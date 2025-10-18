const mongoose = require('mongoose');

const ServiceCostSubUnitSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true, index: true },
  name: { type: String, required: true, trim: true },
  nameNormalized: { type: String, required: true, trim: true, lowercase: true },
}, { timestamps: true });

ServiceCostSubUnitSchema.pre('validate', function(next) {
  if (this.name) this.nameNormalized = this.name.trim().toLowerCase();
  next();
});

ServiceCostSubUnitSchema.index({ unit: 1, nameNormalized: 1 }, { unique: true });

module.exports = mongoose.model('ServiceCostSubUnit', ServiceCostSubUnitSchema);
