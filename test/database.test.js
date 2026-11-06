const assert = require('node:assert/strict');
const test = require('node:test');
const dns = require('node:dns');
const mongoose = require('mongoose');
const { buildSeedListUri, connectDatabase } = require('../config/database');

test('Atlas seed-list URI preserves credentials, database, and query options', () => {
  const uri = buildSeedListUri(
    'mongodb+srv://user:p%40ss@cluster.test/ahad?retryWrites=true',
    [{ name: 'shard-a.test', port: 27017 }, { name: 'shard-b.test', port: 27017 }]
  );
  assert.match(uri, /^mongodb:\/\/user:p%40ss@shard-a\.test:27017,shard-b\.test:27017\/ahad\?/);
  assert.match(uri, /retryWrites=true/);
  assert.match(uri, /tls=true/);
  assert.match(uri, /authSource=admin/);
});

test('local Atlas startup uses a seed list and one Mongoose connection', async (t) => {
  const originalUri = process.env.MONGO_URI;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.MONGO_URI = 'mongodb+srv://user:password@cluster.test/ahad';
  process.env.NODE_ENV = 'development';
  t.after(() => {
    if (originalUri === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = originalUri;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  t.mock.method(dns.promises.Resolver.prototype, 'resolveSrv', async () => [
    { name: 'shard-a.test', port: 27017 }
  ]);
  const calls = [];
  t.mock.method(mongoose, 'connect', async (uri) => { calls.push(uri); });

  await connectDatabase();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^mongodb:\/\/user:password@shard-a\.test:27017\/ahad\?/);
});
