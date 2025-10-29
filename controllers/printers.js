// controllers/printers.js
const Printer = require('../models/printer');
const mongoose = require('mongoose');

exports.list = async (req, res) => {
  try {
    const printers = await Printer.find().sort('name').lean();
    // If AJAX or small API consumer expects JSON, return JSON; otherwise render printers page.
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

    const p = new Printer({ name });
    await p.save();

    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.json({ ok: true, printer: p.toObject() });

    res.redirect('/admin/printers');
  } catch (err) {
    console.error('printers.create error', err);
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
    printer.name = name;
    await printer.save();

    const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) return res.json({ ok: true, printer: printer.toObject() });
    res.redirect('/admin/printers');
  } catch (err) {
    console.error('printers.update error', err);
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

// Minimal JSON API to fetch printers (if you prefer /api/printers)
exports.listAll = async (req, res) => {
  try {
    const printers = await Printer.find().select('_id name').sort('name').lean();
    return res.json({ ok: true, printers });
  } catch (err) {
    console.error('printers.listAll error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load printers' });
  }
};
