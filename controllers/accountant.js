// controllers/accountant.js
const mongoose = require('mongoose');
const AccountantAccount = require('../models/accountant_account');
const User = require('../models/user');

function dateKeyFromIso(dateIso) {
  if (!dateIso) return AccountantAccount.dateKey(new Date());
  return AccountantAccount.dateKey(new Date(dateIso + 'T00:00:00Z'));
}

// GET /accountant/ledger?date=YYYY-MM-DD
exports.getLedger = async (req, res) => {
  try {
    const date = dateKeyFromIso(req.query.date || null);
    // fetch all accounts for that date
    const rows = await AccountantAccount.find({ date: date }).lean();
    const userIds = rows.map(r => r.accountant);
    const users = await User.find({ _id: { $in: userIds } }).select('_id name username').lean();
    const umap = {};
    users.forEach(u => { umap[String(u._id)] = u; });
    const out = rows.map(r => ({
      accountantId: String(r.accountant),
      name: (umap[String(r.accountant)] && (umap[String(r.accountant)].name || umap[String(r.accountant)].username)) || '',
      totalCollected: Number((r.totalCollected || 0).toFixed(2)),
      date: r.date
    }));
    return res.json({ ok: true, date: date.toISOString(), ledger: out });
  } catch (err) {
    console.error('GET /accountant/ledger error', err);
    return res.status(500).json({ error: 'Unable to fetch ledger' });
  }
};
