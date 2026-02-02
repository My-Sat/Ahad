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

function round2(n) {
  return Number((Number(n || 0)).toFixed(2));
}

async function sumPaymentsForCashier(cashierId, start, end) {
  if (!cashierId || !start || !end) return 0;
  const cashierObjId = new mongoose.Types.ObjectId(String(cashierId));
  const agg = await Order.aggregate([
    { $unwind: '$payments' },
    { $match: {
      'payments.method': { $in: ['cash', 'momo', 'cheque'] },
      'payments.createdAt': { $gte: start, $lte: end },
      'payments.recordedBy': cashierObjId
    }},
    { $group: { _id: null, total: { $sum: '$payments.amount' } } }
  ]);
  return Number(((agg && agg.length) ? (agg[0].total || 0) : 0));
}

async function getLastCloseAtFromCollections(cashierId) {
  if (!cashierId) return null;
  const last = await CashierCollection.findOne({
    cashier: new mongoose.Types.ObjectId(String(cashierId)),
    dayClosed: true
  }).sort({ date: -1 }).select('date').lean();
  return last && last.date ? last.date : null;
}

async function ensureBalanceDoc(cashierId, fallbackCloseAt) {
  let balanceDoc = await CashierBalance.findOne({ cashier: cashierId });
  if (!balanceDoc) {
    balanceDoc = new CashierBalance({
      cashier: cashierId,
      balance: 0,
      lastCloseAt: fallbackCloseAt || null
    });
    await balanceDoc.save();
    return balanceDoc;
  }

  if (!balanceDoc.lastCloseAt && fallbackCloseAt) {
    balanceDoc.lastCloseAt = fallbackCloseAt;
    balanceDoc.updatedAt = new Date();
    await balanceDoc.save();
  }

  return balanceDoc;
}

async function applyAutoDayCloseIfNeeded(balanceDoc, cashierId, dayStart) {
  if (!balanceDoc || !cashierId || !dayStart) return { rolledAmount: 0, changed: false };
  const lastCloseAt = balanceDoc.lastCloseAt ? new Date(balanceDoc.lastCloseAt) : null;
  if (!lastCloseAt || lastCloseAt < dayStart) {
    const rolledAmount = await sumPaymentsForCashier(cashierId, lastCloseAt || dayStart, dayStart);
    balanceDoc.balance = round2(Number(balanceDoc.balance || 0) + Number(rolledAmount || 0));
    balanceDoc.lastCloseAt = dayStart;
    balanceDoc.updatedAt = new Date();
    await balanceDoc.save();
    return { rolledAmount: round2(rolledAmount), changed: true };
  }
  return { rolledAmount: 0, changed: false };
}

/**
/**
 * GET /cashiers/status?date=YYYY-MM-DD
 * returns list of cashiers with previous balance and current-period payment totals
 */
exports.getCashiers = async (req, res) => {
  try {
    const dateIso = req.query.date || null;
    const { start, end } = dayRangeForIso(dateIso);
    const rangeEnd = dateIso ? end : new Date();

    // load cashiers (role 'cashier' or 'clerk')
    const cashiers = await User.find({
      role: { $in: ['cashier', 'admin'] }
    }).select('_id name username role').lean();

    // load balances
    const balances = await CashierBalance.find({ cashier: { $in: cashiers.map(c => c._id) } }).lean();
    const balMap = {};
    balances.forEach(b => {
      balMap[String(b.cashier)] = {
        balance: Number(b.balance || 0),
        lastCloseAt: b.lastCloseAt || null
      };
    });

    const cashierIds = cashiers.map(c => c._id).filter(Boolean);
    const lastCloseAgg = await CashierCollection.aggregate([
      { $match: { cashier: { $in: cashierIds }, dayClosed: true } },
      { $sort: { date: -1 } },
      { $group: { _id: '$cashier', lastCloseAt: { $first: '$date' } } }
    ]);
    const lastCloseMap = {};
    lastCloseAgg.forEach(r => { lastCloseMap[String(r._id)] = r.lastCloseAt; });

    // prepare response
    const out = [];
    for (const c of cashiers) {
      const id = String(c._id);
      const balEntry = balMap[id] || {};
      const fallbackCloseAt = balEntry.lastCloseAt || lastCloseMap[id] || start;
      const balanceDoc = await ensureBalanceDoc(c._id, fallbackCloseAt);
      await applyAutoDayCloseIfNeeded(balanceDoc, c._id, start);
      const lastCloseAt = balanceDoc.lastCloseAt || start;

      const currentPayments = await sumPaymentsForCashier(c._id, lastCloseAt, rangeEnd);
      const totalCashRecordedToday = round2(currentPayments);
      const previousBalance = round2(Number(balanceDoc.balance || 0));

      out.push({
        cashierId: id,
        name: c.name || c.username || id,
        totalCashRecordedToday,
        previousBalance
      });
    }

    return res.json({ ok: true, date: start.toISOString(), cashiers: out });
  } catch (err) {
    console.error('GET /cashiers/status error', err);
    return res.status(500).json({ error: 'Unable to fetch cashier status' });
  }
};

/**
/**
 * GET /cashiers/my-status
 * returns current-period totals & computed previous balance for the logged-in cashier
 */
exports.my_status = async (req, res) => {
  try {
    if (!req.user || !req.user._id) return res.status(401).json({ error: 'Not authenticated' });
    const cashierId = String(req.user._id);
    const { start, end } = dayRangeForIso(req.query.date || null);
    const rangeEnd = req.query.date ? end : new Date();

    let balanceDoc = await CashierBalance.findOne({ cashier: new mongoose.Types.ObjectId(cashierId) });
    if (!balanceDoc) {
      const lastCloseAt = await getLastCloseAtFromCollections(cashierId);
      balanceDoc = await ensureBalanceDoc(cashierId, lastCloseAt || start);
    } else if (!balanceDoc.lastCloseAt) {
      const lastCloseAt = await getLastCloseAtFromCollections(cashierId);
      if (lastCloseAt) {
        balanceDoc.lastCloseAt = lastCloseAt;
        balanceDoc.updatedAt = new Date();
        await balanceDoc.save();
      } else if (!balanceDoc.lastCloseAt) {
        balanceDoc.lastCloseAt = start;
        balanceDoc.updatedAt = new Date();
        await balanceDoc.save();
      }
    }

    await applyAutoDayCloseIfNeeded(balanceDoc, cashierId, start);
    const lastCloseAt = balanceDoc.lastCloseAt || start;
    const totalCashRecordedToday = round2(await sumPaymentsForCashier(cashierId, lastCloseAt, rangeEnd));
    const previousBalance = round2(Number(balanceDoc.balance || 0));
    const uncollectedToday = totalCashRecordedToday;

    return res.json({
      ok: true,
      cashierId,
      name: req.user.name || req.user.username || '',
      totalCashRecordedToday,
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

    const { start } = dayRangeForIso(req.body.date || null);
    const rangeEnd = new Date();

    let balanceDoc = await CashierBalance.findOne({ cashier: cashierId });
    if (!balanceDoc) {
      const lastCloseAt = await getLastCloseAtFromCollections(cashierId);
      balanceDoc = await ensureBalanceDoc(cashierId, lastCloseAt || start);
    } else if (!balanceDoc.lastCloseAt) {
      const lastCloseAt = await getLastCloseAtFromCollections(cashierId);
      balanceDoc.lastCloseAt = lastCloseAt || start;
      balanceDoc.updatedAt = new Date();
      await balanceDoc.save();
    }

    await applyAutoDayCloseIfNeeded(balanceDoc, cashierId, start);
    const lastCloseAt = balanceDoc.lastCloseAt || start;
    const totalCashRecordedToday = round2(await sumPaymentsForCashier(cashierId, lastCloseAt, rangeEnd));

    const oldBalance = round2(balanceDoc.balance || 0);
    const changeToBalance = round2(Number(totalCashRecordedToday) - Number(amount));
    const newBalance = round2(oldBalance + changeToBalance);

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
    balanceDoc.lastCloseAt = rangeEnd;
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
      totalCashRecordedToday,
      changeToBalance,
      oldBalance,
      newPreviousBalance: newBalance,
      collectionId: col._id
    });
  } catch (err) {
    console.error('POST /cashiers/:id/collect error', err);
    return res.status(500).json({ error: 'Failed to record collection' });
  }
};

