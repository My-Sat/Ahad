const mongoose = require('mongoose');

const StoreStockLotSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  stock: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreStock', required: true, index: true },
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },

  sourceType: {
    type: String,
    enum: ['purchase', 'transfer', 'adjustment', 'opening', 'legacy'],
    default: 'purchase',
    index: true
  },
  sourceId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  sourceRef: { type: String, default: '' },
  parentLot: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreStockLot', default: null },
  lotCode: { type: String, default: '', index: true },

  originalQuantity: { type: Number, required: true, min: 0 },
  remainingQuantity: { type: Number, required: true, min: 0, index: true },
  unitCost: { type: Number, required: true, min: 0 },
  totalCost: { type: Number, default: 0, min: 0 },
  purchaseUnitName: { type: String, default: '' },
  purchaseUnitFactor: { type: Number, default: 1, min: 0.000001 },
  purchaseUnitQuantity: { type: Number, default: 0, min: 0 },
  purchaseUnitCost: { type: Number, default: 0, min: 0 },
  baseUnitName: { type: String, default: 'piece' },
  receivedAt: { type: Date, default: Date.now, index: true },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

StoreStockLotSchema.index({ store: 1, material: 1, active: 1, remainingQuantity: 1, receivedAt: 1 });
StoreStockLotSchema.index({ stock: 1, active: 1, remainingQuantity: 1 });

module.exports = mongoose.model('StoreStockLot', StoreStockLotSchema);
