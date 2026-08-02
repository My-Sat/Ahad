// models/store_stock_transfer.js
const mongoose = require('mongoose');

const StoreStockTransferSchema = new mongoose.Schema({
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  toMaterial: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', default: null, index: true },

  fromStore: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  toStore: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },

  // ✅ NEW: link to specific stock items
  fromStock: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreStock', index: true },
  toStock: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreStock', index: true },

  // qty is stored in the material's base unit. These fields preserve the unit
  // Admin selected in the transfer form.
  qty: { type: Number, required: true, min: 1 },
  destinationQty: { type: Number, default: 0, min: 0 },
  converted: { type: Boolean, default: false },
  conversionFactor: { type: Number, default: 1, min: 0.000001 },
  transferUnitName: { type: String, default: '' },
  transferUnitFactor: { type: Number, default: 1, min: 0.000001 },
  transferUnitQuantity: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

StoreStockTransferSchema.index({ fromStock: 1, createdAt: 1 });
StoreStockTransferSchema.index({ toStock: 1, createdAt: 1 });

module.exports = mongoose.model('StoreStockTransfer', StoreStockTransferSchema);
