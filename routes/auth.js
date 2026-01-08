// routes/auth.js
const express = require('express');
const router = express.Router();
const User = require('../models/user');
const bcrypt = require('bcrypt');
const { ensureAuthenticated } = require('../middlewares/auth');
const usersController = require('../controllers/users');


// show login page
router.get('/login', (req, res) => {
  const nextUrl = req.query.next || '/';
  res.render('login', { title: 'Sign in', next: nextUrl });
});

// handle login (fixed)
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const nextUrl = req.body.next || '/';
    if (!username || !password) {
      return res.render('login', { error: 'Missing credentials', next: nextUrl });
    }

    const user = await User.findOne({ username }).exec();
    if (!user) {
      return res.render('login', { error: 'Invalid username or password', next: nextUrl });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.render('login', { error: 'Invalid username or password', next: nextUrl });
    }

    // success: set session and save before redirecting
    req.session.userId = user._id.toString();

    // Ensure session is persisted before redirecting
    req.session.save(err => {
      if (err) {
        console.error('session save error', err);
        // fallback: still attempt redirect so user isn't stuck, but log the issue
      }

      const role = (user.role || '').toLowerCase();
      if (role === 'admin') return res.redirect('/admin/services');
      if (role === 'clerk') return res.redirect('/customers');
      if (role === 'cashier') return res.redirect('/orders/pay');

      // fallback (if role unknown)
      return res.redirect(nextUrl);
    });

  } catch (err) {
    next(err);
  }
});

// User settings (authenticated users only)
router.get('/user-settings', ensureAuthenticated, usersController.userSettingsForm);
router.post('/user-settings/password', ensureAuthenticated, usersController.updateMyPassword);


// logout
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.clearCookie('sid');
    return res.redirect('/login');
  });
});


// ONE-TIME create-first-admin endpoint (only allowed if no users exist)
// NOTE: remove or secure after creating your first admin
router.get('/create-first-admin', async (req, res, next) => {
  try {
    const count = await User.estimatedDocumentCount();
    if (count > 0) {
      return res.status(403).send('Not allowed');
    }
    res.render('create_first_admin');
  } catch (err) { next(err); }
});

router.post('/create-first-admin', async (req, res, next) => {
  try {
    const count = await User.estimatedDocumentCount();
    if (count > 0) return res.status(403).send('Not allowed');

    const { username, name, password } = req.body;
    if (!username || !password) return res.render('create_first_admin', { error: 'Missing fields' });

    const u = new User({ username, name, role: 'admin', permissions: [] });
    await u.setPassword(password);
    await u.save();

    // auto-login
    req.session.userId = u._id.toString();
    return res.redirect('/admin/services');
  } catch (err) { next(err); }
});

module.exports = router;
