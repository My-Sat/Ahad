const mongoose = require('mongoose');

const PrepaidReleaseSchema = new mongoose.Schema({
  prepaidExpense: { type: mongoose.Schema.Types.ObjectId, ref: 'ManualExpense', required: true, index: true },
  sourceKey: { type: String, trim: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseCategory', default: null },
  categoryName: { type: String, trim: true, default: '' },
  accountCode: { type: String, trim: true, default: '6900' },
  description: { type: String, trim: true, default: '' },
  amount: { type: Number, required: true, min: 0.01 },
  date: { type: Date, default: Date.now, index: true },
  autoRelease: { type: Boolean, default: false, index: true },
  monthKey: { type: String, trim: true, default: '' },
  note: { type: String, trim: true, default: '' },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recordedByName: { type: String, trim: true, default: '' }
}, { timestamps: true });

PrepaidReleaseSchema.index({ sourceKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('PrepaidRelease', PrepaidReleaseSchema);
