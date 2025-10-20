// models/order.js
const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
  // reference the service so we can lookup names if needed
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  // human-friendly label for the selected combination (e.g. "Paper Size: A4 + Paper Type: Standard")
  selectionLabel: { type: String, required: true },
  // price per unit (the unit price you assigned for that selection)
  unitPrice: { type: Number, required: true },
  // optional multiplier (e.g., number of pages)
  pages: { type: Number, default: 1 },
  // computed line subtotal (unitPrice * pages)
  subtotal: { type: Number, required: true }
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, index: true }, // generated human-friendly ID
  items: [OrderItemSchema],
  total: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  paidAt: { type: Date, default: null }
});

module.exports = mongoose.model('Order', OrderSchema);
