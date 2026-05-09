const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  phone: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  balance: { type: Number, default: 0 },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('Supplier', SupplierSchema);
