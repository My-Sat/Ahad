const mongoose = require('mongoose');

const CashBookTransferSchema = new mongoose.Schema({
  reference: { type: String, required: true, trim: true, unique: true, index: true },
  fromCashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', required: true, index: true },
  fromCashBookName: { type: String, required: true, trim: true },
  fromCashBookKind: { type: String, enum: ['cash', 'bank', 'momo'], required: true },
  toCashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', required: true, index: true },
  toCashBookName: { type: String, required: true, trim: true },
  toCashBookKind: { type: String, enum: ['cash', 'bank', 'momo'], required: true },
  amount: { type: Number, required: true, min: 0.01 },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, trim: true, default: '' }
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

CashBookTransferSchema.index({ createdAt: -1, _id: -1 });
CashBookTransferSchema.path('toCashBook').validate(function (value) {
  return String(value || '') !== String(this.fromCashBook || '');
}, 'Source and destination cash books must be different');

module.exports = mongoose.model('CashBookTransfer', CashBookTransferSchema);
