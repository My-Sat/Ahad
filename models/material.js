// models/material.js
const mongoose = require('mongoose');

const SelectionRef = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true },
  subUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostSubUnit', required: true }
}, { _id: false });

// Material is GLOBAL now (not scoped to a service)
const MaterialSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // removed `service` field — materials are unique across all services
  selections: { type: [SelectionRef], required: true },
  key: { type: String, required: true }, // indexed/unique via schema.index below

  // Initial stocked reference (admin-specified). This must NOT be decremented by usage.
  stocked: { type: Number, default: 0, min: 0 },

  // kept for backward compatibility (existing data may have been using 'stock').
  // We won't rely on this for displayed 'Stocked' once stocked exists.
  stock: { type: Number, default: 0 },

  createdBy: { type: String },
}, { timestamps: true });

MaterialSchema.methods.computeKey = function () {
  const parts = (this.selections || []).map(s => `${s.unit.toString()}:${s.subUnit.toString()}`);
  parts.sort();
  return parts.join('|');
};

MaterialSchema.pre('validate', function (next) {
  if (!this.key) this.key = this.computeKey();
  // backward-compat convenience: if stocked not set but legacy stock present, use it
  if ((this.stocked === undefined || this.stocked === null) && typeof this.stock === 'number' && !isNaN(this.stock)) {
    this.stocked = Math.max(0, Math.floor(this.stock));
  }
  next();
});

// UNIQUE on key globally (no service component)
MaterialSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('Material', MaterialSchema);
