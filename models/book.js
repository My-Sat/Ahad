// models/book.js
const mongoose = require('mongoose');

const BookItemSchema = new mongoose.Schema({
  // reference the service for later matching/lookup (optional but helpful)
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },

  // price rule used (service_price _id)
  priceRule: { type: mongoose.Schema.Types.ObjectId, ref: 'service_price', required: true },

  // number of pages (raw pages as entered) — integer >=1
  pages: { type: Number, default: 1, min: 1 },

  // number of times this component price rule occurs in one compound service
  quantity: { type: Number, default: 1, min: 1 },

  // whether this selection used front+back pricing
  fb: { type: Boolean, default: false },

  // booklet imposes two document pages per printed face and forces F/B mode
  booklet: { type: Boolean, default: false },

  // optional printer used for this item (if applicable)
  printer: { type: mongoose.Schema.Types.ObjectId, ref: 'Printer', default: null },

  // spoiled count (integer >=0)
  spoiled: { type: Number, default: 0, min: 0 },

  // server-authoritative snapshot of computed unit price for this item (price or price2)
  unitPrice: { type: Number, required: true, default: 0 },

  // Fixed amount deducted from the selected rule price before pages/QTY multiply.
  unitDiscountAmount: { type: Number, default: 0, min: 0 },
  discountedUnitPrice: { type: Number, default: null, min: 0 },

  // Gross component value and its total discount are retained for clear costing.
  grossSubtotal: { type: Number, default: 0, min: 0 },
  lineDiscountAmount: { type: Number, default: 0, min: 0 },

  // snapshot of net subtotal ((unitPrice - discount) * effectiveQty * quantity)
  subtotal: { type: Number, required: true, default: 0 },

  // human-friendly label for the selection (e.g. "A4, Plain")
  selectionLabel: { type: String, default: '' }
}, { _id: false });

const BookSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
   category: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'ServiceCategory',
  required: true
},
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
