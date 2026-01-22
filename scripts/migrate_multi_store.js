const mongoose = require('mongoose');
const Store = require('../models/store');
const { MaterialAggregate, MaterialUsage } = require('../models/material_usage');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const op = await Store.findOne({ isOperational: true }).lean();
  if (!op) throw new Error('No operational store configured');

  // Backfill store on old docs (if any)
  await MaterialAggregate.updateMany(
    { store: { $exists: false } },
    { $set: { store: op._id } }
  );
  await MaterialUsage.updateMany(
    { store: { $exists: false } },
    { $set: { store: op._id } }
  );

  // Sync indexes (drops old indexes not in schema + creates required ones)
  await MaterialAggregate.syncIndexes();

  console.log('✅ Material aggregates migrated and indexes synced.');
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
