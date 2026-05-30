const mongoose = require('mongoose');

const CartInvoiceSchema = new mongoose.Schema({
  invoiceNo: { type: String, required: true, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
  customerName: { type: String, trim: true, default: '', index: true },
  customerPhone: { type: String, trim: true, default: '', index: true },
  customerCategory: { type: String, trim: true, default: '' },
  sourceSubmission: { type: mongoose.Schema.Types.ObjectId, ref: 'RegistrationSubmission', default: null, index: true },
  categories: [{
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCategory' },
    name: { type: String, trim: true, default: '' }
  }],
  cart: { type: [mongoose.Schema.Types.Mixed], default: [] },
  manualDiscount: { type: mongoose.Schema.Types.Mixed, default: null },
  manualTax: { type: mongoose.Schema.Types.Mixed, default: null },
  jobNote: { type: String, trim: true, default: '' },
  totals: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['open', 'converted', 'cancelled'], default: 'open', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  createdByName: { type: String, trim: true, default: '' },
  convertedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  convertedOrderId: { type: String, trim: true, default: '', index: true },
  convertedAt: { type: Date, default: null }
}, { timestamps: true });

CartInvoiceSchema.index({ status: 1, updatedAt: -1 });
CartInvoiceSchema.index({ customerName: 'text', customerPhone: 'text', invoiceNo: 'text' });

module.exports = mongoose.model('CartInvoice', CartInvoiceSchema);
