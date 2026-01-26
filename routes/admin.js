// File: routes/admin.js
// (small addition: expose stock page route AND a simple endpoint to adjust material stock)
const express = require('express');
const router = express.Router();
const unitController = require('../controllers/unit');
const subUnitController = require('../controllers/subunit');
const serviceController = require('../controllers/service');
const priceController = require('../controllers/price');
const materialsController = require('../controllers/materials');
router.get('/', (req, res) => res.redirect('/login'));
const printersController = require('../controllers/printers');
const usersController = require('../controllers/users');
const { ensureAdmin } = require('../middlewares/auth');
const serviceCategoryController = require('../controllers/serviceCategory');
const { ensureHasPermission } = require('../middlewares/auth');
const discountsController = require('../controllers/discounts');




// Units
router.post('/units', ensureAdmin, unitController.create);
router.put('/units/:id', ensureAdmin, unitController.update);
router.delete('/units/:id', ensureAdmin, unitController.remove);

// Sub-units
router.post('/units/:unitId/subunits', ensureAdmin, subUnitController.create);
// DELETE subunit route (needed for method-override delete forms)
router.delete('/units/:unitId/subunits/:subunitId', ensureAdmin, subUnitController.remove);
// NEW: PUT route to update a sub-unit
router.put('/units/:unitId/subunits/:subunitId', ensureAdmin, subUnitController.update);

// Services
// price lookup for a selection set
router.post('/services/:id/price-for-selection', ensureAdmin, serviceController.getPriceForSelection);
// return price rules for a chosen service
router.get('/services/:serviceId/prices', serviceController.apiGetPricesForService);
router.get('/services', ensureAdmin, serviceController.list);
router.get('/services/:id', ensureAdmin, serviceController.get);
router.post('/services', ensureAdmin, serviceController.create);
router.put('/services/:id', ensureAdmin, serviceController.update);
router.delete('/services/:id', ensureAdmin, serviceController.remove);
const messagingController = require('../controllers/messaging');

// Messaging (ADMIN)
router.get('/messaging', ensureAdmin, messagingController.page);
router.get('/messaging/api/config', ensureAdmin, messagingController.apiGetConfig);
router.post('/messaging/api/config', ensureAdmin, messagingController.apiSaveConfig);
router.get('/messaging/api/debtors', ensureAdmin, messagingController.apiGetDebtorsList);
router.post('/messaging/api/send', ensureAdmin, messagingController.apiSendManual);


// Add component to service (unit + chosen subUnits)
router.post('/services/:id/components', ensureAdmin, serviceController.addComponent);

// Assign prices from service detail page
router.post('/services/:id/prices', ensureAdmin, serviceController.assignPrice);

// Update a price rule (AJAX-friendly)
router.put('/services/:id/prices/:priceId', ensureAdmin, priceController.updatePrice);

// Prices listing/deletion (optional)
router.get('/services/:id/prices', ensureAdmin, priceController.listForService);
router.delete('/services/:id/prices/:priceId', ensureAdmin, priceController.removePrice);

// list categories (AJAX-friendly) — publicly accessible (client uses this)
router.get('/service-categories', serviceCategoryController.list);

// get single category (AJAX)
router.get('/service-categories/:id', serviceCategoryController.get);

// list services under a category (used by orders_client.js)
router.get('/service-categories/:id/services', serviceCategoryController.servicesForCategory);

// create / update / delete (ADMIN only)
router.post('/service-categories', ensureAdmin, serviceCategoryController.create);
router.put('/service-categories/:id', ensureAdmin, serviceCategoryController.update);
router.delete('/service-categories/:id', ensureAdmin, serviceCategoryController.remove);

// ----------------------
// Catalogue (Materials)
// ----------------------
router.get('/catalogue', ensureAdmin, materialsController.cataloguePage);

// JSON catalogue endpoints (keep same /materials path so existing JS works easily)
router.get('/materials', ensureAdmin, materialsController.listCatalogues);
router.post('/materials', ensureAdmin, materialsController.createCatalogue);
router.delete('/materials/:id', ensureAdmin, materialsController.removeCatalogue);

// Materials for orders page (operational store only)
router.get('/materials/for-orders', ensureHasPermission('/orders/new'), materialsController.listForOrders);

// ----------------------
// Stores + Stock Dashboard
// ----------------------
router.get('/stock', ensureAdmin, materialsController.stockPage);

// stores
router.get('/stores', ensureAdmin, materialsController.listStores);
router.post('/stores', ensureAdmin, materialsController.createStore);
router.post('/stores/:id/operational', ensureAdmin, materialsController.setOperationalStore);
router.put('/stores/:id', ensureAdmin, materialsController.updateStore);
router.delete('/stores/:id', ensureAdmin, materialsController.deleteStore);

// store stock
router.post('/stores/:storeId/stocks', ensureAdmin, materialsController.addStockToStore);
router.post('/stores/:storeId/stocks/:stockId/adjust', ensureAdmin, materialsController.adjustStoreStock);
router.post('/stores/:storeId/stocks/:stockId/transfer', ensureAdmin, materialsController.transferStoreStock);
router.delete('/stores/:storeId/stocks/:stockId', ensureAdmin, materialsController.removeStockFromStore);
router.get('/stores/:storeId/stocks/:stockId/activity', ensureAdmin, materialsController.stockActivity);

// Printers
router.get('/printers', ensureAdmin, printersController.list);
router.get('/printers/:id/stats', ensureAdmin, printersController.stats);
router.post('/printers', ensureAdmin, printersController.create);
router.put('/printers/:id', ensureAdmin, printersController.update);
router.delete('/printers/:id', ensureAdmin, printersController.remove);
router.get('/printers/:id/usage', ensureAdmin, printersController.usage);      // GET usage log (AJAX)
router.post('/printers/:id/adjust', ensureAdmin, printersController.adjustCount); // POST adjust/set total (AJAX)

// Users management (ADMIN only)
router.get('/users', ensureAdmin, usersController.list);        // list view (HTML)
router.get('/users/new', ensureAdmin, usersController.newForm); // new user form (modal or page)
router.post('/users', ensureAdmin, usersController.create);     // create user
router.put('/users/:id', ensureAdmin, usersController.update);  // update user (role, name)
router.delete('/users/:id', ensureAdmin, usersController.remove); // remove user
router.get('/users/:id', ensureAdmin, usersController.getJson);


router.post('/users/:id/permissions', ensureAdmin, usersController.setPermissions);

// also expose simple API endpoint for client-side listing if needed
router.get('/api/printers', printersController.listAll);

// Discounts (ADMIN)
router.get('/discounts', ensureAdmin, discountsController.page);
router.get('/discounts/api', ensureAdmin, discountsController.apiGet);
router.post('/discounts', ensureAdmin, discountsController.apiSave);
router.get('/discounts/customer-search', ensureAdmin, discountsController.apiSearchCustomers);


module.exports = router;
