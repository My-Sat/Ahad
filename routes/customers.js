// routes/customers.js  (save as this name if app.js expects './routes/customers')
const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer');
const { ensureAdmin, ensureHasPermission, ensureHasAnyPermission } = require('../middlewares/auth');

// front desk customer page (clerk)
router.get('/', ensureAdmin, customerController.frontPage);

// API: lookup customer by phone
router.get(
  '/lookup',
  ensureHasAnyPermission(['/lookup', '/orders/new', '/customers']),
  customerController.apiLookupByPhone
);

// API: list all customers (admin)
router.get(
  '/api/list',
  ensureAdmin,
  customerController.apiListCustomers
);

router.get(
  '/api/stats',
  ensureAdmin,
  customerController.apiCustomerStats
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
router.get(
  '/search',
  ensureHasAnyPermission(['/search', '/orders/new', '/customers']),
  customerController.apiSearch
);

// ✅ Customer account page (Admin use via Pay page customer modal)
router.get(
  '/:id/account',
  ensureAdmin,
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
  ensureAdmin,
  customerController.apiGetAccount
);

// ✅ API: debit/credit customer account
router.post(
  '/:id/account/adjust',
  ensureAdmin,
  customerController.apiAdjustAccount
);

module.exports = router;
