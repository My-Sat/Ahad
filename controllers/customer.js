// controllers/customer.js
const Customer = require('../models/customer');
const Order = require('../models/order');
const mongoose = require('mongoose');

/**
 * Render front desk page
 */
exports.frontPage = async (req, res) => {
  try {
    return res.render('customers/front');
  } catch (err) {
    console.error('customer.frontPage error', err);
    return res.status(500).send('Error loading customers page');
  }
};

/**
 * Lookup by phone (existing)
 * GET /api/customers/lookup?phone=...
 */
exports.apiLookupByPhone = async (req, res) => {
  try {
    const phone = (req.query.phone || '').toString().trim();
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const customer = await Customer.findOne({ phone }).lean();
    if (!customer) return res.json({ ok: true, found: false });
    return res.json({ ok: true, found: true, customer });
  } catch (err) {
    console.error('apiLookupByPhone error', err);
    return res.status(500).json({ error: 'Error looking up customer' });
  }
};

/**
 * Create new customer (existing)
 * POST /api/customers
 * body: { category, firstName, businessName, phone, notes }
 */
exports.apiCreateCustomer = async (req, res) => {
  try {
    const body = req.body || {};
    const phone = (body.phone || '').toString().trim();
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    const category = (body.category || 'one_time').toString();
    if (!['one_time','artist','regular','organisation'].includes(category)) return res.status(400).json({ error: 'Invalid category' });

    if (category === 'one_time' && !(body.firstName && body.firstName.trim())) {
      return res.status(400).json({ error: 'First name required for one-time customer' });
    }
    if ((category === 'artist' || category === 'organisation') && !(body.businessName && body.businessName.trim())) {      return res.status(400).json({ error: 'Business name required for artist' });}

    const existing = await Customer.findOne({ phone }).lean();
    if (existing) {
      return res.json({ ok: true, customer: existing, created: false, message: 'Customer already exists' });
    }

    const c = new Customer({
      category,
      firstName: (body.firstName || '').trim(),
      businessName: (body.businessName || '').trim(),
      phone,
      notes: (body.notes || '').trim()
    });

    await c.save();

    // after creating, run regular status check (in case orders exist already)
    try { await exports.updateRegularStatus(c._id); } catch (e) { console.error('post-create regular update failed', e); }

    return res.json({ ok: true, customer: c, created: true });
  } catch (err) {
    console.error('apiCreateCustomer error', err);
    return res.status(500).json({ error: 'Error creating customer' });
  }
};

/**
 * Update customer
 * PATCH /customers/:id
 */
exports.apiUpdateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid customer id' });
    }

    const body = req.body || {};
    const category = (body.category || '').toString();
    const phone = (body.phone || '').toString().trim();

    if (!phone) return res.status(400).json({ error: 'Phone is required' });
    if (!['one_time','artist','regular','organisation'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    if (category === 'one_time' && !(body.firstName && body.firstName.trim())) {
      return res.status(400).json({ error: 'First name required' });
    }

    if ((category === 'artist' || category === 'organisation') &&
        !(body.businessName && body.businessName.trim())) {
      return res.status(400).json({ error: 'Business name required' });
    }

    const customer = await Customer.findById(id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    customer.category = category;
    customer.phone = phone;
    customer.firstName = (body.firstName || '').trim();
    customer.businessName = (body.businessName || '').trim();
    customer.notes = (body.notes || '').trim();

    await customer.save();

    return res.json({ ok: true, customer });
  } catch (err) {
    console.error('apiUpdateCustomer error', err);
    return res.status(500).json({ error: 'Failed to update customer' });
  }
};


/**
 * Helper: updateRegularStatus(customerId)
 * - Counts orders in the last 30 days for this customer
 * - If count >= 5 and customer is not an artist, set category='regular'
 * - If count < 5 and category === 'regular', revert to 'one_time' (so status remains accurate)
 *
 * safe, idempotent, and non-blocking when called
 */
exports.updateRegularStatus = async (customerId) => {
  if (!customerId) return null;
  try {
    if (!mongoose.Types.ObjectId.isValid(customerId)) return null;
    // Do nothing if customer is artist (we must not convert artists)
    const cust = await Customer.findById(customerId).exec();
    if (!cust) return null;
    if (cust.category === 'artist' || cust.category === 'organisation') return cust;
    // compute 30-day window (now - 30 days)
    const now = new Date();
    const since = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

    // count orders for this customer with createdAt >= since
const custObjectId = new mongoose.Types.ObjectId(customerId);

// Match orders in last 30 days even if createdAt is missing
const count = await Order.countDocuments({
  customer: custObjectId,
  $or: [
    { createdAt: { $gte: since } },
    { createdAt: { $exists: false }, _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(since.getTime() / 1000)) } }
  ]
}).exec();

    // Decide new category
    const shouldBeRegular = (count >= 5);

    if (shouldBeRegular && cust.category !== 'regular') {
      cust.category = 'regular';
      await cust.save();
      return cust;
    } else if (!shouldBeRegular && cust.category === 'regular') {
      // revert if previously regular but no longer meets criteria
      cust.category = 'one_time';
      await cust.save();
      return cust;
    }

    return cust;
  } catch (err) {
    console.error('updateRegularStatus error', err);
    return null;
  }
};


/**
 * Search customers for suggestions
 * GET /api/customers/search?q=...  (returns { ok:true, results: [...] })
 * Searches phone, firstName, businessName (case-insensitive) and returns up to 10 results.
 */
exports.apiSearch = async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json({ ok: true, results: [] });

    // fuzzy search: phones or names starting-with or containing the query
    // limit 10
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const docs = await Customer.find({
      $or: [
        { phone: regex },
        { firstName: regex },
        { businessName: regex }
      ]
    }).limit(10).select('_id firstName businessName phone category').lean();

    return res.json({ ok: true, results: docs });
  } catch (err) {
    console.error('apiSearch error', err);
    return res.status(500).json({ error: 'Error searching customers' });
  }
};


/**
 * API: list all customers (admin only)
 * GET /api/customers
 */
exports.apiListCustomers = async (req, res) => {
  try {
    const customers = await Customer.find({})
      .sort({ createdAt: -1 })
      .select('_id category firstName businessName phone createdAt')
      .lean();

    return res.json({ ok: true, customers });
  } catch (err) {
    console.error('apiListCustomers error', err);
    return res.status(500).json({ error: 'Failed to load customers' });
  }
};
