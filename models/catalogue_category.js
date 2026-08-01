const mongoose = require('mongoose');

const CatalogueCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nameNormalized: { type: String, required: true, trim: true, lowercase: true },
  createdBy: { type: String, default: '', trim: true }
}, { timestamps: true });

CatalogueCategorySchema.pre('validate', function (next) {
  const name = String(this.name || '').trim().replace(/\s+/g, ' ');
  this.name = name;
  this.nameNormalized = name.toLowerCase();
  next();
});

CatalogueCategorySchema.index({ nameNormalized: 1 }, { unique: true });
CatalogueCategorySchema.index({ name: 1, _id: 1 });

module.exports = mongoose.model('CatalogueCategory', CatalogueCategorySchema);
