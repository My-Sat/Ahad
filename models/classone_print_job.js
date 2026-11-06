const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  attemptId: { type: String, required: true, unique: true },
  invoiceId: { type: String, required: true, index: true },
  invoiceNumber: { type: String, required: true },
  paperId: { type: String, required: true, index: true },
  schoolId: { type: String, required: true },
  schoolName: { type: String, required: true },
  documentType: { type: String, enum: ['question-paper', 'marking-scheme'], required: true },
  printer: { type: mongoose.Schema.Types.ObjectId, ref: 'Printer', required: true },
  pages: { type: Number, required: true, min: 1 },
  copies: { type: Number, required: true, min: 1 },
  spoiledFaces: { type: Number, required: true, min: 0, default: 0 },
  impressions: { type: Number, required: true, min: 1 },
  type: { type: String, enum: ['monochrome', 'colour'], required: true },
  printMode: { type: String, enum: ['single', 'duplex'], required: true },
  revenuePesewas: { type: Number, required: true, min: 0, default: 0 }
}, { timestamps: true });

schema.index({ paperId: 1, documentType: 1 },
  { unique: true, partialFilterExpression: { revenuePesewas: { $gt: 0 } } });

module.exports = mongoose.model('ClassOnePrintJob', schema);
