const mongoose = require('mongoose');
const CashBook = require('../models/cash_book');
const CashBookTxn = require('../models/cash_book_txn');

function normalizeCashBookKind(kind) {
  const k = String(kind || '').toLowerCase().trim();
  if (k === 'bank') return 'bank';
  if (k === 'momo') return 'momo';
  return 'cash';
}

function paymentMethodForCashBookKind(kind) {
  const k = normalizeCashBookKind(kind);
  if (k === 'bank') return 'bank';
  if (k === 'momo') return 'momo';
  return 'cash';
}

function extractCashBookId(body) {
  const b = body || {};
  return String(b.cashBookId || b.paymentCashBookId || b.cashBook || '').trim();
}

function buildPaymentMeta(body, method) {
  const b = body || {};
  const meta = {};

  if (method === 'momo') {
    if (b.momoNumber) meta.momoNumber = String(b.momoNumber).trim();
    if (b.momoTxId) meta.momoTxId = String(b.momoTxId).trim();
  }

  if (method === 'bank' || method === 'cheque') {
    if (b.chequeNumber) meta.chequeNumber = String(b.chequeNumber).trim();
    if (b.depositDetails) meta.depositDetails = String(b.depositDetails).trim();
  }

  if (b.meta && typeof b.meta === 'object') Object.assign(meta, b.meta);
  return meta;
}

async function resolvePaymentCashBookContext(body, session = null) {
  const b = body || {};
  const cashBookId = extractCashBookId(b);

  if (!cashBookId) {
    const rawMethod = String(b.paymentMethod || 'cash').toLowerCase().trim();
    const allowed = ['cash', 'momo', 'cheque', 'bank', 'other'];
    const method = allowed.includes(rawMethod) ? rawMethod : 'other';
    return {
      cashBook: null,
      method,
      meta: buildPaymentMeta(b, method)
    };
  }

  if (!mongoose.Types.ObjectId.isValid(cashBookId)) {
    const e = new Error('Invalid cash book');
    e.statusCode = 400;
    throw e;
  }

  const query = CashBook.findById(cashBookId);
  if (session) query.session(session);
  const cashBook = await query;

  if (!cashBook || cashBook.active === false) {
    const e = new Error('Cash book not found or inactive');
    e.statusCode = 400;
    throw e;
  }

  const kind = normalizeCashBookKind(cashBook.kind);
  const method = paymentMethodForCashBookKind(kind);
  const meta = buildPaymentMeta(b, method);
  meta.cashBookId = String(cashBook._id);
  meta.cashBookName = cashBook.name || '';
  meta.cashBookKind = kind;

  return { cashBook, method, meta };
}

async function recordCashBookMovement(options) {
  const opts = options || {};
  const cashBook = opts.cashBook;
  if (!cashBook) return null;

  const amount = Number(Number(opts.amount || 0).toFixed(2));
  if (!amount || !isFinite(amount) || amount <= 0) {
    const e = new Error('Cash book movement amount must be greater than zero');
    e.statusCode = 400;
    throw e;
  }

  const type = String(opts.type || '').toLowerCase() === 'outflow' ? 'outflow' : 'inflow';
  const inc = type === 'outflow' ? -amount : amount;
  const session = opts.session || null;
  const cashBookId = cashBook._id || cashBook;
  const updateFilter = { _id: cashBookId };
  if (type === 'outflow') {
    updateFilter.balance = { $gte: amount };
  }

  const updated = await CashBook.findOneAndUpdate(
    updateFilter,
    { $inc: { balance: inc } },
    { new: true, session }
  );

  if (!updated) {
    const currentQuery = CashBook.findById(cashBookId);
    if (session) currentQuery.session(session);
    const current = await currentQuery.lean();
    if (type === 'outflow' && current) {
      const available = Number(current.balance || 0);
      const e = new Error(
        `Insufficient balance in "${current.name || 'Cash book'}". Available: GH\u20B5 ${available.toFixed(2)}, requested: GH\u20B5 ${amount.toFixed(2)}`
      );
      e.statusCode = 400;
      e.code = 'INSUFFICIENT_CASH_BOOK_BALANCE';
      throw e;
    }

    const e = new Error('Unable to update cash book balance');
    e.statusCode = 400;
    throw e;
  }

  const docs = await CashBookTxn.create(
    [{
      cashBook: updated._id,
      cashBookName: updated.name || '',
      cashBookKind: normalizeCashBookKind(updated.kind),
      type,
      amount,
      sourceType: opts.sourceType || '',
      sourceId: opts.sourceId || null,
      sourceRef: opts.sourceRef || '',
      note: opts.note || '',
      meta: opts.meta || {},
      recordedBy: opts.recordedBy || null,
      recordedByName: opts.recordedByName || ''
    }],
    { session }
  );

  return {
    cashBook: updated,
    txn: docs && docs[0] ? docs[0] : null
  };
}

module.exports = {
  normalizeCashBookKind,
  paymentMethodForCashBookKind,
  resolvePaymentCashBookContext,
  recordCashBookMovement
};
