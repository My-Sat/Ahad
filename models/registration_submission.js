const mongoose = require('mongoose');

const RegistrationSubmissionSchema = new mongoose.Schema({
  dayKey: { type: String, required: true, index: true }, // YYYY-MM-DD (UTC day)
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
  walkInNumber: { type: Number, default: null },
  displayName: { type: String, required: true, trim: true },
  phone: { type: String, default: '', trim: true },
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCategory', required: true }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  consumedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  consumedOrderId: { type: String, default: '' },
  consumedAt: { type: Date, default: null },
  status: { type: String, enum: ['pending', 'consumed', 'cancelled'], default: 'pending', index: true }
}, { timestamps: true });

RegistrationSubmissionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('RegistrationSubmission', RegistrationSubmissionSchema);

