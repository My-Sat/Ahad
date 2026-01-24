// models/customer_account_txn.js
const mongoose = require('mongoose');

const CustomerAccountTxnSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true, min: 0.01 },
  note: { type: String, default: '' },

  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recordedByName: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('CustomerAccountTxn', CustomerAccountTxnSchema);
