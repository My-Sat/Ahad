const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  sourceId: { type: String, required: true, unique: true },
  schoolId: { type: String, required: true, index: true },
  sourceInvoiceId: { type: String, required: true, index: true },
  targetInvoiceId: { type: String, required: true, index: true },
  sourceInvoiceNumber: { type: String, required: true },
  targetInvoiceNumber: { type: String, required: true },
  amountPesewas: { type: Number, required: true, min: 1 },
  appliedAt: { type: Date, required: true }
}, { timestamps: true });

module.exports = mongoose.model('ClassOneCreditTransfer', schema);
