// models/messaging_config.js
const mongoose = require('mongoose');

// Reusable schema for an auto-message event (Order placed / Order paid / Debtors periodic)
const AutoEventConfigSchema = new mongoose.Schema(
  {
    // enable/disable this event’s auto SMS
    enabled: { type: Boolean, default: true },

    // If true, send different text per customer type. If false, always use generalTemplate.
    usePerCustomerTypeTemplates: { type: Boolean, default: true },

    // Template used when usePerCustomerTypeTemplates = false, or as fallback
    generalTemplate: { type: String, default: '' },

    // Templates by customer type (fallback order: specific -> general -> default hardcoded)
    templates: {
      one_time: { type: String, default: '' },
      regular: { type: String, default: '' },
      artist: { type: String, default: '' },
      organisation: { type: String, default: '' }
    },

    // Optional signature/appended footer
    appendSignature: { type: Boolean, default: false },
    signatureText: { type: String, default: 'AHADPRINT' },

    // -----------------------------
    // NEW: scheduler fields (for debtors periodic)
    // -----------------------------
    frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'weekly' },
    hour: { type: Number, default: 9 },     // Africa/Accra local time
    minute: { type: Number, default: 0 },

    // Used by server scheduler to avoid duplicate sends
    nextRunAt: { type: Date, default: null },
    lastRunAt: { type: Date, default: null }
  },
  { _id: false }
);

const MessagingConfigSchema = new mongoose.Schema(
  {
    auto: {
      order: { type: AutoEventConfigSchema, default: () => ({}) },
      pay: { type: AutoEventConfigSchema, default: () => ({}) },

      // ✅ NEW: periodic debtor messages
      debtors: { type: AutoEventConfigSchema, default: () => ({ enabled: false }) }
    },

    // Backward-compat fields
    autoEnabled: { type: Boolean, default: true },
    usePerCustomerTypeTemplates: { type: Boolean, default: true },
    generalTemplate: { type: String, default: '' },
    templates: {
      one_time: { type: String, default: '' },
      regular: { type: String, default: '' },
      artist: { type: String, default: '' },
      organisation: { type: String, default: '' }
    },
    appendSignature: { type: Boolean, default: false },
    signatureText: { type: String, default: 'AHADPRINT' },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('MessagingConfig', MessagingConfigSchema);
