// models/store_stock_transfer.js
const mongoose = require('mongoose');

const StoreStockTransferSchema = new mongoose.Schema({
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },

  fromStore: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  toStore: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },

  // ✅ NEW: link to specific stock items
  fromStock: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreStock', index: true },
  toStock: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreStock', index: true },

  qty: { type: Number, required: true, min: 1 },
  createdAt: { type: Date, default: Date.now },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

StoreStockTransferSchema.index({ fromStock: 1, createdAt: 1 });
StoreStockTransferSchema.index({ toStock: 1, createdAt: 1 });

module.exports = mongoose.model('StoreStockTransfer', StoreStockTransferSchema);
