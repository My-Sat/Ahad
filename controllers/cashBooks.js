const CashBook = require('../models/cash_book');
const CashBookTxn = require('../models/cash_book_txn');
const mongoose = require('mongoose');
const { normalizeCashBookKind } = require('../utilities/cash_books');

function isAdmin(req) {
  return !!(req.user && String(req.user.role || '').toLowerCase() === 'admin');
}

function serializeBook(book) {
  return {
    _id: String(book._id),
    name: book.name || '',
    kind: normalizeCashBookKind(book.kind),
    balance: Number(book.balance || 0),
    active: book.active !== false,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt
  };
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === 1 || value === '1' || value === 'on') return true;
  if (value === false || value === 'false' || value === 0 || value === '0' || value === 'off') return false;
  return fallback;
}

exports.page = async (req, res) => {
  try {
    const cashBooks = await CashBook.find()
      .sort({ active: -1, name: 1 })
      .lean();

    return res.render('cash_books/index', {
      title: 'Cash Books',
      cashBooks
    });
  } catch (err) {
    console.error('cashBooks.page error', err);
    return res.status(500).send('Error loading cash books');
  }
};

exports.apiList = async (req, res) => {
  try {
    const includeInactive = isAdmin(req) && String(req.query.all || '').trim() === '1';
    const filter = includeInactive ? {} : { active: true };
    const rows = await CashBook.find(filter)
      .sort({ active: -1, name: 1 })
      .lean();

    return res.json({
      ok: true,
      cashBooks: (rows || []).map(serializeBook)
    });
  } catch (err) {
    console.error('cashBooks.apiList error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load cash books' });
  }
};

exports.apiLedger = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid cash book id' });
    }

    const cashBook = await CashBook.findById(id).lean();
    if (!cashBook) return res.status(404).json({ ok: false, error: 'Cash book not found' });

    const limitRaw = Number(req.query.limit || 100);
    const pageRaw = Number(req.query.page || 1);
    const limit = Math.min(100, Math.max(1, isFinite(limitRaw) ? Math.floor(limitRaw) : 100));
    const page = Math.max(1, isFinite(pageRaw) ? Math.floor(pageRaw) : 1);

    const txns = await CashBookTxn.find({ cashBook: cashBook._id })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    let runningBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const chronological = (txns || []).map(txn => {
      const amount = Number(txn.amount || 0);
      const isDebit = String(txn.type || '').toLowerCase() === 'inflow';
      const debit = isDebit ? amount : 0;
      const credit = isDebit ? 0 : amount;
      totalDebit = Number((totalDebit + debit).toFixed(2));
      totalCredit = Number((totalCredit + credit).toFixed(2));
      runningBalance = Number((runningBalance + debit - credit).toFixed(2));

      return {
        _id: String(txn._id),
        createdAt: txn.createdAt,
        entry: txn.note || txn.sourceRef || txn.sourceType || txn.type,
        sourceType: txn.sourceType || '',
        sourceRef: txn.sourceRef || '',
        debit,
        credit,
        runningBalance,
        recordedByName: txn.recordedByName || ''
      };
    });

    const entriesDesc = chronological.slice().reverse();
    const count = entriesDesc.length;
    const skip = (page - 1) * limit;
    const entries = entriesDesc.slice(skip, skip + limit);

    return res.json({
      ok: true,
      cashBook: serializeBook(cashBook),
      entries,
      count,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(count / limit)),
      hasPrev: page > 1,
      hasMore: (skip + entries.length) < count,
      from: entries.length ? skip + 1 : 0,
      to: skip + entries.length,
      totals: {
        debit: totalDebit,
        credit: totalCredit,
        ledgerBalance: Number((totalDebit - totalCredit).toFixed(2)),
        currentBalance: Number(cashBook.balance || 0)
      }
    });
  } catch (err) {
    console.error('cashBooks.apiLedger error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load cash book ledger' });
  }
};

exports.apiCreate = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const kind = normalizeCashBookKind(req.body.kind);
    const openingBalance = Number(req.body.openingBalance || 0);
    const active = parseBool(req.body.active, true);

    if (!name) return res.status(400).json({ ok: false, error: 'Cash book name is required' });
    if (!isFinite(openingBalance) || openingBalance < 0) {
      return res.status(400).json({ ok: false, error: 'Opening balance must be zero or more' });
    }

    const book = await CashBook.create({
      name,
      kind,
      balance: Number(openingBalance.toFixed(2)),
      active,
      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null
    });

    if (book.balance > 0) {
      await CashBookTxn.create({
        cashBook: book._id,
        cashBookName: book.name,
        cashBookKind: kind,
        type: 'inflow',
        amount: book.balance,
        sourceType: 'opening_balance',
        sourceId: book._id,
        sourceRef: book.name,
        note: 'Opening balance',
        recordedBy: req.user?._id || null,
        recordedByName: req.user?.name || req.user?.username || ''
      });
    }

    return res.json({ ok: true, cashBook: serializeBook(book) });
  } catch (err) {
    console.error('cashBooks.apiCreate error', err);
    if (err && err.code === 11000) {
      return res.status(400).json({ ok: false, error: 'A cash book with this name already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Failed to create cash book' });
  }
};

exports.apiUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const name = String(req.body.name || '').trim();
    const kind = normalizeCashBookKind(req.body.kind);
    const active = parseBool(req.body.active, true);

    if (!name) return res.status(400).json({ ok: false, error: 'Cash book name is required' });

    const book = await CashBook.findByIdAndUpdate(
      id,
      {
        name,
        kind,
        active,
        updatedBy: req.user?._id || null
      },
      { new: true, runValidators: true }
    );

    if (!book) return res.status(404).json({ ok: false, error: 'Cash book not found' });

    return res.json({ ok: true, cashBook: serializeBook(book) });
  } catch (err) {
    console.error('cashBooks.apiUpdate error', err);
    if (err && err.code === 11000) {
      return res.status(400).json({ ok: false, error: 'A cash book with this name already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Failed to update cash book' });
  }
};

exports.apiArchive = async (req, res) => {
  try {
    const { id } = req.params;
    const book = await CashBook.findByIdAndUpdate(
      id,
      {
        active: false,
        updatedBy: req.user?._id || null
      },
      { new: true, runValidators: true }
    );

    if (!book) return res.status(404).json({ ok: false, error: 'Cash book not found' });
    return res.json({ ok: true, cashBook: serializeBook(book) });
  } catch (err) {
    console.error('cashBooks.apiArchive error', err);
    return res.status(500).json({ ok: false, error: 'Failed to archive cash book' });
  }
};

exports.apiRestore = async (req, res) => {
  try {
    const { id } = req.params;
    const book = await CashBook.findByIdAndUpdate(
      id,
      {
        active: true,
        updatedBy: req.user?._id || null
      },
      { new: true, runValidators: true }
    );

    if (!book) return res.status(404).json({ ok: false, error: 'Cash book not found' });
    return res.json({ ok: true, cashBook: serializeBook(book) });
  } catch (err) {
    console.error('cashBooks.apiRestore error', err);
    return res.status(500).json({ ok: false, error: 'Failed to restore cash book' });
  }
};
