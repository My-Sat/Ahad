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
  selections: { type: [SelectionRef], default: [] },
  key: { type: String, required: true }, // indexed/unique via schema.index below

  // Initial stocked reference (admin-specified). This must NOT be decremented by usage.
  stocked: { type: Number, default: 0, min: 0 },

  // kept for backward compatibility (existing data may have been using 'stock').
  // We won't rely on this for displayed 'Stocked' once stocked exists.
  stock: { type: Number, default: 0 },

  // Stock counting units. factor = how many smallest/base units are in this unit.
  // Example: baseUnitName=sheets, stockUnits=[{name:'sheets',factor:1}, {name:'ream',factor:500}].
  baseUnitName: { type: String, default: 'piece', trim: true },
  stockUnits: [{
    name: { type: String, required: true, trim: true },
    factor: { type: Number, required: true, min: 0.000001 },
    isBase: { type: Boolean, default: false }
  }],

  createdBy: { type: String },
}, { timestamps: true });

MaterialSchema.methods.computeKey = function () {
  const parts = (this.selections || [])
    .filter(s => s && s.unit && s.subUnit)
    .map(s => `${s.unit.toString()}:${s.subUnit.toString()}`);
  parts.sort();
  if (parts.length) return parts.join('|');

  const nameKey = String(this.name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return `standalone:${nameKey}`;
};

MaterialSchema.pre('validate', function (next) {
  if (!this.key) this.key = this.computeKey();
  // backward-compat convenience: if stocked not set but legacy stock present, use it
  if ((this.stocked === undefined || this.stocked === null) && typeof this.stock === 'number' && !isNaN(this.stock)) {
    this.stocked = Math.max(0, Math.floor(this.stock));
  }

  const base = String(this.baseUnitName || 'piece').trim() || 'piece';
  const seen = new Set([base.toLowerCase()]);
  const units = [{ name: base, factor: 1, isBase: true }];
  (Array.isArray(this.stockUnits) ? this.stockUnits : []).forEach(unit => {
    const name = String(unit && unit.name || '').trim();
    const factor = Number(unit && unit.factor || 0);
    if (!name || !isFinite(factor) || factor <= 1) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    units.push({ name, factor: Number(factor.toFixed(6)), isBase: false });
  });
  this.baseUnitName = base;
  this.stockUnits = units.sort((a, b) => Number(a.factor || 0) - Number(b.factor || 0));
  next();
});

// UNIQUE on key globally (no service component)
MaterialSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('Material', MaterialSchema);
