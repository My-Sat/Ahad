// routes/auth.js
const express = require('express');
const router = express.Router();
const User = require('../models/user');
const bcrypt = require('bcrypt');
const { ensureAuthenticated } = require('../middlewares/auth');
const usersController = require('../controllers/users');
const crypto = require('crypto');



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
      if (role === 'clerk') return res.redirect('/orders/new');
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


// Forgot password - request OTP page
router.get('/forgot-password', (req, res) => {
  res.render('forgot_password', { title: 'Forgot Password' });
});

// Forgot password - send OTP
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.render('forgot_password', { title: 'Forgot Password', error: 'Phone is required.' });
    }

    // normalize Ghana numbers very simply:
    // - remove spaces
    // - if starts with 0XXXXXXXXX => 233XXXXXXXXX
    // - if starts with +233 => 233
    let p = String(phone).trim().replace(/\s+/g, '');
    if (p.startsWith('+')) p = p.slice(1);
    if (p.startsWith('0') && p.length === 10) p = '233' + p.slice(1);

    // lookup user by phone
    const user = await User.findOne({ phone: p });
    // SECURITY: do not reveal whether user exists
    if (!user) {
      return res.render('forgot_password', {
        title: 'Forgot Password',
        info: 'If an account exists for that number, an OTP has been sent.'
      });
    }

    // lockout check
    const now = new Date();
    if (user.resetOtpLockUntil && user.resetOtpLockUntil > now) {
      return res.render('forgot_password', {
        title: 'Forgot Password',
        error: 'Too many attempts. Try again later.'
      });
    }

    // basic resend throttle (e.g., 60s)
    if (user.resetOtpLastSentAt && (now - user.resetOtpLastSentAt) < 60 * 1000) {
      return res.render('forgot_password', {
        title: 'Forgot Password',
        error: 'Please wait a moment before requesting another OTP.'
      });
    }

    // generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));

    // hash OTP (do NOT store plaintext OTP)
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    user.resetOtpHash = otpHash;
    user.resetOtpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    user.resetOtpLastSentAt = now;
    user.resetOtpAttempts = 0;
    user.resetOtpLockUntil = null;
    await user.save();

    // send OTP via Hubtel
    const { sendSms } = require('../utilities/hubtel_sms');
    await sendSms({
      to: p,
      content: `AHAD password reset OTP: ${otp}. Expires in 5 minutes.`
    });

    // go to verify page (pass phone along)
    return res.redirect(`/reset-password?phone=${encodeURIComponent(p)}`);
  } catch (err) {
    next(err);
  }
});

// Reset password - verify OTP form
router.get('/reset-password', (req, res) => {
  const phone = req.query.phone || '';
  res.render('reset_password', { title: 'Reset Password', phone });
});

// Reset password - verify OTP + set new password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { phone, otp, newPassword, confirmPassword } = req.body;

    if (!phone || !otp || !newPassword || !confirmPassword) {
      return res.render('reset_password', { title: 'Reset Password', phone, error: 'All fields are required.' });
    }
    if (newPassword !== confirmPassword) {
      return res.render('reset_password', { title: 'Reset Password', phone, error: 'Passwords do not match.' });
    }
    if (String(newPassword).length < 6) {
      return res.render('reset_password', { title: 'Reset Password', phone, error: 'Password must be at least 6 characters.' });
    }

    const user = await User.findOne({ phone: String(phone).trim() });
    // SECURITY: generic error
    if (!user) {
      return res.render('reset_password', { title: 'Reset Password', phone, error: 'Invalid OTP or expired.' });
    }

    const now = new Date();

    // lockout check
    if (user.resetOtpLockUntil && user.resetOtpLockUntil > now) {
      return res.render('reset_password', { title: 'Reset Password', phone, error: 'Too many attempts. Try again later.' });
    }

    // expiry check
    if (!user.resetOtpHash || !user.resetOtpExpiresAt || user.resetOtpExpiresAt < now) {
      return res.render('reset_password', { title: 'Reset Password', phone, error: 'Invalid OTP or expired.' });
    }

    const otpHash = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
    if (otpHash !== user.resetOtpHash) {
      // increment attempts and lock if too many
      user.resetOtpAttempts = Number(user.resetOtpAttempts || 0) + 1;
      if (user.resetOtpAttempts >= 5) {
        user.resetOtpLockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
      }
      await user.save();

      return res.render('reset_password', { title: 'Reset Password', phone, error: 'Invalid OTP or expired.' });
    }

    // OTP ok -> set new password
    await user.setPassword(newPassword);

    // clear otp fields
    user.resetOtpHash = null;
    user.resetOtpExpiresAt = null;
    user.resetOtpAttempts = 0;
    user.resetOtpLockUntil = null;
    await user.save();

    // success -> back to login
    return res.render('login', { title: 'Sign in', success: 'Password reset successful. Please sign in.' });
  } catch (err) {
    next(err);
  }
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
