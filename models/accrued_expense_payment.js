const mongoose = require('mongoose');

const AccruedExpensePaymentSchema = new mongoose.Schema({
  accruedExpense: { type: mongoose.Schema.Types.ObjectId, ref: 'ManualExpense', required: true, index: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseCategory', default: null },
  categoryName: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  amount: { type: Number, required: true, min: 0.01 },
  date: { type: Date, default: Date.now, index: true },
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', required: true, index: true },
  cashBookName: { type: String, trim: true, default: '' },
  cashBookKind: { type: String, enum: ['cash', 'bank', 'momo'], default: 'cash' },
  cashMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  note: { type: String, trim: true, default: '' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recordedByName: { type: String, trim: true, default: '' }
}, { timestamps: true });

AccruedExpensePaymentSchema.index({ date: -1, createdAt: -1 });

module.exports = mongoose.model('AccruedExpensePayment', AccruedExpensePaymentSchema);
