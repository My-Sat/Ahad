const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  sourceId: { type: String, required: true, unique: true },
  invoiceId: { type: String, required: true, index: true },
  invoiceNumber: { type: String, required: true },
  schoolId: { type: String, required: true },
  schoolName: { type: String, required: true },
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', required: true },
  amountPesewas: { type: Number, required: true, min: 1 },
  allocations: [{ _id: false, invoiceId: { type: String, required: true },
    invoiceNumber: { type: String, required: true },
    amountPesewas: { type: Number, required: true, min: 0 },
    creditPesewas: { type: Number, default: 0, min: 0 } }],
  method: { type: String, enum: ['bank', 'mobile-money', 'cash'], required: true },
  reference: { type: String, required: true },
  receivedAt: { type: Date, required: true }
}, { timestamps: true });

schema.index({ 'allocations.invoiceId': 1 });

module.exports = mongoose.model('ClassOneReceipt', schema);
