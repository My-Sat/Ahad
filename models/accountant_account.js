// models/accountant_account.js
const mongoose = require('mongoose');

const AccountantAccountSchema = new mongoose.Schema({
  accountant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true }, // stored as UTC midnight for the day
  totalCollected: { type: Number, default: 0 }, // sum of amounts collected by this accountant on this date
  updatedAt: { type: Date, default: Date.now }
});

// ensure unique per accountant/date
AccountantAccountSchema.index({ accountant: 1, date: 1 }, { unique: true });

AccountantAccountSchema.statics.dateKey = function(date) {
  // return Date at UTC midnight for a given Date or ISO string
  const d = date ? new Date(date) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
};

AccountantAccountSchema.methods.add = async function (amount) {
  this.totalCollected = Number((Number(this.totalCollected || 0) + Number(amount || 0)).toFixed(2));
  this.updatedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('AccountantAccount', AccountantAccountSchema);
