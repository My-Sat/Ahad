const mongoose = require('mongoose');
const Service = require('../models/service');
const ServiceCostUnit = require('../models/service_cost_unit');
const ServiceCostSubUnit = require('../models/service_cost_subunit');
const ServicePrice = require('../models/service_price');
const Printer = require('../models/printer');

exports.list = async (req, res) => {
  try {
    const services = await Service.find().sort('name').lean();

    // load units and subunits so the services list page can show/manage them side-by-side
    const units = await ServiceCostUnit.find().sort('name').lean();
    const subunits = await ServiceCostSubUnit.find().sort('name').lean();

    res.render('services/list', { services, units, subunits });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching services');
  }
};

exports.getPriceForSelection = async (req, res) => {
  try {
    const serviceId = req.params.id;
    let { selections } = req.body;

    if (!mongoose.Types.ObjectId.isValid(serviceId)) return res.status(400).json({ error: 'Invalid service id' });
    if (!selections) return res.status(400).json({ error: 'Selections array required' });

    if (typeof selections === 'string') selections = selections ? JSON.parse(selections) : [];
    if (!Array.isArray(selections) || selections.length === 0) return res.status(400).json({ error: 'Empty selections' });

    // compute stable key (unit:subUnit parts sorted)
    const parts = selections.map(s => `${s.unit}:${s.subUnit}`);
    parts.sort();
    const key = parts.join('|');

    const priceRule = await ServicePrice.findOne({ service: serviceId, key }).lean();
    if (!priceRule) return res.status(404).json({ error: 'Price not found for this exact selection' });

    return res.json({ price: priceRule.price, priceId: priceRule._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
// API: return price rules (composite selections) for a service
// ALSO returns whether service requires a printer and list of printers
exports.apiGetPricesForService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(serviceId)) return res.status(400).json({ error: 'Invalid service id' });

    // Determine if service requires a printer
    const serviceDoc = await Service.findById(serviceId).lean();
    const serviceRequiresPrinter = !!(serviceDoc && serviceDoc.requiresPrinter);

    const prices = await ServicePrice.find({ service: serviceId })
      .populate('selections.unit selections.subUnit')
      .lean();

    // fetch printers list for client to show if needed
    const printers = await Printer.find().select('_id name').sort('name').lean();

    const out = prices.map(p => ({
      _id: p._id,
      key: p.key, // ✅ add this

      // ✅ add selections as ids (browser will use this to match materials)
      selections: (p.selections || []).map(s => ({
        unit: (s.unit && s.unit._id) ? String(s.unit._id) : String(s.unit),
        subUnit: (s.subUnit && s.subUnit._id) ? String(s.subUnit._id) : String(s.subUnit)
      })),

      selectionLabel: p.selectionLabel || ((p.selections || []).map(s => {
        const u = s.unit && s.unit.name ? s.unit.name : String(s.unit);
        const su = s.subUnit && s.subUnit.name ? s.subUnit.name : String(s.subUnit);
        return `${u}: ${su}`;
      }).join(' + ')),

      unitPrice: p.price,
      price2: (p.price2 !== undefined && p.price2 !== null) ? p.price2 : null
    }));

        return res.json({ ok: true, prices: out, serviceRequiresPrinter, printers });
      } catch (err) {
        console.error('apiGetPricesForService error', err);
        return res.status(500).json({ error: 'Error fetching prices' });
      }
    };


// get service detail — show all units and their subUnits; fetch composite prices
exports.get = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.redirect('/admin/services/new');
    }

    // Load base service info
    const service = await Service.findById(id).lean();
    if (!service) return res.status(404).send('Service not found');

    // Load all units and subunits
    const units = await ServiceCostUnit.find().sort('name').lean();
    const subunits = await ServiceCostSubUnit.find().sort('name').lean();

    // Build components (unit + its subUnit docs)
    const components = units.map(u => {
      const suForUnit = subunits.filter(su => String(su.unit) === String(u._id));
      return { unit: u, subUnits: suForUnit };
    });
    service.components = components;

    // Fetch composite price rules for this service; populate selections for readability
    const prices = await ServicePrice.find({ service: id })
      .populate('selections.unit')
      .populate('selections.subUnit')
      .lean();

    // Build human-friendly labels for each price
    prices.forEach(p => {
      p.selectionLabel = (p.selections || []).map(s => {
        const unitName = s.unit && s.unit.name ? s.unit.name : String(s.unit);
        const subName = s.subUnit && s.subUnit.name ? s.subUnit.name : String(s.subUnit);
        return `${unitName}: ${subName}`;
      }).join(' + ');
    });

    // Note: service may include `requiresPrinter` flag; the view uses it (checkbox)
    res.render('services/detail', { service, units, subunits, prices });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching service detail');
  }
};

// create a new service with empty components (AJAX-aware)
exports.create = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).send('Name is required');

    // Accept optional requiresPrinter flag on create (checkboxs/forms may send 'on'/'true')
    let requiresPrinter = false;
    if (typeof req.body.requiresPrinter !== 'undefined') {
      const v = req.body.requiresPrinter;
      requiresPrinter = (v === 'on' || v === 'true' || v === '1' || v === true);
    }

    // NEW: optional categoryId
    let category = null;
    if (req.body.categoryId && mongoose.Types.ObjectId.isValid(req.body.categoryId)) {
      category = new mongoose.Types.ObjectId(req.body.categoryId);
    }

    const service = new Service({ name: name.trim(), components: [], requiresPrinter, category });
    await service.save();

    // If AJAX request, return JSON of created service for client-side handling
    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || req.accepts('json') && !req.accepts('html');
    if (isAjax) {
      // send minimal object
      return res.json({ ok: true, service: service.toObject() });
    }

    // otherwise fallback to normal redirect (keeps existing logic)
    res.redirect('/admin/services');
  } catch (err) {
    console.error(err);
    // For AJAX callers return JSON error
    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.status(400).json({ ok: false, error: err.message || 'Error creating service' });
    res.status(500).send('Error creating service');
  }
};

// update service basic fields (name and components if provided)
exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('Invalid service id');

    const service = await Service.findById(id);
    if (!service) return res.status(404).send('Service not found');

    const newName = req.body.name ? String(req.body.name).trim() : null;
    if (newName) service.name = newName;

    // NEW: handle requiresPrinter checkbox (comes from form as 'on' or 'true')
    if (typeof req.body.requiresPrinter !== 'undefined') {
      const val = req.body.requiresPrinter;
      service.requiresPrinter = (val === 'on' || val === 'true' || val === '1' || val === true);
    }

    // NEW: handle categoryId if provided (allow empty to unset)
    if (typeof req.body.categoryId !== 'undefined') {
      const cid = req.body.categoryId;
      if (!cid || String(cid).trim() === '') {
        service.category = null;
      } else if (mongoose.Types.ObjectId.isValid(cid)) {
        service.category = new mongoose.Types.ObjectId(cid);
      } else {
        return res.status(400).send('Invalid category id');
      }
    }

    // components may be provided as JSON string or array — only if explicitly provided
    if (req.body.components) {
      let comps = req.body.components;
      if (typeof comps === 'string') comps = comps ? JSON.parse(comps) : [];
      service.components = comps;
    }

    await service.save();

    // If AJAX request, return JSON so client can update DOM without reload
    if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.json({ ok: true, service: { _id: service._id, name: service.name, requiresPrinter: !!service.requiresPrinter, category: service.category } });
    }

    // fallback: redirect (existing behavior)
    res.redirect(`/admin/services/${service._id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating service');
  }
};

// delete a service and its related price rules
exports.remove = async (req, res) => {
  try {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).send('Invalid service id');
    }

    // remove all ServicePrice docs tied to this service (cascade)
    await ServicePrice.deleteMany({ service: id });

    // remove the service itself
    await Service.findByIdAndDelete(id);

    // redirect back to services list
    return res.redirect('/admin/services');
  } catch (err) {
    console.error('service.remove error:', err);
    res.status(500).send('Error deleting service');
  }
};


// If you removed addComponent route, you can delete this function. Otherwise keep as-is.
exports.addComponent = async (req, res) => {
  try {
    const serviceId = req.params.id;
    let { unitId, subUnitIds } = req.body;

    if (!mongoose.Types.ObjectId.isValid(serviceId)) return res.status(400).send('Invalid service id');
    if (!mongoose.Types.ObjectId.isValid(unitId)) return res.status(400).send('Invalid unit id');

    // normalize subUnitIds to array
    if (!subUnitIds) subUnitIds = [];
    if (typeof subUnitIds === 'string') {
      if (subUnitIds.includes(',')) subUnitIds = subUnitIds.split(',').map(s => s.trim()).filter(Boolean);
      else subUnitIds = [subUnitIds];
    }

    // validate subunits and their belonging to unit
    for (const su of subUnitIds) {
      if (!mongoose.Types.ObjectId.isValid(su)) return res.status(400).send('Invalid subUnit id');
      const sub = await ServiceCostSubUnit.findById(su).lean();
      if (!sub) return res.status(400).send(`SubUnit ${su} not found`);
      if (sub.unit.toString() !== unitId.toString()) {
        return res.status(400).send(`SubUnit ${su} does not belong to Unit ${unitId}`);
      }
    }

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).send('Service not found');

    const existing = (service.components || []).find(c => c.unit.toString() === unitId.toString());
    if (existing) {
      const set = new Set(existing.subUnits.map(String));
      for (const su of subUnitIds) set.add(String(su));
      existing.subUnits = Array.from(set);
    } else {
      service.components.push({ unit: unitId, subUnits: subUnitIds });
    }

    await service.save();
    res.redirect(`/admin/services/${serviceId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error adding component');
  }
};

// ASSIGN PRICE — create or update a composite ServicePrice for the exact selection set
exports.assignPrice = async (req, res) => {
  try {
    const serviceId = req.params.id;
    let { selections, price, price2 } = req.body;

    if (!mongoose.Types.ObjectId.isValid(serviceId)) return res.status(400).send('Invalid service id');
    if (!selections) return res.status(400).send('No selections provided');

    if (typeof selections === 'string') selections = selections ? JSON.parse(selections) : [];
    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).send('Selections must be a non-empty array');
    }

    price = parseFloat(price);
    if (isNaN(price) || price < 0) return res.status(400).send('Invalid price');

    // optional price2
    if (price2 !== undefined && price2 !== null && String(price2).trim() !== '') {
      price2 = parseFloat(price2);
      if (isNaN(price2) || price2 < 0) return res.status(400).send('Invalid price2');
    } else {
      price2 = null;
    }

    // Validate and normalize selections
    const normalized = [];
    for (const s of selections) {
      if (!s.unit || !s.subUnit) return res.status(400).send('Each selection must include unit and subUnit');
      if (!mongoose.Types.ObjectId.isValid(s.unit) || !mongoose.Types.ObjectId.isValid(s.subUnit)) {
        return res.status(400).send('Invalid unit/subUnit id in selections');
      }
      const sub = await ServiceCostSubUnit.findById(s.subUnit).lean();
      if (!sub) return res.status(400).send(`SubUnit ${s.subUnit} not found`);
      if (sub.unit.toString() !== s.unit.toString()) {
        return res.status(400).send('SubUnit does not belong to provided Unit');
      }
      normalized.push({ unit: new mongoose.Types.ObjectId(s.unit), subUnit: new mongoose.Types.ObjectId(s.subUnit) });
    }

    // Compute stable key: sorted unit:subUnit parts
    const parts = normalized.map(s => `${s.unit.toString()}:${s.subUnit.toString()}`).sort();
    const key = parts.join('|');

    // Upsert composite price rule: findOneAndUpdate with upsert:true
    const filter = { service: serviceId, key };
    const update = {
      $set: {
        service: serviceId,
        selections: normalized,
        key,
        price,
        price2,
        updatedAt: new Date()
      },
      $setOnInsert: { createdAt: new Date() }
    };
    const opts = { new: true, upsert: true, setDefaultsOnInsert: true };

    const saved = await ServicePrice.findOneAndUpdate(filter, update, opts).lean();

    // Build a human-friendly label for the selection (Unit: SubUnit + ...)
    const hydratedParts = [];
    for (const sel of saved.selections) {
      const unitDoc = await ServiceCostUnit.findById(sel.unit).lean();
      const subDoc = await ServiceCostSubUnit.findById(sel.subUnit).lean();
      const unitName = unitDoc && unitDoc.name ? unitDoc.name : String(sel.unit);
      const subName = subDoc && subDoc.name ? subDoc.name : String(sel.subUnit);
      hydratedParts.push(`${unitName}: ${subName}`);
    }
    const label = hydratedParts.join(' + ');

    // Redirect back with success query params (URL-encode label and price)
    const redirectUrl = `/admin/services/${serviceId}?assigned=1&price=${encodeURIComponent(String(price))}&label=${encodeURIComponent(label)}`;
    return res.redirect(redirectUrl);
  } catch (err) {
    console.error(err);
    if (err.code === 11000) return res.status(409).send('A price rule for this exact selection already exists');
    res.status(500).send('Error assigning price');
  }
};
