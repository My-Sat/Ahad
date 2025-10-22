// models/material.js
const mongoose = require('mongoose');

const SelectionRef = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true },
  subUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostSubUnit', required: true }
}, { _id: false });

// A Material represents a tracked combination of sub-units (e.g. "A3 + STD")
// optional `service` field if you want to scope it to a service; can be null for global materials
const MaterialSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, // human label, e.g. "A3 STD paper"
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null }, // optional
  selections: { type: [SelectionRef], required: true }, // the combination to match (subset test)
  key: { type: String, required: true, index: true }, // stable key computed from selections
  createdBy: { type: String },
}, { timestamps: true });

// compute stable key: sort "unit:subUnit" parts and join with '|'
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
