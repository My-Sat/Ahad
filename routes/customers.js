const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer');

// front desk customer page
router.get('/', customerController.frontPage);

// API: lookup customer by phone
router.get('/lookup', customerController.apiLookupByPhone);

// API: create new customer
router.post('/', customerController.apiCreateCustomer);

// API: search suggestions (for typeahead)
router.get('/search', customerController.apiSearch);

module.exports = router;
