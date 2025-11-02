// models/printer.js
const mongoose = require('mongoose');

const PrinterSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameNormalized: { type: String, required: true, trim: true, lowercase: true },
  location: { type: String, trim: true, default: '' },
  // stock/availability/status fields can be added later
  createdAt: { type: Date, default: Date.now }
});

PrinterSchema.pre('validate', function (next) {
  if (this.name) this.nameNormalized = this.name.trim().toLowerCase();
  next();
});

// unique index on normalized name to avoid duplicates (case-insensitive)
PrinterSchema.index({ nameNormalized: 1 }, { unique: true });

module.exports = mongoose.model('Printer', PrinterSchema);
