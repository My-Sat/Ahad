// controllers/unit.js
const ServiceCostUnit = require('../models/service_cost_unit');
const mongoose = require('mongoose');

// Create unit (AJAX-aware)
exports.create = async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).send('Name is required');

    const unit = new ServiceCostUnit({ name });
    await unit.save();

    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || req.accepts('json') && !req.accepts('html');
    if (isAjax) {
      return res.json({ ok: true, unit: unit.toObject() });
    }

    // redirect as before
    res.redirect('/admin/services');
  } catch (err) {
    console.error('units.create error:', err);
    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.status(400).json({ ok: false, error: err.message || 'Error creating unit' });
    res.status(400).send(err.message || 'Error creating unit');
  }
};

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const name = req.body.name ? String(req.body.name).trim() : null;

    const unit = await ServiceCostUnit.findById(id);
    if (!unit) return res.status(404).send('Unit not found');

    if (name) unit.name = name;

    await unit.save();

    // support AJAX update response
    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.json({ ok: true, unit: unit.toObject() });

    res.redirect('/admin/services');
  } catch (err) {
    console.error('units.update error:', err);
    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.status(400).json({ ok: false, error: err.message || 'Error updating unit' });
    res.status(400).send(err.message || 'Error updating unit');
  }
};

exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    await ServiceCostUnit.findByIdAndDelete(id);
    // Optionally cascade-delete its subunits elsewhere if desired

    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.json({ ok: true, id });

    res.redirect('/admin/services');
  } catch (err) {
    console.error('units.remove error:', err);
    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.status(400).json({ ok: false, error: err.message || 'Error deleting unit' });
    res.status(400).send(err.message || 'Error deleting unit');
  }
};
