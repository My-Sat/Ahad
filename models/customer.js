// models/customer.js
const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  // category: one_time (default), artist (business), regular -- note: "regular" is derived, not initially set
  category: { type: String, enum: ['one_time', 'regular', 'artist', 'organisation'], default: 'one_time', index: true },
  // for one-time/regular customers
  firstName: { type: String, trim: true, default: '' },

  // for artists / business customers, store business name
  businessName: { type: String, trim: true, default: '' },

  // canonical phone (string) — we'll lookup by phone
  phone: { type: String, trim: true, required: true, index: true },

  // optional notes, createdAt
  notes: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now }
});

// convenience virtual for display name
CustomerSchema.virtual('displayName').get(function () {
if ((this.category === 'artist' || this.category === 'organisation') && this.businessName)
   return this.businessName;  if (this.firstName) return this.firstName;
  if (this.businessName) return this.businessName;
  return this.phone || '';
});

module.exports = mongoose.model('Customer', CustomerSchema);
