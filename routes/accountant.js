const express = require('express');
const router = express.Router();

const ledger = require('../controllers/accountant');

// GET /accountant/ledger?date=YYYY-MM-DD
router.get('/ledger', ledger.getLedger);

module.exports = router;