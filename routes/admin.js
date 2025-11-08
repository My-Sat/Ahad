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
const printersController = require('../controllers/printers');
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
// Set stocked value
router.post('/materials/:id/stock', materialsController.setStock);

// Stock page
router.get('/stock', materialsController.stock);

// Simple API to adjust stock for a material (AJAX)
router.post('/materials/:id/stock', materialsController.setStock);

// Printers
router.get('/printers', printersController.list);
router.get('/printers/:id/stats', printersController.stats);
router.post('/printers', printersController.create);
router.put('/printers/:id', printersController.update);
router.delete('/printers/:id', printersController.remove);
router.get('/printers/:id/usage', printersController.usage);      // GET usage log (AJAX)
router.post('/printers/:id/adjust', printersController.adjustCount); // POST adjust/set total (AJAX)



// also expose simple API endpoint for client-side listing if needed
router.get('/api/printers', printersController.listAll);

module.exports = router;
