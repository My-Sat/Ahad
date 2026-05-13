const mongoose = require('mongoose');

const ExpenseCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  accountCode: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true, index: true },
  system: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('ExpenseCategory', ExpenseCategorySchema);
