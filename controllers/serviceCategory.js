// controllers/serviceCategory.js
const mongoose = require('mongoose');
const ServiceCategory = require('../models/service_category');
const Service = require('../models/service');

exports.list = async (req, res) => {
  try {
    // For admin clients we return all categories. For non-admin UIs you can filter later.
    const cats = await ServiceCategory.find().sort('name').lean();
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
    return res.json({ ok: true, category: c });
  } catch (err) {
    console.error('serviceCategory.get error', err);
    return res.status(500).json({ error: 'Error fetching category' });
  }
};

exports.create = async (req, res) => {
  try {
    const name = req.body.name ? String(req.body.name).trim() : '';
    const showInOrders = (req.body.showInOrders === '0' || req.body.showInOrders === 0 || req.body.showInOrders === false) ? false : true;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const cat = new ServiceCategory({ name: name, showInOrders: !!showInOrders });
    await cat.save();
    return res.json({ ok: true, category: cat.toObject() });
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
    const updated = await ServiceCategory.findByIdAndUpdate(id, { $set: { name, showInOrders } }, { new: true, runValidators: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Category not found' });
    return res.json({ ok: true, category: updated });
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

    const services = await Service.find({ category: id }).select('_id name requiresPrinter').sort('name').lean();
    return res.json({ ok: true, services });
  } catch (err) {
    console.error('serviceCategory.servicesForCategory error', err);
    return res.status(500).json({ error: 'Error fetching services for category' });
  }
};
