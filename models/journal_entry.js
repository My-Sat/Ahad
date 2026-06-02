const mongoose = require('mongoose');

const JournalLineSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountingAccount', required: true },
  accountCode: { type: String, required: true, trim: true, index: true },
  accountName: { type: String, required: true, trim: true },
  accountType: {
    type: String,
    enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
    required: true,
    index: true
  },
  debit: { type: Number, default: 0 },
  credit: { type: Number, default: 0 },
  dimensions: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const JournalEntrySchema = new mongoose.Schema({
  sourceKey: { type: String, required: true, unique: true, index: true },
  sourceType: { type: String, required: true, trim: true, index: true },
  sourceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  sourceRef: { type: String, trim: true, default: '', index: true },
  date: { type: Date, default: Date.now, index: true },
  memo: { type: String, trim: true, default: '' },
  lines: { type: [JournalLineSchema], default: [] },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  postedByName: { type: String, trim: true, default: '' }
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

JournalEntrySchema.index({ createdAt: -1, _id: -1 });
JournalEntrySchema.index({ date: 1, 'lines.accountType': 1 });

module.exports = mongoose.model('JournalEntry', JournalEntrySchema);
