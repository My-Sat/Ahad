const mongoose = require('mongoose');

const ServiceComponentSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true },
  subUnits: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostSubUnit' }]
}, { _id: false });

const ServiceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameNormalized: { type: String, required: true, trim: true, lowercase: true },
  orderIndex: { type: Number, default: 0, index: true },
  // NEW: explicit flag indicating this service requires choosing a printer at order time
  requiresPrinter: { type: Boolean, default: false },
  pricingMode: { type: String, enum: ['price_rules', 'large_format'], default: 'price_rules', index: true },
  largeFormatRate: { type: Number, min: 0, default: null },
  // NEW: optional category reference
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCategory', default: null },
  components: [ServiceComponentSchema]
}, { timestamps: true });

ServiceSchema.pre('validate', function(next) {
  if (this.name) this.nameNormalized = this.name.trim().toLowerCase();
  if (this.pricingMode === 'large_format') this.requiresPrinter = true;
  next();
});

ServiceSchema.index({ nameNormalized: 1 }, { unique: true });

module.exports = mongoose.model('Service', ServiceSchema);
