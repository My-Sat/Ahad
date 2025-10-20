// routes/orders.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order');

// Staff pages (non-admin)
router.get('/new', orderController.newOrderPage);
router.get('/pay', orderController.payPage);

module.exports = router;
