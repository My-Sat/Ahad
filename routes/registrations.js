const express = require('express');
const router = express.Router();
const registrationsController = require('../controllers/registrations');

function ensureAdminOrSecretary(req, res, next) {
  const role = String(req.user && req.user.role ? req.user.role : '').toLowerCase();
  if (role === 'admin' || role === 'secretary') return next();
  if (req.xhr || (req.get('Accept') || '').includes('application/json')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.status(403).send('Forbidden');
}

router.get('/', ensureAdminOrSecretary, registrationsController.page);
router.get('/categories', ensureAdminOrSecretary, registrationsController.apiCategories);
router.get('/pending', ensureAdminOrSecretary, registrationsController.apiListPending);
router.post('/submit', ensureAdminOrSecretary, registrationsController.apiSubmit);

module.exports = router;
