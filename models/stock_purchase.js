const mongoose = require('mongoose');

const StockPurchaseSchema = new mongoose.Schema({
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  supplierName: { type: String, default: '' },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  storeName: { type: String, default: '' },
  stock: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreStock', required: true, index: true },
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true, index: true },
  materialName: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  unitCost: { type: Number, required: true, min: 0 },
  totalCost: { type: Number, required: true, min: 0 },
  paymentType: { type: String, enum: ['cash', 'credit'], required: true, index: true },
  cashBook: { type: mongoose.Schema.Types.ObjectId, ref: 'CashBook', default: null },
  cashBookName: { type: String, default: '' },
  cashBookKind: { type: String, enum: ['cash', 'bank', 'momo', null], default: null },
  cashMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
  note: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('StockPurchase', StockPurchaseSchema);
