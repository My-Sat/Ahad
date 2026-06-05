// models/service_category.js
const mongoose = require('mongoose');

const SYSTEM_CATEGORIES = Object.freeze([
  { key: 'outsourced', name: 'Out-Sourced', isProtected: false },
  { key: 'class_based', name: 'CLASS BASED', isProtected: true }
]);

function normalizeSystemCategoryName(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ServiceCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, lowercase: false },
  nameNormalized: { type: String, required: true, trim: true, lowercase: true },
  showInOrders: { type: Boolean, default: true } // if false: hidden from orders listing for non-admin users
}, { timestamps: true });

ServiceCategorySchema.pre('validate', function (next) {
  if (this.name) this.nameNormalized = String(this.name).trim().toLowerCase();
  next();
});

ServiceCategorySchema.index({ nameNormalized: 1 }, { unique: true });

ServiceCategorySchema.statics.systemCategoryForName = function (name) {
  const normalized = normalizeSystemCategoryName(name);
  return SYSTEM_CATEGORIES.find(cat => normalizeSystemCategoryName(cat.name) === normalized) || null;
};

ServiceCategorySchema.statics.isProtectedSystemName = function (name) {
  const sys = this.systemCategoryForName(name);
  return !!(sys && sys.isProtected);
};

ServiceCategorySchema.statics.withSystemFlags = function (category) {
  if (!category) return category;
  const obj = category.toObject ? category.toObject() : Object.assign({}, category);
  const sys = this.systemCategoryForName(obj.name);
  obj.systemKey = sys ? sys.key : '';
  obj.isSystem = !!sys;
  obj.isProtected = !!(sys && sys.isProtected);
  return obj;
};

ServiceCategorySchema.statics.ensureSystemCategories = async function () {
  const ensured = [];

  for (const sys of SYSTEM_CATEGORIES) {
    const nameNormalized = String(sys.name || '').trim().toLowerCase();
    let cat = await this.findOne({ nameNormalized });

    if (!cat) {
      try {
        cat = await this.create({ name: sys.name, showInOrders: true });
      } catch (e) {
        cat = await this.findOne({ nameNormalized });
      }
    }

    if (cat && (cat.name !== sys.name || cat.showInOrders !== true)) {
      cat.name = sys.name;
      cat.showInOrders = true;
      await cat.save();
    }

    if (cat) ensured.push(cat.toObject ? cat.toObject() : cat);
  }

  return ensured;
};

const ServiceCategory = mongoose.model('ServiceCategory', ServiceCategorySchema);
ServiceCategory.SYSTEM_CATEGORIES = SYSTEM_CATEGORIES;
ServiceCategory.normalizeSystemCategoryName = normalizeSystemCategoryName;

module.exports = ServiceCategory;
