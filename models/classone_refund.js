const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  sourceId: { type: String, required: true, unique: true },
  invoiceId: { type: String, required: true, index: true },
  invoiceNumber: { type: String, required: true },
  schoolId: { type: String, required: true },
  schoolName: { type: String, required: true },
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', required: true },
  amountPesewas: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ['cash', 'bank', 'mobile-money'], required: true },
  reference: { type: String, required: true },
  refundedAt: { type: Date, required: true }
}, { timestamps: true });

module.exports = mongoose.model('ClassOneRefund', schema);
