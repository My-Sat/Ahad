// models/printer.js
const mongoose = require('mongoose');

const PrinterSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  location: { type: String, trim: true, default: '' },
  // stock/availability/status fields can be added later
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Printer', PrinterSchema);
