// models/service_category.js
const mongoose = require('mongoose');

const ServiceCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, lowercase: false },
  nameNormalized: { type: String, required: true, trim: true, lowercase: true },
  showInOrders: { type: Boolean, default: true } // if false: hidden from orders listing for non-admin users
}, { timestamps: true });

ServiceCategorySchema.pre('validate', function (next) {
  if (this.name) this.nameNormalized = String(this.name).trim().toLowerCase();
  next();
});

ServiceCategorySchema.index({ nameNormalized: 1 }, { unique: true });

module.exports = mongoose.model('ServiceCategory', ServiceCategorySchema);
