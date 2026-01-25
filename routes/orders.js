// routes/orders.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order');
const { ensureHasPermission } = require('../middlewares/auth');

// --------------------
// Clerk routes
// --------------------
router.post(
  '/',
  ensureHasPermission('/orders/new'),
  orderController.apiCreateOrder
);

router.get(
  '/new',
  ensureHasPermission('/orders/new'),
  orderController.newOrderPage
);

router.get(
  '/list',
  ensureHasPermission('/orders/list'),
  orderController.apiListOrders
);

router.get(
  '/view/:orderId',
  ensureHasPermission('/orders/view/:orderId'),
  orderController.viewOrderPage
);

// --------------------
// Cashier routes
// --------------------
router.get(
  '/debtors',
  ensureHasPermission('/orders/debtors'),
  orderController.apiGetDebtors
);

router.get(
  '/pay',
  ensureHasPermission('/orders/pay'),
  orderController.payPage
);

// ✅ NEW: bulk full payment for a debtor (MUST be before :orderId)
router.post(
  '/pay-bulk',
  ensureHasPermission('/orders/pay-bulk'),
  orderController.apiPayBulkDebtor
);

// apply manual discount to order (admin only)
router.post(
  '/:orderId/discount',
  ensureHasPermission('/orders/:orderId/discount'),
  orderController.apiApplyManualDiscount
);

// pay single order (cashier)
router.post(
  '/:orderId/pay',
  ensureHasPermission('/orders/:orderId/pay'),
  orderController.apiPayOrder
);

// fetch order by id (used in payment flow)
router.get(
  '/:orderId',
  ensureHasPermission('/orders/:orderId'),
  orderController.apiGetOrderById
);

// ✅ Apply customer account to reduce outstanding (must be before /:orderId if you want)
router.post(
  '/:orderId/pay-from-account',
  ensureHasPermission('/orders/:orderId/pay'),
  orderController.apiPayFromCustomerAccount
);


module.exports = router;
