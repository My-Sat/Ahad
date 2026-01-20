// models/store_stock.js
const mongoose = require('mongoose');

const StoreStockSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },

  // Stock reference for THIS store (not global)
  stocked: { type: Number, default: 0, min: 0 },

  // remove from store list without deleting history
  active: { type: Boolean, default: true }
}, { timestamps: true });

StoreStockSchema.index({ store: 1, material: 1 }, { unique: true });

module.exports = mongoose.model('StoreStock', StoreStockSchema);
