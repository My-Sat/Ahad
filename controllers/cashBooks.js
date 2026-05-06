const CashBook = require('../models/cash_book');
const CashBookTxn = require('../models/cash_book_txn');
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
