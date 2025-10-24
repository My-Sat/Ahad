// File: controllers/materials.js
const mongoose = require('mongoose');
const Material = require('../models/material');
const ServiceCostUnit = require('../models/service_cost_unit');
const ServiceCostSubUnit = require('../models/service_cost_subunit');

exports.list = async (req, res) => {
  try {
    const mats = await Material.find().populate('selections.unit selections.subUnit').lean();
    return res.json({ ok: true, materials: mats });
  } catch (err) {
    console.error('materials.list error', err);
    return res.status(500).json({ ok: false, error: 'Error fetching materials' });
  }
};

// Atomic create: compute key, then upsert using key as unique filter.
// Returns 201 when created, 409 if already exists, 500 for other errors.
exports.create = async (req, res) => {
  try {
    const { name } = req.body;
    let { selections, stock } = req.body;

    if (typeof selections === 'string') {
      try { selections = JSON.parse(selections); } catch (e) { selections = null; }
    }
    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ error: 'Selections must be a non-empty array' });
    }
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });

    stock = stock === undefined || stock === null || String(stock).trim() === '' ? 0 : Number(stock);
    if (isNaN(stock)) stock = 0;

    // validate and normalize selection pairs
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

    // prepare atomic upsert (do NOT set createdAt/updatedAt here)
    const filter = { key };
    const update = {
      $setOnInsert: {
        name: String(name).trim(),
        selections: normalized,
        key,
        stock: Math.floor(stock)
      }
    };
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true };

    // Run atomic upsert
    const raw = await Material.findOneAndUpdate(filter, update, opts);

    // raw may be either:
    // - Mongo raw result { value: <doc>, lastErrorObject: { upserted: <id> ... } }
    // - or the document itself (depending on Mongoose/driver) — handle both
    let doc = null;
    let wasInserted = false;

    if (raw && raw.value !== undefined) {
      // raw result shape
      doc = raw.value;
      wasInserted = !!(raw.lastErrorObject && raw.lastErrorObject.upserted);
    } else if (raw && raw._id) {
      // document shape
      doc = raw;
      wasInserted = false; // can't reliably know — assume existing (we'll ensure duplicate detection below)
    } else {
      // fallback: try to find by key
      doc = await Material.findOne(filter).lean();
      if (!doc) {
        // Something unexpected — return error
        console.error('materials.create: unexpected upsert result', { raw });
        return res.status(500).json({ error: 'Unexpected error creating material' });
      }
      wasInserted = false;
    }

    // If we detected an insertion, respond 201 with populated doc.
    if (wasInserted) {
      const populated = await Material.findById(doc._id).populate('selections.unit selections.subUnit').lean();
      return res.status(201).json({ ok: true, material: populated });
    }

    // If not obviously inserted, ensure we don't silently return success when duplicate.
    // Fetch the current doc to return to client (and detect duplicate)
    const existing = await Material.findOne(filter).populate('selections.unit selections.subUnit').lean();
    if (existing) {
      return res.status(409).json({ error: 'A count unit with this exact selection already exists', existing });
    }

    // Otherwise (should not happen) return server error
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

// stock page and setStock kept as before (no change)
exports.stock = async (req, res) => {
  try {
    const units = await ServiceCostUnit.find().sort('name').lean();
    const subunits = await ServiceCostSubUnit.find().sort('name').lean();
    const materials = await Material.find().populate('selections.unit selections.subUnit').lean();
    const { MaterialAggregate } = require('../models/material_usage');
    const aggDocs = await MaterialAggregate.find().lean();
    const aggMap = {};
    aggDocs.forEach(a => { aggMap[String(a.material)] = a.total || 0; });
    return res.render('stock/index', { materials, aggregates: aggMap, units, subunits });
  } catch (err) {
    console.error('materials.stock error', err);
    return res.status(500).send('Error loading stock page');
  }
};

exports.setStock = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });
    let { stock } = req.body;
    stock = stock === undefined || stock === null || String(stock).trim() === '' ? 0 : Number(stock);
    if (isNaN(stock)) return res.status(400).json({ error: 'Invalid stock value' });
    const updated = await Material.findByIdAndUpdate(id, { $set: { stock: Math.floor(stock) } }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Material not found' });
    return res.json({ ok: true, material: updated });
  } catch (err) {
    console.error('materials.setStock error', err);
    return res.status(500).json({ error: 'Error updating stock' });
  }
};
