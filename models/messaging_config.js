// models/messaging_config.js
const mongoose = require('mongoose');

// Reusable schema for an auto-message event (Order placed / Order paid)
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
    signatureText: { type: String, default: 'AHADPRINT' }
  },
  { _id: false }
);

const MessagingConfigSchema = new mongoose.Schema(
  {
    // NEW: auto messaging config is now separated by event
    // - order: when order is placed
    // - pay: when order becomes fully paid
    auto: {
      order: { type: AutoEventConfigSchema, default: () => ({}) },
      pay: { type: AutoEventConfigSchema, default: () => ({}) }
    },

    // Backward-compat fields (optional): keep these so older code/data won't break if still present
    // You can remove these later after migration, but keeping them is safe.
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

    // Audit
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('MessagingConfig', MessagingConfigSchema);
