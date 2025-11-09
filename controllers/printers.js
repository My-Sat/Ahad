// controllers/printers.js
const Printer = require('../models/printer');
const PrinterUsage = require('../models/printer_usage');
const mongoose = require('mongoose');
const Order = require('../models/order');

exports.list = async (req, res) => {
  try {
    const printers = await Printer.find().sort('name').lean();
    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || (req.accepts('json') && !req.accepts('html'));
    if (isAjax) return res.json({ ok: true, printers });
    res.render('printers/list', { printers });
  } catch (err) {
    console.error('printers.list error', err);
    res.status(500).send('Error fetching printers');
  }
};

exports.create = async (req, res) => {
  try {
    const name = req.body.name ? String(req.body.name).trim() : null;
    if (!name) return res.status(400).json({ ok: false, error: 'Printer name is required' });

    const nameNormalized = name.toLowerCase();
    const existing = await Printer.findOne({ nameNormalized }).lean();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'A printer with that name already exists', existing });
    }

    const p = new Printer({ name });
    await p.save();

    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.json({ ok: true, printer: p.toObject() });

    res.redirect('/admin/printers');
  } catch (err) {
    console.error('printers.create error', err);
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: 'A printer with that name already exists' });
    }
    res.status(500).json({ ok: false, error: 'Failed to create printer' });
  }
};

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const name = req.body.name ? String(req.body.name).trim() : null;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('Invalid printer id');
    const printer = await Printer.findById(id);
    if (!printer) return res.status(404).send('Printer not found');
    if (!name) return res.status(400).send('Name is required');

    const nameNormalized = name.toLowerCase();
    const dup = await Printer.findOne({ nameNormalized, _id: { $ne: id } }).lean();
    if (dup) {
      const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
      if (isAjax) return res.status(409).json({ ok: false, error: 'Another printer with that name already exists' });
      return res.status(409).send('Another printer with that name already exists');
    }

    printer.name = name;
    await printer.save();

    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.json({ ok: true, printer: printer.toObject() });
    res.redirect('/admin/printers');
  } catch (err) {
    console.error('printers.update error', err);
    if (err && err.code === 11000) return res.status(409).send('Another printer with that name already exists');
    res.status(500).send('Error updating printer');
  }
};

exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).send('Invalid printer id');
    await Printer.findByIdAndDelete(id);
    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.json({ ok: true });
    res.redirect('/admin/printers');
  } catch (err) {
    console.error('printers.remove error', err);
    res.status(500).send('Error deleting printer');
  }
};

exports.listAll = async (req, res) => {
  try {
    const printers = await Printer.find().select('_id name totalCount monochromeCount colourCount').sort('name').lean();
    return res.json({ ok: true, printers });
  } catch (err) {
    console.error('printers.listAll error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load printers' });
  }
};

exports.usage = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid printer id' });

    // optional ?limit= parameter
    const limit = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 50));

    const usages = await PrinterUsage.find({ printer: id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, usages });
  } catch (err) {
    console.error('printers.usage error', err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch printer usage' });
  }
};

exports.adjustCount = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid printer id' });

    const printer = await Printer.findById(id);
    if (!printer) return res.status(404).json({ ok: false, error: 'Printer not found' });

    // parse inputs
    let delta = null;
    if (req.body.delta !== undefined && req.body.delta !== null && String(req.body.delta).trim() !== '') {
      delta = Math.floor(Number(req.body.delta) || 0);
    }
    let setTo = null;
    if (req.body.setTo !== undefined && req.body.setTo !== null && String(req.body.setTo).trim() !== '') {
      setTo = Math.floor(Number(req.body.setTo));
      if (isNaN(setTo)) setTo = null;
    }

    const target = (req.body.target && String(req.body.target).toLowerCase()) ? String(req.body.target).toLowerCase() : 'total';
    const allowedTargets = ['total', 'monochrome', 'colour'];
    const finalTarget = allowedTargets.includes(target) ? target : 'total';

    if (delta === null && setTo === null) {
      return res.status(400).json({ ok: false, error: 'Provide delta or setTo value' });
    }

    // determine appliedDelta for the selected target
    let appliedDelta;
    if (setTo !== null) {
      // compute difference relative to the selected target
      if (finalTarget === 'monochrome') {
        appliedDelta = setTo - (printer.monochromeCount || 0);
      } else if (finalTarget === 'colour') {
        appliedDelta = setTo - (printer.colourCount || 0);
      } else {
        appliedDelta = setTo - (printer.totalCount || 0);
      }
    } else {
      appliedDelta = delta;
    }

    // create usage record noting it's a manual adjust (type set for mono/colour)
    const usage = await PrinterUsage.create({
      printer: printer._id,
      orderId: null,
      orderRef: null,
      itemIndex: -1,
      count: appliedDelta,
      type: (finalTarget === 'total') ? null : finalTarget,
      note: (setTo !== null) ? `Manual set to ${setTo} (${finalTarget})` : `Manual delta ${delta} (${finalTarget})`
    });

    // atomic increment: apply to appropriate field(s)
    const inc = {};
    if (finalTarget === 'monochrome') {
      inc.monochromeCount = appliedDelta;
      inc.totalCount = appliedDelta;
    } else if (finalTarget === 'colour') {
      inc.colourCount = appliedDelta;
      inc.totalCount = appliedDelta;
    } else {
      inc.totalCount = appliedDelta;
    }

    // Use findByIdAndUpdate to apply increments and return updated doc
    const updatedPrinter = await Printer.findByIdAndUpdate(printer._id, { $inc: inc }, { new: true }).lean();

    return res.json({ ok: true, printer: updatedPrinter, usage });
  } catch (err) {
    console.error('printers.adjustCount error', err);
    return res.status(500).json({ ok: false, error: 'Failed to adjust printer count' });
  }
};

// GET /admin/printers/:id/stats?days=30
exports.stats = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid printer id' });

    const printerId = new mongoose.Types.ObjectId(id);

    // days for per-day breakdown (default 30)
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));

    // Helper: start of today/week/month in UTC
    const now = new Date();
    // UTC today start
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    // Week: ISO week starting Monday (approx: compute Monday of current week)
    const d = new Date(startOfToday);
    const day = (d.getUTCDay() + 6) % 7; // 0 = Monday .. 6 = Sunday
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - day);
    startOfWeek.setUTCHours(0,0,0,0);

    // Month start (UTC)
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

    // --- Counts using PrinterUsage ---
    const [countTodayAgg] = await PrinterUsage.aggregate([
      { $match: { printer: printerId, createdAt: { $gte: startOfToday, $lte: endOfToday } } },
      { $group: { _id: null, total: { $sum: '$count' } } }
    ]);
    const countToday = (countTodayAgg && countTodayAgg.total) ? countTodayAgg.total : 0;

    const [countWeekAgg] = await PrinterUsage.aggregate([
      { $match: { printer: printerId, createdAt: { $gte: startOfWeek, $lte: endOfToday } } },
      { $group: { _id: null, total: { $sum: '$count' } } }
    ]);
    const countWeek = (countWeekAgg && countWeekAgg.total) ? countWeekAgg.total : 0;

    const [countMonthAgg] = await PrinterUsage.aggregate([
      { $match: { printer: printerId, createdAt: { $gte: startOfMonth, $lte: endOfToday } } },
      { $group: { _id: null, total: { $sum: '$count' } } }
    ]);
    const countMonth = (countMonthAgg && countMonthAgg.total) ? countMonthAgg.total : 0;

    // --- Revenue using Orders: sum of item.subtotal for items referencing this printer ---
    // helper to sum items in date range
    async function revenueForRange(rangeStart, rangeEnd) {
      const pipeline = [
        { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd } } },
        { $unwind: '$items' },
        { $match: { 'items.printer': printerId } },
        { $group: { _id: null, total: { $sum: '$items.subtotal' } } }
      ];
      const [resAgg] = await Order.aggregate(pipeline);
      return (resAgg && resAgg.total) ? Number(resAgg.total) : 0;
    }

    const revenueToday = await revenueForRange(startOfToday, endOfToday);
    const revenueWeek = await revenueForRange(startOfWeek, endOfToday);
    const revenueMonth = await revenueForRange(startOfMonth, endOfToday);

    // --- Per-day breakdown for last `days` days (count + revenue) ---
    const startRange = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1), 0, 0, 0, 0));
    const endRange = endOfToday;

    // PrinterUsage per day
    const usageByDay = await PrinterUsage.aggregate([
      { $match: { printer: printerId, createdAt: { $gte: startRange, $lte: endRange } } },
      {
        $project: {
          y: { $year: '$createdAt' },
          m: { $month: '$createdAt' },
          d: { $dayOfMonth: '$createdAt' },
          count: 1
        }
      },
      { $group: { _id: { y: '$y', m: '$m', d: '$d' }, total: { $sum: '$count' } } },
      { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1 } }
    ]);

    // Orders per day (revenue): unwind items and group by createdAt day
    const ordersByDay = await Order.aggregate([
      { $match: { createdAt: { $gte: startRange, $lte: endRange } } },
      { $unwind: '$items' },
      { $match: { 'items.printer': printerId } },
      {
        $project: {
          y: { $year: '$createdAt' },
          m: { $month: '$createdAt' },
          d: { $dayOfMonth: '$createdAt' },
          subtotal: '$items.subtotal'
        }
      },
      { $group: { _id: { y: '$y', m: '$m', d: '$d' }, totalRevenue: { $sum: '$subtotal' } } },
      { $sort: { '_id.y': 1, '_id.m': 1, '_id.d': 1 } }
    ]);

    // create a map of dateKey -> values for easier combining
    function keyFromObj(o) { return `${o._id.y}-${String(o._id.m).padStart(2,'0')}-${String(o._id.d).padStart(2,'0')}`; }
    const usageMap = {};
    usageByDay.forEach(u => { usageMap[keyFromObj(u)] = u.total; });
    const revenueMap = {};
    ordersByDay.forEach(r => { revenueMap[keyFromObj(r)] = Number(r.totalRevenue); });

    // produce array of days from startRange to endRange
    const perDay = [];
    for (let dt = new Date(startRange); dt <= endRange; dt.setUTCDate(dt.getUTCDate() + 1)) {
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
      const d = dt.getUTCDate();
      const key = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      perDay.push({
        date: key,
        count: usageMap[key] || 0,
        revenue: revenueMap[key] || 0
      });
    }

    // Latest usage entries (limit 50)
    const latestUsages = await PrinterUsage.find({ printer: printerId }).sort({ createdAt: -1 }).limit(50).lean();

    return res.json({
      ok: true,
      printerId: id,
      counts: { today: countToday, week: countWeek, month: countMonth },
      revenue: { today: revenueToday, week: revenueWeek, month: revenueMonth },
      perDay,
      latestUsages
    });
  } catch (err) {
    console.error('printers.stats error', err);
    return res.status(500).json({ ok: false, error: 'Failed to fetch printer stats' });
  }
};
