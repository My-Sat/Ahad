const express = require('express');
const router = express.Router();
const apiController = require('../controllers/api');

// price lookup for a selection set
router.post('/services/:id/price-for-selection', apiController.getPriceForSelection);

module.exports = router;
