// controllers/customer.js
const Customer = require('../models/customer');
const Order = require('../models/order');
const mongoose = require('mongoose');
const CustomerAccountTxn = require('../models/customer_account_txn');

/**
 * Render front desk page
 */
exports.frontPage = async (req, res) => {
  try {
    return res.render('customers/index', { title: 'Customers' });
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
 * Delete customer (only if no orders exist)
 * DELETE /customers/:id
 */
exports.apiDeleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid customer id' });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Check if customer has any orders
    const hasOrders = await Order.exists({ customer: customer._id });
    if (hasOrders) {
      return res.status(400).json({
        error: 'Cannot delete customer with existing orders'
      });
    }

    await customer.deleteOne();

    return res.json({ ok: true });

  } catch (err) {
    console.error('apiDeleteCustomer error', err);
    return res.status(500).json({ error: 'Failed to delete customer' });
  }
};



/**
 * Helper: updateRegularStatus(customerId)
 * - If count >= 5 in the last 30 days and customer is not an artist, set category='regular'
 * - Regular status is maintained only if the customer has at least one order within the last 3 months
 *
 * safe, idempotent, and non-blocking when called
 */
exports.updateRegularStatus = async (customerId) => {
  if (!customerId) return null;
  try {
    if (!mongoose.Types.ObjectId.isValid(customerId)) return null;
    // Do nothing if customer is artist/organisation (we must not convert them)
    const cust = await Customer.findById(customerId).exec();
    if (!cust) return null;
    if (cust.category === 'artist' || cust.category === 'organisation') return cust;

    const now = new Date();
    const since30Days = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const since3Months = new Date(now);
    since3Months.setMonth(since3Months.getMonth() - 3);

    const custObjectId = new mongoose.Types.ObjectId(customerId);

    // Count orders in last 30 days (fallback to _id time if createdAt missing)
    const count = await Order.countDocuments({
      customer: custObjectId,
      $or: [
        { createdAt: { $gte: since30Days } },
        { createdAt: { $exists: false }, _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(since30Days.getTime() / 1000)) } }
      ]
    }).exec();

    const lastOrder = await Order.findOne({ customer: custObjectId })
      .sort({ createdAt: -1, _id: -1 })
      .select('createdAt _id')
      .lean();
    const lastOrderAt = lastOrder
      ? (lastOrder.createdAt || lastOrder._id.getTimestamp())
      : null;

    const shouldBeRegular = (count >= 5);

    if (shouldBeRegular && cust.category !== 'regular') {
      cust.category = 'regular';
      cust.regularSince = lastOrderAt || now;
      await cust.save();
      return cust;
    }

    if (cust.category === 'regular') {
      if (lastOrderAt && lastOrderAt > (cust.regularSince || new Date(0))) {
        cust.regularSince = lastOrderAt;
      }
      if (!lastOrderAt || lastOrderAt < since3Months) {
        cust.category = 'one_time';
        cust.regularSince = null;
      }
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


exports.apiListCustomers = async (req, res) => {
  try {
    const qRaw = (req.query.q || '').toString().trim();
    const q = qRaw;

    // safety caps (don’t allow someone to request 50k)
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit <= 0) limit = 200;
    limit = Math.min(limit, 500);
    let page = parseInt(req.query.page, 10);
    if (isNaN(page) || page <= 0) page = 1;
    const skip = (page - 1) * limit;

    const filter = {};
    if (q) {
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(esc, 'i');
      filter.$or = [
        { phone: regex },
        { firstName: regex },
        { businessName: regex }
      ];
    }

    const [total, rows] = await Promise.all([
      Customer.countDocuments(filter),
      Customer.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit + 1)
        .select('_id category firstName businessName phone createdAt')
        .lean()
    ]);

    const hasMore = rows.length > limit;
    const customers = hasMore ? rows.slice(0, limit) : rows;

    return res.json({ ok: true, customers, page, limit, hasMore, total: Number(total || 0) });
  } catch (err) {
    console.error('apiListCustomers error', err);
    return res.status(500).json({ error: 'Failed to load customers' });
  }
};

exports.apiCustomerStats = async (req, res) => {
  try {
    const now = new Date();
    const since30Days = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const oidThreshold = mongoose.Types.ObjectId.createFromTime(
      Math.floor(since30Days.getTime() / 1000)
    );

    const [totalCustomers, activeRows] = await Promise.all([
      Customer.countDocuments({}),
      Order.aggregate([
        {
          $match: {
            customer: { $type: 'objectId', $ne: null },
            $or: [
              { createdAt: { $gte: since30Days } },
              { createdAt: { $exists: false }, _id: { $gte: oidThreshold } }
            ]
          }
        },
        { $group: { _id: '$customer' } },
        { $count: 'total' }
      ])
    ]);

    const activeCustomers = (activeRows && activeRows[0] && activeRows[0].total) ? Number(activeRows[0].total) : 0;

    return res.json({
      ok: true,
      totalCustomers: Number(totalCustomers || 0),
      activeCustomers: Number(activeCustomers || 0)
    });
  } catch (err) {
    console.error('apiCustomerStats error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load customer stats' });
  }
};

// GET /customers/:id/orders
// returns minimal list of orders for this customer
exports.apiCustomerOrders = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid customer id' });
    }

    const orders = await Order.find({ customer: new mongoose.Types.ObjectId(id) })
      .select('orderId createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .limit(500)
      .lean();

    const out = (orders || []).map(o => ({
      orderId: o.orderId || String(o._id || ''),
      createdAt: o.createdAt || (o._id ? o._id.getTimestamp() : null)
    }));

    return res.json({ ok: true, orders: out });
  } catch (err) {
    console.error('apiCustomerOrders error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load customer orders' });
  }
};

// GET /customers/:id/account
exports.accountPage = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).lean();
    if (!customer) return res.status(404).send('Customer not found');

    const txns = await CustomerAccountTxn.find({ customer: customer._id })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.render('customers/account', {
      title: 'Customer Account',
      customer,
      txns
    });
  } catch (e) {
    console.error('accountPage error', e);
    return res.status(500).send('Server error');
  }
};

// GET /customers/:id/account/api
exports.apiGetAccount = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).lean();
    if (!customer) return res.status(404).json({ ok: false, error: 'Customer not found' });

    const txns = await CustomerAccountTxn.find({ customer: customer._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const accountSettledOrders = await Order.find({
      customer: customer._id,
      'payments.method': 'account'
    })
      .select('orderId')
      .lean();

    const accountSettledOrderIds = (accountSettledOrders || [])
      .map(o => String(o.orderId || '').trim())
      .filter(Boolean);

    return res.json({
      ok: true,
      customer: { _id: customer._id, accountBalance: Number(customer.accountBalance || 0) },
      txns,
      accountSettledOrderIds
    });
  } catch (e) {
    console.error('apiGetAccount error', e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
};

// POST /customers/:id/account/adjust { type: 'credit'|'debit', amount, note }
exports.apiAdjustAccount = async (req, res) => {
  let session = null;

  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid customer id' });
    }

    const type = String(req.body.type || '').toLowerCase().trim();
    const rawAmount = Number(req.body.amount || 0);
    const note = String(req.body.note || '').trim();

    if (!['credit', 'debit'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'Invalid type' });
    }
    if (!rawAmount || isNaN(rawAmount) || rawAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'Enter a valid amount' });
    }

    const amount = Number(rawAmount.toFixed(2));

    const recordedBy = req.user?._id || null;
    const recordedByName = req.user?.name || req.user?.username || '';

    session = await mongoose.startSession();
    let updatedCustomer = null;
    let settledAmount = 0;
    let settledOrdersCount = 0;

    await session.withTransaction(async () => {
      updatedCustomer = await Customer.findById(id).session(session);
      if (!updatedCustomer) {
        const e = new Error('Customer not found');
        e.statusCode = 404;
        throw e;
      }

      const currentBal = Number(updatedCustomer.accountBalance || 0);

      if (type === 'debit') {
        // Manual debit should always be allowed (it can create/expand debt).
        // It only consumes available credit if any.
        const consume = Number(Math.min(currentBal, amount).toFixed(2));
        updatedCustomer.accountBalance = Number((currentBal - consume).toFixed(2));
      } else {
        // Add credit first, then auto-settle customer debts (oldest outstanding orders first).
        updatedCustomer.accountBalance = Number((currentBal + amount).toFixed(2));
      }

      await updatedCustomer.save({ session });

      // Always record the manual adjustment itself.
      await CustomerAccountTxn.create([{
        customer: updatedCustomer._id,
        type,
        amount,
        note,
        recordedBy,
        recordedByName
      }], { session });

      if (type === 'credit') {
        let available = Number(updatedCustomer.accountBalance || 0);
        if (available > 0) {
          const openOrders = await Order.find({ customer: updatedCustomer._id })
            .sort({ createdAt: 1, _id: 1 })
            .session(session);

          for (const order of openOrders) {
            const paidSoFar = (order.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
            const outstanding = Number((Number(order.total || 0) - paidSoFar).toFixed(2));
            if (outstanding <= 0) continue;
            if (available <= 0) break;

            const use = Number(Math.min(available, outstanding).toFixed(2));
            if (use <= 0) continue;

            order.payments = order.payments || [];
            order.payments.push({
              method: 'account',
              amount: use,
              meta: { source: 'manual_credit_auto_settle' },
              note: `Auto-settled from manual credit`,
              createdAt: new Date(),
              recordedBy: recordedBy || null,
              recordedByName
            });

            const newPaid = (order.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
            const newOutstanding = Number((Number(order.total || 0) - newPaid).toFixed(2));
            if (newOutstanding <= 0) {
              order.status = 'paid';
              order.paidAt = new Date();
            }

            await order.save({ session });
            available = Number((available - use).toFixed(2));
            settledAmount = Number((settledAmount + use).toFixed(2));
            settledOrdersCount += 1;
          }

          updatedCustomer.accountBalance = Number(Math.max(0, available).toFixed(2));
          await updatedCustomer.save({ session });
        }
      }
    });

    return res.json({
      ok: true,
      balance: Number(updatedCustomer.accountBalance || 0),
      settledAmount: Number(settledAmount || 0),
      settledOrdersCount: Number(settledOrdersCount || 0)
    });
  } catch (e) {
    console.error('apiAdjustAccount error', e);
    if (e && e.statusCode) return res.status(e.statusCode).json({ ok: false, error: e.message });
    return res.status(500).json({ ok: false, error: 'Server error' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};
