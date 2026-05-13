const mongoose = require('mongoose');
const Supplier = require('../models/supplier');
const SupplierAccountTxn = require('../models/supplier_account_txn');
const {
  resolvePaymentCashBookContext,
  recordCashBookMovement
} = require('../utilities/cash_books');
const {
  ACCOUNTS,
  actorFromReq,
  postJournalEntry
} = require('../utilities/accounting');

function serializeSupplier(s) {
  return {
    _id: String(s._id),
    name: s.name || '',
    phone: s.phone || '',
    email: s.email || '',
    address: s.address || '',
    notes: s.notes || '',
    balance: Number(s.balance || 0),
    active: s.active !== false,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  };
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === 1 || value === '1' || value === 'on') return true;
  if (value === false || value === 'false' || value === 0 || value === '0' || value === 'off') return false;
  return fallback;
}

exports.apiList = async (req, res) => {
  try {
    const includeInactive = String(req.query.all || '').trim() === '1';
    const filter = includeInactive ? {} : { active: true };
    const suppliers = await Supplier.find(filter)
      .sort({ active: -1, name: 1 })
      .lean();

    return res.json({ ok: true, suppliers: (suppliers || []).map(serializeSupplier) });
  } catch (err) {
    console.error('suppliers.apiList error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load suppliers' });
  }
};

exports.apiCreate = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Supplier name is required' });

    const supplier = await Supplier.create({
      name,
      phone: String(req.body.phone || '').trim(),
      email: String(req.body.email || '').trim(),
      address: String(req.body.address || '').trim(),
      notes: String(req.body.notes || '').trim(),
      active: parseBool(req.body.active, true),
      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null
    });

    return res.status(201).json({ ok: true, supplier: serializeSupplier(supplier) });
  } catch (err) {
    console.error('suppliers.apiCreate error', err);
    if (err && err.code === 11000) {
      return res.status(400).json({ ok: false, error: 'A supplier with this name already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Failed to create supplier' });
  }
};

exports.apiUpdate = async (req, res) => {
  try {
    const { id } = req.params;
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Supplier name is required' });

    const supplier = await Supplier.findByIdAndUpdate(
      id,
      {
        name,
        phone: String(req.body.phone || '').trim(),
        email: String(req.body.email || '').trim(),
        address: String(req.body.address || '').trim(),
        notes: String(req.body.notes || '').trim(),
        active: parseBool(req.body.active, true),
        updatedBy: req.user?._id || null
      },
      { new: true, runValidators: true }
    );

    if (!supplier) return res.status(404).json({ ok: false, error: 'Supplier not found' });
    return res.json({ ok: true, supplier: serializeSupplier(supplier) });
  } catch (err) {
    console.error('suppliers.apiUpdate error', err);
    if (err && err.code === 11000) {
      return res.status(400).json({ ok: false, error: 'A supplier with this name already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Failed to update supplier' });
  }
};

exports.apiArchive = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { active: false, updatedBy: req.user?._id || null },
      { new: true, runValidators: true }
    );
    if (!supplier) return res.status(404).json({ ok: false, error: 'Supplier not found' });
    return res.json({ ok: true, supplier: serializeSupplier(supplier) });
  } catch (err) {
    console.error('suppliers.apiArchive error', err);
    return res.status(500).json({ ok: false, error: 'Failed to archive supplier' });
  }
};

exports.apiRestore = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(
      req.params.id,
      { active: true, updatedBy: req.user?._id || null },
      { new: true, runValidators: true }
    );
    if (!supplier) return res.status(404).json({ ok: false, error: 'Supplier not found' });
    return res.json({ ok: true, supplier: serializeSupplier(supplier) });
  } catch (err) {
    console.error('suppliers.apiRestore error', err);
    return res.status(500).json({ ok: false, error: 'Failed to restore supplier' });
  }
};

exports.accountPage = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).send('Invalid supplier id');

    const supplier = await Supplier.findById(req.params.id).lean();
    if (!supplier) return res.status(404).send('Supplier not found');

    const txns = await SupplierAccountTxn.find({ supplier: supplier._id })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.render('suppliers/account', {
      title: 'Supplier Account',
      supplier,
      txns
    });
  } catch (err) {
    console.error('suppliers.accountPage error', err);
    return res.status(500).send('Error loading supplier account');
  }
};

exports.apiGetAccount = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Invalid supplier id' });
    }

    const supplier = await Supplier.findById(req.params.id).lean();
    if (!supplier) return res.status(404).json({ ok: false, error: 'Supplier not found' });

    const txns = await SupplierAccountTxn.find({ supplier: supplier._id })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      ok: true,
      supplier: {
        _id: supplier._id,
        name: supplier.name || '',
        balance: Number(supplier.balance || 0)
      },
      txns
    });
  } catch (err) {
    console.error('suppliers.apiGetAccount error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load supplier account' });
  }
};

exports.apiAdjustAccount = async (req, res) => {
  let session = null;

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid supplier id' });
    }

    const type = String(req.body.type || '').toLowerCase().trim();
    const rawAmount = Number(req.body.amount || 0);
    const note = String(req.body.note || '').trim();
    const requestedCashBookId = String(req.body.cashBookId || req.body.paymentCashBookId || req.body.cashBook || '').trim();
    const rawCashDirection = String(req.body.cashDirection || '').toLowerCase().trim();

    if (!['credit', 'debit'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'Invalid transaction type' });
    }
    if (!rawAmount || isNaN(rawAmount) || rawAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'Enter a valid amount' });
    }

    const amount = Number(rawAmount.toFixed(2));
    const defaultCashDirection = type === 'debit' ? 'outflow' : 'none';
    const cashDirection = rawCashDirection === 'inflow'
      ? 'inflow'
      : (rawCashDirection === 'outflow'
        ? 'outflow'
        : (rawCashDirection === 'none' ? 'none' : defaultCashDirection));
    if (cashDirection !== 'none' && !requestedCashBookId) {
      return res.status(400).json({ ok: false, error: 'Select the cash book used for this supplier transaction' });
    }

    const recordedBy = req.user?._id || null;
    const recordedByName = req.user?.name || req.user?.username || '';

    session = await mongoose.startSession();
    let updatedSupplier = null;

    await session.withTransaction(async () => {
      updatedSupplier = await Supplier.findById(id).session(session);
      if (!updatedSupplier) {
        const e = new Error('Supplier not found');
        e.statusCode = 404;
        throw e;
      }

      const cashBookContext = requestedCashBookId && cashDirection !== 'none'
        ? await resolvePaymentCashBookContext(req.body, session)
        : { cashBook: null, method: null, meta: {} };

      const currentBalance = Number(updatedSupplier.balance || 0);
      const delta = type === 'credit' ? amount : -amount;
      updatedSupplier.balance = Number((currentBalance + delta).toFixed(2));
      updatedSupplier.updatedBy = recordedBy || null;
      await updatedSupplier.save({ session });

      const txnDocs = await SupplierAccountTxn.create([{
        supplier: updatedSupplier._id,
        type,
        amount,
        note,
        cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
        cashBookName: cashBookContext.cashBook ? (cashBookContext.cashBook.name || '') : '',
        cashBookKind: cashBookContext.cashBook ? (cashBookContext.meta.cashBookKind || cashBookContext.cashBook.kind || 'cash') : null,
        cashDirection: cashBookContext.cashBook && cashDirection !== 'none' ? cashDirection : null,
        cashMeta: cashBookContext.meta || {},
        sourceType: 'supplier_account_adjustment',
        sourceId: updatedSupplier._id,
        sourceRef: updatedSupplier.name || String(updatedSupplier._id),
        recordedBy,
        recordedByName
      }], { session });
      const supplierTxn = txnDocs[0];

      if (cashBookContext.cashBook && cashDirection !== 'none') {
        await recordCashBookMovement({
          cashBook: cashBookContext.cashBook,
          type: cashDirection,
          amount,
          sourceType: 'supplier_account_adjustment',
          sourceId: updatedSupplier._id,
          sourceRef: updatedSupplier.name || String(updatedSupplier._id),
          note: `${type === 'credit' ? 'Credit' : 'Debit'} supplier account`,
          meta: Object.assign({ supplierId: String(updatedSupplier._id), adjustmentType: type }, cashBookContext.meta || {}),
          recordedBy,
          recordedByName,
          session
        });
      }

      const actor = actorFromReq(req);
      const dimensions = {
        supplierId: updatedSupplier._id,
        cashBookId: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
        cashBookName: cashBookContext.cashBook ? (cashBookContext.cashBook.name || '') : ''
      };

      let lines = [];
      if (type === 'credit') {
        lines = [
          { accountCode: ACCOUNTS.GENERAL_EXPENSE, debit: amount, dimensions },
          { accountCode: ACCOUNTS.ACCOUNTS_PAYABLE, credit: amount, dimensions }
        ];
      } else if (cashBookContext.cashBook && cashDirection === 'outflow') {
        lines = [
          { accountCode: ACCOUNTS.ACCOUNTS_PAYABLE, debit: amount, dimensions },
          { accountCode: ACCOUNTS.CASH, credit: amount, dimensions }
        ];
      } else if (cashBookContext.cashBook && cashDirection === 'inflow') {
        lines = [
          { accountCode: ACCOUNTS.CASH, debit: amount, dimensions },
          { accountCode: ACCOUNTS.ACCOUNTS_PAYABLE, credit: amount, dimensions }
        ];
      } else {
        lines = [
          { accountCode: ACCOUNTS.ACCOUNTS_PAYABLE, debit: amount, dimensions },
          { accountCode: ACCOUNTS.SUPPLIER_ADJUSTMENT_INCOME, credit: amount, dimensions }
        ];
      }

      await postJournalEntry({
        sourceKey: `supplier_account_txn:${supplierTxn._id}`,
        sourceType: 'supplier_account_adjustment',
        sourceId: supplierTxn._id,
        sourceRef: updatedSupplier.name || String(updatedSupplier._id),
        date: supplierTxn.createdAt || new Date(),
        memo: `${type === 'credit' ? 'Credit' : 'Debit'} supplier account`,
        postedBy: actor.postedBy,
        postedByName: actor.postedByName,
        lines,
        session
      });
    });

    return res.json({
      ok: true,
      balance: Number(updatedSupplier.balance || 0)
    });
  } catch (err) {
    console.error('suppliers.apiAdjustAccount error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ ok: false, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to update supplier account' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};
