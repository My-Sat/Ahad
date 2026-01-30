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

// API: delete customer
router.delete(
  '/:id',
  ensureHasPermission('/customers'),
  customerController.apiDeleteCustomer
);



// API: search suggestions (for typeahead)
router.get('/search', ensureHasPermission('/search'), customerController.apiSearch);

// ✅ Customer account page (Admin use via Pay page customer modal)
router.get(
  '/:id/account',
  ensureHasPermission('/customers'),
  customerController.accountPage
);

// ✅ API: list customer orders
router.get(
  '/:id/orders',
  ensureHasPermission('/customers'),
  customerController.apiCustomerOrders
);

// ✅ API: fetch account info
router.get(
  '/:id/account/api',
  ensureHasPermission('/customers'),
  customerController.apiGetAccount
);

// ✅ API: debit/credit customer account
router.post(
  '/:id/account/adjust',
  ensureHasPermission('/customers'),
  customerController.apiAdjustAccount
);

module.exports = router;
