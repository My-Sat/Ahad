// routes/orders.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order');

// Clerk routes
router.post('/orders', orderController.apiCreateOrder);
router.get('/new', orderController.newOrderPage);
router.get('/list', orderController.apiListOrders);
router.get('/view/:orderId', orderController.viewOrderPage);
router.get('/orders/:orderId', orderController.apiGetOrderById);

// Cahsier routes
router.get('/debtors', orderController.apiGetDebtors); // create order
router.get('/pay', orderController.payPage);
// pay order
router.post('/orders/:orderId/pay', orderController.apiPayOrder);


module.exports = router;
