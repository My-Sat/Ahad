// models/material_usage.js
const mongoose = require('mongoose');

const MaterialUsageSchema = new mongoose.Schema({
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  orderId: { type: String, required: true, index: true }, // human-friendly orderId
  orderRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true }, // link to order doc
  itemIndex: { type: Number, required: true }, // which item in the order.items array
  count: { type: Number, required: true, min: 0 }, // number of units used
  createdAt: { type: Date, default: Date.now }
});

// Optional aggregate totals collection (exists for quick totals if you want)
const MaterialAggregateSchema = new mongoose.Schema({
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', unique: true, required: true },
  total: { type: Number, default: 0 }
});

module.exports = {
  MaterialUsage: mongoose.model('MaterialUsage', MaterialUsageSchema),
  MaterialAggregate: mongoose.model('MaterialAggregate', MaterialAggregateSchema)
};
