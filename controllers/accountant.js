// controllers/accountant.js
const mongoose = require('mongoose');
const CashierCollection = require('../models/cashier_collection');
const User = require('../models/user');

function dateKeyFromIso(dateIso) {
  const d = dateIso ? new Date(dateIso + 'T00:00:00Z') : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function dayRangeFromIso(dateIso) {
  const start = dateKeyFromIso(dateIso);
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

// GET /accountant/ledger?date=YYYY-MM-DD
exports.getLedger = async (req, res) => {
  try {
    const { start, end } = dayRangeFromIso(req.query.date || null);

    const rows = await CashierCollection.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: '$cashier', totalCollected: { $sum: '$amount' } } }
    ]);

    const cashierIds = rows.map(r => r._id).filter(Boolean);
    const users = await User.find({ _id: { $in: cashierIds } }).select('_id name username').lean();
    const umap = {};
    users.forEach(u => { umap[String(u._id)] = u; });

    const out = rows.map(r => ({
      cashierId: String(r._id),
      name: (umap[String(r._id)] && (umap[String(r._id)].name || umap[String(r._id)].username)) || '',
      totalCollected: Number((r.totalCollected || 0).toFixed(2))
    })).sort((a, b) => b.totalCollected - a.totalCollected);

    const totalCollected = out.reduce((s, r) => s + Number(r.totalCollected || 0), 0);
    return res.json({
      ok: true,
      date: start.toISOString(),
      totalCollected: Number(totalCollected.toFixed(2)),
      ledger: out
    });
  } catch (err) {
    console.error('GET /accountant/ledger error', err);
    return res.status(500).json({ error: 'Unable to fetch ledger' });
  }
};
