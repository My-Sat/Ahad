// middlewares/auth.js
const User = require('../models/user');

/* loadUser unchanged */
exports.loadUser = async function (req, res, next) {
  try {
    if (req.session && req.session.userId) {
      if (!req.user || (req.user && req.user._id.toString() !== req.session.userId.toString())) {
        const user = await User.findById(req.session.userId).lean();
        if (user) {
          delete user.passwordHash;
          req.user = user;
          res.locals.currentUser = user;
        } else {
          delete req.session.userId;
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

exports.ensureAuthenticated = function (req, res, next) {
  if (req.user) return next();
  if (req.xhr || req.get('Accept') === 'application/json') {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const redirectTo = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${redirectTo}`);
};

exports.ensureAdmin = function (req, res, next) {
  if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') return next();
  if (req.xhr || req.get('Accept') === 'application/json') return res.status(403).json({ error: 'Admin access required' });
  return res.status(403).send('Forbidden — admin only');
};

/*
 * Permission matcher:
 * - stored permission patterns may contain :param tokens such as '/orders/:orderId'
 * - this turns them into regex anchors and tests against a candidate path
 */
function matchesPermissionPattern(pattern, path) {
  // exact match quick-path
  if (pattern === path) return true;

  // escape regex special chars except ':' and '*' (we'll handle : params and trailing *)
  let escaped = pattern.replace(/([.+?^=!:${}()|\[\]\/\\])/g, '\\$1');

  // replace :paramName with a segment matcher
  escaped = escaped.replace(/\\:([A-Za-z0-9_]+)/g, '[^/]+');

  // allow trailing wildcard '/*' to match subpaths
  if (escaped.endsWith('\\/\\*')) {
    escaped = escaped.slice(0, -4) + '(?:\\/.*)?';
  }

  const re = new RegExp('^' + escaped + '$');
  return re.test(path);
}

/*
 * ensureHasPermission(requiredPattern)
 * If requiredPattern is provided, check that pattern against user's permissions.
 * If not provided, check req.path against user's permissions list directly.
 */
exports.ensureHasPermission = function (requiredPattern) {
  return function (req, res, next) {
    if (!req.user) {
      if (req.xhr) return res.status(401).json({ error: 'Not authenticated' });
      return res.redirect('/login');
    }

    // admin bypass
    if (req.user.role && req.user.role.toLowerCase() === 'admin') return next();

    const perms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    const candidate = requiredPattern || req.path;

    const ok = perms.some(p => matchesPermissionPattern(p, candidate));
    if (ok) return next();

    if (req.xhr || req.get('Accept') === 'application/json') return res.status(403).json({ error: 'Forbidden' });
    return res.status(403).send('Forbidden');
  };
};
