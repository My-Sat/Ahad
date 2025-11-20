// models/book.js
const mongoose = require('mongoose');

const BookItemSchema = new mongoose.Schema({
  // reference the service for later matching/lookup (optional but helpful)
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },

  // price rule used (service_price _id)
  priceRule: { type: mongoose.Schema.Types.ObjectId, ref: 'service_price', required: true },

  // number of pages (raw pages as entered) — integer >=1
  pages: { type: Number, default: 1, min: 1 },

  // whether this selection used front+back pricing
  fb: { type: Boolean, default: false },

  // optional printer used for this item (if applicable)
  printer: { type: mongoose.Schema.Types.ObjectId, ref: 'Printer', default: null },

  // spoiled count (integer >=0)
  spoiled: { type: Number, default: 0, min: 0 },

  // server-authoritative snapshot of computed unit price for this item (price or price2)
  unitPrice: { type: Number, required: true, default: 0 },

  // snapshot of computed subtotal (unitPrice * effectiveQty)
  subtotal: { type: Number, required: true, default: 0 },

  // human-friendly label for the selection (e.g. "A4, Plain")
  selectionLabel: { type: String, default: '' }
}, { _id: false });

const BookSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // sum of item subtotals (unit price for one "book" instance)
  unitPrice: { type: Number, required: true, default: 0 },
  // items that comprise the book (snapshots + references)
  items: { type: [BookItemSchema], default: [] },
  createdBy: { type: String, default: null },
  updatedBy: { type: String, default: null }
}, { timestamps: true });

// enforce unique book name
BookSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Book', BookSchema);
