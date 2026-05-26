const express = require('express');
const router = express.Router();
const cashiers = require('../controllers/cashiers');

// get cashier status for date
router.get('/status', cashiers.getCashiers);
router.get('/my-status', cashiers.my_status);
router.get('/my-cash-breakdown', cashiers.my_cash_breakdown);
//post cashier collection
router.post('/:cashierId/collect', cashiers.postCashiers);

module.exports = router;
