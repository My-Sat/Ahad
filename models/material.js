// File: models/material.js
const mongoose = require('mongoose');

const SelectionRef = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true },
  subUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostSubUnit', required: true }
}, { _id: false });

// A Material represents a tracked combination of sub-units (e.g. "A3 + STD")
const MaterialSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
  selections: { type: [SelectionRef], required: true },
  key: { type: String, required: true, index: true },
  // NEW: stocked quantity (admin-provided). May go negative if usage exceeds stock.
  stock: { type: Number, default: 0, min: -1000000 },
  createdBy: { type: String },
}, { timestamps: true });

MaterialSchema.methods.computeKey = function () {
  const parts = (this.selections || []).map(s => `${s.unit.toString()}:${s.subUnit.toString()}`);
  parts.sort();
  return parts.join('|');
};

MaterialSchema.pre('validate', function (next) {
  if (!this.key) this.key = this.computeKey();
  next();
});

// unique per service + key (service may be null)
MaterialSchema.index({ service: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Material', MaterialSchema);
