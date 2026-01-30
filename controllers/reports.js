// controllers/reports.js
const Order = require('../models/order');
const User = require('../models/user');
const CashierBalance = require('../models/cashier_balance');
const CashierCollection = require('../models/cashier_collection');
const AccountantAccount = require('../models/accountant_account');
const Customer = require('../models/customer');
const CustomerAccountTxn = require('../models/customer_account_txn');
const mongoose = require('mongoose');

function isoDate(d) {
  const dt = d ? new Date(d) : new Date();
  const yr = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yr}-${mm}-${dd}`;
}

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

function getRangeFromQuery(req) {
  const { from, to } = req.query || {};
  const today = new Date();
  const defaultFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));
  const defaultTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999));

  const start = parseDateStart(from) || defaultFrom;
  const end = parseDateEnd(to) || defaultTo;

  return { start, end, from: isoDate(start), to: isoDate(end) };
}

exports.page = async (req, res) => {
  try {
    const today = isoDate(new Date());
    return res.render('admin/reports', {
      title: 'Reports',
      defaultFrom: today,
      defaultTo: today
    });
  } catch (err) {
    console.error('reports page error', err);
    return res.status(500).send('Error loading reports page');
  }
};

exports.apiFinancialSummary = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);

    const matchOrders = { createdAt: { $gte: start, $lte: end } };

    const summaryAgg = await Order.aggregate([
      { $match: matchOrders },
      { $addFields: { paidSoFar: { $sum: { $ifNull: ['$payments.amount', []] } } } },
      { $addFields: { outstanding: { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$paidSoFar', 0] }] } } },
      {
        $group: {
          _id: null,
          ordersCount: { $sum: 1 },
          totalOrdersAmount: { $sum: { $ifNull: ['$total', 0] } },
          totalOutstandingAmount: { $sum: { $ifNull: ['$outstanding', 0] } },
          paidOrdersCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          totalPaidOrdersAmount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, { $ifNull: ['$total', 0] }, 0] } }
        }
      }
    ]);

    const summary = summaryAgg && summaryAgg.length ? summaryAgg[0] : {
      ordersCount: 0,
      totalOrdersAmount: 0,
      totalOutstandingAmount: 0,
      paidOrdersCount: 0,
      totalPaidOrdersAmount: 0
    };

    const paymentsAgg = await Order.aggregate([
      { $unwind: '$payments' },
      { $match: { 'payments.createdAt': { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $ifNull: ['$payments.method', 'unknown'] },
          total: { $sum: { $ifNull: ['$payments.amount', 0] } },
          count: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } }
    ]);

    const paymentsByMethod = (paymentsAgg || []).map(p => ({
      method: String(p._id || 'unknown'),
      total: Number((p.total || 0).toFixed(2)),
      count: Number(p.count || 0)
    }));

    const totalPaymentsReceived = paymentsByMethod.reduce((s, p) => s + Number(p.total || 0), 0);

    return res.json({
      ok: true,
      range: { from, to },
      summary: {
        ordersCount: Number(summary.ordersCount || 0),
        paidOrdersCount: Number(summary.paidOrdersCount || 0),
        totalOrdersAmount: Number((summary.totalOrdersAmount || 0).toFixed(2)),
        totalPaidOrdersAmount: Number((summary.totalPaidOrdersAmount || 0).toFixed(2)),
        totalOutstandingAmount: Number((summary.totalOutstandingAmount || 0).toFixed(2)),
        totalPaymentsReceived: Number(totalPaymentsReceived.toFixed(2))
      },
      paymentsByMethod
    });
  } catch (err) {
    console.error('apiFinancialSummary error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load financial summary' });
  }
};

exports.apiCashierCollections = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);

    const cashiers = await User.find({
      role: { $in: ['cashier', 'admin'] }
    }).select('_id name username role').lean();

    const cashierIds = cashiers.map(c => c._id).filter(Boolean);

    const paymentsByCashier = await Order.aggregate([
      { $unwind: '$payments' },
      {
        $match: {
          'payments.method': { $in: ['cash', 'momo', 'cheque'] },
          'payments.createdAt': { $gte: start, $lte: end },
          'payments.recordedBy': { $exists: true, $ne: null }
        }
      },
      { $group: { _id: '$payments.recordedBy', total: { $sum: '$payments.amount' } } }
    ]);
    const payMap = {};
    paymentsByCashier.forEach(p => { payMap[String(p._id)] = Number(p.total || 0); });

    const collections = await CashierCollection.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: '$cashier', totalCollected: { $sum: '$amount' } } }
    ]);
    const colMap = {};
    collections.forEach(c => { colMap[String(c._id)] = Number(c.totalCollected || 0); });

    const balances = await CashierBalance.find({ cashier: { $in: cashierIds } }).lean();
    const balMap = {};
    balances.forEach(b => { balMap[String(b.cashier)] = Number(b.balance || 0); });

    const out = cashiers.map(c => {
      const id = String(c._id);
      const totalCashRecorded = Number((payMap[id] || 0).toFixed(2));
      const alreadyCollected = Number((colMap[id] || 0).toFixed(2));
      const previousBalance = Number((balMap[id] || 0).toFixed(2));
      const uncollected = Number(Math.max(0, totalCashRecorded - alreadyCollected).toFixed(2));
      return {
        cashierId: id,
        name: c.name || c.username || id,
        totalCashRecorded,
        alreadyCollected,
        uncollected,
        previousBalance
      };
    });

    return res.json({ ok: true, range: { from, to }, cashiers: out });
  } catch (err) {
    console.error('apiCashierCollections error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load cashier collections' });
  }
};

exports.apiAccountantLedger = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);

    const rows = await AccountantAccount.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: '$accountant', totalCollected: { $sum: '$totalCollected' } } }
    ]);

    const userIds = rows.map(r => r._id).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } })
      .select('_id name username')
      .lean();
    const umap = {};
    users.forEach(u => { umap[String(u._id)] = u; });

    const out = rows.map(r => {
      const u = umap[String(r._id)] || {};
      return {
        accountantId: String(r._id),
        name: u.name || u.username || String(r._id),
        totalCollected: Number((r.totalCollected || 0).toFixed(2))
      };
    }).sort((a, b) => b.totalCollected - a.totalCollected);

    return res.json({ ok: true, range: { from, to }, accountants: out });
  } catch (err) {
    console.error('apiAccountantLedger error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load accountant ledger' });
  }
};

exports.apiDebtorsAging = async (req, res) => {
  try {
    const asOfParam = (req.query && req.query.asOf) ? String(req.query.asOf) : null;
    const asOf = asOfParam ? parseDateEnd(asOfParam) : new Date();
    const asOfDate = asOf || new Date();

    const bucketsAgg = await Order.aggregate([
      { $addFields: { createdAtSafe: { $ifNull: ['$createdAt', { $toDate: '$_id' }] } } },
      { $addFields: { paidSoFar: { $sum: { $ifNull: ['$payments.amount', []] } } } },
      { $addFields: { outstanding: { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$paidSoFar', 0] }] } } },
      { $match: { outstanding: { $gt: 0 } } },
      {
        $addFields: {
          ageDays: {
            $floor: {
              $divide: [
                { $subtract: [asOfDate, '$createdAtSafe'] },
                1000 * 60 * 60 * 24
              ]
            }
          }
        }
      },
      {
        $addFields: {
          ageBucket: {
            $switch: {
              branches: [
                { case: { $lte: ['$ageDays', 7] }, then: '0-7' },
                { case: { $and: [{ $gt: ['$ageDays', 7] }, { $lte: ['$ageDays', 30] }] }, then: '8-30' },
                { case: { $and: [{ $gt: ['$ageDays', 30] }, { $lte: ['$ageDays', 60] }] }, then: '31-60' },
                { case: { $and: [{ $gt: ['$ageDays', 60] }, { $lte: ['$ageDays', 90] }] }, then: '61-90' }
              ],
              default: '90+'
            }
          }
        }
      },
      {
        $group: {
          _id: '$ageBucket',
          count: { $sum: 1 },
          totalOutstanding: { $sum: '$outstanding' }
        }
      }
    ]);

    const topDebtorsAgg = await Order.aggregate([
      { $addFields: { paidSoFar: { $sum: { $ifNull: ['$payments.amount', []] } } } },
      { $addFields: { outstanding: { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$paidSoFar', 0] }] } } },
      { $match: { outstanding: { $gt: 0 } } },
      {
        $lookup: {
          from: 'customers',
          localField: 'customer',
          foreignField: '_id',
          as: 'customer_doc'
        }
      },
      { $addFields: { customer_doc: { $arrayElemAt: ['$customer_doc', 0] } } },
      {
        $addFields: {
          debtorName: {
            $ifNull: [
              '$customerName',
              {
                $cond: [
                  { $ifNull: ['$customer_doc', false] },
                  {
                    $cond: [
                      { $in: ['$customer_doc.category', ['artist', 'organisation']] },
                      { $ifNull: ['$customer_doc.businessName', { $ifNull: ['$customer_doc.phone', 'Customer'] }] },
                      { $ifNull: ['$customer_doc.firstName', { $ifNull: ['$customer_doc.businessName', { $ifNull: ['$customer_doc.phone', 'Customer'] }] }] }
                    ]
                  },
                  'Walk-in'
                ]
              }
            ]
          }
        }
      },
      {
        $group: {
          _id: '$debtorName',
          totalOutstanding: { $sum: '$outstanding' },
          ordersCount: { $sum: 1 }
        }
      },
      { $sort: { totalOutstanding: -1 } },
      { $limit: 10 }
    ]);

    return res.json({
      ok: true,
      asOf: isoDate(asOfDate),
      buckets: (bucketsAgg || []).map(b => ({
        bucket: b._id,
        count: Number(b.count || 0),
        totalOutstanding: Number((b.totalOutstanding || 0).toFixed(2))
      })),
      topDebtors: (topDebtorsAgg || []).map(d => ({
        name: d._id || 'Unknown',
        ordersCount: Number(d.ordersCount || 0),
        totalOutstanding: Number((d.totalOutstanding || 0).toFixed(2))
      }))
    });
  } catch (err) {
    console.error('apiDebtorsAging error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load debtors aging' });
  }
};

exports.apiDiscountsSummary = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);

    const discountsAgg = await Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $addFields: { discountAmount: { $ifNull: ['$discountAmount', 0] } } },
      { $match: { discountAmount: { $gt: 0 } } },
      {
        $addFields: {
          discountScope: { $ifNull: ['$discountBreakdown.scope', 'unknown'] }
        }
      },
      {
        $group: {
          _id: '$discountScope',
          totalDiscountAmount: { $sum: '$discountAmount' },
          ordersCount: { $sum: 1 }
        }
      },
      { $sort: { totalDiscountAmount: -1 } }
    ]);

    const totalDiscountAmount = discountsAgg.reduce((s, d) => s + Number(d.totalDiscountAmount || 0), 0);
    const discountedOrdersCount = discountsAgg.reduce((s, d) => s + Number(d.ordersCount || 0), 0);

    return res.json({
      ok: true,
      range: { from, to },
      totalDiscountAmount: Number(totalDiscountAmount.toFixed(2)),
      discountedOrdersCount: Number(discountedOrdersCount || 0),
      byScope: discountsAgg.map(d => ({
        scope: d._id || 'unknown',
        totalDiscountAmount: Number((d.totalDiscountAmount || 0).toFixed(2)),
        ordersCount: Number(d.ordersCount || 0)
      }))
    });
  } catch (err) {
    console.error('apiDiscountsSummary error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load discounts summary' });
  }
};

exports.apiOrdersByStatus = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);

    const rows = await Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $addFields: { paidSoFar: { $sum: { $ifNull: ['$payments.amount', []] } } } },
      { $addFields: { outstanding: { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$paidSoFar', 0] }] } } },
      {
        $group: {
          _id: '$status',
          ordersCount: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$total', 0] } },
          outstandingAmount: { $sum: { $ifNull: ['$outstanding', 0] } }
        }
      }
    ]);

    const out = (rows || []).map(r => ({
      status: r._id || 'unknown',
      ordersCount: Number(r.ordersCount || 0),
      totalAmount: Number((r.totalAmount || 0).toFixed(2)),
      outstandingAmount: Number((r.outstandingAmount || 0).toFixed(2))
    }));

    return res.json({ ok: true, range: { from, to }, rows: out });
  } catch (err) {
    console.error('apiOrdersByStatus error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load orders by status' });
  }
};

exports.apiOrdersByStaff = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);

    const rows = await Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: '$handledBy',
          ordersCount: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$total', 0] } },
          paidOrdersCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          totalPaidAmount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, { $ifNull: ['$total', 0] }, 0] } }
        }
      }
    ]);

    const userIds = rows.map(r => r._id).filter(id => id);
    const users = await User.find({ _id: { $in: userIds } })
      .select('_id name username')
      .lean();
    const umap = {};
    users.forEach(u => { umap[String(u._id)] = u; });

    const out = (rows || []).map(r => {
      const key = r._id ? String(r._id) : '';
      const u = key ? (umap[key] || {}) : {};
      return {
        staffId: key || null,
        name: key ? (u.name || u.username || key) : 'Unassigned',
        ordersCount: Number(r.ordersCount || 0),
        totalAmount: Number((r.totalAmount || 0).toFixed(2)),
        paidOrdersCount: Number(r.paidOrdersCount || 0),
        totalPaidAmount: Number((r.totalPaidAmount || 0).toFixed(2))
      };
    }).sort((a, b) => b.totalAmount - a.totalAmount);

    return res.json({ ok: true, range: { from, to }, rows: out });
  } catch (err) {
    console.error('apiOrdersByStaff error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load orders by staff' });
  }
};

exports.apiSalesByService = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);

    const rows = await Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.service',
          itemsCount: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$items.subtotal', 0] } }
        }
      },
      { $sort: { totalAmount: -1 } },
      { $limit: 100 },
      {
        $lookup: {
          from: 'services',
          localField: '_id',
          foreignField: '_id',
          as: 'service'
        }
      },
      { $addFields: { service: { $arrayElemAt: ['$service', 0] } } },
      {
        $project: {
          serviceId: '$_id',
          serviceName: { $ifNull: ['$service.name', 'Unknown'] },
          categoryId: '$service.category',
          itemsCount: 1,
          totalAmount: 1
        }
      }
    ]);

    const out = (rows || []).map(r => ({
      serviceId: r.serviceId ? String(r.serviceId) : null,
      serviceName: r.serviceName || 'Unknown',
      categoryId: r.categoryId ? String(r.categoryId) : null,
      itemsCount: Number(r.itemsCount || 0),
      totalAmount: Number((r.totalAmount || 0).toFixed(2))
    }));

    return res.json({ ok: true, range: { from, to }, rows: out });
  } catch (err) {
    console.error('apiSalesByService error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load sales by service' });
  }
};

exports.apiSalesByCategory = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);

    const rows = await Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'services',
          localField: 'items.service',
          foreignField: '_id',
          as: 'service'
        }
      },
      { $addFields: { service: { $arrayElemAt: ['$service', 0] } } },
      {
        $group: {
          _id: '$service.category',
          itemsCount: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$items.subtotal', 0] } },
          services: { $addToSet: '$items.service' }
        }
      },
      { $sort: { totalAmount: -1 } },
      {
        $lookup: {
          from: 'servicecategories',
          localField: '_id',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $addFields: { category: { $arrayElemAt: ['$category', 0] } } },
      {
        $project: {
          categoryId: '$_id',
          categoryName: { $ifNull: ['$category.name', 'Uncategorized'] },
          itemsCount: 1,
          servicesCount: { $size: '$services' },
          totalAmount: 1
        }
      }
    ]);

    const out = (rows || []).map(r => ({
      categoryId: r.categoryId ? String(r.categoryId) : null,
      categoryName: r.categoryName || 'Uncategorized',
      itemsCount: Number(r.itemsCount || 0),
      servicesCount: Number(r.servicesCount || 0),
      totalAmount: Number((r.totalAmount || 0).toFixed(2))
    }));

    return res.json({ ok: true, range: { from, to }, rows: out });
  } catch (err) {
    console.error('apiSalesByCategory error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load sales by category' });
  }
};

exports.apiCustomerSummary = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);

    const rows = await Order.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end }, customer: { $ne: null } } },
      { $addFields: { paidSoFar: { $sum: { $ifNull: ['$payments.amount', []] } } } },
      { $addFields: { outstanding: { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$paidSoFar', 0] }] } } },
      {
        $group: {
          _id: '$customer',
          ordersCount: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$total', 0] } },
          paidAmount: { $sum: { $ifNull: ['$paidSoFar', 0] } },
          outstandingAmount: { $sum: { $ifNull: ['$outstanding', 0] } },
          lastOrderAt: { $max: '$createdAt' }
        }
      },
      { $sort: { totalAmount: -1 } },
      { $limit: 200 }
    ]);

    const customerIds = rows.map(r => r._id).filter(Boolean);
    const customers = await Customer.find({ _id: { $in: customerIds } })
      .select('_id firstName businessName phone category')
      .lean();

    const cmap = {};
    customers.forEach(c => { cmap[String(c._id)] = c; });

    const out = rows.map(r => {
      const c = cmap[String(r._id)] || {};
      let name = 'Customer';
      if (c.category === 'artist' || c.category === 'organisation') {
        name = c.businessName || c.phone || 'Customer';
      } else {
        name = c.firstName || c.businessName || c.phone || 'Customer';
      }

      return {
        customerId: String(r._id),
        name,
        phone: c.phone || '',
        category: c.category || '',
        ordersCount: Number(r.ordersCount || 0),
        totalAmount: Number((r.totalAmount || 0).toFixed(2)),
        paidAmount: Number((r.paidAmount || 0).toFixed(2)),
        outstandingAmount: Number((r.outstandingAmount || 0).toFixed(2)),
        lastOrderAt: r.lastOrderAt || null
      };
    });

    return res.json({ ok: true, range: { from, to }, rows: out });
  } catch (err) {
    console.error('apiCustomerSummary error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load customer summary' });
  }
};

exports.apiCustomerAccountActivity = async (req, res) => {
  try {
    const { start, end, from, to } = getRangeFromQuery(req);
    const rows = await CustomerAccountTxn.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: '$customer',
          credits: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
          debits: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } },
          txnsCount: { $sum: 1 },
          lastTxnAt: { $max: '$createdAt' }
        }
      },
      { $sort: { credits: -1 } },
      { $limit: 200 }
    ]);

    const customerIds = rows.map(r => r._id).filter(Boolean);
    const customers = await Customer.find({ _id: { $in: customerIds } })
      .select('_id firstName businessName phone category accountBalance')
      .lean();
    const cmap = {};
    customers.forEach(c => { cmap[String(c._id)] = c; });

    const totals = rows.reduce((acc, r) => {
      acc.totalCredits += Number(r.credits || 0);
      acc.totalDebits += Number(r.debits || 0);
      acc.totalTxns += Number(r.txnsCount || 0);
      return acc;
    }, { totalCredits: 0, totalDebits: 0, totalTxns: 0 });

    const out = rows.map(r => {
      const c = cmap[String(r._id)] || {};
      let name = 'Customer';
      if (c.category === 'artist' || c.category === 'organisation') {
        name = c.businessName || c.phone || 'Customer';
      } else {
        name = c.firstName || c.businessName || c.phone || 'Customer';
      }

      return {
        customerId: String(r._id),
        name,
        phone: c.phone || '',
        category: c.category || '',
        credits: Number((r.credits || 0).toFixed(2)),
        debits: Number((r.debits || 0).toFixed(2)),
        net: Number((Number(r.credits || 0) - Number(r.debits || 0)).toFixed(2)),
        txnsCount: Number(r.txnsCount || 0),
        lastTxnAt: r.lastTxnAt || null,
        accountBalance: Number((c.accountBalance || 0).toFixed(2))
      };
    });

    return res.json({
      ok: true,
      range: { from, to },
      totals: {
        totalCredits: Number(totals.totalCredits.toFixed(2)),
        totalDebits: Number(totals.totalDebits.toFixed(2)),
        totalTxns: Number(totals.totalTxns || 0)
      },
      rows: out
    });
  } catch (err) {
    console.error('apiCustomerAccountActivity error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load customer account activity' });
  }
};
