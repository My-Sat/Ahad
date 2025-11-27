// models/cashier_collection.js
const mongoose = require('mongoose');

const CashierCollectionSchema = new mongoose.Schema({
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  collector: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who recorded the collection (accountant)
  amount: { type: Number, required: true }, // actual amount handed to accountant
  date: { type: Date, default: Date.now }, // when accountant recorded it
  note: { type: String, default: '' },
  dayClosed: { type: Boolean, default: false } // whether cashier's day was closed by this collection
});

module.exports = mongoose.model('CashierCollection', CashierCollectionSchema);
