const Order = require('../models/order');
const User = require('../models/user');
const CashierBalance = require('../models/cashier_balance');
const CashierCollection = require('../models/cashier_collection');
const AccountantAccount = require('../models/accountant_account');
const mongoose = require('mongoose');

// helper: start/end of day for given YYYY-MM-DD (UTC)
function dayRangeForIso(dateIso) {
  const d = dateIso ? new Date(dateIso + 'T00:00:00Z') : new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

/**
/**
 * GET /cashiers/status?date=YYYY-MM-DD
 * returns list of cashiers with previousBalance and daily payments totals and already collected amounts
 */
exports.getCashiers = async (req, res) => {
  try {
    const dateIso = req.query.date || null;
    const { start, end } = dayRangeForIso(dateIso);

    // load cashiers (role 'cashier' or 'clerk')
    const cashiers = await User.find({
      role: { $in: ['cashier', 'admin'] }
    }).select('_id name username role').lean();

    // compute payments aggregated by recordedBy for the day (include cash, momo, cheque)
    const paymentsByCashier = await Order.aggregate([
      { $unwind: '$payments' },
      { $match: {
        'payments.method': { $in: ['cash', 'momo', 'cheque'] },
        'payments.createdAt': { $gte: start, $lte: end },
        'payments.recordedBy': { $exists: true, $ne: null }
      }},
      { $group: { _id: '$payments.recordedBy', total: { $sum: '$payments.amount' } } }
    ]);
    const payMap = {};
    paymentsByCashier.forEach(p => { payMap[String(p._id)] = Number(p.total || 0); });

    // collections by cashier for the day (sum of amounts recorded)
    const collections = await CashierCollection.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: '$cashier', totalCollected: { $sum: '$amount' }, dayClosedCount: { $sum: { $cond: ['$dayClosed', 1, 0] } } } }
    ]);
    const colMap = {};
    const closedMap = {};
    collections.forEach(c => { colMap[String(c._id)] = Number(c.totalCollected || 0); closedMap[String(c._id)] = Number(c.dayClosedCount || 0); });

    // load balances
    const balances = await CashierBalance.find({ cashier: { $in: cashiers.map(c => c._id) } }).lean();
    const balMap = {};
    balances.forEach(b => { balMap[String(b.cashier)] = Number(b.balance || 0); });

    // prepare response
    const out = cashiers.map(c => {
      const id = String(c._id);
      const totalCashRecordedToday = Number((payMap[id] || 0).toFixed(2));
      const alreadyCollectedToday = Number((colMap[id] || 0).toFixed(2));
      const previousBalance = Number((balMap[id] || 0).toFixed(2));
      // if dayClosed (any collection with dayClosed true exists), treat uncollected as 0 (day reset),
      // otherwise compute remaining
      const dayClosed = !!closedMap[id];
      return {
        cashierId: id,
        name: c.name || c.username || id,
        totalCashRecordedToday,
        alreadyCollectedToday,
        previousBalance,
        dayClosed
      };
    });

    return res.json({ ok: true, date: start.toISOString(), cashiers: out });
  } catch (err) {
    console.error('GET /cashiers/status error', err);
    return res.status(500).json({ error: 'Unable to fetch cashier status' });
  }
};

/**
/**
 * GET /cashiers/my-status
 * returns daily totals & previous balance for the logged-in cashier
 */
exports.my_status = async (req, res) => {
  try {
    if (!req.user || !req.user._id) return res.status(401).json({ error: 'Not authenticated' });
    const cashierId = String(req.user._id);
    const { start, end } = dayRangeForIso(req.query.date || null);

    // total payments (cash, momo, cheque) recorded for today by this cashier
    const paymentsAgg = await Order.aggregate([
      { $unwind: '$payments' },
      { $match: {
        'payments.method': { $in: ['cash', 'momo', 'cheque'] },
        'payments.createdAt': { $gte: start, $lte: end },
        'payments.recordedBy': new mongoose.Types.ObjectId(cashierId)
      }},
      { $group: { _id: null, total: { $sum: '$payments.amount' } } }
    ]);
    const totalCashRecordedToday = Number(((paymentsAgg && paymentsAgg.length) ? (paymentsAgg[0].total || 0) : 0));

    // already collected today for this cashier
    const collectedAgg = await CashierCollection.aggregate([
      { $match: { cashier: new mongoose.Types.ObjectId(cashierId), date: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' }, dayClosedCount: { $sum: { $cond: ['$dayClosed', 1, 0] } } } }
    ]);
    const alreadyCollectedToday = Number(((collectedAgg && collectedAgg.length) ? (collectedAgg[0].total || 0) : 0));
    const dayClosedCount = (collectedAgg && collectedAgg.length) ? (collectedAgg[0].dayClosedCount || 0) : 0;

    // previous balance
    const bal = await CashierBalance.findOne({ cashier: new mongoose.Types.ObjectId(cashierId) }).lean();
    const previousBalance = bal ? Number(bal.balance || 0) : 0;

    // if dayClosed, uncollected is 0, else compute
    const uncollectedToday = dayClosedCount ? 0 : Number(Math.max(0, totalCashRecordedToday - alreadyCollectedToday).toFixed(2));

    return res.json({
      ok: true,
      cashierId,
      name: req.user.name || req.user.username || '',
      totalCashRecordedToday: Number(totalCashRecordedToday.toFixed(2)),
      alreadyCollectedToday: Number(alreadyCollectedToday.toFixed(2)),
      uncollectedToday,
      previousBalance
    });
  } catch (err) {
    console.error('GET /cashiers/my-status error', err);
    return res.status(500).json({ error: 'Unable to fetch your cashier status' });
  }
};


/**
 * POST /cashiers/:cashierId/collect
 * body: { amount: Number, note: String, date: YYYY-MM-DD (optional) }
 * The authenticated user is considered the collector (req.user)
 */
exports.postCashiers = async (req, res) => {
  try {
    const { cashierId } = req.params;
    const amountRaw = Number(req.body.amount || 0);
    const note = (req.body.note || '').toString();
    if (!cashierId || !mongoose.Types.ObjectId.isValid(cashierId)) return res.status(400).json({ error: 'Invalid cashier id' });

    const collector = req.user && req.user._id ? req.user._id : null;
    if (!collector) return res.status(403).json({ error: 'Collector identity required' });

    const amount = Math.round((isNaN(amountRaw) ? 0 : amountRaw) * 100) / 100;
    if (isNaN(amount)) return res.status(400).json({ error: 'Invalid amount' });

    // compute today's totals (based on provided date or today)
    const { start, end } = dayRangeForIso(req.body.date || null);

// total payments for day (include cash, momo, cheque) recorded by the cashier
const paymentsAgg = await Order.aggregate([
  { $unwind: '$payments' },
  { $match: {
    'payments.method': { $in: ['cash', 'momo', 'cheque'] },
    'payments.createdAt': { $gte: start, $lte: end },
    'payments.recordedBy': new mongoose.Types.ObjectId(cashierId)
  }},
  { $group: { _id: null, total: { $sum: '$payments.amount' } } }
]);
const totalCashRecordedToday = Number(((paymentsAgg && paymentsAgg.length) ? (paymentsAgg[0].total || 0) : 0));

    // already collected today (sum of collections for cashier & date)
    const collectedAgg = await CashierCollection.aggregate([
      { $match: { cashier: new mongoose.Types.ObjectId(cashierId), date: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const alreadyCollectedToday = Number(((collectedAgg && collectedAgg.length) ? (collectedAgg[0].total || 0) : 0));

    // compute remaining uncollected today before this collection
    const remainingBefore = Number(Math.max(0, totalCashRecordedToday - alreadyCollectedToday).toFixed(2));

    // compute how much of this amount applies to today's outstanding and how much is excess
    const appliedToToday = Number(Math.min(amount, remainingBefore).toFixed(2)); // amount used to satisfy today's uncollected
    const remainingAfter = Number(Math.max(0, remainingBefore - appliedToToday).toFixed(2)); // what would remain unpaid for today after this collection
    const excess = Number(Math.max(0, amount - remainingBefore).toFixed(2)); // money beyond today's needs

    // Ensure there's a persistent balance doc (create if not exists)
    let balanceDoc = await CashierBalance.findOne({ cashier: cashierId });
    if (!balanceDoc) {
      balanceDoc = new CashierBalance({ cashier: cashierId, balance: 0 });
    }
    const oldBalance = Number(balanceDoc.balance || 0);

    // Compute balance delta according to whether there were prior collections today
    let changeToBalance = 0;
    if (alreadyCollectedToday === 0) {
      // first collection of the day:
      // - if amount < remainingBefore -> remainingAfter > 0 => add remainingAfter to balance
      // - if amount > remainingBefore -> excess > 0 => reduce balance by excess
      changeToBalance = Number((remainingAfter - excess).toFixed(2));
    } else {
      // subsequent collections on same day reduce the stored balance by the full amount received
      // (prior partial collections already added day's uncollected into the balance)
      changeToBalance = Number((-amount).toFixed(2));
    }

    // new balance
    const newBalance = Number((oldBalance + changeToBalance).toFixed(2));

    // create collection record (actual cash received recorded)
    const col = new CashierCollection({
      cashier: cashierId,
      collector: collector,
      amount: amount,
      date: new Date(),
      note: note,
      dayClosed: true // indicates a collection/close action took place
    });
    await col.save();

    // update persistent balance
    balanceDoc.balance = newBalance;
    balanceDoc.updatedAt = new Date();
    await balanceDoc.save();

    // update AccountantAccount (ledger) for the collector for this date
    try {
      const acctDate = AccountantAccount.dateKey(new Date());
      const accountantFilter = { accountant: collector, date: acctDate };
      const upd = { $inc: { totalCollected: Number(amount) }, $set: { updatedAt: new Date() } };
      const acctOptions = { upsert: true, new: true, setDefaultsOnInsert: true };
      await AccountantAccount.findOneAndUpdate(accountantFilter, upd, acctOptions);
    } catch (acctErr) {
      console.error('Failed to update AccountantAccount on collection', acctErr);
    }

    // return summary
    return res.json({
      ok: true,
      cashierId,
      amountCollected: amount,
      appliedToToday,
      excess,
      totalCashRecordedToday: Number(totalCashRecordedToday.toFixed(2)),
      alreadyCollectedToday: Number(alreadyCollectedToday.toFixed(2)),
      remainingBefore,
      remainingAfter,
      changeToBalance,
      oldBalance,
      newPreviousBalance: Number(newBalance.toFixed(2)),
      collectionId: col._id
    });
  } catch (err) {
    console.error('POST /cashiers/:id/collect error', err);
    return res.status(500).json({ error: 'Failed to record collection' });
  }
};

