// routes/admin.js
const express = require('express');
const router = express.Router();
const unitController = require('../controllers/unit');
const subUnitController = require('../controllers/subunit');
const serviceController = require('../controllers/service');
const priceController = require('../controllers/price');
const materialsController = require('../controllers/materials');router.get('/', (req, res) => res.redirect('/admin/services'));
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

router.get('/materials', materialsController.list);
router.post('/materials', materialsController.create);
router.delete('/materials/:id', materialsController.remove);
module.exports = router;


// Records dashboard / UI
router.get('/records', recordsController.index);
// JSON data for filtered usages (AJAX)
router.get('/records/usage', recordsController.usageData);
// CSV export of filtered usages
router.get('/records/export', recordsController.exportCsv);

