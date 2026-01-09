const mongoose = require('mongoose');

const DiscountRuleSchema = new mongoose.Schema({
  scope: {
    type: String,
    enum: ['general', 'customer_type', 'service', 'service_category'],
    required: true,
    index: true
  },

  // targets depending on scope:
  // customer_type: ['one_time','regular','artist','organisation']
  // service: [serviceId...]
  // service_category: [categoryId...]
  targets: { type: [String], default: [] },

  // discount mode
  mode: { type: String, enum: ['amount', 'percent'], required: true },

  // amount in GHS, or percent in 0..100
  value: { type: Number, required: true, min: 0 },

  // active?
  enabled: { type: Boolean, default: true }
}, { _id: true });

const DiscountConfigSchema = new mongoose.Schema({
  rules: { type: [DiscountRuleSchema], default: [] },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('DiscountConfig', DiscountConfigSchema);
