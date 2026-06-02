// models/customer_account_txn.js
const mongoose = require('mongoose');

const CustomerAccountTxnSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true, min: 0.01 },
  note: { type: String, default: '' },
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', default: null },
  cashBookName: { type: String, default: '' },
  cashBookKind: { type: String, enum: ['cash', 'bank', 'momo', null], default: null },
  cashDirection: { type: String, enum: ['inflow', 'outflow', null], default: null },
  cashMeta: { type: mongoose.Schema.Types.Mixed, default: {} },

  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recordedByName: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now, index: true }
});

CustomerAccountTxnSchema.index({ customer: 1, type: 1, createdAt: -1 });
CustomerAccountTxnSchema.index({ customer: 1, type: 1, note: 1 });

module.exports = mongoose.model('CustomerAccountTxn', CustomerAccountTxnSchema);
