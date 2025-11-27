// models/cashier_balance.js
const mongoose = require('mongoose');

const CashierBalanceSchema = new mongoose.Schema({
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0 }, // positive means cashier owes that amount to the company (uncollected)
  updatedAt: { type: Date, default: Date.now }
});

CashierBalanceSchema.methods.adjust = async function (delta) {
  this.balance = Number((Number(this.balance || 0) + Number(delta || 0)).toFixed(2));
  this.updatedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('CashierBalance', CashierBalanceSchema);
