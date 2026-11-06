const dns = require('node:dns');
const mongoose = require('mongoose');

const DEFAULT_URI = 'mongodb://127.0.0.1:27017/pos_db';
const LOCAL_DNS_SERVERS = ['1.1.1.1', '8.8.8.8'];

const isSrvUri = (uri) => uri.startsWith('mongodb+srv://');

const buildSeedListUri = (srvUri, records) => {
  const parsed = new URL(srvUri);
  if (!records.length) throw new Error('Atlas did not return any MongoDB hosts');

  const credentials = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
    : '';
  const hosts = records.map((record) => `${record.name}:${record.port}`).join(',');
  const params = new URLSearchParams(parsed.search);
  if (!params.has('tls') && !params.has('ssl')) params.set('tls', 'true');
  if (!params.has('authSource')) params.set('authSource', 'admin');

  return `mongodb://${credentials}${hosts}${parsed.pathname}?${params.toString()}`;
};

const resolveAtlasHosts = async (hostname) => {
  const resolver = new dns.promises.Resolver();
  const servers = String(process.env.MONGODB_DNS_SERVERS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  resolver.setServers(servers.length ? servers : LOCAL_DNS_SERVERS);

  const timeoutMs = Number(process.env.MONGODB_DNS_TIMEOUT_MS) || 5000;
  let timer;
  try {
    return await Promise.race([
      resolver.resolveSrv(`_mongodb._tcp.${hostname}`),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          resolver.cancel();
          reject(new Error(`Atlas host lookup exceeded ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const connectDatabase = async () => {
  const uri = process.env.MONGO_URI || DEFAULT_URI;
  const options = {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 10000
  };
  const useSeedListFirst = isSrvUri(uri) && process.env.NODE_ENV !== 'production';
  const attempts = isSrvUri(uri)
    ? (useSeedListFirst ? ['seed-list', 'configured URI'] : ['configured URI', 'seed-list'])
    : ['configured URI'];
  let lastError;

  for (const attempt of attempts) {
    try {
      const connectionUri = attempt === 'seed-list'
        ? buildSeedListUri(uri, await resolveAtlasHosts(new URL(uri).hostname))
        : uri;
      await mongoose.connect(connectionUri, options);
      console.log(`Mongo connected (${attempt})`);
      return mongoose.connection;
    } catch (error) {
      lastError = error;
      await mongoose.disconnect().catch(() => {});
      if (attempt !== attempts[attempts.length - 1]) {
        console.warn(`MongoDB ${attempt} connection failed; trying ${attempts[attempts.indexOf(attempt) + 1]}.`);
      }
    }
  }

  throw new Error(`MongoDB connection failed: ${lastError?.message || 'unknown error'}`);
};

module.exports = { buildSeedListUri, connectDatabase };
