const mongoose = require('mongoose');

const ServiceComponentSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true },
  subUnits: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostSubUnit' }]
}, { _id: false });

const ServiceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameNormalized: { type: String, required: true, trim: true, lowercase: true },
  components: [ServiceComponentSchema]
}, { timestamps: true });

ServiceSchema.pre('validate', function(next) {
  if (this.name) this.nameNormalized = this.name.trim().toLowerCase();
  next();
});

ServiceSchema.index({ nameNormalized: 1 }, { unique: true });

module.exports = mongoose.model('Service', ServiceSchema);
