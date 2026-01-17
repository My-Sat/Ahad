// controllers/discounts.js
const DiscountConfig = require('../models/discount');
const Service = require('../models/service');
const ServiceCategory = require('../models/service_category');
const mongoose = require('mongoose');         
const Customer = require('../models/customer');

const CUSTOMER_TYPES = ['one_time', 'regular', 'artist', 'organisation'];

function sanitizeRule(r) {
  const scope = String(r.scope || '').trim();
  const enabled = (r.enabled === true || r.enabled === 'true' || r.enabled === 1 || r.enabled === '1');

  const mode = String(r.mode || '').trim();
  const value = Number(r.value);

  const targets = Array.isArray(r.targets) ? r.targets.map(x => String(x)) : [];
  if (scope !== 'general' && (!targets.length || !targets[0])) return null;

  // ✅ add 'customer'
  if (!['general','customer_type','customer','service','service_category'].includes(scope)) return null;
  if (!['amount','percent'].includes(mode)) return null;
  if (!isFinite(value) || value < 0) return null;
  if (mode === 'percent' && value > 100) return null;

  if (scope === 'general') return { scope, targets: [], mode, value, enabled };

  if (scope === 'customer_type') {
    const t = targets.filter(x => CUSTOMER_TYPES.includes(x));
    return { scope, targets: t, mode, value, enabled };
  }

  // ✅ customer scope: validate ObjectId target(s)
  if (scope === 'customer') {
    const t = targets.filter(x => mongoose.Types.ObjectId.isValid(x));
    if (!t.length) return null;
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

exports.apiSearchCustomers = async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const by = (req.query.by || 'name').toString().toLowerCase();

    if (!q) return res.json({ ok: true, results: [] });

    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');

    const or = [];
    if (by === 'phone') {
      or.push({ phone: rx });
    } else {
      // "name": search firstName + businessName, and also phone as a convenience
      or.push({ firstName: rx }, { businessName: rx }, { phone: rx });
    }

    const docs = await Customer.find({ $or: or })
      .limit(20)
      .select('_id category firstName businessName phone')
      .lean();

    const results = (docs || []).map(c => {
      const name =
        (c.category === 'artist' || c.category === 'organisation')
          ? (c.businessName || '')
          : (c.firstName || c.businessName || '');

      return {
        _id: String(c._id),
        phone: c.phone || '',
        category: c.category || '',
        name: name || '',
        label: `${(name || 'Customer')} (${c.phone || ''})`
      };
    });

    return res.json({ ok: true, results });
  } catch (e) {
    console.error('apiSearchCustomers error', e);
    return res.status(500).json({ ok: false, error: 'Failed to search customers' });
  }
};