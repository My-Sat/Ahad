// models/material_usage.js
const mongoose = require('mongoose');

const MaterialUsageSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true }, // ✅ NEW
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  orderId: { type: String, required: true, index: true },
  orderRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  itemIndex: { type: Number, required: true },
  count: { type: Number, required: true, min: 0 },
  createdAt: { type: Date, default: Date.now }
});

const MaterialAggregateSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true }, // ✅ NEW
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  total: { type: Number, default: 0 }
});

// unique per store-material
MaterialAggregateSchema.index({ store: 1, material: 1 }, { unique: true });

module.exports = {
  MaterialUsage: mongoose.model('MaterialUsage', MaterialUsageSchema),
  MaterialAggregate: mongoose.model('MaterialAggregate', MaterialAggregateSchema)
};
