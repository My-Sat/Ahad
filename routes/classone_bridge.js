const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const CashBook = require('../models/cash_book');
const Printer = require('../models/printer');
const PrinterUsage = require('../models/printer_usage');
const ClassOneReceipt = require('../models/classone_receipt');
const ClassOneRefund = require('../models/classone_refund');
const ClassOneCreditTransfer = require('../models/classone_credit_transfer');
const ClassOnePrintJob = require('../models/classone_print_job');
const { ACCOUNTS, postJournalEntry, postPrinterDepreciation } = require('../utilities/accounting');

const router = express.Router();
const money = n => Number((n / 100).toFixed(2));
const text = (value, max = 150) => String(value || '').trim().slice(0, max);
const count = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
const receiptAllocations = (row) => {
  if (row.allocations === undefined) return [{ invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber, amountPesewas: row.amountPesewas, creditPesewas: 0 }];
  if (!Array.isArray(row.allocations) || !row.allocations.length || row.allocations.length > 50) return null;
  const allocations = row.allocations.map((item) => ({ invoiceId: item.invoiceId,
    invoiceNumber: text(item.invoiceNumber), amountPesewas: item.amountPesewas,
    creditPesewas: item.creditPesewas || 0 }));
  if (allocations.some((item) => !mongoose.isValidObjectId(item.invoiceId) ||
      !item.invoiceNumber || !Number.isSafeInteger(item.amountPesewas) || item.amountPesewas < 0 ||
      !Number.isSafeInteger(item.creditPesewas) || item.creditPesewas < 0 ||
      item.amountPesewas + item.creditPesewas < 1) ||
      new Set(allocations.map((item) => item.invoiceId)).size !== allocations.length ||
      allocations.reduce((sum, item) => sum + item.amountPesewas + item.creditPesewas, 0) !== row.amountPesewas ||
      !allocations.some((item) => item.invoiceId === row.invoiceId &&
        item.invoiceNumber === text(row.invoiceNumber))) return null;
  return allocations;
};

function authenticate(req, res, next) {
  const expected = process.env.CLASSONE_BRIDGE_KEY || '';
  const provided = req.get('x-classone-key') || '';
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (expected.length < 32 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'Invalid integration credentials' });
  }
  next();
}

router.use(authenticate);

router.get('/resources', async (req, res, next) => {
  try {
    const [printers, cashBooks] = await Promise.all([
      Printer.find().select('_id name location').sort({ name: 1 }).lean(),
      CashBook.find({ active: true }).select('_id name kind').sort({ name: 1 }).lean()
    ]);
    res.json({ ok: true, printers, cashBooks, features: { receiptAllocations: true,
      receiptCredits: true, refunds: true, creditTransfers: true } });
  } catch (error) { next(error); }
});

router.post('/credits', async (req, res, next) => {
  try {
    const row = req.body || {};
    if (!mongoose.isValidObjectId(row.sourceId) || !mongoose.isValidObjectId(row.schoolId) ||
        !mongoose.isValidObjectId(row.sourceInvoiceId) || !mongoose.isValidObjectId(row.targetInvoiceId) ||
        row.sourceInvoiceId === row.targetInvoiceId || !count(row.amountPesewas, 1000000000) ||
        !Number.isSafeInteger(row.sourceInvoiceTotalPesewas) || row.sourceInvoiceTotalPesewas < 0 ||
        !text(row.sourceInvoiceNumber) || !text(row.targetInvoiceNumber) ||
        !row.appliedAt || Number.isNaN(new Date(row.appliedAt).getTime())) {
      return res.status(400).json({ ok: false, error: 'Invalid ClassOne credit transfer' });
    }
    const existing = await ClassOneCreditTransfer.findOne({ sourceId: row.sourceId }).lean();
    if (existing) {
      if (existing.schoolId !== row.schoolId || existing.sourceInvoiceId !== row.sourceInvoiceId ||
          existing.targetInvoiceId !== row.targetInvoiceId || existing.amountPesewas !== row.amountPesewas) {
        return res.status(409).json({ ok: false, error: 'Credit transfer ID was previously used with different details' });
      }
      return res.json({ ok: true, transferId: String(existing._id), duplicate: true });
    }
    const [receipts, transfers, refunds] = await Promise.all([
      ClassOneReceipt.find({ schoolId: row.schoolId, $or: [{ invoiceId: row.sourceInvoiceId },
        { 'allocations.invoiceId': row.sourceInvoiceId }] }).lean(),
      ClassOneCreditTransfer.find({ schoolId: row.schoolId, $or: [
        { sourceInvoiceId: row.sourceInvoiceId }, { targetInvoiceId: row.sourceInvoiceId }] }).lean(),
      ClassOneRefund.find({ schoolId: row.schoolId, invoiceId: row.sourceInvoiceId }).lean()
    ]);
    const received = receipts.reduce((sum, receipt) => sum + (receipt.allocations?.length
      ? receipt.allocations.filter((allocation) => allocation.invoiceId === row.sourceInvoiceId)
        .reduce((part, allocation) => part + allocation.amountPesewas + (allocation.creditPesewas || 0), 0)
      : receipt.invoiceId === row.sourceInvoiceId ? receipt.amountPesewas : 0), 0);
    const inbound = transfers.filter((transfer) => transfer.targetInvoiceId === row.sourceInvoiceId)
      .reduce((sum, transfer) => sum + transfer.amountPesewas, 0);
    const outbound = transfers.filter((transfer) => transfer.sourceInvoiceId === row.sourceInvoiceId)
      .reduce((sum, transfer) => sum + transfer.amountPesewas, 0);
    const refunded = refunds.reduce((sum, refund) => sum + refund.amountPesewas, 0);
    if (received + inbound - outbound - refunded - row.sourceInvoiceTotalPesewas < row.amountPesewas) {
      return res.status(409).json({ ok: false, error: 'The source invoice has insufficient ClassOne credit' });
    }
    let created;
    await mongoose.connection.transaction(async (session) => {
      [created] = await ClassOneCreditTransfer.create([{ sourceId: row.sourceId,
        schoolId: row.schoolId, sourceInvoiceId: row.sourceInvoiceId,
        targetInvoiceId: row.targetInvoiceId, sourceInvoiceNumber: text(row.sourceInvoiceNumber),
        targetInvoiceNumber: text(row.targetInvoiceNumber), amountPesewas: row.amountPesewas,
        appliedAt: new Date(row.appliedAt) }], { session });
      await postJournalEntry({ sourceKey: `classone:credit:${row.sourceId}`,
        sourceType: 'classone_credit_transfer', sourceId: created._id,
        sourceRef: row.targetInvoiceNumber, date: created.appliedAt,
        memo: `ClassOne school credit ${row.sourceInvoiceNumber} to ${row.targetInvoiceNumber}`,
        session, lines: [
          { accountCode: ACCOUNTS.CUSTOMER_CREDITS, debit: money(row.amountPesewas),
            dimensions: { classOneSchoolId: row.schoolId, classOneInvoiceId: row.sourceInvoiceId } },
          { accountCode: ACCOUNTS.CUSTOMER_CREDITS, credit: money(row.amountPesewas),
            dimensions: { classOneSchoolId: row.schoolId, classOneInvoiceId: row.targetInvoiceId } }
        ] });
    });
    res.status(201).json({ ok: true, transferId: String(created._id) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ ok: false, error: 'Credit transfer is already being synchronized; retry shortly' });
    next(error);
  }
});

router.post('/receipts', async (req, res, next) => {
  try {
    const row = req.body || {};
    if (!mongoose.isValidObjectId(row.sourceId) || !mongoose.isValidObjectId(row.invoiceId) ||
        !mongoose.isValidObjectId(row.schoolId) || !mongoose.isValidObjectId(row.cashBookId) ||
        !count(row.amountPesewas, 1000000000) || !['cash', 'bank', 'mobile-money'].includes(row.method) ||
        !text(row.invoiceNumber) || !text(row.schoolName) || !text(row.reference) ||
        !row.receivedAt || Number.isNaN(new Date(row.receivedAt).getTime())) {
      return res.status(400).json({ ok: false, error: 'Invalid ClassOne receipt' });
    }
    const allocations = receiptAllocations(row);
    if (!allocations) return res.status(400).json({ ok: false, error: 'Invalid receipt allocations' });
    const existing = await ClassOneReceipt.findOne({ sourceId: row.sourceId }).lean();
    if (existing) {
      const prior = existing.allocations?.length ? existing.allocations.map((item) => ({
        invoiceId: item.invoiceId, invoiceNumber: item.invoiceNumber, amountPesewas: item.amountPesewas,
        creditPesewas: item.creditPesewas || 0
      })) : [{ invoiceId: existing.invoiceId, invoiceNumber: existing.invoiceNumber,
        amountPesewas: existing.amountPesewas, creditPesewas: 0 }];
      if (existing.invoiceId !== row.invoiceId || existing.amountPesewas !== row.amountPesewas ||
          String(existing.cashBook) !== row.cashBookId || existing.method !== row.method ||
          existing.reference !== text(row.reference) || existing.schoolId !== row.schoolId ||
          JSON.stringify(prior) !== JSON.stringify(allocations)) {
        return res.status(409).json({ ok: false, error: 'Receipt ID was previously used with different details' });
      }
      return res.json({ ok: true, receiptId: String(existing._id), duplicate: true,
        allocationCount: allocations.length });
    }
    const cashBook = await CashBook.findOne({ _id: row.cashBookId, active: true }).lean();
    const expectedKind = row.method === 'mobile-money' ? 'momo' : row.method;
    if (!cashBook || cashBook.kind !== expectedKind) {
      return res.status(400).json({ ok: false, error: 'Select a matching active Ahad cash book' });
    }
    let created;
    await mongoose.connection.transaction(async session => {
      const [receipt] = await ClassOneReceipt.create([{
        sourceId: row.sourceId, invoiceId: row.invoiceId,
        invoiceNumber: text(row.invoiceNumber), schoolId: row.schoolId,
        schoolName: text(row.schoolName), cashBook: cashBook._id,
        amountPesewas: row.amountPesewas, method: row.method,
        reference: text(row.reference), receivedAt: new Date(row.receivedAt), allocations
      }], { session });
      const dimensions = { cashBookId: cashBook._id, cashBookName: cashBook.name,
        classOneSchoolId: row.schoolId };
      await postJournalEntry({
        sourceKey: `classone:receipt:${row.sourceId}`, sourceType: 'classone_receipt',
        sourceId: receipt._id, sourceRef: row.invoiceNumber,
        date: receipt.receivedAt,
        memo: `ClassOne printing receipt ${row.invoiceNumber} - ${row.schoolName}`,
        session, lines: [
          { accountCode: ACCOUNTS.CASH, debit: money(row.amountPesewas), dimensions },
          ...allocations.map((allocation) => ({ accountCode: ACCOUNTS.CUSTOMER_CREDITS,
            credit: money(allocation.amountPesewas + allocation.creditPesewas),
            dimensions: { ...dimensions, classOneInvoiceId: allocation.invoiceId } }))
        ]
      });
      await CashBook.updateOne({ _id: cashBook._id }, { $inc: { balance: money(row.amountPesewas) } }, { session });
      created = receipt;
    });
    res.status(201).json({ ok: true, receiptId: String(created._id),
      allocationCount: allocations.length });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ ok: false, error: 'Receipt is already being synchronized; retry shortly' });
    next(error);
  }
});

router.post('/refunds', async (req, res, next) => {
  try {
    const row = req.body || {};
    if (!mongoose.isValidObjectId(row.sourceId) || !mongoose.isValidObjectId(row.invoiceId) ||
        !mongoose.isValidObjectId(row.schoolId) || !mongoose.isValidObjectId(row.cashBookId) ||
        !count(row.amountPesewas, 1000000000) || !['cash', 'bank', 'mobile-money'].includes(row.method) ||
        !text(row.invoiceNumber) || !text(row.schoolName) || !text(row.reference) ||
        !row.refundedAt || Number.isNaN(new Date(row.refundedAt).getTime())) {
      return res.status(400).json({ ok: false, error: 'Invalid ClassOne refund' });
    }
    const existing = await ClassOneRefund.findOne({ sourceId: row.sourceId }).lean();
    if (existing) {
      if (existing.invoiceId !== row.invoiceId || existing.amountPesewas !== row.amountPesewas ||
          String(existing.cashBook) !== row.cashBookId || existing.reference !== text(row.reference) ||
          existing.method !== row.method) {
        return res.status(409).json({ ok: false, error: 'Refund ID was previously used with different details' });
      }
      return res.json({ ok: true, refundId: String(existing._id), duplicate: true });
    }
    const cashBook = await CashBook.findOne({ _id: row.cashBookId, active: true }).lean();
    if (!cashBook || cashBook.kind !== (row.method === 'mobile-money' ? 'momo' : row.method)) {
      return res.status(400).json({ ok: false, error: 'Select a matching active Ahad cash book for the refund' });
    }
    const receipts = await ClassOneReceipt.find({ $or: [{ invoiceId: row.invoiceId },
      { 'allocations.invoiceId': row.invoiceId }] }).lean();
    const received = receipts.reduce((sum, receipt) => sum + (receipt.allocations?.length
      ? receipt.allocations.filter((item) => item.invoiceId === row.invoiceId)
        .reduce((total, item) => total + item.amountPesewas + (item.creditPesewas || 0), 0)
      : receipt.invoiceId === row.invoiceId ? receipt.amountPesewas : 0), 0);
    const previousRefunds = await ClassOneRefund.find({ invoiceId: row.invoiceId }).lean();
    const refunded = previousRefunds.reduce((sum, refund) => sum + refund.amountPesewas, 0);
    const transfers = await ClassOneCreditTransfer.find({ schoolId: row.schoolId, $or: [
      { sourceInvoiceId: row.invoiceId }, { targetInvoiceId: row.invoiceId }] }).lean();
    const transferredIn = transfers.filter((transfer) => transfer.targetInvoiceId === row.invoiceId)
      .reduce((sum, transfer) => sum + transfer.amountPesewas, 0);
    const transferredOut = transfers.filter((transfer) => transfer.sourceInvoiceId === row.invoiceId)
      .reduce((sum, transfer) => sum + transfer.amountPesewas, 0);
    if (!Number.isSafeInteger(row.invoiceTotalPesewas) || row.invoiceTotalPesewas < 0 ||
        received + transferredIn - transferredOut - refunded - row.amountPesewas < row.invoiceTotalPesewas) {
      return res.status(409).json({ ok: false, error: 'Refund exceeds the unspent ClassOne invoice credit' });
    }
    let created;
    await mongoose.connection.transaction(async session => {
      const updated = await CashBook.updateOne({ _id: cashBook._id, balance: { $gte: money(row.amountPesewas) } },
        { $inc: { balance: -money(row.amountPesewas) } }, { session });
      if (updated.modifiedCount !== 1) {
        const error = new Error('The Ahad cash book has insufficient funds for this refund');
        error.code = 'INSUFFICIENT_FUNDS';
        throw error;
      }
      [created] = await ClassOneRefund.create([{ sourceId: row.sourceId, invoiceId: row.invoiceId,
        invoiceNumber: text(row.invoiceNumber), schoolId: row.schoolId, schoolName: text(row.schoolName),
        cashBook: cashBook._id, amountPesewas: row.amountPesewas, method: row.method,
        reference: text(row.reference), refundedAt: new Date(row.refundedAt) }], { session });
      const dimensions = { cashBookId: cashBook._id, cashBookName: cashBook.name,
        classOneSchoolId: row.schoolId, classOneInvoiceId: row.invoiceId };
      await postJournalEntry({ sourceKey: `classone:refund:${row.sourceId}`,
        sourceType: 'classone_refund', sourceId: created._id, sourceRef: row.invoiceNumber,
        date: created.refundedAt, memo: `ClassOne printing refund ${row.invoiceNumber} - ${row.schoolName}`,
        session, lines: [
          { accountCode: ACCOUNTS.CUSTOMER_CREDITS, debit: money(row.amountPesewas), dimensions },
          { accountCode: ACCOUNTS.CASH, credit: money(row.amountPesewas), dimensions }
        ] });
    });
    res.status(201).json({ ok: true, refundId: String(created._id) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ ok: false, error: 'Refund is already being synchronized; retry shortly' });
    if (error.code === 'INSUFFICIENT_FUNDS') return res.status(409).json({ ok: false, error: error.message });
    next(error);
  }
});

router.post('/prints', async (req, res, next) => {
  try {
    const row = req.body || {};
    const valid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(row.attemptId || '')) &&
      mongoose.isValidObjectId(row.paperId) && mongoose.isValidObjectId(row.schoolId) &&
      mongoose.isValidObjectId(row.printerId) && mongoose.isValidObjectId(row.invoiceId) &&
      count(row.pages, 200) && count(row.copies, 10000) &&
      Number.isSafeInteger(row.spoiledFaces) && row.spoiledFaces >= 0 && row.spoiledFaces <= 100000 &&
      Number.isSafeInteger(row.revenuePesewas) && row.revenuePesewas >= 0 && row.revenuePesewas <= 1000000000 &&
      ['question-paper', 'marking-scheme'].includes(row.documentType) &&
      ['monochrome', 'colour'].includes(row.type) && ['single', 'duplex'].includes(row.printMode);
    if (!valid || !text(row.invoiceNumber) || !text(row.schoolName)) {
      return res.status(400).json({ ok: false, error: 'Invalid ClassOne print job' });
    }
    const impressions = row.pages * row.copies + row.spoiledFaces;
    if (!Number.isSafeInteger(impressions) || impressions > 1000000) {
      return res.status(400).json({ ok: false, error: 'Too many printed impressions' });
    }
    const existing = await ClassOnePrintJob.findOne({ attemptId: row.attemptId }).lean();
    if (existing) {
      if (existing.paperId !== row.paperId || existing.impressions !== impressions ||
          String(existing.printer) !== row.printerId || existing.revenuePesewas !== row.revenuePesewas ||
          existing.documentType !== row.documentType || existing.type !== row.type ||
          existing.printMode !== row.printMode || existing.schoolId !== row.schoolId) {
        return res.status(409).json({ ok: false, error: 'Print attempt ID was previously used with different details' });
      }
      return res.json({ ok: true, jobId: String(existing._id), duplicate: true });
    }
    if (!(await Printer.exists({ _id: row.printerId }))) {
      return res.status(404).json({ ok: false, error: 'Ahad printer not found' });
    }
    if (row.revenuePesewas > 0) {
      const [receipts, transfers, jobs] = await Promise.all([
        ClassOneReceipt.aggregate([
          { $match: { $or: [{ invoiceId: row.invoiceId }, { 'allocations.invoiceId': row.invoiceId }] } },
          { $project: { amount: { $cond: [
            { $gt: [{ $size: { $ifNull: ['$allocations', []] } }, 0] },
            { $sum: { $map: { input: { $filter: { input: '$allocations', as: 'item',
              cond: { $eq: ['$$item.invoiceId', row.invoiceId] } } }, as: 'item', in: '$$item.amountPesewas' } } },
            { $cond: [{ $eq: ['$invoiceId', row.invoiceId] }, '$amountPesewas', 0] }
          ] } } },
          { $group: { _id: null, amount: { $sum: '$amount' } } }
        ]),
        ClassOneCreditTransfer.aggregate([{ $match: { targetInvoiceId: row.invoiceId } },
          { $group: { _id: null, amount: { $sum: '$amountPesewas' } } }]),
        ClassOnePrintJob.aggregate([{ $match: { invoiceId: row.invoiceId } }, { $group: { _id: null, amount: { $sum: '$revenuePesewas' } } }])
      ]);
      if ((receipts[0]?.amount || 0) + (transfers[0]?.amount || 0) <
          (jobs[0]?.amount || 0) + row.revenuePesewas) {
        return res.status(409).json({ ok: false, error: 'Sync the verified ClassOne receipts before printing' });
      }
    }
    let created;
    await mongoose.connection.transaction(async session => {
      const [job] = await ClassOnePrintJob.create([{
        attemptId: row.attemptId, invoiceId: row.invoiceId,
        invoiceNumber: text(row.invoiceNumber), paperId: row.paperId,
        schoolId: row.schoolId, schoolName: text(row.schoolName),
        documentType: row.documentType, printer: row.printerId,
        pages: row.pages, copies: row.copies, spoiledFaces: row.spoiledFaces,
        impressions, type: row.type, printMode: row.printMode,
        revenuePesewas: row.revenuePesewas
      }], { session });
      const [usage] = await PrinterUsage.create([{
        printer: row.printerId, orderId: row.invoiceNumber,
        count: impressions, type: row.type,
        note: `ClassOne ${row.documentType} ${row.paperId}, ${row.copies} copies, ${row.printMode}`
      }], { session });
      const increment = { totalCount: impressions, [row.type === 'colour' ? 'colourCount' : 'monochromeCount']: impressions };
      await Printer.updateOne({ _id: row.printerId }, { $inc: increment }, { session });
      if (row.revenuePesewas > 0) {
        const dimensions = { classOneSchoolId: row.schoolId, classOneInvoiceId: row.invoiceId,
          classOnePaperId: row.paperId, printerId: row.printerId };
        await postJournalEntry({
          sourceKey: `classone:print:${row.attemptId}`, sourceType: 'classone_print_revenue',
          sourceId: job._id, sourceRef: row.invoiceNumber,
          memo: `ClassOne printing completed ${row.invoiceNumber} - ${row.schoolName}`,
          session, lines: [
            { accountCode: ACCOUNTS.CUSTOMER_CREDITS, debit: money(row.revenuePesewas), dimensions },
            { accountCode: ACCOUNTS.SALES_REVENUE, credit: money(row.revenuePesewas), dimensions }
          ]
        });
      }
      await postPrinterDepreciation(usage, {}, session);
      created = job;
    });
    res.status(201).json({ ok: true, jobId: String(created._id), impressions });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ ok: false, error: 'Print attempt is already being synchronized; retry shortly' });
    next(error);
  }
});

router.use((error, req, res, next) => {
  console.error('ClassOne bridge error:', error);
  res.status(500).json({ ok: false, error: 'Ahad could not record this ClassOne event' });
});

module.exports = router;
