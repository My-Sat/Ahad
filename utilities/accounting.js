const mongoose = require('mongoose');
const AccountingAccount = require('../models/accounting_account');
const JournalEntry = require('../models/journal_entry');
const FixedAsset = require('../models/fixed_asset');

const ACCOUNTS = {
  CASH: '1000',
  ACCOUNTS_RECEIVABLE: '1100',
  INVENTORY: '1200',
  PREPAID_EXPENSES: '1300',
  FIXED_ASSETS: '1500',
  ACCUMULATED_DEPRECIATION: '1590',
  ACCOUNTS_PAYABLE: '2000',
  ACCRUED_PAYABLES: '2100',
  CUSTOMER_CREDITS: '2200',
  OWNER_CAPITAL: '3000',
  OWNER_DRAWINGS: '3100',
  OPENING_BALANCE_EQUITY: '3200',
  SALES_REVENUE: '4000',
  SUPPLIER_ADJUSTMENT_INCOME: '4050',
  MATERIAL_COST: '5000',
  OUTSOURCED_COST: '5100',
  PRINTER_DEPRECIATION: '5200',
  FIXED_ASSET_DEPRECIATION: '6400',
  RENT_EXPENSE: '6000',
  STAFF_EXPENSE: '6100',
  UTILITIES_EXPENSE: '6200',
  INTERNET_EXPENSE: '6300',
  GENERAL_EXPENSE: '6900'
};

const DEFAULT_ACCOUNTS = [
  { code: ACCOUNTS.CASH, name: 'Cash and Bank Books', type: 'asset', group: 'Current Assets' },
  { code: ACCOUNTS.ACCOUNTS_RECEIVABLE, name: 'Accounts Receivable', type: 'asset', group: 'Current Assets' },
  { code: ACCOUNTS.INVENTORY, name: 'Inventory / Stock', type: 'asset', group: 'Current Assets' },
  { code: ACCOUNTS.PREPAID_EXPENSES, name: 'Prepaid Expenses', type: 'asset', group: 'Current Assets' },
  { code: ACCOUNTS.FIXED_ASSETS, name: 'Fixed Assets', type: 'asset', group: 'Non-current Assets' },
  { code: ACCOUNTS.ACCUMULATED_DEPRECIATION, name: 'Accumulated Depreciation', type: 'asset', group: 'Contra Assets' },
  { code: ACCOUNTS.ACCOUNTS_PAYABLE, name: 'Supplier Payables', type: 'liability', group: 'Current Liabilities' },
  { code: ACCOUNTS.ACCRUED_PAYABLES, name: 'Accrued Payables', type: 'liability', group: 'Current Liabilities' },
  { code: ACCOUNTS.CUSTOMER_CREDITS, name: 'Customer Credits', type: 'liability', group: 'Current Liabilities' },
  { code: ACCOUNTS.OWNER_CAPITAL, name: 'Owner Capital', type: 'equity', group: 'Owner Equity' },
  { code: ACCOUNTS.OWNER_DRAWINGS, name: 'Owner Drawings', type: 'equity', group: 'Contra Equity' },
  { code: ACCOUNTS.OPENING_BALANCE_EQUITY, name: 'Opening Balance Equity', type: 'equity', group: 'Opening Equity' },
  { code: ACCOUNTS.SALES_REVENUE, name: 'Sales Revenue', type: 'revenue', group: 'Revenue' },
  { code: ACCOUNTS.SUPPLIER_ADJUSTMENT_INCOME, name: 'Supplier Debit Adjustments', type: 'revenue', group: 'Other Income' },
  { code: ACCOUNTS.MATERIAL_COST, name: 'Material Cost of Sales', type: 'expense', group: 'Cost of Sales' },
  { code: ACCOUNTS.OUTSOURCED_COST, name: 'Out-sourced Cost of Sales', type: 'expense', group: 'Cost of Sales' },
  { code: ACCOUNTS.PRINTER_DEPRECIATION, name: 'Printer Depreciation', type: 'expense', group: 'Cost of Sales' },
  { code: ACCOUNTS.FIXED_ASSET_DEPRECIATION, name: 'Fixed Asset Depreciation', type: 'expense', group: 'Operating Expenses' },
  { code: ACCOUNTS.RENT_EXPENSE, name: 'Rent Expense', type: 'expense', group: 'Operating Expenses' },
  { code: ACCOUNTS.STAFF_EXPENSE, name: 'Staff Expense', type: 'expense', group: 'Operating Expenses' },
  { code: ACCOUNTS.UTILITIES_EXPENSE, name: 'Utilities / Electricity Expense', type: 'expense', group: 'Operating Expenses' },
  { code: ACCOUNTS.INTERNET_EXPENSE, name: 'Internet / Data Expense', type: 'expense', group: 'Operating Expenses' },
  { code: ACCOUNTS.GENERAL_EXPENSE, name: 'General Expense', type: 'expense', group: 'Operating Expenses' }
];

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function roundUnitCost(n) {
  return Number(Number(n || 0).toFixed(6));
}

function actorFromReq(req) {
  return {
    postedBy: req?.user?._id || null,
    postedByName: req?.user?.name || req?.user?.username || ''
  };
}

async function ensureDefaultAccounts(session = null) {
  const opts = session ? { session } : {};
  for (const acc of DEFAULT_ACCOUNTS) {
    await AccountingAccount.updateOne(
      { code: acc.code },
      { $setOnInsert: Object.assign({}, acc, { system: true, active: true }) },
      Object.assign({ upsert: true }, opts)
    );
  }
}

async function getAccountsMap(codes, session = null) {
  await ensureDefaultAccounts(session);
  const uniqueCodes = Array.from(new Set((codes || []).filter(Boolean).map(String)));
  const query = AccountingAccount.find({ code: { $in: uniqueCodes } });
  if (session) query.session(session);
  const rows = await query.lean();
  const map = {};
  rows.forEach(r => { map[String(r.code)] = r; });
  return map;
}

async function postJournalEntry(options) {
  const opts = options || {};
  const sourceKey = String(opts.sourceKey || '').trim();
  if (!sourceKey) throw new Error('Journal sourceKey is required');

  const existingQuery = JournalEntry.findOne({ sourceKey });
  if (opts.session) existingQuery.session(opts.session);
  const existing = await existingQuery;
  if (existing) return existing;

  const rawLines = Array.isArray(opts.lines) ? opts.lines : [];
  const usableLines = rawLines
    .map(l => Object.assign({}, l, { debit: round2(l.debit), credit: round2(l.credit) }))
    .filter(l => l.accountCode && (l.debit > 0 || l.credit > 0));

  if (usableLines.length < 2) throw new Error('Journal entry requires at least two lines');

  const debitTotal = round2(usableLines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const creditTotal = round2(usableLines.reduce((s, l) => s + Number(l.credit || 0), 0));
  if (Math.abs(debitTotal - creditTotal) > 0.009) {
    throw new Error(`Journal entry is not balanced: debit ${debitTotal}, credit ${creditTotal}`);
  }

  const accounts = await getAccountsMap(usableLines.map(l => l.accountCode), opts.session || null);
  const lines = usableLines.map(l => {
    const acc = accounts[String(l.accountCode)];
    if (!acc) throw new Error(`Accounting account ${l.accountCode} not found`);
    return {
      account: acc._id,
      accountCode: acc.code,
      accountName: acc.name,
      accountType: acc.type,
      debit: round2(l.debit),
      credit: round2(l.credit),
      dimensions: l.dimensions || {}
    };
  });

  const docs = await JournalEntry.create([{
    sourceKey,
    sourceType: String(opts.sourceType || 'manual'),
    sourceId: opts.sourceId || null,
    sourceRef: String(opts.sourceRef || ''),
    date: opts.date || new Date(),
    memo: String(opts.memo || ''),
    lines,
    postedBy: opts.postedBy || null,
    postedByName: opts.postedByName || ''
  }], opts.session ? { session: opts.session } : {});

  return docs[0];
}

async function postOrderRevenue(order, actor = {}, session = null) {
  if (!order || !order._id || !order.orderId) return null;
  const amount = round2(order.total);
  if (amount <= 0) return null;

  return postJournalEntry({
    sourceKey: `order:${order.orderId}:revenue`,
    sourceType: 'order_revenue',
    sourceId: order._id,
    sourceRef: order.orderId,
    date: order.createdAt || new Date(),
    memo: `Revenue recognized for order ${order.orderId}`,
    postedBy: actor.postedBy || null,
    postedByName: actor.postedByName || '',
    session,
    lines: [
      {
        accountCode: ACCOUNTS.ACCOUNTS_RECEIVABLE,
        debit: amount,
        dimensions: { orderId: order.orderId, customerId: order.customer || null }
      },
      {
        accountCode: ACCOUNTS.SALES_REVENUE,
        credit: amount,
        dimensions: { orderId: order.orderId, customerId: order.customer || null }
      }
    ]
  });
}

async function postOrderPayment(order, payment, actor = {}, session = null) {
  if (!order || !payment || !order.orderId) return null;
  const paymentId = payment._id ? String(payment._id) : `${order.orderId}:${payment.createdAt || Date.now()}:${payment.amount}`;
  const amount = round2(payment.amount);
  const meta = payment.meta || {};
  const receivedAmount = round2(meta.receivedAmount || amount);
  const creditExcess = round2(meta.creditExcess || Math.max(0, receivedAmount - amount));
  if (amount <= 0 && receivedAmount <= 0) return null;

  const debitLines = [];
  if (String(payment.method || '').toLowerCase() === 'account') {
    debitLines.push({
      accountCode: ACCOUNTS.CUSTOMER_CREDITS,
      debit: amount,
      dimensions: { orderId: order.orderId, customerId: order.customer || null }
    });
  } else if (receivedAmount > 0) {
    debitLines.push({
      accountCode: ACCOUNTS.CASH,
      debit: receivedAmount,
      dimensions: {
        orderId: order.orderId,
        cashBookId: payment.cashBook || meta.cashBookId || null,
        cashBookName: payment.cashBookName || meta.cashBookName || ''
      }
    });
  }

  const lines = debitLines.concat([
    {
      accountCode: ACCOUNTS.ACCOUNTS_RECEIVABLE,
      credit: amount,
      dimensions: { orderId: order.orderId, customerId: order.customer || null }
    }
  ]);

  if (creditExcess > 0) {
    lines.push({
      accountCode: ACCOUNTS.CUSTOMER_CREDITS,
      credit: creditExcess,
      dimensions: { orderId: order.orderId, customerId: order.customer || null }
    });
  }

  return postJournalEntry({
    sourceKey: `order:${order.orderId}:payment:${paymentId}`,
    sourceType: 'order_payment',
    sourceId: order._id,
    sourceRef: order.orderId,
    date: payment.createdAt || new Date(),
    memo: `Payment for order ${order.orderId}`,
    postedBy: actor.postedBy || payment.recordedBy || null,
    postedByName: actor.postedByName || payment.recordedByName || '',
    session,
    lines
  });
}

async function postStockPurchase(purchase, actor = {}, session = null) {
  if (!purchase || !purchase._id) return null;
  const amount = round2(purchase.totalCost);
  if (amount <= 0) return null;

  const creditAccount = String(purchase.paymentType || '').toLowerCase() === 'credit'
    ? ACCOUNTS.ACCOUNTS_PAYABLE
    : ACCOUNTS.CASH;

  return postJournalEntry({
    sourceKey: `stock_purchase:${purchase._id}`,
    sourceType: 'stock_purchase',
    sourceId: purchase._id,
    sourceRef: purchase.materialName || String(purchase._id),
    date: purchase.createdAt || new Date(),
    memo: `Stock purchase: ${purchase.materialName || 'Stock'}`,
    postedBy: actor.postedBy || purchase.createdBy || null,
    postedByName: actor.postedByName || purchase.createdByName || '',
    session,
    lines: [
      {
        accountCode: ACCOUNTS.INVENTORY,
        debit: amount,
        dimensions: {
          supplierId: purchase.supplier || null,
          storeId: purchase.store || null,
          materialId: purchase.material || null
        }
      },
      {
        accountCode: creditAccount,
        credit: amount,
        dimensions: {
          supplierId: purchase.supplier || null,
          cashBookId: purchase.cashBook || null,
          cashBookName: purchase.cashBookName || ''
        }
      }
    ]
  });
}

async function postMaterialUsageCost(usage, actor = {}, session = null) {
  if (!usage || !usage._id) return null;
  const amount = round2(usage.totalCost);
  if (amount <= 0) return null;

  return postJournalEntry({
    sourceKey: `material_usage:${usage._id}`,
    sourceType: 'material_usage',
    sourceId: usage._id,
    sourceRef: usage.orderId || String(usage._id),
    date: usage.createdAt || new Date(),
    memo: `Material consumed for order ${usage.orderId || ''}`.trim(),
    postedBy: actor.postedBy || null,
    postedByName: actor.postedByName || '',
    session,
    lines: [
      {
        accountCode: ACCOUNTS.MATERIAL_COST,
        debit: amount,
        dimensions: {
          orderId: usage.orderId || '',
          orderRef: usage.orderRef || null,
          storeId: usage.store || null,
          materialId: usage.material || null
        }
      },
      {
        accountCode: ACCOUNTS.INVENTORY,
        credit: amount,
        dimensions: {
          orderId: usage.orderId || '',
          orderRef: usage.orderRef || null,
          storeId: usage.store || null,
          materialId: usage.material || null
        }
      }
    ]
  });
}

async function postOutsourcedCost(order, artistId, amount, actor = {}, session = null) {
  if (!order || !order._id || !artistId) return null;
  const cost = round2(amount);
  if (cost <= 0) return null;

  return postJournalEntry({
    sourceKey: `order:${order.orderId}:outsourced:${artistId}`,
    sourceType: 'outsourced_cost',
    sourceId: order._id,
    sourceRef: order.orderId,
    date: order.createdAt || new Date(),
    memo: `Out-sourced cost for order ${order.orderId}`,
    postedBy: actor.postedBy || null,
    postedByName: actor.postedByName || '',
    session,
    lines: [
      {
        accountCode: ACCOUNTS.OUTSOURCED_COST,
        debit: cost,
        dimensions: { orderId: order.orderId, artistId }
      },
      {
        accountCode: ACCOUNTS.CUSTOMER_CREDITS,
        credit: cost,
        dimensions: { orderId: order.orderId, artistId }
      }
    ]
  });
}

async function postPrinterDepreciation(usage, actor = {}, session = null) {
  if (!usage || !usage._id || !usage.printer) return null;
  const sourceKey = `printer_usage:${usage._id}:depreciation`;
  const existingQuery = JournalEntry.findOne({ sourceKey });
  if (session) existingQuery.session(session);
  const existing = await existingQuery;
  if (existing) return existing;

  const count = Math.max(0, Number(usage.count || 0));
  if (count <= 0) return null;

  const query = FixedAsset.findOne({
    printer: usage.printer,
    active: true,
    depreciationMethod: 'usage',
    usefulLifeUnits: { $gt: 0 }
  }).sort({ purchaseDate: 1, _id: 1 });
  if (session) query.session(session);
  const asset = await query;
  if (!asset) return null;

  const depreciableCost = Math.max(0, Number(asset.purchaseCost || 0) - Number(asset.residualValue || 0));
  const remainingDepreciable = Math.max(0, depreciableCost - Number(asset.accumulatedDepreciation || 0));
  if (remainingDepreciable <= 0) return null;

  const perUnit = depreciableCost > 0 && Number(asset.usefulLifeUnits || 0) > 0
    ? depreciableCost / Number(asset.usefulLifeUnits || 1)
    : 0;
  const depreciation = round2(Math.min(remainingDepreciable, count * perUnit));
  if (depreciation <= 0) return null;

  asset.accumulatedDepreciation = round2(Number(asset.accumulatedDepreciation || 0) + depreciation);
  await asset.save(session ? { session } : {});

  if (usage.depreciationCost !== undefined) {
    usage.depreciationCost = depreciation;
    if (typeof usage.save === 'function') {
      await usage.save(session ? { session } : {});
    }
  }

  return postJournalEntry({
    sourceKey,
    sourceType: 'printer_depreciation',
    sourceId: usage._id,
    sourceRef: usage.orderId || String(usage._id),
    date: usage.createdAt || new Date(),
    memo: `Printer depreciation for ${usage.orderId || asset.name}`,
    postedBy: actor.postedBy || null,
    postedByName: actor.postedByName || '',
    session,
    lines: [
      {
        accountCode: ACCOUNTS.PRINTER_DEPRECIATION,
        debit: depreciation,
        dimensions: {
          orderId: usage.orderId || '',
          printerId: usage.printer || null,
          fixedAssetId: asset._id
        }
      },
      {
        accountCode: ACCOUNTS.ACCUMULATED_DEPRECIATION,
        credit: depreciation,
        dimensions: {
          orderId: usage.orderId || '',
          printerId: usage.printer || null,
          fixedAssetId: asset._id
        }
      }
    ]
  });
}

module.exports = {
  ACCOUNTS,
  DEFAULT_ACCOUNTS,
  actorFromReq,
  ensureDefaultAccounts,
  postJournalEntry,
  postOrderRevenue,
  postOrderPayment,
  postStockPurchase,
  postMaterialUsageCost,
  postOutsourcedCost,
  postPrinterDepreciation,
  round2,
  roundUnitCost
};
