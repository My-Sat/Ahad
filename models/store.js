// models/store.js
const mongoose = require('mongoose');

const StoreSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // ONLY ONE store should be operational at a time
  isOperational: { type: Boolean, default: false }
}, { timestamps: true });

StoreSchema.index({ name: 1 }, { unique: true });
StoreSchema.index({ isOperational: 1 });

module.exports = mongoose.model('Store', StoreSchema);
