// File: routes/admin.js
// (small addition: expose stock page route AND a simple endpoint to adjust material stock)
const express = require('express');
const router = express.Router();
const unitController = require('../controllers/unit');
const subUnitController = require('../controllers/subunit');
const serviceController = require('../controllers/service');
const priceController = require('../controllers/price');
const materialsController = require('../controllers/materials');
router.get('/', (req, res) => res.redirect('/admin/services'));
const recordsController = require('../controllers/records');

// Units
router.post('/units', unitController.create);
router.put('/units/:id', unitController.update);
router.delete('/units/:id', unitController.remove);

// Sub-units
router.post('/units/:unitId/subunits', subUnitController.create);
// DELETE subunit route (needed for method-override delete forms)
router.delete('/units/:unitId/subunits/:subunitId', subUnitController.remove);
// NEW: PUT route to update a sub-unit
router.put('/units/:unitId/subunits/:subunitId', subUnitController.update);

// Services
router.get('/services', serviceController.list);
router.get('/services/:id', serviceController.get);
router.post('/services', serviceController.create);
router.put('/services/:id', serviceController.update);
router.delete('/services/:id', serviceController.remove);

// Add component to service (unit + chosen subUnits)
router.post('/services/:id/components', serviceController.addComponent);

// Assign prices from service detail page
router.post('/services/:id/prices', serviceController.assignPrice);

// Update a price rule (AJAX-friendly)
router.put('/services/:id/prices/:priceId', priceController.updatePrice);

// Prices listing/deletion (optional)
router.get('/services/:id/prices', priceController.listForService);
router.delete('/services/:id/prices/:priceId', priceController.removePrice);

// Materials
router.get('/materials', materialsController.list);
router.post('/materials', materialsController.create);
router.delete('/materials/:id', materialsController.remove);

// Stock page
router.get('/stock', materialsController.stock);

// Simple API to adjust stock for a material (AJAX)
router.post('/materials/:id/stock', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) return res.status(400).json({ error: 'Invalid id' });
    const stock = Number(req.body.stock);
    if (isNaN(stock)) return res.status(400).json({ error: 'Invalid stock value' });
    const updated = await require('../models/material').findByIdAndUpdate(id, { $set: { stock: stock } }, { new: true }).lean();
    if (!updated) return res.status(404).json({ error: 'Material not found' });
    return res.json({ ok: true, material: updated });
  } catch (err) {
    console.error('adjust stock error', err);
    return res.status(500).json({ error: 'Error updating stock' });
  }
});

module.exports = router;


// Records dashboard / UI
router.get('/records', recordsController.index);
// JSON data for filtered usages (AJAX)
router.get('/records/usage', recordsController.usageData);
// CSV export of filtered usages
router.get('/records/export', recordsController.exportCsv);
