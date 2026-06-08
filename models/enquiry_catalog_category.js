const mongoose = require('mongoose');

const EnquiryServiceSchema = new mongoose.Schema({
  name: { type: String, trim: true, required: true },
  orderIndex: { type: Number, default: 0 }
}, { _id: true, timestamps: true });

const EnquiryCatalogCategorySchema = new mongoose.Schema({
  name: { type: String, trim: true, required: true, unique: true },
  orderIndex: { type: Number, default: 0, index: true },
  services: { type: [EnquiryServiceSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

EnquiryCatalogCategorySchema.index({ orderIndex: 1, name: 1 });

module.exports = mongoose.model('EnquiryCatalogCategory', EnquiryCatalogCategorySchema);
