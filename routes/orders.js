// routes/orders.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order');
const { ensureHasPermission } = require('../middlewares/auth');

// Clerk routes
router.post('/', ensureHasPermission('/orders/new'), orderController.apiCreateOrder); // allow create
router.get('/new', ensureHasPermission('/orders/new'), orderController.newOrderPage);
router.get('/list', ensureHasPermission('/orders/list'), orderController.apiListOrders);
router.get('/view/:orderId', ensureHasPermission('/orders/view/:orderId'), orderController.viewOrderPage);

// Cashier routes
router.get('/debtors', ensureHasPermission('/orders/debtors'), orderController.apiGetDebtors);
router.get('/pay', ensureHasPermission('/orders/pay'), orderController.payPage);

// pay order (cashier)
router.post('/:orderId/pay', ensureHasPermission('/orders/:orderId/pay'), orderController.apiPayOrder);

// fetch order by id (used in payment flow)
router.get('/:orderId', ensureHasPermission('/orders/:orderId'), orderController.apiGetOrderById);

module.exports = router;
