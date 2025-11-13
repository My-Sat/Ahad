const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer');

// front desk customer page
router.get('/customers', customerController.frontPage);

// API: lookup customer by phone
router.get('/api/customers/lookup', customerController.apiLookupByPhone);

// API: create new customer
router.post('/api/customers', customerController.apiCreateCustomer);

// API: search suggestions (for typeahead)
router.get('/api/customers/search', customerController.apiSearch);

module.exports = router;
