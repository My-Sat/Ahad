const mongoose = require('mongoose');
const Customer = require('../models/customer');
const ServiceCategory = require('../models/service_category');
const RegistrationSubmission = require('../models/registration_submission');

function utcDayKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function customerDisplayName(c) {
  if (!c) return '';
  const cat = String(c.category || '').toLowerCase();
  if (cat === 'artist' || cat === 'organisation') {
    return String(c.businessName || c.phone || 'Customer').trim();
  }
  return String(c.firstName || c.businessName || c.phone || 'Customer').trim();
}

exports.page = async function page(req, res) {
  return res.render('registrations/index', { title: 'Registerations' });
};

exports.apiCategories = async function apiCategories(req, res) {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    const isAdmin = role === 'admin';
    const q = isAdmin ? {} : { showInOrders: true };
    const categories = await ServiceCategory.find(q).sort({ name: 1 }).lean();
    return res.json({ ok: true, categories });
  } catch (err) {
    console.error('registrations.apiCategories error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load categories' });
  }
};

exports.apiSubmit = async function apiSubmit(req, res) {
  try {
    const customerId = String(req.body.customerId || '').trim();
    const rawCategories = Array.isArray(req.body.categoryIds) ? req.body.categoryIds : [];
    const categoryIds = rawCategories
      .map(id => String(id || '').trim())
      .filter(id => mongoose.Types.ObjectId.isValid(id));

    if (!categoryIds.length) {
      return res.status(400).json({ ok: false, error: 'Select at least one service category' });
    }

    const role = String(req.user?.role || '').toLowerCase();
    const isAdmin = role === 'admin';
    const allowedCats = await ServiceCategory.find({
      _id: { $in: categoryIds.map(id => new mongoose.Types.ObjectId(id)) },
      ...(isAdmin ? {} : { showInOrders: true })
    }).select('_id').lean();

    if (!allowedCats.length || allowedCats.length !== categoryIds.length) {
      return res.status(400).json({ ok: false, error: 'One or more selected categories are not allowed' });
    }

    let customer = null;
    let walkInNumber = null;
    let displayName = '';
    let phone = '';

    if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({ ok: false, error: 'Invalid customer' });
      }
      customer = await Customer.findById(customerId).select('_id category firstName businessName phone').lean();
      if (!customer) return res.status(404).json({ ok: false, error: 'Customer not found' });
      displayName = customerDisplayName(customer);
      phone = String(customer.phone || '').trim();
    } else {
      const dayKey = utcDayKey();
      const last = await RegistrationSubmission.findOne({ dayKey, walkInNumber: { $ne: null } })
        .sort({ walkInNumber: -1 })
        .select('walkInNumber')
        .lean();
      walkInNumber = Number((last && last.walkInNumber) ? last.walkInNumber : 0) + 1;
      displayName = `Walk-in ${walkInNumber}`;
      phone = '';
    }

    const doc = await RegistrationSubmission.create({
      dayKey: utcDayKey(),
      customer: customer ? customer._id : null,
      walkInNumber,
      displayName,
      phone,
      categories: allowedCats.map(c => c._id),
      createdBy: new mongoose.Types.ObjectId(req.user._id),
      status: 'pending'
    });

    return res.json({
      ok: true,
      submission: {
        id: String(doc._id),
        displayName: doc.displayName,
        walkInNumber: doc.walkInNumber,
        customerId: doc.customer ? String(doc.customer) : '',
        categoriesCount: (doc.categories || []).length
      }
    });
  } catch (err) {
    console.error('registrations.apiSubmit error', err);
    return res.status(500).json({ ok: false, error: 'Failed to submit registration' });
  }
};

exports.apiListPending = async function apiListPending(req, res) {
  try {
    const dayKey = utcDayKey();
    const rows = await RegistrationSubmission.find({ status: 'pending', dayKey })
      .populate('categories', '_id name')
      .sort({ createdAt: 1 })
      .lean();

    const submissions = (rows || []).map(r => ({
      id: String(r._id),
      displayName: String(r.displayName || '').trim(),
      phone: String(r.phone || '').trim(),
      customerId: r.customer ? String(r.customer) : '',
      walkInNumber: (r.walkInNumber == null ? null : Number(r.walkInNumber)),
      categories: Array.isArray(r.categories) ? r.categories.map(c => ({ id: String(c._id), name: c.name })) : [],
      createdAt: r.createdAt
    }));

    return res.json({ ok: true, submissions });
  } catch (err) {
    console.error('registrations.apiListPending error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load pending registrations' });
  }
};
