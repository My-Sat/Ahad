// models/customer.js
const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  category: { type: String, enum: ['one_time', 'regular', 'artist', 'organisation'], default: 'one_time', index: true },
  firstName: { type: String, trim: true, default: '' },
  businessName: { type: String, trim: true, default: '' },
  phone: { type: String, trim: true, required: true, index: true },
  notes: { type: String, default: '' },

  // ✅ NEW: customer wallet/account balance (cannot go negative)
  accountBalance: { type: Number, default: 0, min: 0 },

  // Tracks regular status activity window (last order date while regular)
  regularSince: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now }
});

CustomerSchema.virtual('displayName').get(function () {
  if ((this.category === 'artist' || this.category === 'organisation') && this.businessName) return this.businessName;
  if (this.firstName) return this.firstName;
  if (this.businessName) return this.businessName;
  return this.phone || '';
});

module.exports = mongoose.model('Customer', CustomerSchema);
