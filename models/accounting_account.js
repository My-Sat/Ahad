const mongoose = require('mongoose');

const AccountingAccountSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
    required: true,
    index: true
  },
  group: { type: String, trim: true, default: '' },
  system: { type: Boolean, default: false },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('AccountingAccount', AccountingAccountSchema);
