// models/messaging_config.js
const mongoose = require('mongoose');

const MessagingConfigSchema = new mongoose.Schema({
  // Auto/Dynamic messages
  autoEnabled: { type: Boolean, default: true },

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

  // Audit
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('MessagingConfig', MessagingConfigSchema);
