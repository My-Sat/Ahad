// models/order.js
const mongoose = require('mongoose');

const SelectionRef = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true },
  subUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostSubUnit', required: true }
}, { _id: false });

const OrderItemSchema = new mongoose.Schema({
  // reference the service so we can lookup names if needed
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  // store selections as unit/subUnit pairs so we can match materials later
  selections: { type: [SelectionRef], default: [] },
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
