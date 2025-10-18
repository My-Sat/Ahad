const mongoose = require('mongoose');

const SelectionSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true },
  subUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostSubUnit', required: true }
}, { _id: false });

const ServicePriceSchema = new mongoose.Schema({
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'service', required: true, index: true },
  selections: { type: [SelectionSchema], required: true },
  key: { type: String, required: true, index: true }, // stable key for exact-match lookups
  price: { type: Number, required: true, min: 0 },
  createdBy: { type: String },
  updatedBy: { type: String }
}, { timestamps: true });

// compute a stable key: sort "unit:subUnit" parts and join with '|'
ServicePriceSchema.methods.computeKey = function() {
  const parts = (this.selections || []).map(s => `${s.unit.toString()}:${s.subUnit.toString()}`);
  parts.sort();
  return parts.join('|');
};

ServicePriceSchema.pre('validate', function(next) {
  if (!this.key) this.key = this.computeKey();
  next();
});

// prevent duplicate identical selection rule per service
ServicePriceSchema.index({ service: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('service_price', ServicePriceSchema);
