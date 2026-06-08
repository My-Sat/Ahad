const mongoose = require('mongoose');

const ServiceEnquirySchema = new mongoose.Schema({
  firstName: { type: String, trim: true, default: '' },
  phone: { type: String, trim: true, required: true, index: true },
  action: { type: String, enum: ['print', 'share'], default: 'print', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  createdByName: { type: String, trim: true, default: '' }
}, { timestamps: true });

ServiceEnquirySchema.index({ createdAt: -1 });
ServiceEnquirySchema.index({ firstName: 'text', phone: 'text' });

module.exports = mongoose.model('ServiceEnquiry', ServiceEnquirySchema);
