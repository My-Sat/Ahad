// controllers/order.js
const crypto = require('crypto');
const Service = require('../models/service');
const ServicePrice = require('../models/service_price');
const Order = require('../models/order');
const mongoose = require('mongoose');

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

    // ServicePrice documents store selections + price; populate for readable labels
    const prices = await ServicePrice.find({ service: serviceId })
      .populate('selections.unit selections.subUnit')
      .lean();

    // ensure we return selectionLabel + price + id
    const out = prices.map(p => ({
      _id: p._id,
      selectionLabel: p.selectionLabel || ((p.selections || []).map(s => {
        const u = s.unit && s.unit.name ? s.unit.name : String(s.unit);
        const su = s.subUnit && s.subUnit.name ? s.subUnit.name : String(s.subUnit);
        return `${u}: ${su}`;
      }).join(' + ')),
      unitPrice: p.price
    }));

    return res.json({ ok: true, prices: out });
  } catch (err) {
    console.error('apiGetPricesForService error', err);
    return res.status(500).json({ error: 'Error fetching prices' });
  }
};

// API: create order
// expects body: { items: [{ serviceId, priceRuleId, pages (optional) } , ...] }
// We look up price rule(s) to get unit price and selection label, compute subtotal and total, save Order with generated orderId
exports.apiCreateOrder = async (req, res) => {
  try {
    let { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    // normalize pages and validate
    items = items.map(it => ({
      serviceId: it.serviceId,
      priceRuleId: it.priceRuleId,
      pages: Number(it.pages) || 1
    }));

    const builtItems = [];
    let total = 0;

    for (const it of items) {
      if (!mongoose.Types.ObjectId.isValid(it.serviceId) || !mongoose.Types.ObjectId.isValid(it.priceRuleId)) {
        return res.status(400).json({ error: 'Invalid IDs in items' });
      }

      const pr = await ServicePrice.findById(it.priceRuleId).populate('selections.unit selections.subUnit').lean();
      if (!pr) return res.status(404).json({ error: `Price rule ${it.priceRuleId} not found` });

      const unitPrice = Number(pr.price);
      const pages = Number(it.pages) || 1;
      const subtotal = Number((unitPrice * pages).toFixed(2));

      // build human-friendly selection label
      const selectionLabel = pr.selectionLabel || ((pr.selections || []).map(s => {
        const u = s.unit && s.unit.name ? s.unit.name : String(s.unit);
        const su = s.subUnit && s.subUnit.name ? s.subUnit.name : String(s.subUnit);
        return `${u}: ${su}`;
      }).join(' + '));

      builtItems.push({
        service: it.serviceId,
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
