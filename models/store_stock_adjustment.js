// models/store_stock_adjustment.js
const mongoose = require('mongoose');

const StoreStockAdjustmentSchema = new mongoose.Schema({
  stock: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreStock', required: true, index: true }, // ties to stock item
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },

  kind: { type: String, enum: ['add', 'adjust-delta', 'adjust-absolute'], required: true },

  // for delta adjustments
  delta: { type: Number, default: 0 },

  // snapshot AFTER the operation (remaining = stocked - used)
  setTo: { type: Number, required: true },

  stockedAfter: { type: Number, required: true },
  usedAfter: { type: Number, required: true },

  note: { type: String, default: '' },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  createdAt: { type: Date, default: Date.now }
});

StoreStockAdjustmentSchema.index({ stock: 1, createdAt: 1 });

module.exports = mongoose.model('StoreStockAdjustment', StoreStockAdjustmentSchema);
