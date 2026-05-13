const mongoose = require('mongoose');
const AccountingAccount = require('../models/accounting_account');
const JournalEntry = require('../models/journal_entry');
const ExpenseCategory = require('../models/expense_category');
const ManualExpense = require('../models/manual_expense');
const PrepaidRelease = require('../models/prepaid_release');
const AccruedExpensePayment = require('../models/accrued_expense_payment');
const FixedAsset = require('../models/fixed_asset');
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

exports.page = async (req, res) => {
  try {
    await ensureDefaultExpenseCategories();
    await postDueStraightLineDepreciation(new Date(), actorFromReq(req));
    await postDuePrepaidReleases(new Date(), actorFromReq(req));
    const [categories, cashBooks, printers, assets, expenses, accruedExpenses, accruedPayments, prepaids, prepaidReleases, entries] = await Promise.all([
      ExpenseCategory.find({ active: true }).sort({ name: 1 }).lean(),
      CashBook.find({ active: true }).sort({ name: 1 }).lean(),
      Printer.find().sort({ name: 1 }).lean(),
      FixedAsset.find().populate('printer', 'name').sort({ createdAt: -1 }).limit(100).lean(),
      ManualExpense.find().sort({ date: -1, createdAt: -1 }).limit(100).lean(),
      ManualExpense.find({ treatment: 'accrued' }).sort({ date: -1, createdAt: -1 }).limit(200).lean(),
      AccruedExpensePayment.find().sort({ date: -1, createdAt: -1 }).limit(100).lean(),
      ManualExpense.find({ treatment: 'prepaid' }).sort({ date: -1, createdAt: -1 }).limit(200).lean(),
      PrepaidRelease.find().sort({ date: -1, createdAt: -1 }).limit(100).lean(),
      JournalEntry.find().sort({ date: -1, createdAt: -1 }).limit(50).lean()
    ]);

    return res.render('accounting/index', {
      title: 'Accounting',
      categories,
      cashBooks,
      printers,
      assets,
      expenses,
      accruedExpenses: accruedExpenses.map(serializeAccrued),
      accruedPayments: accruedPayments.map(serializeAccruedPayment),
      prepaids: prepaids.map(serializePrepaid),
      prepaidReleases: prepaidReleases.map(serializePrepaidRelease),
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
      const docs = await FixedAsset.create([{
        name,
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
    const entries = await JournalEntry.find().sort({ date: -1, createdAt: -1 }).limit(100).lean();
    return res.json({ ok: true, entries });
  } catch (err) {
    console.error('accounting.apiJournalEntries error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load journal entries' });
  }
};
