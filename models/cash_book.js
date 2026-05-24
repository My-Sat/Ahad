const mongoose = require('mongoose');

const CashBookSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  kind: {
    type: String,
    enum: ['cash', 'bank', 'momo'],
    default: 'cash',
    index: true
  },
  balance: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('CashBook', CashBookSchema);
