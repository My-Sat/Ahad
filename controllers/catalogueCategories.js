const mongoose = require('mongoose');
const CatalogueCategory = require('../models/catalogue_category');
const Material = require('../models/material');

function actorName(req) {
  return String(
    (req.user && (req.user.name || req.user.username || req.user.email)) || ''
  ).trim();
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100);
}

async function serializeCategory(category) {
  const doc = category && category.toObject ? category.toObject() : category;
  if (!doc) return null;
  const materialCount = await Material.countDocuments({ category: doc._id });
  return {
    _id: String(doc._id),
    name: String(doc.name || ''),
    materialCount
  };
}

exports.list = async function list(req, res) {
  try {
    const categories = await CatalogueCategory.find({}).sort({ name: 1, _id: 1 }).lean();
    const counts = await Material.aggregate([
      { $match: { category: { $ne: null } } },
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);
    const countMap = new Map(counts.map(row => [String(row._id), Number(row.count || 0)]));
    const uncategorizedCount = await Material.countDocuments({
      $or: [{ category: null }, { category: { $exists: false } }]
    });

    return res.json({
      ok: true,
      categories: categories.map(category => ({
        _id: String(category._id),
        name: String(category.name || ''),
        materialCount: countMap.get(String(category._id)) || 0
      })),
      uncategorizedCount
    });
  } catch (err) {
    console.error('catalogueCategories.list error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load catalogue categories' });
  }
};

exports.create = async function create(req, res) {
  try {
    const name = cleanName(req.body && req.body.name);
    if (!name) return res.status(400).json({ ok: false, error: 'Category name is required' });

    const category = await CatalogueCategory.create({ name, createdBy: actorName(req) });
    return res.status(201).json({ ok: true, category: await serializeCategory(category) });
  } catch (err) {
    console.error('catalogueCategories.create error', err);
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: 'This catalogue category already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Failed to create catalogue category' });
  }
};

exports.update = async function update(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid category id' });
    }

    const name = cleanName(req.body && req.body.name);
    if (!name) return res.status(400).json({ ok: false, error: 'Category name is required' });

    const category = await CatalogueCategory.findById(id);
    if (!category) return res.status(404).json({ ok: false, error: 'Catalogue category not found' });
    category.name = name;
    await category.save();

    return res.json({ ok: true, category: await serializeCategory(category) });
  } catch (err) {
    console.error('catalogueCategories.update error', err);
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: 'This catalogue category already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Failed to update catalogue category' });
  }
};

exports.remove = async function remove(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid category id' });
    }

    const usedCount = await Material.countDocuments({ category: id });
    if (usedCount > 0) {
      return res.status(409).json({
        ok: false,
        error: `Move the ${usedCount} catalogue item${usedCount === 1 ? '' : 's'} in this category before deleting it.`
      });
    }

    const removed = await CatalogueCategory.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Catalogue category not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('catalogueCategories.remove error', err);
    return res.status(500).json({ ok: false, error: 'Failed to delete catalogue category' });
  }
};
