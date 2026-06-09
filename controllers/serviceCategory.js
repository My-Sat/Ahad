// controllers/serviceCategory.js
const mongoose = require('mongoose');
const ServiceCategory = require('../models/service_category');
const Service = require('../models/service');
const Book = require('../models/book');

function withSystemFlags(cat) {
  return ServiceCategory.withSystemFlags(cat);
}

async function ensureSystemCategories() {
  if (typeof ServiceCategory.ensureSystemCategories === 'function') {
    await ServiceCategory.ensureSystemCategories();
  }
}

exports.list = async (req, res) => {
  try {
    await ensureSystemCategories();
    // For admin clients we return all categories. For non-admin UIs you can filter later.
    const cats = (await ServiceCategory.find().sort('name').lean()).map(withSystemFlags);
    // If request expects JSON (AJAX), return JSON array (used by client)
    if (req.xhr || req.get('Accept') && req.get('Accept').includes('application/json')) {
      return res.json({ ok: true, categories: cats });
    }
    // otherwise render an admin view if you ever need — fallback to JSON
    return res.json({ ok: true, categories: cats });
  } catch (err) {
    console.error('serviceCategory.list error', err);
    return res.status(500).json({ error: 'Error fetching categories' });
  }
};

exports.get = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid category id' });
    const c = await ServiceCategory.findById(id).lean();
    if (!c) return res.status(404).json({ error: 'Category not found' });
    return res.json({ ok: true, category: withSystemFlags(c) });
  } catch (err) {
    console.error('serviceCategory.get error', err);
    return res.status(500).json({ error: 'Error fetching category' });
  }
};

exports.create = async (req, res) => {
  try {
    const name = req.body.name ? String(req.body.name).trim() : '';
    let showInOrders = (req.body.showInOrders === '0' || req.body.showInOrders === 0 || req.body.showInOrders === false) ? false : true;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const sys = ServiceCategory.systemCategoryForName(name);
    const safeName = sys ? sys.name : name;
    if (sys) showInOrders = true;
    const cat = new ServiceCategory({ name: safeName, showInOrders: !!showInOrders });
    await cat.save();
    return res.json({ ok: true, category: withSystemFlags(cat) });
  } catch (err) {
    console.error('serviceCategory.create error', err);
    if (err.code === 11000) return res.status(409).json({ error: 'Category already exists' });
    return res.status(500).json({ error: 'Error creating category' });
  }
};

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid category id' });
    const name = req.body.name ? String(req.body.name).trim() : '';
    const showInOrders = (req.body.showInOrders === '0' || req.body.showInOrders === 0 || req.body.showInOrders === false) ? false : true;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const existing = await ServiceCategory.findById(id);
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    if (ServiceCategory.isProtectedSystemName(existing.name)) {
      existing.name = 'CLASS BASED';
      existing.showInOrders = true;
      await existing.save();
      return res.status(403).json({ ok: false, error: 'CLASS BASED is a protected category and cannot be edited.' });
    }

    const sys = ServiceCategory.systemCategoryForName(name);
    existing.name = sys ? sys.name : name;
    existing.showInOrders = sys ? true : showInOrders;
    await existing.save();
    return res.json({ ok: true, category: withSystemFlags(existing) });
  } catch (err) {
    console.error('serviceCategory.update error', err);
    if (err.code === 11000) return res.status(409).json({ error: 'Category already exists' });
    return res.status(500).json({ error: 'Error updating category' });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid category id' });

    const existing = await ServiceCategory.findById(id).lean();
    if (!existing) return res.status(404).json({ error: 'Category not found' });
    if (ServiceCategory.isProtectedSystemName(existing.name)) {
      return res.status(403).json({ ok: false, error: 'CLASS BASED is a protected category and cannot be deleted.' });
    }

    // Option: instead of deleting, you could soft-delete; here we remove the category doc
    const removed = await ServiceCategory.findByIdAndDelete(id).lean();
    if (!removed) return res.status(404).json({ error: 'Category not found' });

    // IMPORTANT: keep services intact but unset their category reference to preserve data integrity
    try {
      await Service.updateMany({ category: id }, { $unset: { category: '' } });
    } catch (e) {
      console.error('Failed to unset category on services after deleting category', e);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('serviceCategory.remove error', err);
    return res.status(500).json({ error: 'Error deleting category' });
  }
};

// return services for a category (used by client to populate services select)
exports.servicesForCategory = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid category id' });

    const services = await Service.find({ category: id })
      .select('_id name requiresPrinter pricingMode largeFormatRate orderIndex')
      .sort({ orderIndex: 1, name: 1, _id: 1 })
      .lean();

    const compoundServices = await Book.find({ category: id })
      .select('_id name unitPrice')
      .sort({ name: 1, _id: 1 })
      .lean();

    return res.json({ ok: true, services, compoundServices });
  } catch (err) {
    console.error('serviceCategory.servicesForCategory error', err);
    return res.status(500).json({ error: 'Error fetching services for category' });
  }
};
