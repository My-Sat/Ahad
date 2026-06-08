const express = require('express');
const router = express.Router();
const registrationsController = require('../controllers/registrations');
const enquiriesController = require('../controllers/enquiries');

function ensureAdminOrSecretary(req, res, next) {
  const role = String(req.user && req.user.role ? req.user.role : '').toLowerCase();
  if (role === 'admin' || role === 'secretary') return next();
  if (req.xhr || (req.get('Accept') || '').includes('application/json')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.status(403).send('Forbidden');
}

function ensureAdmin(req, res, next) {
  const role = String(req.user && req.user.role ? req.user.role : '').toLowerCase();
  if (role === 'admin') return next();
  if (req.xhr || (req.get('Accept') || '').includes('application/json')) {
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  }
  return res.status(403).send('Admin access required');
}

router.get('/', ensureAdminOrSecretary, registrationsController.page);
router.get('/categories', ensureAdminOrSecretary, registrationsController.apiCategories);
router.get('/pending', ensureAdminOrSecretary, registrationsController.apiListPending);
router.get('/enquiries', ensureAdminOrSecretary, enquiriesController.page);
router.get('/enquiries/catalog', ensureAdminOrSecretary, enquiriesController.apiCatalog);
router.post('/enquiries/catalog/categories', ensureAdmin, enquiriesController.apiCreateCatalogCategory);
router.put('/enquiries/catalog/categories/:categoryId', ensureAdmin, enquiriesController.apiUpdateCatalogCategory);
router.delete('/enquiries/catalog/categories/:categoryId', ensureAdmin, enquiriesController.apiDeleteCatalogCategory);
router.post('/enquiries/catalog/categories/:categoryId/services', ensureAdmin, enquiriesController.apiCreateCatalogService);
router.put('/enquiries/catalog/categories/:categoryId/services/:serviceId', ensureAdmin, enquiriesController.apiUpdateCatalogService);
router.delete('/enquiries/catalog/categories/:categoryId/services/:serviceId', ensureAdmin, enquiriesController.apiDeleteCatalogService);
router.get('/enquiries/api', ensureAdminOrSecretary, enquiriesController.apiList);
router.post('/enquiries', ensureAdminOrSecretary, enquiriesController.apiCreate);
router.delete('/:id', ensureAdminOrSecretary, registrationsController.apiClearOne);
router.post('/submit', ensureAdminOrSecretary, registrationsController.apiSubmit);

module.exports = router;
