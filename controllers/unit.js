// controllers/unit.js
const ServiceCostUnit = require('../models/service_cost_unit');
const mongoose = require('mongoose');

// Create unit (AJAX-aware)
exports.create = async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).send('Name is required');

    const top = await ServiceCostUnit.findOne().sort({ orderIndex: -1, createdAt: -1 }).select('orderIndex').lean();
    const nextOrderIndex = Number(top && Number.isFinite(Number(top.orderIndex)) ? top.orderIndex : 0) + 1;

    const unit = new ServiceCostUnit({ name, orderIndex: nextOrderIndex });
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

exports.move = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid unit id' });
    }

    const direction = String(req.body.direction || '').toLowerCase();
    if (direction !== 'up' && direction !== 'down') {
      return res.status(400).json({ ok: false, error: 'Invalid direction' });
    }

    const rows = await ServiceCostUnit.find()
      .select('_id orderIndex name')
      .sort({ orderIndex: 1, name: 1, _id: 1 })
      .lean();

    const idx = rows.findIndex(r => String(r._id) === String(id));
    if (idx < 0) return res.status(404).json({ ok: false, error: 'Unit not found' });

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= rows.length) {
      return res.json({ ok: true, moved: false });
    }

    const [moved] = rows.splice(idx, 1);
    rows.splice(targetIdx, 0, moved);

    const ops = rows.map((row, i) => ({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { orderIndex: i + 1 } }
      }
    }));
    if (ops.length) await ServiceCostUnit.bulkWrite(ops);

    return res.json({
      ok: true,
      moved: true,
      order: rows.map(r => String(r._id))
    });
  } catch (err) {
    console.error('units.move error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Error reordering units' });
  }
};
