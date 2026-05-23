const mongoose = require('mongoose');
const StoreStock = require('../models/store_stock');
const StoreStockLot = require('../models/store_stock_lot');
const StockPurchase = require('../models/stock_purchase');
const { MaterialUsage, MaterialAggregate } = require('../models/material_usage');
const { round2, roundUnitCost } = require('./accounting');

const EPS = 0.000001;

function qty(n) {
  const v = Number(n || 0);
  if (!isFinite(v)) return 0;
  return Number(v.toFixed(6));
}

function maybeSession(query, session) {
  return session ? query.session(session) : query;
}

function lotPrefix(sourceType) {
  const s = String(sourceType || '').toLowerCase();
  if (s === 'purchase') return 'PUR';
  if (s === 'transfer') return 'TRF';
  if (s === 'adjustment') return 'ADJ';
  if (s === 'opening') return 'OPN';
  return 'LOT';
}

function buildLotCode(sourceType, sourceId) {
  const suffix = sourceId
    ? String(sourceId).slice(-8).toUpperCase()
    : Date.now().toString(36).toUpperCase();
  return `${lotPrefix(sourceType)}-${suffix}`;
}

async function getStockDoc({ store, stock, material, session = null }) {
  // Mongoose ObjectId exposes an `_id` getter, so only treat `stock` as an
  // already-loaded document when it also carries stock fields.
  if (stock && stock._id && (stock.store || stock.material || stock.stocked !== undefined)) {
    return stock;
  }
  if (stock && mongoose.Types.ObjectId.isValid(stock)) {
    return maybeSession(StoreStock.findById(stock), session);
  }
  if (stock && stock._id && mongoose.Types.ObjectId.isValid(stock._id)) {
    return maybeSession(StoreStock.findById(stock._id), session);
  }
  return maybeSession(StoreStock.findOne({ store, material }), session);
}

async function createStockLot({
  store,
  stock,
  material,
  quantity,
  unitCost,
  sourceType = 'purchase',
  sourceId = null,
  sourceRef = '',
  parentLot = null,
  purchaseUnitName = '',
  purchaseUnitFactor = 1,
  purchaseUnitQuantity = 0,
  purchaseUnitCost = 0,
  baseUnitName = 'piece',
  receivedAt = new Date(),
  session = null
}) {
  const lotQty = qty(quantity);
  if (lotQty <= 0) return null;

  const safeUnitCost = roundUnitCost(unitCost || 0);
  const docs = await StoreStockLot.create([{
    store,
    stock,
    material,
    sourceType,
    sourceId,
    sourceRef,
    parentLot,
    lotCode: buildLotCode(sourceType, sourceId),
    originalQuantity: lotQty,
    remainingQuantity: lotQty,
    unitCost: safeUnitCost,
    totalCost: round2(lotQty * safeUnitCost),
    purchaseUnitName,
    purchaseUnitFactor,
    purchaseUnitQuantity,
    purchaseUnitCost,
    baseUnitName,
    receivedAt,
    active: true
  }], session ? { session } : undefined);

  return docs[0];
}

async function getLotBalance({ store, material, session = null }) {
  const pipeline = [
    {
      $match: {
        store: new mongoose.Types.ObjectId(store),
        material: new mongoose.Types.ObjectId(material),
        remainingQuantity: { $gt: EPS }
      }
    },
    {
      $group: {
        _id: null,
        quantity: { $sum: '$remainingQuantity' },
        value: { $sum: { $multiply: ['$remainingQuantity', '$unitCost'] } }
      }
    }
  ];

  const aggregate = StoreStockLot.aggregate(pipeline);
  if (session) aggregate.session(session);
  const rows = await aggregate;
  const row = rows && rows[0] ? rows[0] : {};
  const quantity = qty(row.quantity || 0);
  const value = Number(row.value || 0);
  return {
    quantity,
    value,
    averageUnitCost: quantity > 0 ? roundUnitCost(value / quantity) : 0
  };
}

async function recalculateAverageCostFromLots({ store, stock = null, material, session = null }) {
  const balance = await getLotBalance({ store, material, session });
  const filter = stock ? { _id: stock } : { store, material };
  await StoreStock.updateOne(
    filter,
    { $set: { averageUnitCost: balance.averageUnitCost } },
    session ? { session } : undefined
  );
  return balance;
}

async function consumeStockLots({
  store,
  stock = null,
  material,
  quantity,
  sourceRef = '',
  session = null,
  skipEnsure = false,
  recalculateAfter = true
}) {
  const needed = qty(quantity);
  if (needed <= 0) {
    return { lots: [], totalQuantity: 0, totalCost: 0, weightedUnitCost: 0 };
  }

  if (!skipEnsure) {
    await ensureLotsForStock({ store, stock, material, session });
  }

  const lots = await maybeSession(
    StoreStockLot.find({
      store,
      material,
      active: true,
      remainingQuantity: { $gt: EPS }
    }).sort({ receivedAt: 1, createdAt: 1, _id: 1 }),
    session
  ).lean();

  const available = qty(lots.reduce((sum, lot) => sum + Number(lot.remainingQuantity || 0), 0));
  if (available + EPS < needed) {
    const e = new Error(`Insufficient stock lots. Needed: ${needed}, Available: ${available}`);
    e.statusCode = 409;
    throw e;
  }

  let remaining = needed;
  let rawValue = 0;
  const consumed = [];

  for (const lot of lots) {
    if (remaining <= EPS) break;

    const take = qty(Math.min(Number(lot.remainingQuantity || 0), remaining));
    if (take <= 0) continue;

    const after = qty(Number(lot.remainingQuantity || 0) - take);
    const unitCost = roundUnitCost(lot.unitCost || 0);
    rawValue += take * unitCost;

    await StoreStockLot.updateOne(
      { _id: lot._id },
      {
        $set: {
          remainingQuantity: after,
          active: after > EPS
        }
      },
      session ? { session } : undefined
    );

    consumed.push({
      lot: lot._id,
      lotCode: lot.lotCode || '',
      quantity: take,
      unitCost,
      totalCost: round2(take * unitCost),
      sourceRef
    });

    remaining = qty(remaining - take);
  }

  const totalQuantity = qty(needed - Math.max(0, remaining));
  const totalCost = round2(rawValue);
  const weightedUnitCost = totalQuantity > 0 ? roundUnitCost(rawValue / totalQuantity) : 0;

  if (recalculateAfter) {
    await recalculateAverageCostFromLots({ store, stock, material, session });
  }

  return { lots: consumed, totalQuantity, totalCost, weightedUnitCost };
}

async function reconcileLotsToRemaining({
  store,
  stock,
  material,
  targetRemaining,
  unitCost = 0,
  sourceType = 'adjustment',
  sourceId = null,
  sourceRef = '',
  session = null
}) {
  const target = qty(Math.max(0, Number(targetRemaining || 0)));
  const balance = await getLotBalance({ store, material, session });
  const diff = qty(target - balance.quantity);

  if (diff > EPS) {
    await createStockLot({
      store,
      stock,
      material,
      quantity: diff,
      unitCost,
      sourceType,
      sourceId,
      sourceRef,
      session
    });
  } else if (diff < -EPS) {
    await consumeStockLots({
      store,
      stock,
      material,
      quantity: Math.abs(diff),
      sourceRef,
      session,
      skipEnsure: true,
      recalculateAfter: false
    });
  }

  return recalculateAverageCostFromLots({ store, stock, material, session });
}

async function ensureLotsForStock({ store, stock = null, material, session = null }) {
  const stockDoc = await getStockDoc({ store, stock, material, session });
  if (!stockDoc) return null;

  const existingLots = await maybeSession(
    StoreStockLot.countDocuments({ store, material }),
    session
  );

  const agg = await maybeSession(
    MaterialAggregate.findOne({ store, material }),
    session
  ).lean();
  const used = Number(agg ? agg.total || 0 : 0);
  const stocked = Number(stockDoc.stocked || 0);
  const targetRemaining = Math.max(0, stocked - used);

  if (existingLots > 0) {
    const balance = await getLotBalance({ store, material, session });
    if (Math.abs(Number(balance.quantity || 0) - targetRemaining) > EPS) {
      await reconcileLotsToRemaining({
        store,
        stock: stockDoc._id,
        material,
        targetRemaining,
        unitCost: roundUnitCost(stockDoc.averageUnitCost || stockDoc.lastPurchaseUnitCost || 0),
        sourceType: 'legacy',
        sourceRef: 'Stock lot reconciliation',
        session
      });
    }
    return stockDoc;
  }

  const purchases = await maybeSession(
    StockPurchase.find({ stock: stockDoc._id })
      .select('_id supplierName quantity unitCost totalCost purchaseUnitName purchaseUnitFactor purchaseUnitQuantity purchaseUnitCost baseUnitName createdAt')
      .sort({ createdAt: 1, _id: 1 }),
    session
  ).lean();

  if (purchases.length) {
    for (const purchase of purchases) {
      const purchaseQty = qty(purchase.quantity || 0);
      if (purchaseQty <= 0) continue;

      const unitCost = roundUnitCost(
        purchase.unitCost || (purchase.totalCost && purchaseQty ? Number(purchase.totalCost) / purchaseQty : 0)
      );

      await createStockLot({
        store,
        stock: stockDoc._id,
        material,
        quantity: purchaseQty,
        unitCost,
        sourceType: 'purchase',
        sourceId: purchase._id,
        sourceRef: purchase.supplierName || 'Legacy purchase',
        purchaseUnitName: purchase.purchaseUnitName || '',
        purchaseUnitFactor: purchase.purchaseUnitFactor || 1,
        purchaseUnitQuantity: purchase.purchaseUnitQuantity || 0,
        purchaseUnitCost: purchase.purchaseUnitCost || 0,
        baseUnitName: purchase.baseUnitName || 'piece',
        receivedAt: purchase.createdAt || new Date(),
        session
      });
    }

    const usages = await maybeSession(
      MaterialUsage.find({ store, material })
        .select('_id count createdAt')
        .sort({ createdAt: 1, _id: 1 }),
      session
    ).lean();

    for (const usage of usages) {
      const usedQty = qty(usage.count || 0);
      if (usedQty <= 0) continue;
      try {
        await consumeStockLots({
          store,
          stock: stockDoc._id,
          material,
          quantity: usedQty,
          sourceRef: 'Legacy material usage',
          session,
          skipEnsure: true,
          recalculateAfter: false
        });
      } catch (e) {
        break;
      }
    }

    await reconcileLotsToRemaining({
      store,
      stock: stockDoc._id,
      material,
      targetRemaining,
      unitCost: roundUnitCost(stockDoc.averageUnitCost || stockDoc.lastPurchaseUnitCost || 0),
      sourceType: 'legacy',
      sourceRef: 'Legacy stock reconciliation',
      session
    });
  } else if (targetRemaining > EPS) {
    await createStockLot({
      store,
      stock: stockDoc._id,
      material,
      quantity: targetRemaining,
      unitCost: roundUnitCost(stockDoc.averageUnitCost || stockDoc.lastPurchaseUnitCost || 0),
      sourceType: 'opening',
      sourceRef: 'Opening stock balance',
      session
    });
  }

  await recalculateAverageCostFromLots({ store, stock: stockDoc._id, material, session });
  return stockDoc;
}

module.exports = {
  createStockLot,
  consumeStockLots,
  ensureLotsForStock,
  getLotBalance,
  reconcileLotsToRemaining,
  recalculateAverageCostFromLots
};
