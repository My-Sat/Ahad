// File: controllers/materials.js
// controllers/materials.js
const mongoose = require('mongoose');
const Material = require('../models/material');
const ServiceCostUnit = require('../models/service_cost_unit');
const ServiceCostSubUnit = require('../models/service_cost_subunit');

// List (existing) — unchanged behavior
exports.list = async (req, res) => {
  try {
    const { serviceId } = req.query; // optional filter
    const filter = {};
    if (serviceId && mongoose.Types.ObjectId.isValid(serviceId)) filter.service = serviceId;
    const mats = await Material.find(filter).populate('selections.unit selections.subUnit').lean();
    return res.json({ ok: true, materials: mats });
  } catch (err) {
    console.error('materials.list error', err);
    return res.status(500).json({ ok: false, error: 'Error fetching materials' });
  }
};

// Create material — now accepts optional 'stock' field (stocking)
exports.create = async (req, res) => {
  try {
    const { name, serviceId, selections } = req.body;
    // stock may come from form/urlencoded or JSON
    let stock = req.body.stock;
    if (stock === undefined || stock === null || stock === '') stock = 0;
    stock = Number(stock) || 0;

    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name required' });
    let sels = selections;
    if (typeof sels === 'string') sels = sels ? JSON.parse(sels) : [];
    if (!Array.isArray(sels) || sels.length === 0) return res.status(400).json({ error: 'Selections must be provided' });

    // validate and normalize
    const normalized = [];
    for (const s of sels) {
      if (!s.unit || !s.subUnit) return res.status(400).json({ error: 'Each selection must include unit and subUnit' });
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
      normalized.push({ unit: new mongoose.Types.ObjectId(s.unit), subUnit: new mongoose.Types.ObjectId(s.subUnit) });
    }

    const mat = new Material({
      name: name.trim(),
      service: (serviceId && mongoose.Types.ObjectId.isValid(serviceId)) ? serviceId : null,
      selections: normalized,
      stock: stock
    });

    await mat.save();
    const saved = await Material.findById(mat._id).populate('selections.unit selections.subUnit').lean();
    return res.json({ ok: true, material: saved });
  } catch (err) {
    console.error('materials.create error', err);
    if (err.code === 11000) return res.status(409).json({ error: 'Material already defined' });
    return res.status(500).json({ error: err.message || 'Error creating material' });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    const removed = await Material.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ error: 'Material not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('materials.remove error', err);
    return res.status(500).json({ error: 'Error deleting material' });
  }
};

/**
 * New: Stock admin page
 * Renders a server-side view showing stocked qty vs used totals. Client can enhance via JS.
 */
exports.stock = async (req, res) => {
  try {
    // load all materials and their aggregates
    const materials = await Material.find().lean();
    const { MaterialAggregate } = require('../models/material_usage');
    const aggDocs = await MaterialAggregate.find().lean();

    // map aggregates by material id for quick lookup
    const aggMap = {};
    aggDocs.forEach(a => { aggMap[String(a.material)] = a.total || 0; });

    return res.render('stock/index', { materials, aggregates: aggMap });
  } catch (err) {
    console.error('materials.stock error', err);
    return res.status(500).send('Error loading stock page');
  }
};
