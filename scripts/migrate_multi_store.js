// scripts/migrate_multi_store.js
require('dotenv').config();
const mongoose = require('mongoose');

const Material = require('../models/material');
const Store = require('../models/store');
const StoreStock = require('../models/store_stock');
const { MaterialUsage, MaterialAggregate } = require('../models/material_usage');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos_db';
  await mongoose.connect(uri);

  // 1) Ensure a main store exists
  let mainStore = await Store.findOne({ name: 'Main Store' });
  if (!mainStore) {
    const count = await Store.countDocuments({});
    mainStore = await Store.create({ name: 'Main Store', isOperational: (count === 0) });
  }

  // Ensure at least one operational store
  const op = await Store.findOne({ isOperational: true });
  if (!op) {
    await Store.updateMany({}, { $set: { isOperational: false } });
    await Store.findByIdAndUpdate(mainStore._id, { $set: { isOperational: true } });
  }

  // 2) Backfill store field on old usage + aggregate docs
  await MaterialUsage.updateMany(
    { store: { $exists: false } },
    { $set: { store: mainStore._id } }
  );

  await MaterialAggregate.updateMany(
    { store: { $exists: false } },
    { $set: { store: mainStore._id } }
  );

  // 3) Create StoreStock for each material using old material.stocked/stock as initial
  const mats = await Material.find().lean();
  for (const m of mats) {
    const stocked =
      (typeof m.stocked === 'number') ? Number(m.stocked) :
      ((typeof m.stock === 'number') ? Number(m.stock) : 0);

    await StoreStock.findOneAndUpdate(
      { store: mainStore._id, material: m._id },
      { $set: { active: true, stocked: Math.max(0, Math.floor(stocked || 0)) } },
      { upsert: true, new: true }
    );
  }

  console.log('✅ Migration complete');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Migration failed', err);
  process.exit(1);
});
