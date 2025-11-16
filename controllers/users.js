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
    if (!username || !password || !role) {
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
    '/orders/:orderId/pay'     // pay a specific order
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

    u.permissions = perms;
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
