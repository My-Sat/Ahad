// controllers/orders.js
const crypto = require('crypto');
const Service = require('../models/service');
const ServicePrice = require('../models/service_price');
const Order = require('../models/order');
const Printer = require('../models/printer');
const mongoose = require('mongoose');
const Material = require('../models/material');
const { MaterialUsage, MaterialAggregate } = require('../models/material_usage');
const { ObjectId } = require('mongoose').Types;



function makeOrderId() {
  // short, human-readable id: 8 chars base36
  return (Date.now().toString(36) + crypto.randomBytes(3).toString('hex')).slice(-10).toUpperCase();
}

// Render order creation page
exports.newOrderPage = async (req, res) => {
  try {
    // load basic services list (name + id)
    const services = await Service.find().select('_id name').sort('name').lean();
    res.render('orders/new', { services });
  } catch (err) {
    console.error('newOrderPage error', err);
    res.status(500).send('Error loading order page');
  }
};

// Render payment page
exports.payPage = async (req, res) => {
  try {
    res.render('orders/pay');
  } catch (err) {
    console.error('payPage error', err);
    res.status(500).send('Error loading payment page');
  }
};

// API: return price rules (composite selections) for a service
// ALSO returns whether service requires a printer and list of printers
exports.apiGetPricesForService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(serviceId)) return res.status(400).json({ error: 'Invalid service id' });

    // Determine if service requires a printer
    const serviceDoc = await Service.findById(serviceId).lean();
    const serviceRequiresPrinter = !!(serviceDoc && serviceDoc.requiresPrinter);

    const prices = await ServicePrice.find({ service: serviceId })
      .populate('selections.unit selections.subUnit')
      .lean();

    // fetch printers list for client to show if needed
    const printers = await Printer.find().select('_id name').sort('name').lean();

    const out = prices.map(p => ({
      _id: p._id,
      selectionLabel: p.selectionLabel || ((p.selections || []).map(s => {
        const u = s.unit && s.unit.name ? s.unit.name : String(s.unit);
        const su = s.subUnit && s.subUnit.name ? s.subUnit.name : String(s.subUnit);
        return `${u}: ${su}`;
      }).join(' + ')),
      unitPrice: p.price,
      price2: (p.price2 !== undefined && p.price2 !== null) ? p.price2 : null
    }));

    return res.json({ ok: true, prices: out, serviceRequiresPrinter, printers });
  } catch (err) {
    console.error('apiGetPricesForService error', err);
    return res.status(500).json({ error: 'Error fetching prices' });
  }
};

// API: create order
// expects body: { items: [{ serviceId, priceRuleId, pages (optional), fb (optional boolean), printerId (optional) } , ...] }
// Server-authoritative pricing: when items[].fb is true and the price rule has price2, use price2.
exports.apiCreateOrder = async (req, res) => {
  try {
    let { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    // normalize pages, fb flag and validate shape; also normalize printerId (may be null)
    items = items.map(it => ({
      serviceId: it.serviceId,
      priceRuleId: it.priceRuleId,
      pages: Number(it.pages) || 1,
      fb: (it.fb === true || it.fb === 'true' || it.fb === 1 || it.fb === '1') ? true : false,
      printerId: it.printerId || null
    }));

    const builtItems = [];
    let total = 0;

    for (const it of items) {
      if (!mongoose.Types.ObjectId.isValid(it.serviceId) || !mongoose.Types.ObjectId.isValid(it.priceRuleId)) {
        return res.status(400).json({ error: 'Invalid IDs in items' });
      }

      // populate selections/unit/subUnit so we can store and later match materials
      const pr = await ServicePrice.findById(it.priceRuleId).populate('selections.unit selections.subUnit').lean();
      if (!pr) return res.status(404).json({ error: `Price rule ${it.priceRuleId} not found` });

      // Determine which price to use: use price2 only when client requested FB and price2 exists
      let unitPrice = Number(pr.price);
      let usedFB = false;
      if (it.fb && pr.price2 !== undefined && pr.price2 !== null) {
        unitPrice = Number(pr.price2);
        usedFB = true;
      }

      const pages = Number(it.pages) || 1;
      const subtotal = Number((unitPrice * pages).toFixed(2));

      // build human-friendly selection label
      const selectionLabel = pr.selectionLabel || ((pr.selections || []).map(s => {
        const u = s.unit && s.unit.name ? s.unit.name : String(s.unit);
        const su = s.subUnit && s.subUnit.name ? s.subUnit.name : String(s.subUnit);
        return `${u}: ${su}`;
      }).join(' + ')) + (usedFB ? ' (F/B)' : '');

      // store selections as unit/subUnit objectIds (not populated objects)
      const selectionsForOrder = (pr.selections || []).map(s => ({
        unit: s.unit && s.unit._id ? s.unit._id : s.unit,
        subUnit: s.subUnit && s.subUnit._id ? s.subUnit._id : s.subUnit
      }));

      // Check whether this service requires a printer
      const svc = await Service.findById(it.serviceId).lean();
      const svcRequiresPrinter = !!(svc && svc.requiresPrinter);

      // validate printer if required
      let printerId = null;
      if (svcRequiresPrinter) {
        if (!it.printerId || !mongoose.Types.ObjectId.isValid(it.printerId)) {
          return res.status(400).json({ error: 'Printer required for one or more items' });
        }
        const prDoc = await Printer.findById(it.printerId).lean();
        if (!prDoc) return res.status(400).json({ error: `Printer ${it.printerId} not found` });
        printerId = new mongoose.Types.ObjectId(it.printerId);
      } else {
        // if provided but invalid, ignore or validate format
        if (it.printerId && mongoose.Types.ObjectId.isValid(it.printerId)) {
          // allow storing if client provided printer for non-required service (optional)
          const maybePrinter = await Printer.findById(it.printerId).lean();
          if (maybePrinter) printerId = new mongoose.Types.ObjectId(it.printerId);
        }
      }

      builtItems.push({
        service: it.serviceId,
        printer: printerId, // may be null
        selections: selectionsForOrder,
        selectionLabel,
        unitPrice,
        pages,
        subtotal
      });

      total += subtotal;
    }

    total = Number(total.toFixed(2));

    const order = new Order({
      orderId: makeOrderId(),
      items: builtItems,
      total
    });

    await order.save();

    // --- MATERIAL MATCHING & RECORDING ---
    try {
      // load all materials (global + those scoped to services involved)
      const serviceIds = Array.from(new Set(builtItems.map(it => String(it.service))));
      const mats = await Material.find().lean();

      function materialMatchesItem(matSelections, itemSelections) {
        const itemSet = new Set((itemSelections || []).map(s => `${String(s.unit)}:${String(s.subUnit)}`));
        for (const ms of (matSelections || [])) {
          const key = `${String(ms.unit)}:${String(ms.subUnit)}`;
          if (!itemSet.has(key)) return false;
        }
        return true;
      }

      for (let idx = 0; idx < builtItems.length; idx++) {
        const it = builtItems[idx];
        const itemSelections = it.selections || [];

        for (const m of mats) {
          if (!m.selections || !m.selections.length) continue;
          if (materialMatchesItem(m.selections, itemSelections)) {
            // Determine final count using pages & fb detection:
            let pages = Number(it.pages) || 1;
            const isFb = String(it.selectionLabel || '').includes('(F/B)');
            let count = 1;
            if (!pages || pages <= 0) {
              count = 1;
            } else {
              if (isFb) count = Math.ceil(pages / 2);
              else count = pages;
            }

            // create usage record
            await MaterialUsage.create({
              material: m._id,
              orderId: order.orderId,
              orderRef: order._id,
              itemIndex: idx,
              count
            });

            // update aggregate total (atomic increment)
            await MaterialAggregate.findOneAndUpdate(
              { material: m._id },
              { $inc: { total: count } },
              { upsert: true, new: true }
            );

            // NEW: decrement stock for the material (allow negative to indicate backorder)
            // We decrement even if stock becomes negative (so admins can spot shortages)
            try {
              await Material.findByIdAndUpdate(m._id, { $inc: { stock: -count } });
            } catch (stockErr) {
              console.error('Failed to decrement material stock', stockErr, 'materialId=', m._id);
            }
          }
        }
      }
    } catch (matErr) {
      // material recording failure should not block order creation, but we log it
      console.error('Material matching/recording error', matErr);
    }
    // return order info
    return res.json({ ok: true, orderId: order.orderId, total });
  } catch (err) {
    console.error('apiCreateOrder error', err);
    return res.status(500).json({ error: 'Error creating order' });
  }
};

// API: fetch order by orderId (returns order summary)
exports.apiGetOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: 'No orderId provided' });

    const order = await Order.findOne({ orderId }).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // return minimal data
    return res.json({
      ok: true,
      order: {
        orderId: order.orderId,
        total: order.total,
        status: order.status,
        items: order.items,
        createdAt: order.createdAt,
        paidAt: order.paidAt
      }
    });
  } catch (err) {
    console.error('apiGetOrderById error', err);
    return res.status(500).json({ error: 'Error fetching order' });
  }
};

// API: mark order paid
// POST /api/orders/:orderId/pay
exports.apiPayOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: 'No orderId provided' });

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'paid') return res.status(400).json({ error: 'Order already paid' });

    order.status = 'paid';
    order.paidAt = new Date();
    await order.save();

    return res.json({ ok: true, orderId: order.orderId });
  } catch (err) {
    console.error('apiPayOrder error', err);
    return res.status(500).json({ error: 'Error paying order' });
  }
};

// controllers/orders.js  (add this export near the bottom of the file)
exports.apiListOrders = async (req, res) => {
  try {
    // Accepts ?from=YYYY-MM-DD&to=YYYY-MM-DD
    const { from, to } = req.query || {};
    // Helper: parse YYYY-MM-DD into Date start/end-of-day
    function parseDateStart(dstr) {
      if (!dstr) return null;
      const d = new Date(dstr + 'T00:00:00Z');
      if (isNaN(d.getTime())) return null;
      return d;
    }
    function parseDateEnd(dstr) {
      if (!dstr) return null;
      const d = new Date(dstr + 'T23:59:59.999Z');
      if (isNaN(d.getTime())) return null;
      return d;
    }

    // Default: today in server UTC (client is Africa/Accra but server should interpret ISO date)
    const todayIso = new Date();
    const defaultFrom = new Date(Date.UTC(todayIso.getUTCFullYear(), todayIso.getUTCMonth(), todayIso.getUTCDate(), 0, 0, 0, 0));
    const defaultTo = new Date(Date.UTC(todayIso.getUTCFullYear(), todayIso.getUTCMonth(), todayIso.getUTCDate(), 23, 59, 59, 999));

    const start = parseDateStart(from) || defaultFrom;
    const end = parseDateEnd(to) || defaultTo;

    // Protect: don't allow huge ranges — limit to 365 days by default
    const maxRangeMs = 365 * 24 * 60 * 60 * 1000;
    if (end - start > maxRangeMs) {
      return res.status(400).json({ error: 'Date range too large (max 365 days)' });
    }

    // Query orders in range, newest first, limit to 1000 for safety
    const q = { createdAt: { $gte: start, $lte: end } };
    const orders = await Order.find(q)
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    // Map to minimal info the client needs in the list
    const out = orders.map(o => ({
      _id: o._id,
      orderId: o.orderId,
      total: o.total,
      status: o.status,
      createdAt: o.createdAt
    }));

    return res.json({ ok: true, orders: out });
  } catch (err) {
    console.error('apiListOrders error', err);
    return res.status(500).json({ error: 'Error listing orders' });
  }
};
