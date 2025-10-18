// controllers/price.js
const mongoose = require('mongoose');
const ServicePrice = require('../models/service_price');
const Service = require('../models/service');
const ServiceCostUnit = require('../models/service_cost_unit');
const ServiceCostSubUnit = require('../models/service_cost_subunit');

/**
 * Return an HTML fragment or JSON list of prices for a service.
 * (Your code used to render a view; keep it if you need server-rendered fragment)
 */
exports.listForService = async (req, res) => {
  try {
    const prices = await ServicePrice.find({ service: req.params.id })
      .populate('selections.unit selections.subUnit')
      .lean();

    // If AJAX asked for JSON, return JSON
    if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.json({ ok: true, prices });
    }

    // Otherwise render the server-side view you used before
    return res.render('prices/list', { prices, serviceId: req.params.id });
  } catch (err) {
    console.error('price.listForService error', err);
    if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.status(500).json({ ok: false, error: 'Error fetching prices' });
    }
    res.status(500).send('Error fetching prices');
  }
};

/**
 * Create price rule (JSON response)
 * Expect body: { selections: [{unit, subUnit}, ...], price }
 */
exports.createPrice = async (req, res) => {
  try {
    const serviceId = req.params.id;
    let { selections, price } = req.body;

    // if selections sent as JSON string, parse it
    if (typeof selections === 'string') {
      try { selections = JSON.parse(selections); } catch (e) { selections = null; }
    }

    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ error: 'Selections must be a non-empty array' });
    }

    // ensure service exists
    const service = await Service.findById(serviceId).lean();
    if (!service) return res.status(404).json({ error: 'Service not found' });

    // basic price validation
    price = parseFloat(price);
    if (isNaN(price) || price < 0) return res.status(400).json({ error: 'Invalid price' });

    // validate each selection: unit/subUnit exist and belong together, and (optionally) belong to service component
    for (const s of selections) {
      if (!s || !s.unit || !s.subUnit) return res.status(400).json({ error: 'Each selection must include unit and subUnit' });

      if (!mongoose.Types.ObjectId.isValid(s.unit) || !mongoose.Types.ObjectId.isValid(s.subUnit)) {
        return res.status(400).json({ error: 'Invalid unit/subUnit id in selections' });
      }

      const unit = await ServiceCostUnit.findById(s.unit).lean();
      if (!unit) return res.status(400).json({ error: `Unit ${s.unit} not found` });

      const sub = await ServiceCostSubUnit.findById(s.subUnit).lean();
      if (!sub) return res.status(400).json({ error: `SubUnit ${s.subUnit} not found` });

      if (sub.unit.toString() !== unit._id.toString()) {
        return res.status(400).json({ error: `SubUnit ${s.subUnit} does not belong to Unit ${s.unit}` });
      }

      // If service has components defined, ensure the unit/subunit pair is allowed
      const comp = (service.components || []).find(c => String(c.unit) === String(s.unit));
      if (comp && Array.isArray(comp.subUnits) && comp.subUnits.length) {
        if (!comp.subUnits.map(String).includes(String(s.subUnit))) {
          return res.status(400).json({ error: `SubUnit ${s.subUnit} is not part of Service component for unit ${s.unit}` });
        }
      }
    }

    // Create the ServicePrice doc
    const sp = new ServicePrice({ service: serviceId, selections, price });
    await sp.save();

    // populate selections for client convenience
    const saved = await ServicePrice.findById(sp._id).populate('selections.unit selections.subUnit').lean();

    return res.json({ ok: true, price: saved });
  } catch (err) {
    console.error('price.createPrice error', err);
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A price for this exact selection already exists' });
    }
    return res.status(400).json({ error: err.message || 'Error creating price' });
  }
};

/**
 * Remove a price rule. Return JSON for AJAX; otherwise redirect.
 * DELETE /admin/services/:id/prices/:priceId
 */
exports.removePrice = async (req, res) => {
  try {
    const { id: serviceId, priceId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(serviceId) || !mongoose.Types.ObjectId.isValid(priceId)) {
      if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
        return res.status(400).json({ ok: false, error: 'Invalid id' });
      }
      return res.status(400).send('Invalid id');
    }

    const removed = await ServicePrice.findOneAndDelete({ _id: priceId, service: serviceId });
    if (!removed) {
      if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
        return res.status(404).json({ ok: false, error: 'Price rule not found' });
      }
      return res.status(404).send('Price rule not found');
    }

    if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.json({ ok: true });
    }
    return res.redirect(`/admin/services/${serviceId}`);
  } catch (err) {
    console.error('price.removePrice error', err);
    if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.status(500).json({ ok: false, error: 'Error deleting price' });
    }
    return res.status(500).send('Error deleting price');
  }
};

/**
 * Update price rule (only editing the numeric price for now).
 * PUT /admin/services/:id/prices/:priceId
 * Body: { price }
 */
exports.updatePrice = async (req, res) => {
  try {
    const { id: serviceId, priceId } = req.params;
    let { price } = req.body;

    if (!mongoose.Types.ObjectId.isValid(serviceId) || !mongoose.Types.ObjectId.isValid(priceId)) {
      if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
        return res.status(400).json({ ok: false, error: 'Invalid id' });
      }
      return res.status(400).send('Invalid id');
    }

    price = parseFloat(price);
    if (isNaN(price) || price < 0) {
      if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
        return res.status(400).json({ ok: false, error: 'Invalid price' });
      }
      return res.status(400).send('Invalid price');
    }

    const doc = await ServicePrice.findOneAndUpdate(
      { _id: priceId, service: serviceId },
      { $set: { price, updatedAt: new Date() } },
      { new: true }
    ).lean();

    if (!doc) {
      if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
        return res.status(404).json({ ok: false, error: 'Price rule not found' });
      }
      return res.status(404).send('Price rule not found');
    }

    // optionally populate selections for client
    const populated = await ServicePrice.findById(doc._id).populate('selections.unit selections.subUnit').lean();

    if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.json({ ok: true, price: populated });
    }

    return res.redirect(`/admin/services/${serviceId}`);
  } catch (err) {
    console.error('price.updatePrice error', err);
    if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.status(500).json({ ok: false, error: 'Error updating price' });
    }
    return res.status(500).send('Error updating price');
  }
};
