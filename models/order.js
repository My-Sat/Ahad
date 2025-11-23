// models/order.js
const mongoose = require('mongoose');

const SelectionRef = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true },
  subUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostSubUnit', required: true }
}, { _id: false });

const OrderItemSchema = new mongoose.Schema({
  // reference the service so we can lookup names if needed
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  // optional printer used for this item (if applicable)
  printer: { type: mongoose.Schema.Types.ObjectId, ref: 'Printer', default: null },
  // store selections as unit/subUnit pairs so we can match materials later
  selections: { type: [SelectionRef], default: [] },
  // human-friendly label for the selected combination (e.g. "Paper Size: A4 + Paper Type: Standard")
  selectionLabel: { type: String, required: true },
  // price per unit (the unit price you assigned for that selection)
  unitPrice: { type: Number, required: true },
  // optional multiplier (raw user input, e.g., number of pages)
  pages: { type: Number, default: 1 },
  // the effective quantity used for pricing (e.g. ceil(pages/2) for F/B). Stored so clients can show exactly what server used.
  effectiveQty: { type: Number, default: 1 },
  // computed line subtotal (unitPrice * effectiveQty)
  subtotal: { type: Number, required: true },
  // optional flags stored per-item (backwards compat)
  fb: { type: Boolean, default: false },
  spoiled: { type: Number, default: 0 },
  printerType: { type: String, enum: ['monochrome', 'colour', null], default: null }
}, { _id: false });

const PaymentSchema = new mongoose.Schema({
  method: { type: String, enum: ['cash', 'momo', 'cheque', 'other'], default: 'cash' },
  amount: { type: Number, required: true },
  // store optional metadata: momoNumber, momoTxId, chequeNumber, any free-form note
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  note: { type: String, default: '' },
   recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recordedByName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const OrderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, index: true }, // generated human-friendly ID
  items: [OrderItemSchema],
  total: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  paidAt: { type: Date, default: null },
  //optional customer reference
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  //record payment events (supports part payments)
  payments: { type: [PaymentSchema], default: [] }
});

// instance helper to compute paid so far (not persisted)
OrderSchema.methods.paidSoFar = function () {
  if (!this.payments || !this.payments.length) return 0;
  return this.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
};

// virtual outstanding (total - paidSoFar)
OrderSchema.virtual('outstanding').get(function () {
  const paid = (this.payments && this.payments.length) ? this.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0;
  return Number((Number(this.total || 0) - paid).toFixed(2));
});

module.exports = mongoose.model('Order', OrderSchema);
