// controllers/records.js
const mongoose = require('mongoose');
const Material = require('../models/material');
const { MaterialUsage, MaterialAggregate } = require('../models/material_usage');

// helper to parse dates safely (expects yyyy-mm-dd strings)
function parseDateStrict(s, fallback) {
  if (!s) return fallback;
  const d = new Date(s);
  if (isNaN(d.getTime())) return fallback;
  // normalize to start of day for from, and end of day for to in callers
  return d;
}

exports.index = async (req, res) => {
  try {
    // default date range: last 30 days
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(now.getDate() - 30);

    const from = parseDateStrict(req.query.from, defaultFrom);
    const to = parseDateStrict(req.query.to, now);

    // load materials and aggregates for quick display
    const materials = await Material.find().lean();
    const aggDocs = await MaterialAggregate.find().lean();

    // map aggregates by material id for quick lookup
    const aggMap = {};
    aggDocs.forEach(a => { aggMap[String(a.material)] = a.total || 0; });

    // render page — client will request detailed usage via AJAX
    return res.render('records/index', {
      materials,
      aggregates: aggMap,
      filters: {
        from: from.toISOString().slice(0,10),
        to: to.toISOString().slice(0,10),
        materialId: req.query.materialId || ''
      }
    });
  } catch (err) {
    console.error('records.index error', err);
    res.status(500).send('Error loading records');
  }
};

// JSON endpoint for usages — returns aggregated totals and recent usages within date range and optional material
exports.usageData = async (req, res) => {
  try {
    const { from, to, materialId } = req.query;
    const fromDate = parseDateStrict(from, null);
    const toDate = parseDateStrict(to, null);

    const query = {};
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate.setHours(0,0,0,0));
      if (toDate) query.createdAt.$lte = new Date(toDate.setHours(23,59,59,999));
    }
    if (materialId && mongoose.Types.ObjectId.isValid(materialId)) {
      query.material = materialId;
    }

    // fetch usages (limit for recent rows)
    const usages = await MaterialUsage.find(query)
      .sort({ createdAt: -1 })
      .limit(1000)
      .populate('material')
      .populate('orderRef')
      .lean();

    // aggregate totals by material id
    const totals = {};
    for (const u of usages) {
      const mid = String(u.material._id);
      totals[mid] = (totals[mid] || 0) + (Number(u.count) || 0);
    }

    return res.json({ ok: true, totals, usages });
  } catch (err) {
    console.error('records.usageData error', err);
    return res.status(500).json({ ok: false, error: 'Error fetching usage data' });
  }
};

// CSV export for filtered usages
exports.exportCsv = async (req, res) => {
  try {
    const { from, to, materialId } = req.query;
    const fromDate = parseDateStrict(from, null);
    const toDate = parseDateStrict(to, null);

    const query = {};
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate.setHours(0,0,0,0));
      if (toDate) query.createdAt.$lte = new Date(toDate.setHours(23,59,59,999));
    }
    if (materialId && mongoose.Types.ObjectId.isValid(materialId)) {
      query.material = materialId;
    }

    const usages = await MaterialUsage.find(query).sort({ createdAt: -1 }).populate('material').populate('orderRef').lean();

    // CSV header
    const rows = [];
    rows.push(['material_id','material_name','orderId','order_ref','itemIndex','count','createdAt'].join(','));

    for (const u of usages) {
      const materialIdStr = u.material ? String(u.material._id) : '';
      const materialName = u.material ? `"${String(u.material.name).replace(/"/g, '""')}"` : '';
      const orderId = u.orderId ? `"${String(u.orderId)}"` : '';
      const orderRef = u.orderRef ? String(u.orderRef._id) : '';
      const itemIndex = u.itemIndex != null ? u.itemIndex : '';
      const count = u.count != null ? u.count : '';
      const createdAt = u.createdAt ? u.createdAt.toISOString() : '';
      rows.push([materialIdStr, materialName, orderId, orderRef, itemIndex, count, createdAt].join(','));
    }

    const csv = rows.join('\n');
    const filename = `material_usage_${from || 'all'}_${to || 'all'}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error('records.exportCsv error', err);
    return res.status(500).send('Error exporting CSV');
  }
};
