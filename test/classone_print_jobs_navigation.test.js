const assert = require('node:assert/strict');
const test = require('node:test');
const pug = require('pug');
const path = require('node:path');
const adminRoutes = require('../routes/admin');
const { ensureAdmin } = require('../middlewares/auth');

const renderLayout = (role) => pug.renderFile(path.join(__dirname, '../views/layout.pug'), {
  currentUser: { role, name: role }
});

test('ClassOne print jobs appear under Jobs, not Assets, for admins only', () => {
  const admin = renderLayout('admin');
  const jobsStart = admin.indexOf('id="tab-operations"');
  const printJobs = admin.indexOf('id="tab-classone-print-jobs"');
  const assetsStart = admin.indexOf('id="tab-assets"');

  assert.ok(jobsStart >= 0 && printJobs > jobsStart && printJobs < assetsStart);
  assert.match(admin, /Jobs .*ClassOne Print Jobs/);
  assert.doesNotMatch(admin, /Assets - ClassOne Print Jobs/);
  assert.ok(admin.indexOf('id="tab-classone-print-jobs-sm"') > admin.indexOf('id="tab-orders-new-sm"'));

  for (const role of ['cashier', 'clerk', 'secretary']) {
    assert.doesNotMatch(renderLayout(role), /\/admin\/classone-print-jobs/);
  }
});

test('ClassOne print jobs route requires the admin middleware', () => {
  const route = adminRoutes.stack.find((layer) => layer.route?.path === '/classone-print-jobs');
  assert.ok(route);
  assert.equal(route.route.stack[0].handle, ensureAdmin);
});
