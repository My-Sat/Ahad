const express = require('express');
const router = express.Router();
const apiController = require('../controllers/api');
const orderController = require('../controllers/order');


// price lookup for a selection set
router.post('/services/:id/price-for-selection', apiController.getPriceForSelection);

// routes/api_orders.js
// return price rules for a chosen service
router.get('/services/:serviceId/prices', orderController.apiGetPricesForService);

// create order
router.post('/orders', orderController.apiCreateOrder);

// get order by id
router.get('/orders/:orderId', orderController.apiGetOrderById);

// pay order
router.post('/orders/:orderId/pay', orderController.apiPayOrder);

module.exports = router;


module.exports = router;
