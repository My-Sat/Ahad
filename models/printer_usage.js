// models/printer_usage.js
const mongoose = require('mongoose');

const PrinterUsageSchema = new mongoose.Schema({
  printer: { type: mongoose.Schema.Types.ObjectId, ref: 'Printer', required: true, index: true },
  // human-friendly order id (from Order.orderId) to tie back
  orderId: { type: String, default: null },
  // mongodb order ref (ObjectId)
  orderRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  // index of the item in the order's items array (optional)
  itemIndex: { type: Number, default: 0 },
  // number of units incremented (positive for increments, negative for adjustments if desired)
  count: { type: Number, required: true, default: 0 },
  // optional note (e.g., 'manual adjust' or 'order-created')
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('PrinterUsage', PrinterUsageSchema);
