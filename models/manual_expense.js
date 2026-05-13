const mongoose = require('mongoose');

const ManualExpenseSchema = new mongoose.Schema({
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseCategory', default: null },
  categoryName: { type: String, trim: true, default: '' },
  accountCode: { type: String, trim: true, default: '6900' },
  treatment: { type: String, enum: ['expense', 'prepaid', 'accrued'], default: 'expense', index: true },
  description: { type: String, trim: true, required: true },
  amount: { type: Number, required: true, min: 0.01 },
  releasedAmount: { type: Number, default: 0, min: 0 },
  autoReleaseEnabled: { type: Boolean, default: false, index: true },
  releaseMonths: { type: Number, default: 0, min: 0 },
  paidAmount: { type: Number, default: 0, min: 0 },
  date: { type: Date, default: Date.now, index: true },
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', default: null },
  cashBookName: { type: String, default: '' },
  cashBookKind: { type: String, enum: ['cash', 'bank', 'momo', null], default: null },
  cashMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  paid: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('ManualExpense', ManualExpenseSchema);
