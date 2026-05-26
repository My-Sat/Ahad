const mongoose = require('mongoose');
const crypto = require('crypto');
const AccountingAccount = require('../models/accounting_account');
const JournalEntry = require('../models/journal_entry');
const ExpenseCategory = require('../models/expense_category');
const ManualExpense = require('../models/manual_expense');
const PrepaidRelease = require('../models/prepaid_release');
const AccruedExpensePayment = require('../models/accrued_expense_payment');
const FixedAsset = require('../models/fixed_asset');
const EquityTransaction = require('../models/equity_transaction');
const CashBook = require('../models/cash_book');
const Printer = require('../models/printer');
const {
  resolvePaymentCashBookContext,
  recordCashBookMovement
} = require('../utilities/cash_books');
const {
  ACCOUNTS,
  actorFromReq,
  ensureDefaultAccounts,
  postJournalEntry,
  round2
} = require('../utilities/accounting');

const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Rent', accountCode: ACCOUNTS.RENT_EXPENSE },
  { name: 'Staff Payments', accountCode: ACCOUNTS.STAFF_EXPENSE },
  { name: 'Electricity / Utilities', accountCode: ACCOUNTS.UTILITIES_EXPENSE },
  { name: 'Internet Data', accountCode: ACCOUNTS.INTERNET_EXPENSE },
  { name: 'General Expense', accountCode: ACCOUNTS.GENERAL_EXPENSE }
];

function parseDateStart(dstr) {
  if (!dstr) return null;
  const d = new Date(`${dstr}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

function parseDateEnd(dstr) {
  if (!dstr) return null;
  const d = new Date(`${dstr}T23:59:59.999Z`);
  return isNaN(d.getTime()) ? null : d;
}

function isoDate(d) {
  const dt = d ? new Date(d) : new Date();
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getRange(req) {
  const today = new Date();
  const start = parseDateStart(req.query.from) || new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = parseDateEnd(req.query.to) || new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end, from: isoDate(start), to: isoDate(end) };
}

function monthStartUTC(date) {
  const d = date ? new Date(date) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function nextMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function monthKeyUTC(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function depreciationPostingDate(monthDate, asOfDate) {
  const monthEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return monthEnd > asOfDate ? asOfDate : monthEnd;
}

function truthyInput(value) {
  const v = String(value || '').toLowerCase().trim();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

async function ensureDefaultExpenseCategories() {
  await ensureDefaultAccounts();
  for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
    await ExpenseCategory.updateOne(
      { name: cat.name },
      { $setOnInsert: Object.assign({}, cat, { active: true, system: true }) },
      { upsert: true }
    );
  }
}

function depreciationExpenseAccountForAsset(asset) {
  return asset && asset.printer
    ? ACCOUNTS.PRINTER_DEPRECIATION
    : ACCOUNTS.FIXED_ASSET_DEPRECIATION;
}

const FIXED_ASSET_CODE_LENGTH = 4;
const FIXED_ASSET_CODE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FIXED_ASSET_CODE_DIGITS = '0123456789';

function fixedAssetCodeFromId(id, attempt = 0) {
  const hash = crypto
    .createHash('sha1')
    .update(`${id}:${attempt}`)
    .digest();

  return [
    FIXED_ASSET_CODE_LETTERS[hash[0] % FIXED_ASSET_CODE_LETTERS.length],
    FIXED_ASSET_CODE_LETTERS[hash[1] % FIXED_ASSET_CODE_LETTERS.length],
    FIXED_ASSET_CODE_DIGITS[hash[2] % FIXED_ASSET_CODE_DIGITS.length],
    FIXED_ASSET_CODE_DIGITS[hash[3] % FIXED_ASSET_CODE_DIGITS.length]
  ].join('').slice(0, FIXED_ASSET_CODE_LENGTH);
}

async function uniqueFixedAssetCodeForId(id, session = null, excludeId = null) {
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const code = fixedAssetCodeFromId(id, attempt);
    const filter = { code };
    if (excludeId) filter._id = { $ne: excludeId };
    const query = FixedAsset.exists(filter);
    if (session) query.session(session);
    const exists = await query;
    if (!exists) return code;
  }

  const e = new Error('Unable to generate a unique fixed asset code');
  e.statusCode = 500;
  throw e;
}

async function newFixedAssetIdentity(session = null) {
  const _id = new mongoose.Types.ObjectId();
  return {
    _id,
    code: await uniqueFixedAssetCodeForId(_id, session)
  };
}

async function ensureFixedAssetCodes() {
  const needsCode = await FixedAsset.find({
    $or: [
      { code: { $exists: false } },
      { code: null },
      { code: '' },
      { code: /^FA-/i },
      { code: { $not: /^[A-Z0-9]{4}$/ } },
      { code: { $not: /[A-Z]/ } },
      { code: { $not: /\d/ } }
    ]
  }).select('_id').limit(500);

  for (const asset of needsCode) {
    const code = await uniqueFixedAssetCodeForId(asset._id, null, asset._id);
    await FixedAsset.updateOne(
      {
        _id: asset._id
      },
      { $set: { code } }
    );
  }
}

async function repairFixedAssetDepreciationAccounts() {
  const accounts = await AccountingAccount.find({
    code: { $in: [ACCOUNTS.PRINTER_DEPRECIATION, ACCOUNTS.FIXED_ASSET_DEPRECIATION] }
  }).lean();
  const accountByCode = {};
  accounts.forEach(acc => { accountByCode[String(acc.code)] = acc; });

  const assets = await FixedAsset.find({ depreciationMethod: 'straight_line' })
    .select('_id printer')
    .lean();

  for (const asset of assets) {
    const desiredCode = depreciationExpenseAccountForAsset(asset);
    const desiredAccount = accountByCode[desiredCode];
    if (!desiredAccount) continue;

    await JournalEntry.updateMany(
      { sourceType: 'fixed_asset_depreciation', sourceId: asset._id },
      {
        $set: {
          'lines.$[line].account': desiredAccount._id,
          'lines.$[line].accountCode': desiredAccount.code,
          'lines.$[line].accountName': desiredAccount.name,
          'lines.$[line].accountType': desiredAccount.type
        }
      },
      {
        arrayFilters: [
          { 'line.debit': { $gt: 0 }, 'line.accountType': 'expense' }
        ]
      }
    );
  }
}

async function postDueStraightLineDepreciation(asOf = new Date(), actor = {}) {
  await ensureDefaultAccounts();
  await repairFixedAssetDepreciationAccounts();

  const requestedCutoff = asOf && !isNaN(new Date(asOf).getTime()) ? new Date(asOf) : new Date();
  const now = new Date();
  const cutoff = requestedCutoff > now ? now : requestedCutoff;
  const cutoffMonth = monthStartUTC(cutoff);
  const assets = await FixedAsset.find({
    active: true,
    depreciationMethod: 'straight_line',
    usefulLifeMonths: { $gt: 0 }
  }).sort({ purchaseDate: 1, _id: 1 });

  let posted = 0;
  let skipped = 0;

  for (const asset of assets) {
    const purchaseDate = asset.purchaseDate ? new Date(asset.purchaseDate) : null;
    if (!purchaseDate || isNaN(purchaseDate.getTime()) || purchaseDate > cutoff) {
      skipped += 1;
      continue;
    }

    const usefulLifeMonths = Number(asset.usefulLifeMonths || 0);
    const depreciable = Math.max(0, Number(asset.purchaseCost || 0) - Number(asset.residualValue || 0));
    if (usefulLifeMonths <= 0 || depreciable <= 0) {
      skipped += 1;
      continue;
    }

    const monthlyDepreciation = round2(depreciable / usefulLifeMonths);
    if (monthlyDepreciation <= 0) {
      skipped += 1;
      continue;
    }

    let cursor = monthStartUTC(purchaseDate);
    while (cursor <= cutoffMonth) {
      const remaining = round2(Math.max(0, depreciable - Number(asset.accumulatedDepreciation || 0)));
      if (remaining <= 0) break;

      const monthKey = monthKeyUTC(cursor);
      const sourceKey = `fixed_asset:${asset._id}:depreciation:${monthKey}`;
      const existing = await JournalEntry.exists({ sourceKey });
      if (existing) {
        cursor = nextMonthUTC(cursor);
        continue;
      }

      const depreciation = round2(Math.min(remaining, monthlyDepreciation));
      if (depreciation <= 0) break;
      const expenseAccount = depreciationExpenseAccountForAsset(asset);

      try {
        await postJournalEntry({
          sourceKey,
          sourceType: 'fixed_asset_depreciation',
          sourceId: asset._id,
          sourceRef: asset.name,
          date: depreciationPostingDate(cursor, cutoff),
          memo: `Automatic monthly depreciation: ${asset.name}`,
          postedBy: actor.postedBy || null,
          postedByName: actor.postedByName || 'System',
          lines: [
            { accountCode: expenseAccount, debit: depreciation, dimensions: { fixedAssetId: asset._id, printerId: asset.printer || null, automatic: true, month: monthKey } },
            { accountCode: ACCOUNTS.ACCUMULATED_DEPRECIATION, credit: depreciation, dimensions: { fixedAssetId: asset._id, printerId: asset.printer || null, automatic: true, month: monthKey } }
          ]
        });

        asset.accumulatedDepreciation = round2(Number(asset.accumulatedDepreciation || 0) + depreciation);
        await asset.save();
        posted += 1;
      } catch (err) {
        if (err && err.code === 11000) {
          cursor = nextMonthUTC(cursor);
          continue;
        }
        throw err;
      }

      cursor = nextMonthUTC(cursor);
    }
  }

  return { posted, skipped };
}

async function postDuePrepaidReleases(asOf = new Date(), actor = {}) {
  await ensureDefaultAccounts();

  const requestedCutoff = asOf && !isNaN(new Date(asOf).getTime()) ? new Date(asOf) : new Date();
  const now = new Date();
  const cutoff = requestedCutoff > now ? now : requestedCutoff;
  const cutoffMonth = monthStartUTC(cutoff);
  const prepaids = await ManualExpense.find({
    treatment: 'prepaid',
    autoReleaseEnabled: true,
    releaseMonths: { $gt: 0 }
  }).sort({ date: 1, _id: 1 });

  let posted = 0;
  let skipped = 0;

  for (const prepaid of prepaids) {
    const startDate = prepaid.date ? new Date(prepaid.date) : null;
    if (!startDate || isNaN(startDate.getTime()) || startDate > cutoff) {
      skipped += 1;
      continue;
    }

    const totalAmount = round2(prepaid.amount || 0);
    const releaseMonths = Math.max(0, Math.floor(Number(prepaid.releaseMonths || 0)));
    if (totalAmount <= 0 || releaseMonths <= 0) {
      skipped += 1;
      continue;
    }

    const monthlyRelease = round2(totalAmount / releaseMonths);
    if (monthlyRelease <= 0) {
      skipped += 1;
      continue;
    }

    let cursor = monthStartUTC(startDate);
    let scheduleIndex = 0;
    while (cursor <= cutoffMonth && scheduleIndex < releaseMonths) {
      const remaining = round2(Math.max(0, totalAmount - Number(prepaid.releasedAmount || 0)));
      if (remaining <= 0) break;

      const monthKey = monthKeyUTC(cursor);
      const sourceKey = `prepaid_release:auto:${prepaid._id}:${monthKey}`;
      const existing = await PrepaidRelease.exists({ sourceKey });
      if (existing) {
        scheduleIndex += 1;
        cursor = nextMonthUTC(cursor);
        continue;
      }

      const isLastScheduledMonth = scheduleIndex === releaseMonths - 1;
      const releaseAmount = round2(Math.min(remaining, isLastScheduledMonth ? remaining : monthlyRelease));
      if (releaseAmount <= 0) break;

      try {
        const docs = await PrepaidRelease.create([{
          prepaidExpense: prepaid._id,
          sourceKey,
          category: prepaid.category || null,
          categoryName: prepaid.categoryName || '',
          accountCode: prepaid.accountCode || ACCOUNTS.GENERAL_EXPENSE,
          description: prepaid.description || '',
          amount: releaseAmount,
          date: depreciationPostingDate(cursor, cutoff),
          autoRelease: true,
          monthKey,
          note: `Automatic prepaid release (${monthKey})`,
          recordedBy: actor.postedBy || null,
          recordedByName: actor.postedByName || 'System'
        }]);
        const release = docs[0];

        prepaid.releasedAmount = round2(Number(prepaid.releasedAmount || 0) + releaseAmount);
        await prepaid.save();

        await postJournalEntry({
          sourceKey,
          sourceType: 'prepaid_release',
          sourceId: release._id,
          sourceRef: prepaid.description || String(prepaid._id),
          date: release.date,
          memo: `Automatic prepaid release: ${prepaid.description || ''}`.trim(),
          postedBy: actor.postedBy || null,
          postedByName: actor.postedByName || 'System',
          lines: [
            {
              accountCode: prepaid.accountCode || ACCOUNTS.GENERAL_EXPENSE,
              debit: releaseAmount,
              dimensions: {
                manualExpenseId: prepaid._id,
                prepaidReleaseId: release._id,
                categoryId: prepaid.category || null,
                automatic: true,
                month: monthKey
              }
            },
            {
              accountCode: ACCOUNTS.PREPAID_EXPENSES,
              credit: releaseAmount,
              dimensions: {
                manualExpenseId: prepaid._id,
                prepaidReleaseId: release._id,
                categoryId: prepaid.category || null,
                automatic: true,
                month: monthKey
              }
            }
          ]
        });

        posted += 1;
      } catch (err) {
        if (err && err.code === 11000) {
          scheduleIndex += 1;
          cursor = nextMonthUTC(cursor);
          continue;
        }
        throw err;
      }

      scheduleIndex += 1;
      cursor = nextMonthUTC(cursor);
    }
  }

  return { posted, skipped };
}

function serializePrepaid(expense) {
  const amount = round2(expense.amount || 0);
  const releasedAmount = round2(expense.releasedAmount || 0);
  return {
    _id: expense._id,
    date: expense.date,
    description: expense.description || '',
    categoryName: expense.categoryName || '',
    accountCode: expense.accountCode || ACCOUNTS.GENERAL_EXPENSE,
    amount,
    releasedAmount,
    autoReleaseEnabled: !!expense.autoReleaseEnabled,
    releaseMonths: Number(expense.releaseMonths || 0),
    remainingAmount: round2(Math.max(0, amount - releasedAmount))
  };
}

function serializePrepaidRelease(release) {
  return {
    _id: release._id,
    prepaidExpense: release.prepaidExpense,
    date: release.date,
    description: release.description || '',
    categoryName: release.categoryName || '',
    amount: round2(release.amount || 0),
    autoRelease: !!release.autoRelease,
    monthKey: release.monthKey || '',
    note: release.note || '',
    recordedByName: release.recordedByName || ''
  };
}

function serializeAccrued(expense) {
  const amount = round2(expense.amount || 0);
  const paidAmount = round2(expense.paidAmount || 0);
  return {
    _id: expense._id,
    date: expense.date,
    description: expense.description || '',
    categoryName: expense.categoryName || '',
    accountCode: expense.accountCode || ACCOUNTS.GENERAL_EXPENSE,
    amount,
    paidAmount,
    remainingAmount: round2(Math.max(0, amount - paidAmount)),
    paid: !!expense.paid
  };
}

function serializeAccruedPayment(payment) {
  return {
    _id: payment._id,
    accruedExpense: payment.accruedExpense,
    date: payment.date,
    description: payment.description || '',
    categoryName: payment.categoryName || '',
    amount: round2(payment.amount || 0),
    cashBookName: payment.cashBookName || '',
    cashBookKind: payment.cashBookKind || '',
    note: payment.note || '',
    recordedByName: payment.recordedByName || ''
  };
}

function serializeEquityTransaction(txn) {
  return {
    _id: txn._id,
    type: txn.type || '',
    accountCode: txn.accountCode || '',
    accountName: txn.accountName || '',
    accountType: txn.accountType || '',
    accountGroup: txn.accountGroup || '',
    description: txn.description || '',
    amount: round2(txn.amount || 0),
    date: txn.date,
    cashBookName: txn.cashBookName || '',
    fixedAsset: txn.fixedAsset || null,
    fixedAssetName: txn.fixedAssetName || '',
    createdByName: txn.createdByName || ''
  };
}

function allowedEquityAccountTypes(type) {
  const t = String(type || '').trim();
  if (t === 'opening_liability') return ['liability'];
  return ['asset'];
}

function equityEntryLabel(type) {
  const labels = {
    owner_capital: 'Owner capital / investment',
    owner_drawing: 'Owner drawing / withdrawal',
    opening_asset: 'Opening asset balance',
    opening_liability: 'Opening liability balance'
  };
  return labels[String(type || '')] || 'Equity entry';
}

async function getAccountBalancesAsOf(end) {
  const [accounts, balances] = await Promise.all([
    AccountingAccount.find({ active: true }).sort({ code: 1 }).lean(),
    JournalEntry.aggregate([
      { $match: { date: { $lte: end } } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.accountCode',
          name: { $first: '$lines.accountName' },
          type: { $first: '$lines.accountType' },
          debit: { $sum: '$lines.debit' },
          credit: { $sum: '$lines.credit' }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  const byCode = new Map();
  balances.forEach(row => {
    byCode.set(String(row._id || ''), {
      code: String(row._id || ''),
      name: row.name || '',
      type: row.type || '',
      group: '',
      debit: round2(row.debit || 0),
      credit: round2(row.credit || 0)
    });
  });

  const rows = accounts.map(account => {
    const balance = byCode.get(String(account.code)) || {};
    byCode.delete(String(account.code));
    return {
      code: account.code,
      name: account.name,
      type: account.type,
      group: account.group || '',
      debit: round2(balance.debit || 0),
      credit: round2(balance.credit || 0)
    };
  });

  byCode.forEach(balance => {
    rows.push({
      code: balance.code,
      name: balance.name || 'Unknown account',
      type: balance.type || '',
      group: balance.group || '',
      debit: round2(balance.debit || 0),
      credit: round2(balance.credit || 0)
    });
  });

  rows.sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
  return rows;
}

function normalBalanceAmount(row) {
  const debit = Number(row.debit || 0);
  const credit = Number(row.credit || 0);
  if (['liability', 'equity', 'revenue'].includes(String(row.type || ''))) {
    return round2(credit - debit);
  }
  return round2(debit - credit);
}

exports.page = async (req, res) => {
  try {
    await ensureDefaultExpenseCategories();
    await postDueStraightLineDepreciation(new Date(), actorFromReq(req));
    await postDuePrepaidReleases(new Date(), actorFromReq(req));
    await ensureFixedAssetCodes();
    const [categories, cashBooks, printers, accounts, assets, expenses, accruedExpenses, accruedPayments, prepaids, prepaidReleases, equityTransactions, entries] = await Promise.all([
      ExpenseCategory.find({ active: true }).sort({ name: 1 }).lean(),
      CashBook.find({ active: true }).sort({ name: 1 }).lean(),
      Printer.find().sort({ name: 1 }).lean(),
      AccountingAccount.find({ active: true, type: { $in: ['asset', 'liability', 'equity'] } }).sort({ code: 1 }).lean(),
      FixedAsset.find().populate('printer', 'name').sort({ createdAt: -1 }).limit(100).lean(),
      ManualExpense.find().sort({ date: -1, createdAt: -1 }).limit(100).lean(),
      ManualExpense.find({ treatment: 'accrued' }).sort({ date: -1, createdAt: -1 }).limit(200).lean(),
      AccruedExpensePayment.find().sort({ date: -1, createdAt: -1 }).limit(100).lean(),
      ManualExpense.find({ treatment: 'prepaid' }).sort({ date: -1, createdAt: -1 }).limit(200).lean(),
      PrepaidRelease.find().sort({ date: -1, createdAt: -1 }).limit(100).lean(),
      EquityTransaction.find().sort({ date: -1, createdAt: -1 }).limit(100).lean(),
      JournalEntry.find().sort({ createdAt: -1, _id: -1 }).limit(50).lean()
    ]);

    return res.render('accounting/index', {
      title: 'Accounting',
      categories,
      cashBooks,
      printers,
      accounts,
      assets,
      expenses,
      accruedExpenses: accruedExpenses.map(serializeAccrued),
      accruedPayments: accruedPayments.map(serializeAccruedPayment),
      prepaids: prepaids.map(serializePrepaid),
      prepaidReleases: prepaidReleases.map(serializePrepaidRelease),
      equityTransactions: equityTransactions.map(serializeEquityTransaction),
      entries,
      defaultFrom: isoDate(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))),
      defaultTo: isoDate(new Date())
    });
  } catch (err) {
    console.error('accounting.page error', err);
    return res.status(500).send('Error loading accounting page');
  }
};

exports.apiProfitLoss = async (req, res) => {
  try {
    await ensureDefaultAccounts();
    const { start, end, from, to } = getRange(req);
    await postDueStraightLineDepreciation(end, actorFromReq(req));
    await postDuePrepaidReleases(end, actorFromReq(req));

    const rows = await JournalEntry.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $unwind: '$lines' },
      { $match: { 'lines.accountType': { $in: ['revenue', 'expense'] } } },
      {
        $group: {
          _id: {
            code: '$lines.accountCode',
            name: '$lines.accountName',
            type: '$lines.accountType'
          },
          debit: { $sum: '$lines.debit' },
          credit: { $sum: '$lines.credit' }
        }
      },
      { $sort: { '_id.code': 1 } }
    ]);

    const cogsCodes = new Set([ACCOUNTS.MATERIAL_COST, ACCOUNTS.OUTSOURCED_COST, ACCOUNTS.PRINTER_DEPRECIATION]);
    const revenue = [];
    const cogs = [];
    const operatingExpenses = [];

    rows.forEach(r => {
      const type = r._id.type;
      const code = String(r._id.code || '');
      const amount = type === 'revenue'
        ? round2(Number(r.credit || 0) - Number(r.debit || 0))
        : round2(Number(r.debit || 0) - Number(r.credit || 0));
      const out = { code, name: r._id.name, type, amount };
      if (type === 'revenue') revenue.push(out);
      else if (cogsCodes.has(code)) cogs.push(out);
      else operatingExpenses.push(out);
    });

    const revenueTotal = round2(revenue.reduce((s, r) => s + Number(r.amount || 0), 0));
    const cogsTotal = round2(cogs.reduce((s, r) => s + Number(r.amount || 0), 0));
    const grossProfit = round2(revenueTotal - cogsTotal);
    const operatingExpensesTotal = round2(operatingExpenses.reduce((s, r) => s + Number(r.amount || 0), 0));
    const netProfit = round2(grossProfit - operatingExpensesTotal);

    return res.json({
      ok: true,
      range: { from, to },
      totals: { revenueTotal, cogsTotal, grossProfit, operatingExpensesTotal, netProfit },
      revenue,
      cogs,
      operatingExpenses
    });
  } catch (err) {
    console.error('accounting.apiProfitLoss error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load profit and loss' });
  }
};

exports.apiTrialBalance = async (req, res) => {
  try {
    await ensureDefaultAccounts();
    const end = parseDateEnd(req.query.to) || new Date();
    await postDueStraightLineDepreciation(end, actorFromReq(req));
    await postDuePrepaidReleases(end, actorFromReq(req));

    const rows = (await getAccountBalancesAsOf(end)).map(row => {
      const debit = round2(row.debit || 0);
      const credit = round2(row.credit || 0);
      const net = round2(debit - credit);
      return {
        code: row.code,
        name: row.name,
        type: row.type,
        group: row.group || '',
        debit,
        credit,
        debitBalance: net >= 0 ? net : 0,
        creditBalance: net < 0 ? round2(Math.abs(net)) : 0
      };
    });

    const totalDebit = round2(rows.reduce((sum, row) => sum + Number(row.debitBalance || 0), 0));
    const totalCredit = round2(rows.reduce((sum, row) => sum + Number(row.creditBalance || 0), 0));
    const difference = round2(totalDebit - totalCredit);

    return res.json({
      ok: true,
      asOf: isoDate(end),
      rows,
      totals: {
        totalDebit,
        totalCredit,
        difference,
        balanced: Math.abs(difference) <= 0.009
      }
    });
  } catch (err) {
    console.error('accounting.apiTrialBalance error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load trial balance' });
  }
};

exports.apiBalanceSheet = async (req, res) => {
  try {
    await ensureDefaultAccounts();
    const end = parseDateEnd(req.query.to) || new Date();
    await postDueStraightLineDepreciation(end, actorFromReq(req));
    await postDuePrepaidReleases(end, actorFromReq(req));

    const accountRows = await getAccountBalancesAsOf(end);
    const assets = [];
    const liabilities = [];
    const equity = [];
    let revenueTotal = 0;
    let expenseTotal = 0;

    accountRows.forEach(row => {
      const amount = normalBalanceAmount(row);
      const out = {
        code: row.code,
        name: row.name,
        type: row.type,
        group: row.group || '',
        amount
      };

      if (row.type === 'asset') {
        if (Math.abs(amount) > 0.009) assets.push(out);
      } else if (row.type === 'liability') {
        if (Math.abs(amount) > 0.009) liabilities.push(out);
      } else if (row.type === 'equity') {
        if (Math.abs(amount) > 0.009) equity.push(out);
      } else if (row.type === 'revenue') {
        revenueTotal = round2(revenueTotal + amount);
      } else if (row.type === 'expense') {
        expenseTotal = round2(expenseTotal + amount);
      }
    });

    const accumulatedProfit = round2(revenueTotal - expenseTotal);
    equity.push({
      code: '',
      name: 'Accumulated Profit / Loss',
      type: 'equity',
      group: 'Calculated Equity',
      amount: accumulatedProfit,
      calculated: true
    });

    const totalAssets = round2(assets.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const totalLiabilities = round2(liabilities.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const totalEquity = round2(equity.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);
    const difference = round2(totalAssets - totalLiabilitiesAndEquity);

    return res.json({
      ok: true,
      asOf: isoDate(end),
      assets,
      liabilities,
      equity,
      totals: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        totalLiabilitiesAndEquity,
        difference,
        balanced: Math.abs(difference) <= 0.009,
        revenueTotal,
        expenseTotal,
        accumulatedProfit
      }
    });
  } catch (err) {
    console.error('accounting.apiBalanceSheet error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load balance sheet' });
  }
};

exports.apiEquityTransactions = async (req, res) => {
  try {
    const entries = await EquityTransaction.find().sort({ date: -1, createdAt: -1 }).limit(100).lean();
    return res.json({ ok: true, entries: entries.map(serializeEquityTransaction) });
  } catch (err) {
    console.error('accounting.apiEquityTransactions error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load equity entries' });
  }
};

exports.apiCreateEquityTransaction = async (req, res) => {
  let session = null;
  try {
    await ensureDefaultAccounts();
    const allowedTypes = ['owner_capital', 'owner_drawing', 'opening_asset', 'opening_liability'];
    const type = String(req.body.type || '').trim();
    const accountCode = String(req.body.accountCode || '').trim();
    const amount = Number(req.body.amount || 0);
    const description = String(req.body.description || '').trim();
    const date = req.body.date ? new Date(req.body.date) : new Date();
    const openingFixedAssetRequested = type === 'opening_asset' && accountCode === ACCOUNTS.FIXED_ASSETS;
    const fixedAssetName = String(req.body.fixedAssetName || '').trim();
    const fixedAssetPrinterId = String(req.body.fixedAssetPrinterId || '').trim();
    const fixedAssetResidualValue = Number(req.body.fixedAssetResidualValue || 0);
    const fixedAssetDepreciationMethod = String(req.body.fixedAssetDepreciationMethod || 'straight_line') === 'usage' ? 'usage' : 'straight_line';
    const fixedAssetUsefulLifeUnits = Math.max(0, Math.floor(Number(req.body.fixedAssetUsefulLifeUnits || 0)));
    const fixedAssetUsefulLifeMonths = Math.max(0, Math.floor(Number(req.body.fixedAssetUsefulLifeMonths || 0)));

    if (!allowedTypes.includes(type)) return res.status(400).json({ ok: false, error: 'Select a valid equity entry type' });
    if (!accountCode) return res.status(400).json({ ok: false, error: 'Select the affected account' });
    if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Enter a valid amount' });
    if (isNaN(date.getTime())) return res.status(400).json({ ok: false, error: 'Enter a valid date' });
    if (openingFixedAssetRequested && !fixedAssetName) return res.status(400).json({ ok: false, error: 'Enter the opening fixed asset name' });
    if (openingFixedAssetRequested && fixedAssetResidualValue < 0) return res.status(400).json({ ok: false, error: 'Residual value cannot be negative' });
    if (openingFixedAssetRequested && fixedAssetResidualValue > amount) return res.status(400).json({ ok: false, error: 'Residual value cannot exceed the opening asset amount' });
    if (openingFixedAssetRequested && fixedAssetDepreciationMethod === 'usage' && !fixedAssetPrinterId) {
      return res.status(400).json({ ok: false, error: 'Usage-based opening assets must be linked to a printer. Use straight-line for assets like tables and chairs.' });
    }
    if (openingFixedAssetRequested && fixedAssetDepreciationMethod === 'usage' && fixedAssetUsefulLifeUnits <= 0) {
      return res.status(400).json({ ok: false, error: 'Usage-based opening assets need useful life units' });
    }
    if (openingFixedAssetRequested && fixedAssetDepreciationMethod === 'straight_line' && fixedAssetUsefulLifeMonths <= 0) {
      return res.status(400).json({ ok: false, error: 'Straight-line opening assets need useful life months' });
    }

    session = await mongoose.startSession();
    let equityTransaction = null;
    let fixedAsset = null;

    await session.withTransaction(async () => {
      const account = await AccountingAccount.findOne({ code: accountCode, active: true }).session(session);
      if (!account) {
        const e = new Error('Affected account not found');
        e.statusCode = 400;
        throw e;
      }

      const allowedAccountTypes = allowedEquityAccountTypes(type);
      if (!allowedAccountTypes.includes(account.type)) {
        const e = new Error(`${equityEntryLabel(type)} must use a ${allowedAccountTypes.join(' or ')} account`);
        e.statusCode = 400;
        throw e;
      }

      const usesCashAccount = String(account.code) === ACCOUNTS.CASH;
      if (!usesCashAccount && String(req.body.cashBookId || '').trim()) {
        const e = new Error('Cash book can only be selected when the affected account is Cash and Bank Books');
        e.statusCode = 400;
        throw e;
      }

      const cashBookContext = usesCashAccount
        ? await resolvePaymentCashBookContext(req.body, session)
        : { cashBook: null, meta: {} };
      if (usesCashAccount && !cashBookContext.cashBook) {
        const e = new Error('Select the cash book affected by this entry');
        e.statusCode = 400;
        throw e;
      }

      const actor = actorFromReq(req);
      if (openingFixedAssetRequested) {
        let printer = null;
        if (fixedAssetPrinterId) {
          if (!mongoose.Types.ObjectId.isValid(fixedAssetPrinterId)) {
            const e = new Error('Invalid linked printer');
            e.statusCode = 400;
            throw e;
          }
          printer = await Printer.findById(fixedAssetPrinterId).session(session);
          if (!printer) {
            const e = new Error('Linked printer not found');
            e.statusCode = 404;
            throw e;
          }
        }

        const fixedAssetIdentity = await newFixedAssetIdentity(session);
        const fixedAssetDocs = await FixedAsset.create([{
          _id: fixedAssetIdentity._id,
          name: fixedAssetName,
          code: fixedAssetIdentity.code,
          assetType: printer ? 'printer' : 'asset',
          printer: printer ? printer._id : null,
          purchaseDate: date,
          purchaseCost: round2(amount),
          residualValue: round2(fixedAssetResidualValue),
          depreciationMethod: fixedAssetDepreciationMethod,
          usefulLifeUnits: fixedAssetDepreciationMethod === 'usage' ? fixedAssetUsefulLifeUnits : 0,
          usefulLifeMonths: fixedAssetDepreciationMethod === 'straight_line' ? fixedAssetUsefulLifeMonths : 0,
          note: description || 'Opening fixed asset',
          createdBy: actor.postedBy,
          createdByName: actor.postedByName
        }], { session });
        fixedAsset = fixedAssetDocs[0];
      }

      const docs = await EquityTransaction.create([{
        type,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type,
        accountGroup: account.group || '',
        description,
        amount: round2(amount),
        date,
        cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
        cashBookName: cashBookContext.cashBook ? cashBookContext.cashBook.name : '',
        cashBookKind: cashBookContext.cashBook ? cashBookContext.cashBook.kind : null,
        cashMeta: cashBookContext.meta || {},
        fixedAsset: fixedAsset ? fixedAsset._id : null,
        fixedAssetName: fixedAsset ? fixedAsset.name : '',
        createdBy: actor.postedBy,
        createdByName: actor.postedByName
      }], { session });
      equityTransaction = docs[0];

      if (cashBookContext.cashBook) {
        const movementType = type === 'owner_drawing' ? 'outflow' : 'inflow';
        await recordCashBookMovement({
          cashBook: cashBookContext.cashBook,
          type: movementType,
          amount: round2(amount),
          sourceType: type,
          sourceId: equityTransaction._id,
          sourceRef: description || equityEntryLabel(type),
          note: description || equityEntryLabel(type),
          meta: cashBookContext.meta || {},
          recordedBy: actor.postedBy,
          recordedByName: actor.postedByName,
          session
        });
      }

      let lines = [];
      if (type === 'owner_capital') {
        lines = [
          { accountCode: account.code, debit: round2(amount), dimensions: { equityTransactionId: equityTransaction._id, cashBookId: cashBookContext.cashBook ? cashBookContext.cashBook._id : null } },
          { accountCode: ACCOUNTS.OWNER_CAPITAL, credit: round2(amount), dimensions: { equityTransactionId: equityTransaction._id } }
        ];
      } else if (type === 'owner_drawing') {
        lines = [
          { accountCode: ACCOUNTS.OWNER_DRAWINGS, debit: round2(amount), dimensions: { equityTransactionId: equityTransaction._id } },
          { accountCode: account.code, credit: round2(amount), dimensions: { equityTransactionId: equityTransaction._id, cashBookId: cashBookContext.cashBook ? cashBookContext.cashBook._id : null } }
        ];
      } else if (type === 'opening_asset') {
        lines = [
          { accountCode: account.code, debit: round2(amount), dimensions: { equityTransactionId: equityTransaction._id, fixedAssetId: fixedAsset ? fixedAsset._id : null, cashBookId: cashBookContext.cashBook ? cashBookContext.cashBook._id : null } },
          { accountCode: ACCOUNTS.OPENING_BALANCE_EQUITY, credit: round2(amount), dimensions: { equityTransactionId: equityTransaction._id, fixedAssetId: fixedAsset ? fixedAsset._id : null } }
        ];
      } else if (type === 'opening_liability') {
        lines = [
          { accountCode: ACCOUNTS.OPENING_BALANCE_EQUITY, debit: round2(amount), dimensions: { equityTransactionId: equityTransaction._id } },
          { accountCode: account.code, credit: round2(amount), dimensions: { equityTransactionId: equityTransaction._id } }
        ];
      }

      await postJournalEntry({
        sourceKey: `equity_transaction:${equityTransaction._id}`,
        sourceType: type,
        sourceId: equityTransaction._id,
        sourceRef: description || equityEntryLabel(type),
        date,
        memo: description || equityEntryLabel(type),
        postedBy: actor.postedBy,
        postedByName: actor.postedByName,
        session,
        lines
      });
    });

    let autoDepreciation = { posted: 0 };
    let responseFixedAsset = null;
    if (fixedAsset && fixedAsset.depreciationMethod === 'straight_line') {
      autoDepreciation = await postDueStraightLineDepreciation(new Date(), actorFromReq(req));
    }
    if (fixedAsset) {
      responseFixedAsset = await FixedAsset.findById(fixedAsset._id).populate('printer', 'name').lean();
    }

    return res.status(201).json({
      ok: true,
      entry: serializeEquityTransaction(equityTransaction),
      fixedAsset: responseFixedAsset,
      autoDepreciation
    });
  } catch (err) {
    console.error('accounting.apiCreateEquityTransaction error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to record equity entry' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

exports.apiCreateManualExpense = async (req, res) => {
  let session = null;
  try {
    await ensureDefaultExpenseCategories();
    const amount = Number(req.body.amount || 0);
    const description = String(req.body.description || '').trim();
    const treatment = ['expense', 'prepaid', 'accrued'].includes(String(req.body.treatment || 'expense'))
      ? String(req.body.treatment || 'expense')
      : 'expense';
    const categoryId = String(req.body.categoryId || '').trim();
    const date = req.body.date ? new Date(req.body.date) : new Date();
    const autoReleaseEnabled = treatment === 'prepaid' && truthyInput(req.body.autoReleaseEnabled);
    const releaseMonths = Math.max(0, Math.floor(Number(req.body.releaseMonths || 0)));

    if (!description) return res.status(400).json({ ok: false, error: 'Description is required' });
    if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Enter a valid amount' });
    if (!mongoose.Types.ObjectId.isValid(categoryId)) return res.status(400).json({ ok: false, error: 'Select an expense category' });
    if (autoReleaseEnabled && releaseMonths <= 0) {
      return res.status(400).json({ ok: false, error: 'Enter the number of months for automatic release' });
    }

    session = await mongoose.startSession();
    let expense = null;

    await session.withTransaction(async () => {
      const category = await ExpenseCategory.findById(categoryId).session(session);
      if (!category) {
        const e = new Error('Expense category not found');
        e.statusCode = 404;
        throw e;
      }

      const needsCashBook = treatment !== 'accrued';
      const cashBookContext = needsCashBook
        ? await resolvePaymentCashBookContext(req.body, session)
        : { cashBook: null, meta: {} };
      if (needsCashBook && !cashBookContext.cashBook) {
        const e = new Error('Select the cash book used for this expense');
        e.statusCode = 400;
        throw e;
      }

      const actor = actorFromReq(req);
      const docs = await ManualExpense.create([{
        category: category._id,
        categoryName: category.name,
        accountCode: category.accountCode,
        treatment,
        description,
        amount: round2(amount),
        releasedAmount: 0,
        autoReleaseEnabled,
        releaseMonths: autoReleaseEnabled ? releaseMonths : 0,
        paidAmount: treatment === 'accrued' ? 0 : round2(amount),
        date,
        cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
        cashBookName: cashBookContext.cashBook ? cashBookContext.cashBook.name : '',
        cashBookKind: cashBookContext.cashBook ? cashBookContext.cashBook.kind : null,
        cashMeta: cashBookContext.meta || {},
        paid: treatment !== 'accrued',
        createdBy: actor.postedBy,
        createdByName: actor.postedByName
      }], { session });
      expense = docs[0];

      if (cashBookContext.cashBook) {
        await recordCashBookMovement({
          cashBook: cashBookContext.cashBook,
          type: 'outflow',
          amount: round2(amount),
          sourceType: 'manual_expense',
          sourceId: expense._id,
          sourceRef: description,
          note: `Manual expense: ${description}`,
          meta: cashBookContext.meta || {},
          recordedBy: actor.postedBy,
          recordedByName: actor.postedByName,
          session
        });
      }

      const debitAccount = treatment === 'prepaid' ? ACCOUNTS.PREPAID_EXPENSES : category.accountCode;
      const creditAccount = treatment === 'accrued' ? ACCOUNTS.ACCRUED_PAYABLES : ACCOUNTS.CASH;
      await postJournalEntry({
        sourceKey: `manual_expense:${expense._id}`,
        sourceType: 'manual_expense',
        sourceId: expense._id,
        sourceRef: description,
        date,
        memo: description,
        postedBy: actor.postedBy,
        postedByName: actor.postedByName,
        session,
        lines: [
          { accountCode: debitAccount, debit: round2(amount), dimensions: { categoryId: category._id } },
          {
            accountCode: creditAccount,
            credit: round2(amount),
            dimensions: {
              categoryId: category._id,
              cashBookId: cashBookContext.cashBook ? cashBookContext.cashBook._id : null
            }
          }
        ]
      });
    });

    let autoPrepaidRelease = { posted: 0 };
    if (expense && expense.treatment === 'prepaid' && expense.autoReleaseEnabled) {
      autoPrepaidRelease = await postDuePrepaidReleases(new Date(), actorFromReq(req));
      expense = await ManualExpense.findById(expense._id).lean() || expense;
    }

    return res.status(201).json({ ok: true, expense, autoPrepaidRelease });
  } catch (err) {
    console.error('accounting.apiCreateManualExpense error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to record manual expense' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

exports.apiAccruedExpenses = async (req, res) => {
  try {
    const [accruedExpenses, payments] = await Promise.all([
      ManualExpense.find({ treatment: 'accrued' }).sort({ date: -1, createdAt: -1 }).limit(200).lean(),
      AccruedExpensePayment.find().sort({ date: -1, createdAt: -1 }).limit(100).lean()
    ]);

    return res.json({
      ok: true,
      accruedExpenses: accruedExpenses.map(serializeAccrued),
      payments: payments.map(serializeAccruedPayment)
    });
  } catch (err) {
    console.error('accounting.apiAccruedExpenses error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load accrued expenses' });
  }
};

exports.apiPayAccruedExpense = async (req, res) => {
  let session = null;
  try {
    await ensureDefaultExpenseCategories();
    const { id } = req.params;
    const amount = Number(req.body.amount || 0);
    const date = req.body.date ? new Date(req.body.date) : new Date();
    const note = String(req.body.note || '').trim();

    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid accrued expense id' });
    if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Enter a valid payment amount' });

    session = await mongoose.startSession();
    let payment = null;
    let remainingAmount = 0;

    await session.withTransaction(async () => {
      const accrued = await ManualExpense.findById(id).session(session);
      if (!accrued || accrued.treatment !== 'accrued') {
        const e = new Error('Accrued expense not found');
        e.statusCode = 404;
        throw e;
      }

      const originalAmount = round2(accrued.amount || 0);
      const paidAmount = round2(accrued.paidAmount || 0);
      const currentRemaining = round2(Math.max(0, originalAmount - paidAmount));
      const payAmount = round2(amount);

      if (payAmount > currentRemaining + 0.009) {
        const e = new Error(`Payment amount exceeds remaining accrued balance (${currentRemaining.toFixed(2)})`);
        e.statusCode = 400;
        throw e;
      }

      const cashBookContext = await resolvePaymentCashBookContext(req.body, session);
      if (!cashBookContext.cashBook) {
        const e = new Error('Select the cash book used for this payment');
        e.statusCode = 400;
        throw e;
      }

      const actor = actorFromReq(req);
      const docs = await AccruedExpensePayment.create([{
        accruedExpense: accrued._id,
        category: accrued.category || null,
        categoryName: accrued.categoryName || '',
        description: accrued.description || '',
        amount: payAmount,
        date,
        cashBook: cashBookContext.cashBook._id,
        cashBookName: cashBookContext.cashBook.name || '',
        cashBookKind: cashBookContext.meta?.cashBookKind || cashBookContext.cashBook.kind || 'cash',
        cashMeta: cashBookContext.meta || {},
        note,
        recordedBy: actor.postedBy,
        recordedByName: actor.postedByName
      }], { session });
      payment = docs[0];

      await recordCashBookMovement({
        cashBook: cashBookContext.cashBook,
        type: 'outflow',
        amount: payAmount,
        sourceType: 'accrued_expense_payment',
        sourceId: payment._id,
        sourceRef: accrued.description || String(accrued._id),
        note: note || `Pay accrued expense: ${accrued.description || ''}`.trim(),
        meta: Object.assign({}, cashBookContext.meta || {}, {
          manualExpenseId: String(accrued._id),
          accruedPaymentId: String(payment._id)
        }),
        recordedBy: actor.postedBy,
        recordedByName: actor.postedByName,
        session
      });

      accrued.paidAmount = round2(paidAmount + payAmount);
      remainingAmount = round2(Math.max(0, originalAmount - accrued.paidAmount));
      accrued.paid = remainingAmount <= 0.009;
      await accrued.save({ session });

      await postJournalEntry({
        sourceKey: `accrued_expense_payment:${payment._id}`,
        sourceType: 'accrued_expense_payment',
        sourceId: payment._id,
        sourceRef: accrued.description || String(accrued._id),
        date,
        memo: note || `Pay accrued expense: ${accrued.description || ''}`.trim(),
        postedBy: actor.postedBy,
        postedByName: actor.postedByName,
        session,
        lines: [
          {
            accountCode: ACCOUNTS.ACCRUED_PAYABLES,
            debit: payAmount,
            dimensions: {
              manualExpenseId: accrued._id,
              accruedPaymentId: payment._id,
              categoryId: accrued.category || null,
              cashBookId: cashBookContext.cashBook._id
            }
          },
          {
            accountCode: ACCOUNTS.CASH,
            credit: payAmount,
            dimensions: {
              manualExpenseId: accrued._id,
              accruedPaymentId: payment._id,
              categoryId: accrued.category || null,
              cashBookId: cashBookContext.cashBook._id,
              cashBookName: cashBookContext.cashBook.name || ''
            }
          }
        ]
      });
    });

    return res.status(201).json({
      ok: true,
      payment: serializeAccruedPayment(payment),
      remainingAmount
    });
  } catch (err) {
    console.error('accounting.apiPayAccruedExpense error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to pay accrued expense' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

exports.apiPrepaidExpenses = async (req, res) => {
  try {
    await postDuePrepaidReleases(new Date(), actorFromReq(req));
    const [prepaids, releases] = await Promise.all([
      ManualExpense.find({ treatment: 'prepaid' }).sort({ date: -1, createdAt: -1 }).limit(200).lean(),
      PrepaidRelease.find().sort({ date: -1, createdAt: -1 }).limit(100).lean()
    ]);

    return res.json({
      ok: true,
      prepaids: prepaids.map(serializePrepaid),
      releases: releases.map(serializePrepaidRelease)
    });
  } catch (err) {
    console.error('accounting.apiPrepaidExpenses error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load prepaid expenses' });
  }
};

exports.apiReleasePrepaidExpense = async (req, res) => {
  let session = null;
  try {
    await ensureDefaultExpenseCategories();
    const { id } = req.params;
    const amount = Number(req.body.amount || 0);
    const date = req.body.date ? new Date(req.body.date) : new Date();
    const note = String(req.body.note || '').trim();

    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid prepaid expense id' });
    if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Enter a valid release amount' });

    session = await mongoose.startSession();
    let release = null;
    let remainingAmount = 0;

    await session.withTransaction(async () => {
      const prepaid = await ManualExpense.findById(id).session(session);
      if (!prepaid || prepaid.treatment !== 'prepaid') {
        const e = new Error('Prepaid expense not found');
        e.statusCode = 404;
        throw e;
      }

      const originalAmount = round2(prepaid.amount || 0);
      const releasedAmount = round2(prepaid.releasedAmount || 0);
      const currentRemaining = round2(Math.max(0, originalAmount - releasedAmount));
      const releaseAmount = round2(amount);

      if (releaseAmount > currentRemaining + 0.009) {
        const e = new Error(`Release amount exceeds remaining prepaid balance (${currentRemaining.toFixed(2)})`);
        e.statusCode = 400;
        throw e;
      }

      const actor = actorFromReq(req);
      const docs = await PrepaidRelease.create([{
        prepaidExpense: prepaid._id,
        category: prepaid.category || null,
        categoryName: prepaid.categoryName || '',
        accountCode: prepaid.accountCode || ACCOUNTS.GENERAL_EXPENSE,
        description: prepaid.description || '',
        amount: releaseAmount,
        date,
        note,
        recordedBy: actor.postedBy,
        recordedByName: actor.postedByName
      }], { session });
      release = docs[0];

      prepaid.releasedAmount = round2(releasedAmount + releaseAmount);
      await prepaid.save({ session });
      remainingAmount = round2(Math.max(0, originalAmount - prepaid.releasedAmount));

      await postJournalEntry({
        sourceKey: `prepaid_release:${release._id}`,
        sourceType: 'prepaid_release',
        sourceId: release._id,
        sourceRef: prepaid.description || String(prepaid._id),
        date,
        memo: note || `Release prepaid expense: ${prepaid.description || ''}`.trim(),
        postedBy: actor.postedBy,
        postedByName: actor.postedByName,
        session,
        lines: [
          {
            accountCode: prepaid.accountCode || ACCOUNTS.GENERAL_EXPENSE,
            debit: releaseAmount,
            dimensions: {
              manualExpenseId: prepaid._id,
              prepaidReleaseId: release._id,
              categoryId: prepaid.category || null
            }
          },
          {
            accountCode: ACCOUNTS.PREPAID_EXPENSES,
            credit: releaseAmount,
            dimensions: {
              manualExpenseId: prepaid._id,
              prepaidReleaseId: release._id,
              categoryId: prepaid.category || null
            }
          }
        ]
      });
    });

    return res.status(201).json({
      ok: true,
      release: serializePrepaidRelease(release),
      remainingAmount
    });
  } catch (err) {
    console.error('accounting.apiReleasePrepaidExpense error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to release prepaid expense' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

exports.apiCreateFixedAsset = async (req, res) => {
  let session = null;
  try {
    await ensureDefaultAccounts();
    const name = String(req.body.name || '').trim();
    const purchaseCost = Number(req.body.purchaseCost || 0);
    const residualValue = Number(req.body.residualValue || 0);
    const depreciationMethod = String(req.body.depreciationMethod || 'usage') === 'straight_line' ? 'straight_line' : 'usage';
    const usefulLifeUnits = Number(req.body.usefulLifeUnits || 0);
    const usefulLifeMonths = Number(req.body.usefulLifeMonths || 0);
    const printerId = String(req.body.printerId || '').trim();
    const purchaseDate = req.body.purchaseDate ? new Date(req.body.purchaseDate) : new Date();
    const note = String(req.body.note || '').trim();

    if (!name) return res.status(400).json({ ok: false, error: 'Asset name is required' });
    if (!purchaseCost || isNaN(purchaseCost) || purchaseCost <= 0) return res.status(400).json({ ok: false, error: 'Enter a valid purchase cost' });
    if (depreciationMethod === 'usage' && (!usefulLifeUnits || usefulLifeUnits <= 0)) {
      return res.status(400).json({ ok: false, error: 'Usage-based assets need useful life units' });
    }
    if (depreciationMethod === 'straight_line' && (!usefulLifeMonths || usefulLifeMonths <= 0)) {
      return res.status(400).json({ ok: false, error: 'Straight-line assets need useful life months' });
    }

    session = await mongoose.startSession();
    let asset = null;

    await session.withTransaction(async () => {
      let printer = null;
      if (printerId && mongoose.Types.ObjectId.isValid(printerId)) {
        printer = await Printer.findById(printerId).session(session);
      }

      const cashBookContext = req.body.cashBookId
        ? await resolvePaymentCashBookContext(req.body, session)
        : { cashBook: null, meta: {} };

      const actor = actorFromReq(req);
      const fixedAssetIdentity = await newFixedAssetIdentity(session);
      const docs = await FixedAsset.create([{
        _id: fixedAssetIdentity._id,
        name,
        code: fixedAssetIdentity.code,
        assetType: printer ? 'printer' : String(req.body.assetType || 'asset').trim() || 'asset',
        printer: printer ? printer._id : null,
        purchaseDate,
        purchaseCost: round2(purchaseCost),
        residualValue: Math.max(0, round2(residualValue)),
        depreciationMethod,
        usefulLifeUnits: Math.max(0, Math.floor(usefulLifeUnits || 0)),
        usefulLifeMonths: Math.max(0, Math.floor(usefulLifeMonths || 0)),
        cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
        cashBookName: cashBookContext.cashBook ? cashBookContext.cashBook.name : '',
        cashBookKind: cashBookContext.cashBook ? cashBookContext.cashBook.kind : null,
        cashMeta: cashBookContext.meta || {},
        note,
        createdBy: actor.postedBy,
        createdByName: actor.postedByName
      }], { session });
      asset = docs[0];

      if (cashBookContext.cashBook) {
        await recordCashBookMovement({
          cashBook: cashBookContext.cashBook,
          type: 'outflow',
          amount: round2(purchaseCost),
          sourceType: 'fixed_asset_purchase',
          sourceId: asset._id,
          sourceRef: name,
          note: `Fixed asset purchase: ${name}`,
          meta: cashBookContext.meta || {},
          recordedBy: actor.postedBy,
          recordedByName: actor.postedByName,
          session
        });
      }

      await postJournalEntry({
        sourceKey: `fixed_asset:${asset._id}:purchase`,
        sourceType: 'fixed_asset_purchase',
        sourceId: asset._id,
        sourceRef: name,
        date: purchaseDate,
        memo: `Fixed asset purchase: ${name}`,
        postedBy: actor.postedBy,
        postedByName: actor.postedByName,
        session,
        lines: [
          { accountCode: ACCOUNTS.FIXED_ASSETS, debit: round2(purchaseCost), dimensions: { fixedAssetId: asset._id, printerId: asset.printer || null } },
          {
            accountCode: cashBookContext.cashBook ? ACCOUNTS.CASH : ACCOUNTS.ACCRUED_PAYABLES,
            credit: round2(purchaseCost),
            dimensions: { fixedAssetId: asset._id, printerId: asset.printer || null, cashBookId: cashBookContext.cashBook ? cashBookContext.cashBook._id : null }
          }
        ]
      });
    });

    let autoDepreciation = { posted: 0 };
    if (asset && asset.depreciationMethod === 'straight_line') {
      autoDepreciation = await postDueStraightLineDepreciation(new Date(), actorFromReq(req));
    }
    const responseAsset = asset
      ? (await FixedAsset.findById(asset._id).populate('printer', 'name').lean()) || asset
      : asset;

    return res.status(201).json({ ok: true, asset: responseAsset, autoDepreciation });
  } catch (err) {
    console.error('accounting.apiCreateFixedAsset error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to create fixed asset' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

exports.apiDepreciateFixedAsset = async (req, res) => {
  let session = null;
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid asset id' });

    const date = req.body.date ? new Date(req.body.date) : new Date();
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    session = await mongoose.startSession();
    let depreciation = 0;

    await session.withTransaction(async () => {
      const asset = await FixedAsset.findById(id).session(session);
      if (!asset || asset.active === false) {
        const e = new Error('Fixed asset not found');
        e.statusCode = 404;
        throw e;
      }
      if (asset.depreciationMethod !== 'straight_line') {
        const e = new Error('Only straight-line assets use monthly depreciation posting');
        e.statusCode = 400;
        throw e;
      }
      const sourceKey = `fixed_asset:${asset._id}:depreciation:${monthKey}`;
      const existing = await JournalEntry.findOne({ sourceKey }).session(session).lean();
      if (existing) {
        const e = new Error('Depreciation already posted for this month');
        e.statusCode = 400;
        throw e;
      }
      const usefulLifeMonths = Number(asset.usefulLifeMonths || 0);
      if (usefulLifeMonths <= 0) {
        const e = new Error('Useful life months is required');
        e.statusCode = 400;
        throw e;
      }

      const depreciable = Math.max(0, Number(asset.purchaseCost || 0) - Number(asset.residualValue || 0));
      const remaining = Math.max(0, depreciable - Number(asset.accumulatedDepreciation || 0));
      depreciation = round2(Math.min(remaining, depreciable / usefulLifeMonths));
      if (depreciation <= 0) {
        const e = new Error('Asset is fully depreciated');
        e.statusCode = 400;
        throw e;
      }

      const actor = actorFromReq(req);
      const expenseAccount = depreciationExpenseAccountForAsset(asset);
      await postJournalEntry({
        sourceKey,
        sourceType: 'fixed_asset_depreciation',
        sourceId: asset._id,
        sourceRef: asset.name,
        date,
        memo: `Monthly depreciation: ${asset.name}`,
        postedBy: actor.postedBy,
        postedByName: actor.postedByName,
        session,
        lines: [
          { accountCode: expenseAccount, debit: depreciation, dimensions: { fixedAssetId: asset._id, printerId: asset.printer || null } },
          { accountCode: ACCOUNTS.ACCUMULATED_DEPRECIATION, credit: depreciation, dimensions: { fixedAssetId: asset._id, printerId: asset.printer || null } }
        ]
      });

      asset.accumulatedDepreciation = round2(Number(asset.accumulatedDepreciation || 0) + depreciation);
      await asset.save({ session });
    });

    return res.json({ ok: true, depreciation });
  } catch (err) {
    console.error('accounting.apiDepreciateFixedAsset error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to post depreciation' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

exports.apiJournalEntries = async (req, res) => {
  try {
    const entries = await JournalEntry.find().sort({ createdAt: -1, _id: -1 }).limit(100).lean();
    return res.json({ ok: true, entries });
  } catch (err) {
    console.error('accounting.apiJournalEntries error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load journal entries' });
  }
};
