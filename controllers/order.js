// controllers/order.js
const crypto = require('crypto');
const Service = require('../models/service');
const ServicePrice = require('../models/service_price');
const Order = require('../models/order');
const mongoose = require('mongoose');
const Material = require('../models/material');
const { MaterialUsage, MaterialAggregate } = require('../models/material_usage');


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
exports.apiGetPricesForService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(serviceId)) return res.status(400).json({ error: 'Invalid service id' });

    const prices = await ServicePrice.find({ service: serviceId })
      .populate('selections.unit selections.subUnit')
      .lean();

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

    return res.json({ ok: true, prices: out });
  } catch (err) {
    console.error('apiGetPricesForService error', err);
    return res.status(500).json({ error: 'Error fetching prices' });
  }
};

// API: create order
// expects body: { items: [{ serviceId, priceRuleId, pages (optional), fb (optional boolean) } , ...] }
// Server-authoritative pricing: when items[].fb is true and the price rule has price2, use price2.
exports.apiCreateOrder = async (req, res) => {
  try {
    let { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    // normalize pages and fb flag and validate shape
    items = items.map(it => ({
      serviceId: it.serviceId,
      priceRuleId: it.priceRuleId,
      pages: Number(it.pages) || 1,
      fb: (it.fb === true || it.fb === 'true' || it.fb === 1 || it.fb === '1') ? true : false
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

      builtItems.push({
        service: it.serviceId,
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
      // build a set of service ids used in this order
      const serviceIds = Array.from(new Set(builtItems.map(it => String(it.service))));
      // fetch materials that are global (service=null) or match any of these services
      const mats = await Material.find({ $or: [{ service: null }, { service: { $in: serviceIds } }] }).lean();

      // helper: check if mat.selections is subset of item.selections
      function materialMatchesItem(matSelections, itemSelections) {
        // Use string keys "unit:subUnit" for quick lookup
        const itemSet = new Set((itemSelections || []).map(s => `${String(s.unit)}:${String(s.subUnit)}`));
        // every mat selection must exist in itemSet
        for (const ms of (matSelections || [])) {
          const key = `${String(ms.unit)}:${String(ms.subUnit)}`;
          if (!itemSet.has(key)) return false;
        }
        return true;
      }

      // iterate items and materials to record usage
      for (let idx = 0; idx < builtItems.length; idx++) {
        const it = builtItems[idx];
        const itemSelections = it.selections || [];

        for (const m of mats) {
          if (!m.selections || !m.selections.length) continue;
          if (materialMatchesItem(m.selections, itemSelections)) {
            // compute count
            let count = 1;
            if (it.pages && Number(it.pages) > 0) {
              if (it.pages && it.pages > 0) {
                if (it.pages && it.pages !== undefined) {
                  if (it.pages && !isNaN(it.pages)) {
                    if (it.pages && Number(it.pages) > 0) {
                      if (it.pages && it.pages !== undefined) {
                        // if front/back used (we flagged usedFB previously when selecting unitPrice),
                        // but we don't have usedFB saved in builtItems, so detect it from selectionLabel
                      }
                    }
                  }
                }
              }
            }

            // Determine final count using pages & fb detection:
            let pages = Number(it.pages) || 1;
            // detect fb from selectionLabel suffix '(F/B)'
            const isFb = String(it.selectionLabel || '').includes('(F/B)');
            if (!pages || pages <= 0) {
              count = 1;
            } else {
              if (isFb) {
                // each paper holds two pages => papers = ceil(pages/2)
                count = Math.ceil(pages / 2);
              } else {
                count = pages;
              }
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
