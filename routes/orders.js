// routes/orders.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order');

// Clerk routes
router.post('/', orderController.apiCreateOrder);
router.get('/new', orderController.newOrderPage);
router.get('/list', orderController.apiListOrders);
router.get('/view/:orderId', orderController.viewOrderPage);
// Cahsier routes
router.get('/debtors', orderController.apiGetDebtors);
router.get('/pay', orderController.payPage);
// pay order
router.post('/:orderId/pay', orderController.apiPayOrder);
router.get('/:orderId', orderController.apiGetOrderById);


module.exports = router;
