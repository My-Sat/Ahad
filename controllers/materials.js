// controllers/materials.js
const mongoose = require('mongoose');
const Material = require('../models/material');
const ServiceCostUnit = require('../models/service_cost_unit');
const ServiceCostSubUnit = require('../models/service_cost_subunit');
const { MaterialUsage, MaterialAggregate } = require('../models/material_usage');

const Store = require('../models/store');
const StoreStock = require('../models/store_stock');
const StoreStockTransfer = require('../models/store_stock_transfer');
const StoreStockAdjustment = require('../models/store_stock_adjustment');
const StoreStockLot = require('../models/store_stock_lot');
const Supplier = require('../models/supplier');
const SupplierAccountTxn = require('../models/supplier_account_txn');
const StockPurchase = require('../models/stock_purchase');
const { resolvePaymentCashBookContext, recordCashBookMovement } = require('../utilities/cash_books');
const {
  createStockLot,
  consumeStockLots,
  ensureLotsForStock,
  reconcileLotsToRemaining,
  recalculateAverageCostFromLots
} = require('../utilities/stock_lots');
const {
  formatMaterialQuantity,
  materialUnits,
  normalizeStockUnits,
  unitForPurchase
} = require('../utilities/material_units');
const {
  actorFromReq,
  postStockPurchase,
  round2,
  roundUnitCost
} = require('../utilities/accounting');


// Helper: safely parse selections (JSON string or array)
function parseSelections(sels) {
  if (Array.isArray(sels)) return sels;
  if (typeof sels === 'string') {
    try { return JSON.parse(sels); } catch (e) { return null; }
  }
  return null;
}

function parseStockUnits(rawUnits, baseUnitName) {
  let units = rawUnits;
  if (typeof units === 'string') {
    try { units = JSON.parse(units); } catch (e) { units = []; }
  }
  return normalizeStockUnits(Array.isArray(units) ? units : [], baseUnitName);
}

async function getOperationalStoreLean() {
  return await Store.findOne({ isOperational: true }).lean();
}

// helper: subset match (material selections must be contained in item selections)
function materialMatchesItem(matSelections, itemSelections) {
  const itemSet = new Set((itemSelections || []).map(s => `${String(s.unit)}:${String(s.subUnit)}`));
  for (const ms of (matSelections || [])) {
    const key = `${String(ms.unit)}:${String(ms.subUnit)}`;
    if (!itemSet.has(key)) return false;
  }
  return true;
}

/* -----------------------------
 * CATALOGUE (GLOBAL MATERIALS)
 * ----------------------------- */

// Render catalogue page
exports.cataloguePage = async (req, res) => {
  try {
    const units = await ServiceCostUnit.find().sort('name').lean();
    const subunits = await ServiceCostSubUnit.find().sort('name').lean();
    const materials = await Material.find().populate('selections.unit selections.subUnit').sort({ createdAt: -1 }).lean();
    return res.render('catalogue/index', { materials, units, subunits });
  } catch (err) {
    console.error('materials.cataloguePage error', err);
    return res.status(500).send('Error loading catalogue page');
  }
};

// List catalogues (JSON)
exports.listCatalogues = async (req, res) => {
  try {
    const mats = await Material.find().populate('selections.unit selections.subUnit').sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, materials: mats });
  } catch (err) {
    console.error('materials.listCatalogues error', err);
    return res.status(500).json({ ok: false, error: 'Error fetching catalogue' });
  }
};

// Atomic create catalogue (idempotent). Returns 201 when inserted, 409 if exists.
exports.createCatalogue = async (req, res) => {
  try {
    const { name } = req.body;
    let { selections } = req.body;
    const baseUnitName = String(req.body.baseUnitName || 'piece').trim() || 'piece';
    const stockUnits = parseStockUnits(req.body.stockUnits, baseUnitName);

    selections = parseSelections(selections);
    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ error: 'Selections must be a non-empty array' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name required' });
    }

    // validate and normalize selections
    const normalized = [];
    for (const s of selections) {
      if (!s || !s.unit || !s.subUnit) {
        return res.status(400).json({ error: 'Each selection must include unit and subUnit' });
      }
      if (!mongoose.Types.ObjectId.isValid(s.unit) || !mongoose.Types.ObjectId.isValid(s.subUnit)) {
        return res.status(400).json({ error: 'Invalid unit/subUnit id in selections' });
      }

      // validate existence + relationship
      const unit = await ServiceCostUnit.findById(s.unit).lean();
      if (!unit) return res.status(400).json({ error: `Unit ${s.unit} not found` });

      const sub = await ServiceCostSubUnit.findById(s.subUnit).lean();
      if (!sub) return res.status(400).json({ error: `SubUnit ${s.subUnit} not found` });

      if (String(sub.unit) !== String(unit._id)) {
        return res.status(400).json({ error: `SubUnit ${s.subUnit} does not belong to Unit ${s.unit}` });
      }

      normalized.push({
        unit: new mongoose.Types.ObjectId(s.unit),
        subUnit: new mongoose.Types.ObjectId(s.subUnit)
      });
    }

    // compute stable key
    const parts = normalized
      .map(s => `${s.unit.toString()}:${s.subUnit.toString()}`)
      .sort();
    const key = parts.join('|');

    const filter = { key };
    const insertDoc = {
      name: String(name).trim(),
      selections: normalized,
      key,
      baseUnitName,
      stockUnits
    };

    // ✅ IMPORTANT:
    // Avoid relying on findOneAndUpdate(rawResult/lastErrorObject) because Mongoose versions differ.
    // updateOne() reliably exposes upsertedCount/upsertedId.
    const r = await Material.updateOne(
      filter,
      { $setOnInsert: insertDoc },
      { upsert: true }
    );

    // Mongoose/Mongo driver versions return slightly different shapes; support all
    const wasInserted =
      (r && (
        (typeof r.upsertedCount === 'number' && r.upsertedCount > 0) ||
        (r.upsertedId != null) ||
        (r.result && r.result.upserted) ||
        (r.upserted && Array.isArray(r.upserted) && r.upserted.length > 0)
      ));

    if (wasInserted) {
      const populated = await Material.findOne(filter)
        .populate('selections.unit selections.subUnit')
        .lean();

      return res.status(201).json({ ok: true, material: populated });
    }

    // Not inserted => it already exists
    const existing = await Material.findOne(filter)
      .populate('selections.unit selections.subUnit')
      .lean();

    return res.status(409).json({
      error: 'A catalogue with this exact selection already exists',
      existing
    });
  } catch (err) {
    console.error('materials.createCatalogue error', err);
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'A catalogue with this exact selection already exists' });
    }
    return res.status(500).json({ error: err.message || 'Error creating catalogue' });
  }
};

// Remove catalogue (block if used in any store)
exports.removeCatalogue = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });

    const used = await StoreStock.findOne({ material: id, active: true }).lean();
    if (used) {
      return res.status(409).json({ error: 'This catalogue is in one or more stores. Remove it from stores before deleting.' });
    }

    const removed = await Material.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ error: 'Catalogue not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('materials.removeCatalogue error', err);
    return res.status(500).json({ error: 'Error deleting catalogue' });
  }
};

exports.updateCatalogueUnits = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid id' });

    const mat = await Material.findById(id);
    if (!mat) return res.status(404).json({ error: 'Catalogue not found' });

    const baseUnitName = String(req.body.baseUnitName || 'piece').trim() || 'piece';
    const stockUnits = parseStockUnits(req.body.stockUnits, baseUnitName);

    mat.baseUnitName = baseUnitName;
    mat.stockUnits = stockUnits;
    await mat.save();

    const populated = await Material.findById(mat._id)
      .populate('selections.unit selections.subUnit')
      .lean();

    return res.json({ ok: true, material: populated });
  } catch (err) {
    console.error('materials.updateCatalogueUnits error', err);
    return res.status(500).json({ error: err.message || 'Error updating catalogue units' });
  }
};

/* -----------------------------
 * STORES
 * ----------------------------- */

// List stores (JSON)
exports.listStores = async (req, res) => {
  try {
    const stores = await Store.find().sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, stores });
  } catch (err) {
    console.error('materials.listStores error', err);
    return res.status(500).json({ error: 'Error fetching stores' });
  }
};

// Create store (JSON)
exports.createStore = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Store name required' });

    const count = await Store.countDocuments({});
    const doc = await Store.create({ name, isOperational: (count === 0) });

    // If it became the first store, ensure it’s operational
    if (count === 0) {
      await Store.updateMany({ _id: { $ne: doc._id } }, { $set: { isOperational: false } });
    }

    return res.status(201).json({ ok: true, store: doc });
  } catch (err) {
    console.error('materials.createStore error', err);
    if (err && err.code === 11000) return res.status(409).json({ error: 'Store name already exists' });
    return res.status(500).json({ error: 'Error creating store' });
  }
};

// Update store name (JSON)
exports.updateStore = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid store id' });

    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Store name required' });

    const st = await Store.findById(id);
    if (!st) return res.status(404).json({ error: 'Store not found' });

    // If name unchanged, return OK
    if (String(st.name).trim().toLowerCase() === name.toLowerCase()) {
      return res.json({ ok: true, store: { _id: st._id, name: st.name, isOperational: !!st.isOperational } });
    }

    // Check duplicate store name (case-insensitive)
    const dup = await Store.findOne({
      _id: { $ne: st._id },
      name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    }).lean();

    if (dup) return res.status(409).json({ error: 'Another store already has this name' });

    st.name = name;
    await st.save();

    return res.json({ ok: true, store: { _id: st._id, name: st.name, isOperational: !!st.isOperational } });
  } catch (err) {
    console.error('materials.updateStore error', err);
    if (err && err.code === 11000) return res.status(409).json({ error: 'Store name already exists' });
    return res.status(500).json({ error: 'Error updating store' });
  }
};

// Delete store (JSON) — FULL cleanup: stocks + logs + aggregates + operational swap
exports.deleteStore = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid store id' });

    const st = await Store.findById(id).lean();
    if (!st) return res.status(404).json({ error: 'Store not found' });

    const storeCount = await Store.countDocuments({});
    if (storeCount <= 1) {
      return res.status(409).json({ error: 'You cannot delete the last store.' });
    }

    // Collect all stock items belonging to store
    const stocks = await StoreStock.find({ store: id }).select('_id material').lean();
    const stockIds = stocks.map(s => s._id);
    const materialIds = stocks.map(s => s.material).filter(Boolean);

    // ✅ delete logs for those stock items
    if (stockIds.length) {
      await StoreStockAdjustment.deleteMany({ stock: { $in: stockIds } });

      // delete transfers referencing this store's stock items
      await StoreStockTransfer.deleteMany({
        $or: [
          { fromStock: { $in: stockIds } },
          { toStock: { $in: stockIds } },
          // extra safety for older data
          { fromStore: new mongoose.Types.ObjectId(id) },
          { toStore: new mongoose.Types.ObjectId(id) }
        ]
      });
    } else {
      // still clear store-level transfers (older logs may not have fromStock/toStock)
      await StoreStockTransfer.deleteMany({
        $or: [
          { fromStore: new mongoose.Types.ObjectId(id) },
          { toStore: new mongoose.Types.ObjectId(id) }
        ]
      });
    }

    // ✅ delete operational consumption logs + aggregates for this store
    try {
      await MaterialUsage.deleteMany({ store: id });
    } catch (e) {}
    try {
      await MaterialAggregate.deleteMany({ store: id });
    } catch (e) {}
    try {
      await StoreStockLot.deleteMany({ store: id });
    } catch (e) {}

    // ✅ delete the store stock rows
    await StoreStock.deleteMany({ store: id });

    // If it was operational, move operational flag to another store BEFORE deleting
    if (st.isOperational) {
      const replacement = await Store.findOne({ _id: { $ne: id } }).sort({ createdAt: -1 }).lean();
      if (replacement) {
        await Store.updateMany({}, { $set: { isOperational: false } });
        await Store.findByIdAndUpdate(replacement._id, { $set: { isOperational: true } });
      }
    }

    // ✅ delete store
    await Store.findByIdAndDelete(id);

    return res.json({ ok: true });
  } catch (err) {
    console.error('materials.deleteStore error', err);
    return res.status(500).json({ error: 'Error deleting store' });
  }
};


// Set operational store (JSON)
exports.setOperationalStore = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid store id' });

    const st = await Store.findById(id).lean();
    if (!st) return res.status(404).json({ error: 'Store not found' });

    await Store.updateMany({}, { $set: { isOperational: false } });
    await Store.findByIdAndUpdate(id, { $set: { isOperational: true } });

    return res.json({ ok: true, operationalStoreId: id });
  } catch (err) {
    console.error('materials.setOperationalStore error', err);
    return res.status(500).json({ error: 'Error setting operational store' });
  }
};

/* -----------------------------
 * STORE STOCK DASHBOARD (HTML)
 * ----------------------------- */

// Render store stock dashboard page
exports.stockPage = async (req, res) => {
  try {
    const stores = await Store.find().sort({ createdAt: -1 }).lean();
    const operational = await getOperationalStoreLean();

    // Pick selected store: query param -> operational -> first store -> null
    const qStoreId = req.query.storeId;
    let selectedStore = null;

    if (qStoreId && mongoose.Types.ObjectId.isValid(qStoreId)) {
      selectedStore = await Store.findById(qStoreId).lean();
    }
    if (!selectedStore && operational) selectedStore = operational;
    if (!selectedStore && stores.length) selectedStore = stores[0];

    const catalogues = await Material.find().sort({ createdAt: -1 }).lean();
    const suppliers = await Supplier.find().sort({ active: -1, name: 1 }).lean();

    let stocks = [];
    if (selectedStore) {
      const rawStocks = await StoreStock.find({ store: selectedStore._id, active: true })
        .populate({
          path: 'material',
          select: 'name selections baseUnitName stockUnits',
          populate: [
            { path: 'selections.unit', select: 'name' },
            { path: 'selections.subUnit', select: 'name' }
          ]
        })
        .sort({ createdAt: -1 })
        .lean();

      const materialIds = rawStocks.map(s => s.material?._id).filter(Boolean);
      const aggDocs = materialIds.length
        ? await MaterialAggregate.find({ store: selectedStore._id, material: { $in: materialIds } }).lean()
        : [];

      await Promise.all(rawStocks.map(async ss => {
        if (!ss || !ss._id || !ss.material || !ss.material._id) return;
        try {
          await ensureLotsForStock({
            store: selectedStore._id,
            stock: ss._id,
            material: ss.material._id
          });
        } catch (e) {
          console.error('materials.stockPage ensure lots failed', e);
        }
      }));

      const lotDocs = materialIds.length
        ? await StoreStockLot.find({
            store: selectedStore._id,
            material: { $in: materialIds },
            remainingQuantity: { $gt: 0.000001 }
          })
            .select('material lotCode remainingQuantity unitCost sourceType sourceRef purchaseUnitName purchaseUnitFactor purchaseUnitQuantity purchaseUnitCost baseUnitName receivedAt')
            .sort({ material: 1, receivedAt: 1, createdAt: 1, _id: 1 })
            .lean()
        : [];

      const aggMap = {};
      aggDocs.forEach(a => { aggMap[String(a.material)] = Number(a.total || 0); });

      const lotMap = {};
      const preferBaseUnits = !!(selectedStore && selectedStore.isOperational);
      lotDocs.forEach(lot => {
        const mid = String(lot.material || '');
        if (!mid) return;
        const stockForLot = rawStocks.find(s => s.material?._id && String(s.material._id) === mid);
        const materialForLot = stockForLot ? stockForLot.material : null;
        const remainingQty = Number(lot.remainingQuantity || 0);
        if (!lotMap[mid]) lotMap[mid] = [];
        lotMap[mid].push({
          _id: lot._id,
          lotCode: lot.lotCode || '',
          remainingQuantity: remainingQty,
          displayQuantity: formatMaterialQuantity(remainingQty, materialForLot, { preferBase: preferBaseUnits }),
          unitCost: Number(lot.unitCost || 0),
          sourceType: lot.sourceType || '',
          sourceRef: lot.sourceRef || '',
          purchaseUnitName: lot.purchaseUnitName || '',
          purchaseUnitFactor: Number(lot.purchaseUnitFactor || 1),
          purchaseUnitQuantity: Number(lot.purchaseUnitQuantity || 0),
          purchaseUnitCost: Number(lot.purchaseUnitCost || 0),
          baseUnitName: lot.baseUnitName || (materialForLot ? materialForLot.baseUnitName : 'piece'),
          receivedAt: lot.receivedAt || null
        });
      });

      stocks = rawStocks.map(ss => {
        const mid = ss.material?._id ? String(ss.material._id) : null;
        const used = mid ? (aggMap[mid] || 0) : 0;
        const stocked = Number(ss.stocked || 0);
        const remaining = Math.max(0, stocked - used);
        const stockUnits = ss.material ? materialUnits(ss.material) : [];
        const unitDisplayOpts = { preferBase: preferBaseUnits };

        return Object.assign({}, ss, {
          used,
          remaining,
          stockUnits,
          stockedDisplay: ss.material ? formatMaterialQuantity(stocked, ss.material, unitDisplayOpts) : String(stocked),
          usedDisplay: ss.material ? formatMaterialQuantity(used, ss.material, unitDisplayOpts) : String(used),
          remainingDisplay: ss.material ? formatMaterialQuantity(remaining, ss.material, unitDisplayOpts) : String(remaining),
          lotBreakdown: mid ? (lotMap[mid] || []) : []
        });
      });
    }

    return res.render('stock/index', {
      stores,
      selectedStore: selectedStore || null,
      operationalStore: operational || null,
      catalogues,
      suppliers,
      stocks
    });
  } catch (err) {
    console.error('materials.stockPage error', err);
    return res.status(500).send('Error loading stock dashboard');
  }
};

/* -----------------------------
 * STORE STOCK (JSON)
 * ----------------------------- */

// Add catalogue to store (JSON)
exports.addStockToStore = async (req, res) => {
  try {
    const { storeId } = req.params;
    const materialId = req.body.materialId;

    if (!mongoose.Types.ObjectId.isValid(storeId)) return res.status(400).json({ error: 'Invalid store id' });
    if (!mongoose.Types.ObjectId.isValid(materialId)) return res.status(400).json({ error: 'Invalid catalogue id' });

    let stockRaw = req.body.stockInitial;
    stockRaw = (stockRaw === undefined || stockRaw === null || String(stockRaw).trim() === '') ? 0 : Number(stockRaw);
    if (isNaN(stockRaw) || stockRaw < 0) stockRaw = 0;
    const initial = Math.floor(stockRaw);

    const st = await Store.findById(storeId).lean();
    if (!st) return res.status(404).json({ error: 'Store not found' });

    const mat = await Material.findById(materialId).lean();
    if (!mat) return res.status(404).json({ error: 'Catalogue not found' });

    const existing = await StoreStock.findOne({ store: storeId, material: materialId }).lean();
    if (existing && existing.active) {
      return res.status(409).json({ error: 'This catalogue is already added to this store' });
    }

    const up = await StoreStock.findOneAndUpdate(
      { store: storeId, material: materialId },
      { $set: { active: true, stocked: initial } },
      { upsert: true, new: true }
    ).populate('material', 'name selections').lean();

    // attach totals
    const agg = await MaterialAggregate.findOne({ store: storeId, material: materialId }).lean();
    const used = agg ? Number(agg.total || 0) : 0;
    const remaining = Math.max(0, Number(up.stocked || 0) - used);
    // ✅ log "add to store" as a snapshot event
try {
  await StoreStockAdjustment.create({
    stock: up._id,
    store: st._id,
    material: mat._id,
    kind: 'add',
    delta: 0,
    setTo: remaining,
    stockedAfter: Number(up.stocked || 0),
    usedAfter: Number(used || 0),
    note: `Added to store`,
    actor: (req.user && req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : null
  });
} catch (e) {
  console.error('addStockToStore adjustment log failed', e);
}


    return res.status(201).json({ ok: true, stock: Object.assign({}, up, { used, remaining }) });
  } catch (err) {
    console.error('materials.addStockToStore error', err);
    return res.status(500).json({ error: 'Error adding stock to store' });
  }
};

// Purchase stock from a supplier (JSON)
exports.purchaseStock = async (req, res) => {
  let session = null;

  try {
    const { storeId } = req.params;
    const materialId = req.body.materialId;
    const supplierId = req.body.supplierId;
    const paymentType = String(req.body.paymentType || 'cash').toLowerCase().trim() === 'credit' ? 'credit' : 'cash';
    const note = String(req.body.note || '').trim();
    const purchaseQty = Math.floor(Number(req.body.quantity || req.body.qty || 0));
    const purchaseUnitCost = Number(req.body.unitCost || 0);
    const requestedUnitName = String(req.body.purchaseUnitName || req.body.unitName || '').trim();
    const requestedUnitFactor = Number(req.body.purchaseUnitFactor || req.body.unitFactor || 0);

    if (!mongoose.Types.ObjectId.isValid(storeId)) return res.status(400).json({ error: 'Invalid store id' });
    if (!mongoose.Types.ObjectId.isValid(materialId)) return res.status(400).json({ error: 'Invalid catalogue id' });
    if (!mongoose.Types.ObjectId.isValid(supplierId)) return res.status(400).json({ error: 'Invalid supplier id' });
    if (!isFinite(purchaseQty) || purchaseQty <= 0) return res.status(400).json({ error: 'Purchase quantity must be greater than zero' });
    if (!isFinite(purchaseUnitCost) || purchaseUnitCost <= 0) return res.status(400).json({ error: 'Unit cost must be greater than zero' });

    session = await mongoose.startSession();
    let result = null;

    await session.withTransaction(async () => {
      const [store, material, supplier] = await Promise.all([
        Store.findById(storeId).session(session),
        Material.findById(materialId).session(session),
        Supplier.findById(supplierId).session(session)
      ]);

      if (!store) {
        const e = new Error('Store not found');
        e.statusCode = 404;
        throw e;
      }
      if (!material) {
        const e = new Error('Catalogue not found');
        e.statusCode = 404;
        throw e;
      }
      if (!supplier || supplier.active === false) {
        const e = new Error('Supplier not found or inactive');
        e.statusCode = 404;
        throw e;
      }

      const selectedPurchaseUnit = unitForPurchase(material, requestedUnitName, requestedUnitFactor);
      const purchaseUnitFactor = Number(selectedPurchaseUnit.factor || 1);
      const purchaseUnitName = selectedPurchaseUnit.name || material.baseUnitName || 'piece';
      const baseUnitName = material.baseUnitName || 'piece';
      const qty = Number((purchaseQty * purchaseUnitFactor).toFixed(6));
      const preciseUnitCost = roundUnitCost(purchaseUnitCost / purchaseUnitFactor);
      const totalCost = round2(purchaseQty * purchaseUnitCost);

      let cashBookContext = { cashBook: null, meta: {} };
      if (paymentType === 'cash') {
        cashBookContext = await resolvePaymentCashBookContext(req.body, session);
        if (!cashBookContext.cashBook) {
          const e = new Error('Select the cash book used for this purchase');
          e.statusCode = 400;
          throw e;
        }
      }

      const agg = await MaterialAggregate
        .findOne({ store: store._id, material: material._id })
        .session(session)
        .lean();
      const used = agg ? Number(agg.total || 0) : 0;
      let existingStock = await StoreStock.findOne({ store: store._id, material: material._id }).session(session);
      if (existingStock) {
        await ensureLotsForStock({
          store: store._id,
          stock: existingStock._id,
          material: material._id,
          session
        });
        existingStock = await StoreStock.findOne({ store: store._id, material: material._id }).session(session);
      }

      const oldStocked = existingStock ? Number(existingStock.stocked || 0) : 0;
      const oldAverageUnitCost = existingStock ? Number(existingStock.averageUnitCost || 0) : 0;
      const oldRemaining = Math.max(0, oldStocked - used);
      const oldRemainingValue = oldRemaining * oldAverageUnitCost;
      const newAverageUnitCost = oldRemaining + qty > 0
        ? roundUnitCost((oldRemainingValue + totalCost) / (oldRemaining + qty))
        : preciseUnitCost;

      const updatedStock = await StoreStock.findOneAndUpdate(
        { store: store._id, material: material._id },
        {
          $set: {
            active: true,
            averageUnitCost: newAverageUnitCost,
            lastPurchaseUnitCost: preciseUnitCost,
            lastPurchaseAt: new Date()
          },
          $inc: { stocked: qty }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, session }
      );

      const remaining = Math.max(0, Number(updatedStock.stocked || 0) - used);

      const recordedBy = req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null;
      const recordedByName = (req.user?.name || req.user?.username || '').toString();

      const purchaseDocs = await StockPurchase.create([{
        supplier: supplier._id,
        supplierName: supplier.name || '',
        store: store._id,
        storeName: store.name || '',
        stock: updatedStock._id,
        material: material._id,
        materialName: material.name || '',
        quantity: qty,
        unitCost: preciseUnitCost,
        totalCost,
        purchaseUnitName,
        purchaseUnitFactor,
        purchaseUnitQuantity: purchaseQty,
        purchaseUnitCost,
        baseUnitName,
        paymentType,
        cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
        cashBookName: cashBookContext.cashBook ? (cashBookContext.cashBook.name || '') : '',
        cashBookKind: cashBookContext.cashBook ? (cashBookContext.meta?.cashBookKind || cashBookContext.cashBook.kind || 'cash') : null,
        cashMeta: cashBookContext.meta || {},
        note,
        createdBy: recordedBy,
        createdByName: recordedByName
      }], { session });

      const purchase = purchaseDocs[0];

      await createStockLot({
        store: store._id,
        stock: updatedStock._id,
        material: material._id,
        quantity: qty,
        unitCost: preciseUnitCost,
        sourceType: 'purchase',
        sourceId: purchase._id,
        sourceRef: supplier.name || 'Supplier',
        purchaseUnitName,
        purchaseUnitFactor,
        purchaseUnitQuantity: purchaseQty,
        purchaseUnitCost,
        baseUnitName,
        receivedAt: purchase.createdAt || new Date(),
        session
      });

      await recalculateAverageCostFromLots({
        store: store._id,
        stock: updatedStock._id,
        material: material._id,
        session
      });

      await StoreStockAdjustment.create([{
        stock: updatedStock._id,
        store: store._id,
        material: material._id,
        kind: 'purchase',
        delta: qty,
        setTo: remaining,
        stockedAfter: Number(updatedStock.stocked || 0),
        usedAfter: Number(used || 0),
        note: `Purchase from ${supplier.name || 'Supplier'} (${paymentType === 'credit' ? 'credit' : 'cash'})`,
        actor: recordedBy
      }], { session });

      if (paymentType === 'cash') {
        await recordCashBookMovement({
          cashBook: cashBookContext.cashBook,
          type: 'outflow',
          amount: totalCost,
          sourceType: 'stock_purchase',
          sourceId: purchase._id,
          sourceRef: `${material.name || 'Stock'} purchase`,
          note: `Stock purchase from ${supplier.name || 'Supplier'}`,
          meta: Object.assign({}, cashBookContext.meta || {}, {
            supplierId: String(supplier._id),
            supplierName: supplier.name || '',
            storeId: String(store._id),
            materialId: String(material._id),
            quantity: qty,
            unitCost: preciseUnitCost,
            purchaseUnitName,
            purchaseUnitFactor,
            purchaseUnitQuantity: purchaseQty,
            purchaseUnitCost,
            baseUnitName
          }),
          recordedBy,
          recordedByName,
          session
        });
      } else {
        await Supplier.findByIdAndUpdate(
          supplier._id,
          { $inc: { balance: totalCost }, $set: { updatedBy: recordedBy } },
          { session }
        );

        await SupplierAccountTxn.create([{
          supplier: supplier._id,
          type: 'credit',
          amount: totalCost,
          note: `Stock purchase on credit: ${material.name || 'Stock'}`,
          sourceType: 'stock_purchase',
          sourceId: purchase._id,
          sourceRef: `${material.name || 'Stock'} purchase`,
          recordedBy,
          recordedByName
        }], { session });
      }

      await postStockPurchase(purchase, actorFromReq(req), session);

      result = {
        ok: true,
        purchase: {
          _id: purchase._id,
          quantity: qty,
          unitCost: preciseUnitCost,
          totalCost,
          paymentType,
          purchaseUnitName,
          purchaseUnitFactor,
          purchaseUnitQuantity: purchaseQty,
          purchaseUnitCost,
          baseUnitName
        },
        stock: {
          _id: updatedStock._id,
          stocked: Number(updatedStock.stocked || 0),
          used,
          remaining
        }
      };
    });

    return res.status(201).json(result || { ok: true });
  } catch (err) {
    console.error('materials.purchaseStock error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'Error recording stock purchase' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

// Adjust store stock (delta/absolute) (JSON)
exports.adjustStoreStock = async (req, res) => {
  try {
    const { storeId, stockId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) return res.status(400).json({ error: 'Invalid store id' });
    if (!mongoose.Types.ObjectId.isValid(stockId)) return res.status(400).json({ error: 'Invalid stock id' });

    const mode = (req.body.mode === 'absolute') ? 'absolute' : 'delta';

    let valRaw = req.body.stock;
    valRaw = (valRaw === undefined || valRaw === null || String(valRaw).trim() === '') ? 0 : Number(valRaw);
    if (isNaN(valRaw)) return res.status(400).json({ error: 'Invalid stock value' });

    const ss = await StoreStock.findById(stockId).populate('material', 'name selections').lean();
    if (!ss) return res.status(404).json({ error: 'Stock not found' });
    if (String(ss.store) !== String(storeId)) return res.status(403).json({ error: 'Stock does not belong to selected store' });

    const current = Number(ss.stocked || 0);
    let newStocked = current;

    if (mode === 'delta') newStocked = current + Number(valRaw);
    else newStocked = Number(valRaw);

    newStocked = Math.floor(newStocked);
    if (!isFinite(newStocked) || newStocked < 0) return res.status(400).json({ error: 'Resulting stock cannot be negative' });

    const updated = await StoreStock.findByIdAndUpdate(
      stockId,
      { $set: { stocked: newStocked } },
      { new: true }
    ).populate('material', 'name selections').lean();

    // absolute reset => reset used aggregate to 0 for this store+material
    if (mode === 'absolute') {
      await MaterialAggregate.findOneAndUpdate(
        { store: storeId, material: updated.material._id },
        { $set: { total: 0 } },
        { upsert: true, new: true }
      );
    }

    const agg = await MaterialAggregate.findOne({ store: storeId, material: updated.material._id }).lean();
    const used = agg ? Number(agg.total || 0) : 0;
    const remaining = Math.max(0, Number(updated.stocked || 0) - used);

    let stockForResponse = updated;

    // Keep lots aligned with manual adjustments so future order costs use the
    // exact remaining stock layers.
try {
  const deltaVal = (mode === 'delta') ? Math.floor(Number(valRaw) || 0) : 0;

  const adjustmentDoc = await StoreStockAdjustment.create({
    stock: updated._id,
    store: new mongoose.Types.ObjectId(storeId),
    material: updated.material._id,
    kind: (mode === 'absolute') ? 'adjust-absolute' : 'adjust-delta',
    delta: deltaVal,
    setTo: remaining,
    stockedAfter: Number(updated.stocked || 0),
    usedAfter: Number(used || 0),
    note: (mode === 'absolute') ? 'Absolute set (used reset)' : 'Delta adjust',
    actor: (req.user && req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : null
  });

  const lotBalance = await reconcileLotsToRemaining({
    store: new mongoose.Types.ObjectId(storeId),
    stock: updated._id,
    material: updated.material._id,
    targetRemaining: remaining,
    unitCost: roundUnitCost(updated.averageUnitCost || updated.lastPurchaseUnitCost || 0),
    sourceType: 'adjustment',
    sourceId: adjustmentDoc._id,
    sourceRef: (mode === 'absolute') ? 'Absolute stock adjustment' : 'Stock delta adjustment'
  });

  stockForResponse = Object.assign({}, updated, { averageUnitCost: lotBalance.averageUnitCost });
} catch (e) {
  console.error('adjustStoreStock adjustment log failed', e);
}


    return res.json({ ok: true, stock: Object.assign({}, stockForResponse, { used, remaining }) });
  } catch (err) {
    console.error('materials.adjustStoreStock error', err);
    return res.status(500).json({ error: 'Error adjusting stock' });
  }
};

// Transfer stock between stores (JSON)
exports.transferStoreStock = async (req, res) => {
  let session = null;

  try {
    const { storeId, stockId } = req.params;
    const toStoreId = req.body.toStoreId;
    const transferUnitQty = Math.floor(Number(req.body.qty || 0));
    const requestedTransferUnitName = String(req.body.transferUnitName || req.body.unitName || '').trim();
    const requestedTransferUnitFactor = Number(req.body.transferUnitFactor || req.body.unitFactor || 0);

    if (!mongoose.Types.ObjectId.isValid(storeId)) return res.status(400).json({ error: 'Invalid from store id' });
    if (!mongoose.Types.ObjectId.isValid(stockId)) return res.status(400).json({ error: 'Invalid stock id' });
    if (!mongoose.Types.ObjectId.isValid(toStoreId)) return res.status(400).json({ error: 'Invalid destination store id' });

    if (String(storeId) === String(toStoreId)) return res.status(400).json({ error: 'Destination store must be different' });

    if (!isFinite(transferUnitQty) || transferUnitQty <= 0) return res.status(400).json({ error: 'Transfer quantity must be greater than 0' });

    session = await mongoose.startSession();
    let result = null;

    await session.withTransaction(async () => {
      const [fromStore, toStore] = await Promise.all([
        Store.findById(storeId).session(session).lean(),
        Store.findById(toStoreId).session(session).lean()
      ]);
      if (!fromStore) {
        const e = new Error('From store not found');
        e.statusCode = 404;
        throw e;
      }
      if (!toStore) {
        const e = new Error('Destination store not found');
        e.statusCode = 404;
        throw e;
      }

      const fromStock = await StoreStock.findById(stockId)
        .populate('material', 'name selections baseUnitName stockUnits')
        .session(session)
        .lean();
      if (!fromStock) {
        const e = new Error('Stock not found');
        e.statusCode = 404;
        throw e;
      }
      if (String(fromStock.store) !== String(storeId)) {
        const e = new Error('Stock does not belong to selected store');
        e.statusCode = 403;
        throw e;
      }

      const materialId = fromStock.material._id;
      const selectedTransferUnit = unitForPurchase(fromStock.material, requestedTransferUnitName, requestedTransferUnitFactor);
      const transferUnitFactor = Number(selectedTransferUnit.factor || 1);
      const transferUnitName = selectedTransferUnit.name || fromStock.material.baseUnitName || 'piece';
      const qty = Number((transferUnitQty * transferUnitFactor).toFixed(6));

      const agg = await MaterialAggregate.findOne({ store: storeId, material: materialId }).session(session).lean();
      const used = agg ? Number(agg.total || 0) : 0;
      const stocked = Number(fromStock.stocked || 0);
      const remaining = Math.max(0, stocked - used);

      if (qty > remaining) {
        const e = new Error(`Insufficient remaining stock to transfer. Remaining: ${remaining}`);
        e.statusCode = 409;
        throw e;
      }

      const consumedLots = await consumeStockLots({
        store: fromStore._id,
        stock: fromStock._id,
        material: materialId,
        quantity: qty,
        sourceRef: `Transfer to ${toStore.name || 'store'}`,
        session
      });

      const newFromStocked = Math.max(0, stocked - qty);
      const updatedFrom = await StoreStock.findByIdAndUpdate(
        stockId,
        { $set: { stocked: newFromStocked } },
        { new: true, session }
      ).populate('material', 'name selections').lean();

      const transferUnitCost = consumedLots.weightedUnitCost || roundUnitCost(fromStock.averageUnitCost || 0);
      const existingToStock = await StoreStock.findOne({ store: toStoreId, material: materialId }).session(session);
      if (existingToStock) {
        await ensureLotsForStock({
          store: toStore._id,
          stock: existingToStock._id,
          material: materialId,
          session
        });
      }

      const updatedTo = await StoreStock.findOneAndUpdate(
        { store: toStoreId, material: materialId },
        {
          $set: {
            active: true,
            lastPurchaseUnitCost: transferUnitCost,
            lastPurchaseAt: new Date()
          },
          $inc: { stocked: qty }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, session }
      ).populate('material', 'name selections').lean();

      const transferDocs = await StoreStockTransfer.create([{
        material: materialId,
        fromStore: fromStore._id,
        toStore: toStore._id,
        fromStock: updatedFrom._id,
        toStock: updatedTo._id,
        qty,
        transferUnitName,
        transferUnitFactor,
        transferUnitQuantity: transferUnitQty,
        actor: (req.user && req.user._id) ? new mongoose.Types.ObjectId(req.user._id) : null
      }], { session });
      const transfer = transferDocs[0];

      for (const lot of (consumedLots.lots || [])) {
        await createStockLot({
          store: toStore._id,
          stock: updatedTo._id,
          material: materialId,
          quantity: lot.quantity,
          unitCost: lot.unitCost,
          sourceType: 'transfer',
          sourceId: transfer._id,
          sourceRef: `Transfer from ${fromStore.name || 'store'}`,
          parentLot: lot.lot,
          session
        });
      }

      const sourceBalance = await recalculateAverageCostFromLots({
        store: fromStore._id,
        stock: updatedFrom._id,
        material: materialId,
        session
      });
      const destBalance = await recalculateAverageCostFromLots({
        store: toStore._id,
        stock: updatedTo._id,
        material: materialId,
        session
      });

      const agg2 = await MaterialAggregate.findOne({ store: storeId, material: materialId }).session(session).lean();
      const used2 = agg2 ? Number(agg2.total || 0) : 0;
      const remaining2 = Math.max(0, Number(updatedFrom.stocked || 0) - used2);

      result = {
        ok: true,
        from: Object.assign({}, updatedFrom, {
          used: used2,
          remaining: remaining2,
          averageUnitCost: sourceBalance.averageUnitCost
        }),
        to: Object.assign({}, updatedTo, { averageUnitCost: destBalance.averageUnitCost })
      };
    });

    return res.json(result || { ok: true });
  } catch (err) {
    console.error('materials.transferStoreStock error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return res.status(500).json({ error: 'Error transferring stock' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

// Remove stock from store list (soft remove) (JSON)
exports.removeStockFromStore = async (req, res) => {
  try {
    const { storeId, stockId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) return res.status(400).json({ error: 'Invalid store id' });
    if (!mongoose.Types.ObjectId.isValid(stockId)) return res.status(400).json({ error: 'Invalid stock id' });

    const ss = await StoreStock.findById(stockId).lean();
    if (!ss) return res.status(404).json({ error: 'Stock not found' });
    if (String(ss.store) !== String(storeId)) return res.status(403).json({ error: 'Stock does not belong to selected store' });

    const materialId = ss.material;

    // ✅ delete activity logs for THIS stock item
    await StoreStockAdjustment.deleteMany({ stock: stockId });
    await StoreStockTransfer.deleteMany({ $or: [{ fromStock: stockId }, { toStock: stockId }] });

    // ✅ delete operational logs + aggregate for this store/material (so re-adding starts clean)
    await MaterialUsage.deleteMany({ store: storeId, material: materialId });
    await MaterialAggregate.deleteMany({ store: storeId, material: materialId });
    await StoreStockLot.deleteMany({ store: storeId, material: materialId });

    // ✅ delete the stock item itself (no soft remove)
    await StoreStock.findByIdAndDelete(stockId);

    return res.json({ ok: true });
  } catch (err) {
    console.error('materials.removeStockFromStore error', err);
    return res.status(500).json({ error: 'Error removing stock from store' });
  }
};

exports.stockActivity = async (req, res) => {
  try {
    const { storeId, stockId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(storeId)) return res.status(400).json({ error: 'Invalid store id' });
    if (!mongoose.Types.ObjectId.isValid(stockId)) return res.status(400).json({ error: 'Invalid stock id' });

    const ss = await StoreStock.findById(stockId).populate('material', 'name').lean();
    if (!ss) return res.status(404).json({ error: 'Stock not found' });
    if (String(ss.store) !== String(storeId)) return res.status(403).json({ error: 'Stock does not belong to selected store' });

    const store = await Store.findById(storeId).lean();

    // current totals
    const agg = await MaterialAggregate.findOne({ store: storeId, material: ss.material._id }).lean();
    const usedNow = agg ? Number(agg.total || 0) : 0;
    const stockedNow = Number(ss.stocked || 0);
    const remainingNow = Math.max(0, stockedNow - usedNow);

    // --- pull events ---
    const adjustments = await StoreStockAdjustment.find({ stock: stockId })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    const usage = await MaterialUsage.find({ store: storeId, material: ss.material._id })
      .select('orderId itemIndex count createdAt')
      .sort({ createdAt: 1, _id: 1 })
      .limit(2000)
      .lean();

    const transfers = await StoreStockTransfer.find({
      $or: [{ fromStock: stockId }, { toStock: stockId }]
    })
      .populate('fromStore', 'name')
      .populate('toStore', 'name')
      .sort({ createdAt: 1, _id: 1 })
      .limit(2000)
      .lean();

    // --- normalize into a single timeline ---
    const events = [];

    // adjustments are "snapshots" (setTo = remaining after action)
    adjustments.forEach(a => {
      const kind = String(a.kind || '');
      events.push({
        createdAt: a.createdAt,
        type: a.kind,              // add | purchase | adjust-delta | adjust-absolute
        delta: (kind === 'adjust-delta' || kind === 'purchase') ? Number(a.delta || 0) : null,
        setTo: Number(a.setTo || 0),
        details: a.note || ''
      });
    });

    // transfers are deltas to remaining
    transfers.forEach(t => {
      const isOut = String(t.fromStock || '') === String(stockId);
      events.push({
        createdAt: t.createdAt,
        type: isOut ? 'transfer-out' : 'transfer-in',
        delta: isOut ? -Number(t.qty || 0) : Number(t.qty || 0),
        setTo: null,
        details: `${t.fromStore?.name || ''} → ${t.toStore?.name || ''}`
      });
    });

    // operational logs (order consumption) are deltas to remaining
    usage.forEach(u => {
      events.push({
        createdAt: u.createdAt,
        type: 'order-consume',
        delta: -Number(u.count || 0),
        setTo: null,
        details: `Order ${u.orderId || ''} (item ${u.itemIndex})`
      });
    });

    // sort oldest -> newest so it narrates how we reached current
    events.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      if (ta !== tb) return ta - tb;
      return 0;
    });

    // compute running balance (remaining)
    let balance = null;
    for (const ev of events) {
      if (ev.setTo !== null && ev.setTo !== undefined) {
        balance = Number(ev.setTo || 0);
      } else {
        if (balance === null) balance = 0;
        balance = balance + Number(ev.delta || 0);
      }
      ev.balance = balance;
    }

    // If missing older logs, ensure the timeline ends at current remaining
    const lastBal = (events.length ? events[events.length - 1].balance : null);
    if (lastBal === null) {
      // No events at all -> show a single snapshot row
      events.push({
        createdAt: new Date(),
        type: 'current',
        delta: null,
        setTo: remainingNow,
        balance: remainingNow,
        details: 'Current remaining (no activity yet)'
      });
    } else if (Math.floor(lastBal) !== Math.floor(remainingNow)) {
      events.push({
        createdAt: new Date(),
        type: 'reconcile',
        delta: null,
        setTo: remainingNow,
        balance: remainingNow,
        details: 'Reconciled to current remaining'
      });
    }

    return res.json({
      ok: true,
      store: store ? { _id: store._id, name: store.name } : null,
      material: ss.material ? { _id: ss.material._id, name: ss.material.name } : null,
      current: { stocked: stockedNow, used: usedNow, remaining: remainingNow },
      events
    });
  } catch (err) {
    console.error('materials.stockActivity error', err);
    return res.status(500).json({ error: 'Error loading activity' });
  }
};

/* -----------------------------
 * MATERIALS FOR ORDERS PAGE
 * Only operational store is consumable.
 * Only materials added (active) in operational store are returned.
 * ----------------------------- */
exports.listForOrders = async (req, res) => {
  try {
    const op = await getOperationalStoreLean();
    if (!op) {
      return res.status(409).json({ ok: false, error: 'No operational store configured' });
    }

    const stocks = await StoreStock.find({ store: op._id, active: true })
      .populate('material', '_id name selections')
      .lean();

    const materialIds = stocks.map(s => s.material?._id).filter(Boolean);
    const aggDocs = materialIds.length
      ? await MaterialAggregate.find({ store: op._id, material: { $in: materialIds } }).lean()
      : [];

    const aggMap = {};
    aggDocs.forEach(a => { aggMap[String(a.material)] = Number(a.total || 0); });

    const out = stocks
      .filter(s => s.material && s.material._id)
      .map(s => {
        const mid = String(s.material._id);
        const used = aggMap[mid] || 0;
        const stocked = Number(s.stocked || 0);
        const remaining = Math.max(0, stocked - used);

        // selections as ids (strings)
        const selections = (s.material.selections || []).map(sel => ({
          unit: String(sel.unit),
          subUnit: String(sel.subUnit)
        }));

        return { _id: s.material._id, name: s.material.name, stocked, used, remaining, selections };
      });

    return res.json({ ok: true, operationalStore: { _id: op._id, name: op.name }, materials: out });
  } catch (err) {
    console.error('materials.listForOrders error', err);
    return res.status(500).json({ ok: false, error: 'Error fetching materials' });
  }
};
