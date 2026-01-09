// controllers/discounts.js
const DiscountConfig = require('../models/discount');
const Service = require('../models/service');
const ServiceCategory = require('../models/service_category');

const CUSTOMER_TYPES = ['one_time', 'regular', 'artist', 'organisation'];

function sanitizeRule(r) {
  const scope = String(r.scope || '').trim();
  const enabled = (r.enabled === true || r.enabled === 'true' || r.enabled === 1 || r.enabled === '1');

  const mode = String(r.mode || '').trim();
  const value = Number(r.value);

  const targets = Array.isArray(r.targets) ? r.targets.map(x => String(x)) : [];

  if (!['general','customer_type','service','service_category'].includes(scope)) return null;
  if (!['amount','percent'].includes(mode)) return null;
  if (!isFinite(value) || value < 0) return null;

  // percent range guard
  if (mode === 'percent' && value > 100) return null;

  // scope guards
  if (scope === 'general') return { scope, targets: [], mode, value, enabled };
  if (scope === 'customer_type') {
    const t = targets.filter(x => CUSTOMER_TYPES.includes(x));
    return { scope, targets: t, mode, value, enabled };
  }
  // service/service_category accept ids (strings)
  return { scope, targets, mode, value, enabled };
}

exports.page = async (req, res) => {
  const cfg = await DiscountConfig.findOne().sort({ updatedAt: -1 }).lean();

  const services = await Service.find().select('_id name category').sort('name').lean();
  const categories = await ServiceCategory.find().select('_id name showInOrders').sort('name').lean();

  res.render('discounts/index', {
    title: 'Discounts',
    config: cfg || { rules: [] },
    services,
    categories,
    customerTypes: CUSTOMER_TYPES
  });
};

exports.apiGet = async (req, res) => {
  const cfg = await DiscountConfig.findOne().sort({ updatedAt: -1 }).lean();
  res.json({ ok: true, config: cfg || { rules: [] } });
};

exports.apiSave = async (req, res) => {
  try {
    const rulesIn = (req.body && Array.isArray(req.body.rules)) ? req.body.rules : [];
    const rules = rulesIn.map(sanitizeRule).filter(Boolean);

    let cfg = await DiscountConfig.findOne().sort({ updatedAt: -1 });
    if (!cfg) cfg = new DiscountConfig({ rules: [] });

    cfg.rules = rules;
    cfg.updatedBy = req.user ? req.user._id : null;
    cfg.updatedAt = new Date();

    await cfg.save();

    res.json({ ok: true });
  } catch (e) {
    console.error('discount save error', e);
    res.status(500).json({ ok: false, error: 'Failed to save discounts' });
  }
};
