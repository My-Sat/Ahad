const mongoose = require('mongoose');

const CashBookTxnSchema = new mongoose.Schema({
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', required: true, index: true },
  cashBookName: { type: String, default: '' },
  cashBookKind: { type: String, enum: ['cash', 'bank', 'momo'], default: 'cash' },
  type: { type: String, enum: ['inflow', 'outflow'], required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  sourceType: { type: String, default: '' },
  sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  sourceRef: { type: String, default: '' },
  note: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recordedByName: { type: String, default: '' }
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

module.exports = mongoose.model('CashBookTxn', CashBookTxnSchema);
