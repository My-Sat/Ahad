const mongoose = require('mongoose');

const SelectionSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostUnit', required: true },
  subUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceCostSubUnit', required: true }
}, { _id: false });

const CategoryPriceSchema = new mongoose.Schema({
  price: { type: Number, required: false, min: 0, default: null },
  price2: { type: Number, required: false, min: 0, default: null }
}, { _id: false });

function normalizeLabelKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

let flexibleIndexPromise = null;

const ServicePriceSchema = new mongoose.Schema({
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'service', required: true, index: true },
  selections: { type: [SelectionSchema], required: true },
  key: { type: String, required: true, index: true }, // stable key for exact-match lookups
  // Optional short label for this rule (used in Jobs/cart/order views instead of long selection composition)
  customLabel: { type: String, trim: true, default: '' },
  labelKey: { type: String, default: '', index: true },
  price: { type: Number, required: true, min: 0 },

  // Optional second price — used for "Front + Back" reduced pricing.
  // If null/undefined the client will fall back to `price`.
  price2: { type: Number, required: false, min: 0, default: null },
  categoryPrices: {
    artist: { type: CategoryPriceSchema, default: () => ({}) },
    organisation: { type: CategoryPriceSchema, default: () => ({}) }
  },

  createdBy: { type: String },
  updatedBy: { type: String }
}, { timestamps: true });

// compute a stable key: sort "unit:subUnit" parts and join with '|'
ServicePriceSchema.methods.computeKey = function() {
  const parts = (this.selections || []).map(s => `${s.unit.toString()}:${s.subUnit.toString()}`);
  parts.sort();
  return parts.join('|');
};

ServicePriceSchema.pre('validate', function(next) {
  if (!this.key) this.key = this.computeKey();
  this.customLabel = String(this.customLabel || '').trim();
  this.labelKey = normalizeLabelKey(this.customLabel);
  next();
});

// Same selections are allowed only when the optional short rule name differs.
// Blank-name rules remain unique per service + selection set.
ServicePriceSchema.index({ service: 1, key: 1, labelKey: 1 }, { unique: true });

ServicePriceSchema.statics.normalizeLabelKey = normalizeLabelKey;

ServicePriceSchema.statics.ensureFlexibleSelectionIndexes = async function ensureFlexibleSelectionIndexes() {
  if (flexibleIndexPromise) return flexibleIndexPromise;
  flexibleIndexPromise = (async () => {
    const collection = this.collection;

    const needsLabelKey = await collection
      .find({ $or: [{ labelKey: { $exists: false } }, { labelKey: null }] }, { projection: { _id: 1, customLabel: 1 } })
      .toArray()
      .catch(() => []);
    if (needsLabelKey.length) {
      await collection.bulkWrite(needsLabelKey.map(doc => ({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { labelKey: normalizeLabelKey(doc.customLabel) } }
        }
      })), { ordered: false }).catch(() => null);
    }

    const indexes = await collection.indexes().catch(() => []);
    const oldUnique = indexes.find(idx => (
      idx && idx.unique &&
      idx.key && idx.key.service === 1 && idx.key.key === 1 &&
      typeof idx.key.labelKey === 'undefined'
    ));
    if (oldUnique && oldUnique.name) {
      await collection.dropIndex(oldUnique.name).catch(err => {
        if (err && (err.codeName === 'IndexNotFound' || err.code === 27)) return;
        throw err;
      });
    }

    await collection.createIndex({ service: 1, key: 1 }, { name: 'service_1_key_1' });
    await collection.createIndex(
      { service: 1, key: 1, labelKey: 1 },
      { unique: true, name: 'service_1_key_1_labelKey_1' }
    );
  })().catch(err => {
    flexibleIndexPromise = null;
    throw err;
  });
  return flexibleIndexPromise;
};

module.exports = mongoose.model('service_price', ServicePriceSchema);
