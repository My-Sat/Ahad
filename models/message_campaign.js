// models/message_campaign.js
const mongoose = require('mongoose');

const MessageCampaignSchema = new mongoose.Schema({
  mode: { type: String, enum: ['manual', 'auto'], default: 'manual' },
  message: { type: String, required: true },

  // Targeting
  target: { type: String, enum: ['all', 'customer_type', 'debtors'], required: true },
  customerType: { type: String, enum: ['one_time', 'regular', 'artist', 'organisation', null], default: null },

  // Results
  totalRecipients: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failCount: { type: Number, default: 0 },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sentAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('MessageCampaign', MessageCampaignSchema);
