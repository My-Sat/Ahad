const mongoose = require('mongoose');

const EquityTransactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['owner_capital', 'owner_drawing', 'opening_asset', 'opening_liability'],
    required: true,
    index: true
  },
  accountCode: { type: String, required: true, trim: true, index: true },
  accountName: { type: String, required: true, trim: true },
  accountType: {
    type: String,
    enum: ['asset', 'liability', 'equity'],
    required: true,
    index: true
  },
  accountGroup: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  amount: { type: Number, required: true, min: 0.01 },
  date: { type: Date, default: Date.now, index: true },
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', default: null },
  cashBookName: { type: String, trim: true, default: '' },
  cashBookKind: { type: String, enum: ['cash', 'bank', 'momo', null], default: null },
  cashMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, trim: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('EquityTransaction', EquityTransactionSchema);
