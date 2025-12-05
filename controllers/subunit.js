// controllers/subunit.js
const mongoose = require('mongoose');
const ServiceCostSubUnit = require('../models/service_cost_subunit');
const ServiceCostUnit = require('../models/service_cost_unit');

function isAjaxRequest(req) {
  return req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || (req.accepts && req.accepts('json') && !req.accepts('html'));
}

exports.create = async (req, res) => {
  try {
    const unitId = req.params.unitId;
    const name = (req.body.name || '').trim();

    // parse factor (optional)
    let factor = 1;
    if (req.body.factor !== undefined && req.body.factor !== null && String(req.body.factor).trim() !== '') {
      const f = Number(req.body.factor);
      factor = (isNaN(f) || f <= 0) ? 1 : Math.floor(f);
    }

    if (!mongoose.Types.ObjectId.isValid(unitId)) {
      return res.status(400).send('Invalid unit id');
    }
    if (!name) return res.status(400).send('Name is required for sub-unit');

    const unit = await ServiceCostUnit.findById(unitId);
    if (!unit) return res.status(404).send('Parent unit not found');

    const sub = new ServiceCostSubUnit({ unit: unit._id, name, factor });
    await sub.save();

    if (isAjaxRequest(req)) {
      return res.status(201).json({ ok: true, subunit: sub.toObject(), unitId: unit._id.toString() });
    }

    // Redirect back to the combined services page (where the unit's subunits are displayed)
    res.redirect('/admin/services');
  } catch (err) {
    console.error('subunits.create error:', err);
    if (isAjaxRequest(req)) return res.status(400).json({ ok: false, error: err.message || 'Error creating sub-unit' });
    res.status(400).send(err.message || 'Error creating sub-unit');
  }
};

// Update subunit (PUT /admin/units/:unitId/subunits/:subunitId)
exports.update = async (req, res) => {
  try {
    const { unitId, subunitId } = req.params;
    const name = (req.body.name || '').trim();

    // parse factor (optional)
    let factor = null;
    if (req.body.factor !== undefined && req.body.factor !== null && String(req.body.factor).trim() !== '') {
      const f = Number(req.body.factor);
      factor = (isNaN(f) || f <= 0) ? null : Math.floor(f);
    }

    if (!mongoose.Types.ObjectId.isValid(unitId) || !mongoose.Types.ObjectId.isValid(subunitId)) {
      return res.status(400).send('Invalid id');
    }

    if (!name) return res.status(400).send('Name is required');

    const sub = await ServiceCostSubUnit.findById(subunitId);
    if (!sub) return res.status(404).send('Sub-unit not found');

    // ensure it belongs to the provided unit (defensive)
    if (String(sub.unit) !== String(unitId)) {
      return res.status(400).send('Sub-unit does not belong to the specified unit');
    }

    sub.name = name;
    if (factor !== null) sub.factor = factor;
    await sub.save();

    // If AJAX: return JSON so client can update DOM without reload
    if (isAjaxRequest(req)) {
      return res.json({ ok: true, sub: { _id: sub._id, name: sub.name, unit: sub.unit, factor: sub.factor } });
    }

    // fallback: redirect
    res.redirect('/admin/services');
  } catch (err) {
    console.error('subunits.update error:', err);
    if (isAjaxRequest(req)) return res.status(400).json({ ok: false, error: err.message || 'Error updating sub-unit' });
    res.status(400).send(err.message || 'Error updating sub-unit');
  }
};

// Remove subunit
exports.remove = async (req, res) => {
  try {
    const { unitId, subunitId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(unitId) || !mongoose.Types.ObjectId.isValid(subunitId)) {
      return res.status(400).send('Invalid id');
    }

    const unit = await ServiceCostUnit.findById(unitId);
    if (!unit) return res.status(404).send('Parent unit not found');

    await ServiceCostSubUnit.findByIdAndDelete(subunitId);

    if (isAjaxRequest(req)) {
      return res.json({ ok: true, id: subunitId });
    }

    // Redirect back to combined view
    res.redirect('/admin/services');
  } catch (err) {
    console.error('subunits.remove error:', err);
    if (isAjaxRequest(req)) return res.status(400).json({ ok: false, error: err.message || 'Error deleting sub-unit' });
    res.status(400).send(err.message || 'Error deleting sub-unit');
  }
};
