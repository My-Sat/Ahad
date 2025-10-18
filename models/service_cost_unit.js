const mongoose = require('mongoose');

const ServiceCostUnitSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameNormalized: { type: String, required: true, trim: true, lowercase: true },
}, { timestamps: true });

ServiceCostUnitSchema.pre('validate', function(next) {
  if (this.name) this.nameNormalized = this.name.trim().toLowerCase();
  next();
});

ServiceCostUnitSchema.index({ nameNormalized: 1 }, { unique: true });

module.exports = mongoose.model('ServiceCostUnit', ServiceCostUnitSchema);
