// models/service_cost_subunit.js
const mongoose = require('mongoose');

const ServiceCostSubUnitSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true, index: true },
  name: { type: String, required: true, trim: true },
  nameNormalized: { type: String, required: true, trim: true, lowercase: true },

  // NEW: multiplier factor used when counting prints for printers (default 1)
  // Example: A4 -> 1, A3 -> 2, A2 -> 4
  factor: { type: Number, required: true, default: 1 }
}, { timestamps: true });

ServiceCostSubUnitSchema.pre('validate', function(next) {
  if (this.name) this.nameNormalized = this.name.trim().toLowerCase();
  // coerce factor to a safe number >= 0
  if (this.factor === undefined || this.factor === null) this.factor = 1;
  else {
    const f = Number(this.factor);
    this.factor = (isNaN(f) || f <= 0) ? 1 : f;
  }
  next();
});

ServiceCostSubUnitSchema.index({ unit: 1, nameNormalized: 1 }, { unique: true });

module.exports = mongoose.model('ServiceCostSubUnit', ServiceCostSubUnitSchema);
