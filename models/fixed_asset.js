const mongoose = require('mongoose');

const FixedAssetSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true, uppercase: true, minlength: 7, maxlength: 7, match: /^[A-Z]{2}-[A-Z]{2}\d{2}$/, unique: true, sparse: true, index: true },
  assetType: { type: String, trim: true, default: 'printer', index: true },
  printer: { type: mongoose.Schema.Types.ObjectId, ref: 'Printer', default: null, index: true },
  purchaseDate: { type: Date, default: Date.now, index: true },
  purchaseCost: { type: Number, required: true, min: 0 },
  residualValue: { type: Number, default: 0, min: 0 },
  depreciationMethod: { type: String, enum: ['usage', 'straight_line'], default: 'usage', index: true },
  usefulLifeUnits: { type: Number, default: 0, min: 0 },
  usefulLifeMonths: { type: Number, default: 0, min: 0 },
  accumulatedDepreciation: { type: Number, default: 0, min: 0 },
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', default: null },
  cashBookName: { type: String, default: '' },
  cashBookKind: { type: String, enum: ['cash', 'bank', 'momo', null], default: null },
  cashMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  note: { type: String, trim: true, default: '' },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' }
}, { timestamps: true });

FixedAssetSchema.index({ printer: 1, active: 1 });

module.exports = mongoose.model('FixedAsset', FixedAssetSchema);
