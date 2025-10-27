// File: controllers/materials.js
const mongoose = require('mongoose');
const Material = require('../models/material');
const ServiceCostUnit = require('../models/service_cost_unit');
const ServiceCostSubUnit = require('../models/service_cost_subunit');
const { MaterialAggregate } = require('../models/material_usage');

// Helper: safely parse selections (JSON string or array)
function parseSelections(sels) {
  if (Array.isArray(sels)) return sels;
  if (typeof sels === 'string') {
    try { return JSON.parse(sels); } catch (e) { return null; }
  }
  return null;
}

// List materials (JSON API)
exports.list = async (req, res) => {
  try {
    // materials are global (no service scoping)
    const mats = await Material.find().populate('selections.unit selections.subUnit').lean();

    // load aggregates for these materials
    const matIds = mats.map(m => m._id);
    const aggDocs = await MaterialAggregate.find({ material: { $in: matIds } }).lean();
    const aggMap = {};
    aggDocs.forEach(a => { aggMap[String(a.material)] = a.total || 0; });

    const out = mats.map(m => {
      const used = aggMap[String(m._id)] || 0;
      const stocked = (typeof m.stocked === 'number') ? Number(m.stocked) : ((typeof m.stock === 'number') ? Number(m.stock) : 0);
      const remaining = Math.max(0, stocked - used);
      return Object.assign({}, m, { stocked, used, remaining });
    });

    return res.json({ ok: true, materials: out });
  } catch (err) {
    console.error('materials.list error', err);
    return res.status(500).json({ ok: false, error: 'Error fetching materials' });
  }
};

// Atomic create (idempotent). Returns 201 when inserted, 409 if exists.
exports.create = async (req, res) => {
  try {
    const { name } = req.body;
    let { selections } = req.body;
    // accept either 'stock' or 'stocked'
    let stockRaw = (req.body.stocked !== undefined) ? req.body.stocked : req.body.stock;
    let stockVal = 0;
    if (stockRaw !== undefined && stockRaw !== null && String(stockRaw).trim() !== '') {
      const parsed = Number(stockRaw);
      stockVal = (isNaN(parsed) || parsed < 0) ? 0 : Math.floor(parsed);
    }

    selections = parseSelections(selections);
    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ error: 'Selections must be a non-empty array' });
    }
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });

    // validate and normalize selections
    const normalized = [];
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
      normalized.push({ unit: new mongoose.Types.ObjectId(s.unit), subUnit: new mongoose.Types.ObjectId(s.subUnit) });
    }

    // compute stable key
    const parts = normalized.map(s => `${s.unit.toString()}:${s.subUnit.toString()}`).sort();
    const key = parts.join('|');

    // atomic upsert: only set fields on insert (avoid touching timestamps directly)
    const filter = { key };
    const update = {
      $setOnInsert: {
        name: String(name).trim(),
        selections: normalized,
        key,
        stocked: stockVal,
        stock: stockVal
      }
    };
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true };

    const raw = await Material.findOneAndUpdate(filter, update, opts);

    // rawResult handling: raw.value is the doc, raw.lastErrorObject.upserted indicates insert
    let doc = null;
    let wasInserted = false;
    if (raw && raw.value !== undefined) {
      doc = raw.value;
      wasInserted = !!(raw.lastErrorObject && raw.lastErrorObject.upserted);
    } else if (raw && raw._id) { // fallback if mongoose returned doc instead
      doc = raw;
      wasInserted = false;
    } else {
      // final fallback: find existing
      doc = await Material.findOne(filter).lean();
      if (!doc) {
        console.error('materials.create: unexpected upsert result', { raw });
        return res.status(500).json({ error: 'Unexpected error creating material' });
      }
      wasInserted = false;
    }

    // If inserted, respond with 201 and populated material
    if (wasInserted) {
      const populated = await Material.findById(doc._id).populate('selections.unit selections.subUnit').lean();
      const agg = await MaterialAggregate.findOne({ material: populated._id }).lean();
      const used = agg ? (agg.total || 0) : 0;
      const remaining = Math.max(0, (populated.stocked || 0) - used);
      return res.status(201).json({ ok: true, material: Object.assign({}, populated, { used, remaining }) });
    }

    // If not inserted, return 409 with existing doc
    const existing = await Material.findOne(filter).populate('selections.unit selections.subUnit').lean();
    if (existing) {
      const agg = await MaterialAggregate.findOne({ material: existing._id }).lean();
      const used = agg ? (agg.total || 0) : 0;
      const remaining = Math.max(0, (existing.stocked || existing.stock || 0) - used);
      return res.status(409).json({ error: 'A count unit with this exact selection already exists', existing: Object.assign({}, existing, { used, remaining }) });
    }

    return res.status(500).json({ error: 'Failed to create material' });
  } catch (err) {
    console.error('materials.create error', err);
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'A count unit with this exact selection already exists' });
    }
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

// Render stock page: attach aggregates map for used totals
exports.stock = async (req, res) => {
  try {
    const units = await ServiceCostUnit.find().sort('name').lean();
    const subunits = await ServiceCostSubUnit.find().sort('name').lean();
    const materials = await Material.find().populate('selections.unit selections.subUnit').lean();

    const aggDocs = await MaterialAggregate.find().lean();
    const aggMap = {};
    aggDocs.forEach(a => { aggMap[String(a.material)] = a.total || 0; });

    // compute stocked/used/remaining per material for template convenience
    const matsWithTotals = materials.map(m => {
      const used = aggMap[String(m._id)] || 0;
      const stocked = (typeof m.stocked === 'number') ? Number(m.stocked) : ((typeof m.stock === 'number') ? Number(m.stock) : 0);
      const remaining = Math.max(0, stocked - used);
      return Object.assign({}, m, { stocked, used, remaining });
    });

    return res.render('stock/index', { materials: matsWithTotals, aggregates: aggMap, units, subunits });
  } catch (err) {
    console.error('materials.stock error', err);
    return res.status(500).send('Error loading stock page');
  }
};

// Set stocked value (admin adjusts initial stock reference)
exports.setStock = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });

    let { stock } = req.body;
    stock = stock === undefined || stock === null || String(stock).trim() === '' ? 0 : Number(stock);
    if (isNaN(stock)) return res.status(400).json({ error: 'Invalid stock value' });

    // update stocked and keep legacy stock in sync
    const updated = await Material.findByIdAndUpdate(id, { $set: { stocked: Math.floor(stock), stock: Math.floor(stock) } }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Material not found' });

    // attach usage totals
    const agg = await MaterialAggregate.findOne({ material: updated._id }).lean();
    const used = agg ? (agg.total || 0) : 0;
    const remaining = Math.max(0, (updated.stocked || 0) - used);

    return res.json({ ok: true, material: Object.assign({}, updated, { used, remaining }) });
  } catch (err) {
    console.error('materials.setStock error', err);
    return res.status(500).json({ error: 'Error updating stock' });
  }
};
