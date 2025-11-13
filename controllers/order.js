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
    const services = await Service.find().select('_id name').sort('name').lean();

    // optional preselected customer
    let customer = null;
    const customerId = req.query.customerId;
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
      const Customer = require('../models/customer');
      customer = await Customer.findById(customerId).select('_id firstName businessName phone category').lean();
    }

    res.render('orders/new', { services, customer });
  } catch (err) {
    console.error('newOrderPage error', err);
    res.status(500).send('Error loading order page');
  }
};

exports.viewOrderPage = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).send('Missing orderId');

    // find order and include payments/items
    const orderDoc = await Order.findOne({ orderId }).lean();
    if (!orderDoc) return res.status(404).send('Order not found');

    // Populate printer names for items that reference a printer (non-blocking; keep behavior consistent)
    try {
      const printerIds = Array.from(new Set((orderDoc.items || []).filter(it => it.printer).map(it => String(it.printer))));
      let printers = [];
      if (printerIds.length) {
        printers = await Printer.find({ _id: { $in: printerIds } }).select('_id name').lean();
      }
      const pmap = {};
      printers.forEach(p => { pmap[String(p._id)] = p.name || String(p._id); });
      orderDoc.items = (orderDoc.items || []).map(it => {
        if (it.printer) {
          const pid = String(it.printer);
          return Object.assign({}, it, { printerName: (pmap[pid] || pid) });
        }
        return Object.assign({}, it, { printerName: null });
      });
    } catch (e) {
      console.error('Failed to populate printers for order view', e);
      // keep original items if population fails
      orderDoc.items = orderDoc.items || [];
    }

    // compute payments summary
    let paidSoFar = 0;
    if (orderDoc.payments && Array.isArray(orderDoc.payments)) {
      for (const p of orderDoc.payments) {
        const a = Number(p && p.amount ? p.amount : 0);
        if (!isNaN(a)) paidSoFar += a;
      }
    }
    paidSoFar = Number(paidSoFar.toFixed(2));
    const total = Number(orderDoc.total || 0);
    const outstanding = Number((total - paidSoFar).toFixed(2));

    // render server-side page
    return res.render('orders/view', {
      order: orderDoc,
      paidSoFar,
      outstanding
    });
  } catch (err) {
    console.error('viewOrderPage error', err);
    return res.status(500).send('Error loading order');
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
    items = items.map(it => {
      const pages = Number(it.pages) || 1;
      const fb = (it.fb === true || it.fb === 'true' || it.fb === 1 || it.fb === '1') ? true : false;
      let spoiled = 0;
      if (it.spoiled !== undefined && it.spoiled !== null && String(it.spoiled).trim() !== '') {
        const sp = Number(it.spoiled);
        spoiled = (isNaN(sp) || sp < 0) ? 0 : Math.floor(sp);
      }
      return {
        serviceId: it.serviceId,
        priceRuleId: it.priceRuleId,
        pages,
        fb,
        printerId: it.printerId || null,
        spoiled
      };
    });

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

  // Determine printer-type for this price rule (inspect populated subUnit names)
  let printerType = null;
  try {
    // prefer 'colour' if any subunit contains 'colour' or 'color', otherwise 'monochrome' if present
    const subs = (pr.selections || []).map(s => (s.subUnit && s.subUnit.name) ? String(s.subUnit.name) : '');
    const hasColour = subs.some(n => /colour|color/i.test(n));
    const hasMono = subs.some(n => /monochrome/i.test(n));
    if (hasColour) printerType = 'colour';
    else if (hasMono) printerType = 'monochrome';
  } catch (e) {
    printerType = null;
  }

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
    subtotal,
    spoiled: Number(it.spoiled) || 0,
    printerType // NEW: 'monochrome' | 'colour' | null
  });

  total += subtotal;
}
    total = Number(total.toFixed(2));

    const order = new Order({
      orderId: makeOrderId(),
      items: builtItems,
      total
    });

    const customerId = req.body.customerId;
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
      order.customer = new mongoose.Types.ObjectId(customerId);
    }

    await order.save();

    // If the order has a customer attached, re-evaluate their 'regular' status.
// Do this in background but wait a short time to capture any potential synchronous listeners.
try {
  if (order.customer) {
    // require the customer controller helper and call it (non-blocking)
    const customerController = require('./customer');
    // fire-and-forget but await to handle occasional DB consistency; swallow errors
    customerController.updateRegularStatus(order.customer).catch(err => {
      console.error('updateRegularStatus failed for customer', String(order.customer), err);
    });
  }
} catch (e) {
  console.error('post-order regular update dispatch error', e);
}

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
            let baseCount = 1;
            if (!pages || pages <= 0) {
              baseCount = 1;
            } else {
              if (isFb) baseCount = Math.ceil(pages / 2);
              else baseCount = pages;
            }

            // ensure spoiled is integer >= 0
            const spoiled = (it.spoiled !== undefined && it.spoiled !== null) ? Math.floor(Number(it.spoiled) || 0) : 0;
            const count = Math.max(0, baseCount) + Math.max(0, spoiled);

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

            // decrement stock for the material (allow negative to indicate backorder)
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
        // --- PRINTER USAGE RECORDING ---
try {
  const PrinterUsage = require('../models/printer_usage');
  // for each order item, if printer exists, increment that printer by pages (QTY)
  for (let idx = 0; idx < builtItems.length; idx++) {
    const it = builtItems[idx];
    if (!it.printer) continue;
    // pages (quantity) default is 1 already
    const pages = Number(it.pages) || 1;
    // We record pages as count increment. Do NOT include 'spoiled' for printer count unless you want that
    const count = Math.max(0, Math.floor(pages));

    // determine type for this usage (may be 'monochrome'|'colour'|null)
    const usageType = (it.printerType === 'monochrome' || it.printerType === 'colour') ? it.printerType : null;

    // create usage record
    await PrinterUsage.create({
      printer: it.printer,
      orderId: order.orderId,
      orderRef: order._id,
      itemIndex: idx,
      count,
      type: usageType,
      note: 'order-created'
    });

    // update printer aggregate (atomic increment)
    try {
      if (usageType === 'monochrome') {
        await Printer.findByIdAndUpdate(it.printer, { $inc: { monochromeCount: count, totalCount: count } });
      } else if (usageType === 'colour') {
        await Printer.findByIdAndUpdate(it.printer, { $inc: { colourCount: count, totalCount: count } });
      } else {
        await Printer.findByIdAndUpdate(it.printer, { $inc: { totalCount: count } });
      }
    } catch (pErr) {
      console.error('Failed to increment printer counts', pErr, 'printerId=', it.printer);
    }
  }
} catch (puErr) {
  console.error('Printer usage recording error', puErr);
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

    // Populate printer names for items that reference a printer (keep existing behavior otherwise)
    try {
      const printerIds = Array.from(new Set((order.items || []).filter(it => it.printer).map(it => String(it.printer))));
      if (printerIds.length) {
        const printers = await Printer.find({ _id: { $in: printerIds } }).select('_id name').lean();
        const pmap = {};
        printers.forEach(p => { pmap[String(p._id)] = p.name || String(p._id); });
        // replace item.printer (id) with printer name string for client convenience
        order.items = (order.items || []).map(it => {
          if (it.printer) {
            const pid = String(it.printer);
            return Object.assign({}, it, { printer: (pmap[pid] || pid) });
          }
          return it;
        });
      }
    } catch (pErr) {
      // If printer lookup fails, keep original ids (do not block response)
      console.error('Failed to populate printer names for order items', pErr);
    }

        let customerInfo = null;
    if (order.customer) {
      try {
        const Customer = require('../models/customer');
        const c = await Customer.findById(order.customer).select('_id firstName businessName phone category').lean();
        if (c) {
          customerInfo = c;
        }
      } catch (e) { console.error('Failed to populate customer', e); }
    }

    // Compute payments summary (backwards-compatible: may be undefined)
    let paidSoFar = 0;
    if (order.payments && Array.isArray(order.payments)) {
      for (const p of order.payments) {
        const a = Number(p && p.amount ? p.amount : 0);
        if (!isNaN(a)) paidSoFar += a;
      }
    }
    // round to 2 decimals
    paidSoFar = Number(paidSoFar.toFixed(2));
    const total = Number((order.total || 0));
    const outstanding = Number((total - paidSoFar).toFixed(2));

    // return minimal data plus payments summary
    return res.json({
  ok: true,
  order: {
    orderId: order.orderId,
    total: order.total,
    status: order.status,
    items: order.items,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    paidSoFar,
    outstanding,
    payments: order.payments || [],
    customer: customerInfo
  }
});
  } catch (err) {
    console.error('apiGetOrderById error', err);
    return res.status(500).json({ error: 'Error fetching order' });
  }
};

// API: mark order paid (record payment)
// POST /api/orders/:orderId/pay
exports.apiPayOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: 'No orderId provided' });

    // Accept JSON body for payment metadata:
    // { paymentMethod, momoNumber, momoTxId, chequeNumber, partPayment (bool), partPaymentAmount (number), note }
    const body = req.body || {};
    const method = (body.paymentMethod || 'cash').toString().toLowerCase();
    const isPart = !!body.partPayment;
    let amount = null;
    if (isPart) {
      amount = Number(body.partPaymentAmount || 0);
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Invalid part payment amount' });
      }
    }

    // Load order
    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // If already fully paid, short-circuit
    const currentPaid = order.paidSoFar ? order.paidSoFar() : (order.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if (order.status === 'paid' && (Number(currentPaid) >= Number(order.total || 0))) {
      return res.status(400).json({ error: 'Order already paid' });
    }

    // Determine payment amount to record
    let toRecordAmount = 0;
    if (isPart) {
      toRecordAmount = Number(amount);
    } else {
      // full payment: if client supplied partPaymentAmount treat it as amount, otherwise use remaining outstanding
      if (body.partPaymentAmount) {
        toRecordAmount = Number(body.partPaymentAmount);
      } else {
        // remaining outstanding
        const remaining = Number(order.total || 0) - Number(currentPaid || 0);
        toRecordAmount = remaining > 0 ? remaining : 0;
      }
    }
    if (toRecordAmount <= 0) {
      return res.status(400).json({ error: 'Payment amount must be greater than zero' });
    }

    // Build meta object for momo/cheque etc
    const meta = {};
    if (method === 'momo') {
      if (body.momoNumber) meta.momoNumber = String(body.momoNumber);
      if (body.momoTxId) meta.momoTxId = String(body.momoTxId);
    } else if (method === 'cheque') {
      if (body.chequeNumber) meta.chequeNumber = String(body.chequeNumber);
    }
    // other arbitrary metadata allowed in body.meta
    if (body.meta && typeof body.meta === 'object') {
      Object.assign(meta, body.meta);
    }

    // Create payment record and push
    const payment = {
      method: ['cash','momo','cheque','other'].includes(method) ? method : 'other',
      amount: Number(toRecordAmount),
      meta,
      note: body.note || (isPart ? 'part-payment' : 'full-payment'),
      createdAt: new Date()
    };

    order.payments = order.payments || [];
    order.payments.push(payment);

    // recompute paid so far
    const newPaidSoFar = order.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const outstanding = Number((Number(order.total || 0) - newPaidSoFar).toFixed(2));

    // If fully paid now, mark paid and set paidAt
    if (outstanding <= 0) {
      order.status = 'paid';
      order.paidAt = new Date();
    }

    await order.save();

    return res.json({
      ok: true,
      orderId: order.orderId,
      paidSoFar: Number(newPaidSoFar.toFixed(2)),
      outstanding: Number(outstanding.toFixed(2)),
      status: order.status
    });
  } catch (err) {
    console.error('apiPayOrder error', err);
    return res.status(500).json({ error: 'Error paying order' });
  }
};


// API: list debtors (orders with outstanding > 0)
// GET /api/debtors
exports.apiGetDebtors = async (req, res) => {
  try {
    // aggregate: compute paidSoFar and outstanding per order then filter outstanding > 0
    const rows = await Order.aggregate([
      // compute paidSoFar (sum of payments.amount)
      { $addFields: { paidSoFar: { $sum: { $ifNull: ['$payments.amount', []] } } } },
      // outstanding = total - paidSoFar
      { $addFields: { outstanding: { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$paidSoFar', 0] }] } } },
      // only those with outstanding > 0
      { $match: { outstanding: { $gt: 0 } } },
      // project fields useful for frontend
      { $project: {
        orderId: 1,
        total: 1,
        paidSoFar: 1,
        outstanding: 1,
        // attempt to include a debtor name if present on the order document
        debtorName: { $ifNull: ['$customerName', { $ifNull: ['$customer', null] }] },
        createdAt: 1,
        status: 1
      } },
      { $sort: { outstanding: -1, createdAt: -1 } },
      { $limit: 1000 }
    ]);

    // Normalize output so amounts are numbers with 2 decimals
    const out = (rows || []).map(r => ({
      orderId: r.orderId,
      debtorName: r.debtorName || '',
      amountDue: Number((r.total || 0).toFixed(2)),
      paidSoFar: Number((r.paidSoFar || 0).toFixed(2)),
      outstanding: Number((r.outstanding || 0).toFixed(2)),
      createdAt: r.createdAt,
      status: r.status
    }));

    return res.json({ ok: true, debtors: out });
  } catch (err) {
    console.error('apiGetDebtors error', err);
    return res.status(500).json({ error: 'Error fetching debtors' });
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
