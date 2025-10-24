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
  key: { type: String, required: true, index: true }, // stable key computed from selections
  stock: { type: Number, default: 0 }, // stocked quantity (can go negative when consumed)
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

// UNIQUE on key globally (no service component)
MaterialSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model('Material', MaterialSchema);
