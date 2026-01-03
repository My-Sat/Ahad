// routes/customers.js  (save as this name if app.js expects './routes/customers')
const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer');
const { ensureHasPermission } = require('../middlewares/auth');

// front desk customer page (clerk)
router.get('/', ensureHasPermission('/customers'), customerController.frontPage);

// API: lookup customer by phone
router.get('/lookup', ensureHasPermission('/lookup'), customerController.apiLookupByPhone);

// API: list all customers (admin)
router.get(
  '/api/list',
  ensureHasPermission('/customers'),
  customerController.apiListCustomers
);


// API: create new customer
router.post('/', ensureHasPermission('/customers'), customerController.apiCreateCustomer);

// API: update customer
router.patch(
  '/:id',
  ensureHasPermission('/customers'),
  customerController.apiUpdateCustomer
);


// API: search suggestions (for typeahead)
router.get('/search', ensureHasPermission('/search'), customerController.apiSearch);

module.exports = router;
