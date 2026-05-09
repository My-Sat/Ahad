const mongoose = require('mongoose');

const SupplierAccountTxnSchema = new mongoose.Schema({
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true, min: 0.01 },
  note: { type: String, default: '' },
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', default: null },
  cashBookName: { type: String, default: '' },
  cashBookKind: { type: String, enum: ['cash', 'bank', 'momo', null], default: null },
  cashDirection: { type: String, enum: ['inflow', 'outflow', null], default: null },
  cashMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  sourceType: { type: String, default: '' },
  sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  sourceRef: { type: String, default: '' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recordedByName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('SupplierAccountTxn', SupplierAccountTxnSchema);
