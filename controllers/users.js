// controllers/users.js
const User = require('../models/user');

// render users admin page
exports.list = async function (req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    return res.render('users/admin_users', { title: 'Users', users, currentUser: req.user });
  } catch (err) {
    next(err);
  }
};

exports.newForm = function (req, res) {
  res.render('admin_users_new', { title: 'Create user' });
};

exports.create = async function (req, res, next) {
  try {
    const { username, name, role, password, email, phone } = req.body;
    if (!username || !password || !role || !phone) {
      return res.status(400).send('Missing required fields');
    }

// inside exports.create(...)
let defaultPerms = [];
const r = role.toLowerCase();

if (r === 'clerk') {
  defaultPerms = [
    '/customers',               // front desk page
    '/lookup',                  // API lookup
    '/search',                  // API search/typeahead
    '/orders/new',              // create new order
    '/orders/list',             // list orders
    '/orders/view/:orderId'     // view order details
  ];
} else if (r === 'cashier') {
  defaultPerms = [
    '/orders/pay',              // payments page
    '/orders/debtors',         // debtors
    '/orders/:orderId',        // fetch order by id at payment page
    '/orders/:orderId/pay',    // pay a specific order
    '/search'                  // API search/typeahead
  ];
}

    const user = new User({ username, name, role: r, email, phone, permissions: defaultPerms });
    await user.setPassword(password);
    await user.save();

    // redirect back to users list with success
    req.flash && req.flash('success', 'User created');
    return res.redirect('/admin/users');
  } catch (err) {
    // handle duplicate username
    if (err.code === 11000) return res.status(409).send('Username already exists');
    next(err);
  }
};

exports.update = async function (req, res, next) {
  try {
    const id = req.params.id;
    const { name, email, phone, role } = req.body;
    const u = await User.findById(id);
    if (!u) return res.status(404).send('Not found');

    if (name) u.name = name;
    if (email) u.email = email;
    if (phone) u.phone = phone;
    if (role && ['admin','clerk','cashier'].includes(role.toLowerCase())) {
      u.role = role.toLowerCase();
    }
    await u.save();
    return res.redirect('/admin/users');
  } catch (err) { next(err); }
};

exports.remove = async function (req, res, next) {
  try {
    await User.findByIdAndDelete(req.params.id);
    return res.redirect('/admin/users');
  } catch (err) { next(err); }
};

// set permissions (AJAX-friendly)
exports.setPermissions = async function (req, res, next) {
  try {
    const id = req.params.id;
    const perms = Array.isArray(req.body.permissions) ? req.body.permissions : [];
    const u = await User.findById(id);
    if (!u) return res.status(404).json({ error: 'User not found' });

    const permSet = new Set(perms);
    // If front desk or lookup is enabled, ensure search/typeahead is also enabled.
    if (permSet.has('/customers') || permSet.has('/lookup')) permSet.add('/search');
    u.permissions = Array.from(permSet);
    await u.save();
    return res.json({ ok: true, permissions: u.permissions });
  } catch (err) { next(err); }
};

// get user (AJAX)
exports.getJson = async function (req, res, next) {
  try {
    const u = await User.findById(req.params.id).lean();
    if (!u) return res.status(404).json({ error: 'Not found' });
    // hide sensitive fields
    delete u.passwordHash;
    res.json(u);
  } catch (err) { next(err); }
};

// Render user settings page (password change)
exports.userSettingsForm = async function (req, res, next) {
  try {
    return res.render('users/user_settings', {
      title: 'User Settings',
      currentUser: req.user
    });
  } catch (err) {
    next(err);
  }
};

// Handle password update
exports.updateMyPassword = async function (req, res, next) {
  try {
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).render('users/user_settings', { title: 'User Settings', error: 'Not authenticated' });

    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.render('users/user_settings', { title: 'User Settings', error: 'All fields are required.' });
    }

    if (newPassword !== confirmPassword) {
      return res.render('users/user_settings', { title: 'User Settings', error: 'New password and confirmation do not match.' });
    }

    if (String(newPassword).length < 6) {
      return res.render('users/user_settings', { title: 'User Settings', error: 'New password must be at least 6 characters.' });
    }

    const u = await User.findById(userId);
    if (!u) return res.status(404).render('users/user_settings', { title: 'User Settings', error: 'User not found.' });

    // verify old password
    const ok = await u.verifyPassword(oldPassword);
    if (!ok) {
      return res.render('users/user_settings', { title: 'User Settings', error: 'Old password is incorrect.' });
    }

    await u.setPassword(newPassword);
    await u.save();

  // role-based redirect after success
  const role = (req.user.role || '').toLowerCase();
  let redirectTo = '/';
  if (role === 'admin') redirectTo = '/admin/services';
  else if (role === 'clerk') redirectTo = '/customers';
  else if (role === 'cashier') redirectTo = '/orders/pay';

  // Render success modal then redirect
  return res.render('users/user_settings', {
    title: 'User Settings',
    currentUser: req.user,
    success: true,
    redirectTo
  });
  } catch (err) {
    next(err);
  }
};

