const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const mongoose = require('mongoose');
const ClassOneReceipt = require('../models/classone_receipt');
const ClassOneRefund = require('../models/classone_refund');
const ClassOneCreditTransfer = require('../models/classone_credit_transfer');
const ClassOnePrintJob = require('../models/classone_print_job');
const bridge = require('../routes/classone_bridge');

const id = () => new mongoose.Types.ObjectId().toString();

test('ClassOne bridge requires its secret and rejects malformed events', async (t) => {
  const previous = process.env.CLASSONE_BRIDGE_KEY;
  process.env.CLASSONE_BRIDGE_KEY = 'test-only-integration-secret-32-characters';
  t.after(() => {
    if (previous === undefined) delete process.env.CLASSONE_BRIDGE_KEY;
    else process.env.CLASSONE_BRIDGE_KEY = previous;
  });
  const app = express();
  app.use(express.json());
  app.use('/integrations/classone', bridge);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/integrations/classone`;
  const post = (path, body, key = 'test-only-integration-secret-32-characters') => fetch(`${url}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-classone-key': key },
    body: JSON.stringify(body)
  });

  assert.equal((await post('/prints', {}, 'wrong-key')).status, 401);
  assert.equal((await post('/prints', {})).status, 400);
  assert.equal((await post('/receipts', {})).status, 400);

  const receipt = { sourceId: id(), invoiceId: id(), schoolId: id(), cashBookId: id(),
    invoiceNumber: 'C1P-test', schoolName: 'Test School', amountPesewas: 500,
    method: 'bank', reference: 'BANK-123', receivedAt: '2026-11-01T12:00:00.000Z' };
  let existingReceipt = { _id: id(), ...receipt,
    cashBook: new mongoose.Types.ObjectId(receipt.cashBookId) };
  t.mock.method(ClassOneReceipt, 'findOne', () => ({ lean: async () => existingReceipt }));
  const replay = await post('/receipts', receipt);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);
  assert.equal((await post('/receipts', { ...receipt, amountPesewas: 600 })).status, 409);
  const multi = { ...receipt, allocations: [
    { invoiceId: receipt.invoiceId, invoiceNumber: receipt.invoiceNumber, amountPesewas: 300 },
    { invoiceId: id(), invoiceNumber: 'C1P-second', amountPesewas: 200 }
  ] };
  assert.equal((await post('/receipts', multi)).status, 409);
  assert.equal((await post('/receipts', { ...multi, allocations: [
    { ...multi.allocations[0], amountPesewas: 400 }, multi.allocations[1]
  ] })).status, 400);
  existingReceipt = { ...existingReceipt, allocations: multi.allocations };
  assert.equal((await post('/receipts', multi)).status, 200);
  const credited = { ...receipt, amountPesewas: 400, allocations: [
    { invoiceId: receipt.invoiceId, invoiceNumber: receipt.invoiceNumber,
      amountPesewas: 300, creditPesewas: 100 }
  ] };
  existingReceipt = { ...existingReceipt, amountPesewas: 400, allocations: credited.allocations };
  assert.equal((await post('/receipts', credited)).status, 200);

  const print = { attemptId: '12345678-1234-4123-8123-123456789abc', invoiceId: receipt.invoiceId,
    paperId: id(), schoolId: receipt.schoolId, printerId: id(), invoiceNumber: receipt.invoiceNumber,
    schoolName: receipt.schoolName, documentType: 'question-paper', pages: 3, copies: 20,
    spoiledFaces: 0, revenuePesewas: 1000, type: 'monochrome', printMode: 'duplex' };
  t.mock.method(ClassOnePrintJob, 'findOne', () => ({ lean: async () => ({
    _id: id(), ...print, printer: new mongoose.Types.ObjectId(print.printerId), impressions: 60
  }) }));
  const replayPrint = await post('/prints', print);
  assert.equal(replayPrint.status, 200);
  assert.equal((await replayPrint.json()).duplicate, true);
  assert.equal((await post('/prints', { ...print, copies: 21 })).status, 409);
});

test('ClassOne refund replay is idempotent and cannot exceed unspent invoice credit', async (t) => {
  const previous = process.env.CLASSONE_BRIDGE_KEY;
  process.env.CLASSONE_BRIDGE_KEY = 'test-only-integration-secret-32-characters';
  t.after(() => {
    if (previous === undefined) delete process.env.CLASSONE_BRIDGE_KEY;
    else process.env.CLASSONE_BRIDGE_KEY = previous;
  });
  const app = express();
  app.use(express.json());
  app.use('/integrations/classone', bridge);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/integrations/classone/refunds`;
  const post = (body) => fetch(url, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-classone-key': process.env.CLASSONE_BRIDGE_KEY },
    body: JSON.stringify(body) });
  const refund = { sourceId: id(), invoiceId: id(), schoolId: id(), cashBookId: id(),
    invoiceNumber: 'C1P-test', schoolName: 'Test School', amountPesewas: 100,
    invoiceTotalPesewas: 300, method: 'bank', reference: 'BANK-REFUND-1',
    refundedAt: '2026-11-01T12:00:00.000Z' };
  let existing = { _id: id(), ...refund, cashBook: new mongoose.Types.ObjectId(refund.cashBookId) };
  t.mock.method(ClassOneRefund, 'findOne', () => ({ lean: async () => existing }));
  assert.equal((await post(refund)).status, 200);
  assert.equal((await post({ ...refund, amountPesewas: 101 })).status, 409);
  existing = null;
  t.mock.method(require('../models/cash_book'), 'findOne', () => ({ lean: async () => ({
    _id: refund.cashBookId, kind: 'bank', active: true }) }));
  t.mock.method(ClassOneReceipt, 'find', () => ({ lean: async () => [{ invoiceId: refund.invoiceId,
    amountPesewas: 400 }] }));
  t.mock.method(ClassOneRefund, 'find', () => ({ lean: async () => [] }));
  t.mock.method(ClassOneCreditTransfer, 'find', () => ({ lean: async () => [] }));
  assert.equal((await post({ ...refund, amountPesewas: 101 })).status, 409);
  assert.equal((await post({ ...refund, invoiceTotalPesewas: 401 })).status, 409);
});

test('ClassOne school-credit replay is idempotent and rejects unbacked transfers', async (t) => {
  const previous = process.env.CLASSONE_BRIDGE_KEY;
  process.env.CLASSONE_BRIDGE_KEY = 'test-only-integration-secret-32-characters';
  t.after(() => {
    if (previous === undefined) delete process.env.CLASSONE_BRIDGE_KEY;
    else process.env.CLASSONE_BRIDGE_KEY = previous;
  });
  const app = express();
  app.use(express.json());
  app.use('/integrations/classone', bridge);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/integrations/classone/credits`;
  const post = (body) => fetch(url, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-classone-key': process.env.CLASSONE_BRIDGE_KEY },
    body: JSON.stringify(body) });
  const transfer = { sourceId: id(), schoolId: id(), sourceInvoiceId: id(),
    targetInvoiceId: id(), sourceInvoiceNumber: 'C1P-source', targetInvoiceNumber: 'C1P-target',
    sourceInvoiceTotalPesewas: 1000, amountPesewas: 100,
    appliedAt: '2026-11-01T12:00:00.000Z' };
  let existing = { _id: id(), ...transfer };
  t.mock.method(ClassOneCreditTransfer, 'findOne', () => ({ lean: async () => existing }));
  assert.equal((await post(transfer)).status, 200);
  assert.equal((await post({ ...transfer, amountPesewas: 101 })).status, 409);
  existing = null;
  t.mock.method(ClassOneReceipt, 'find', () => ({ lean: async () => [{ invoiceId: transfer.sourceInvoiceId,
    amountPesewas: 1099 }] }));
  t.mock.method(ClassOneCreditTransfer, 'find', () => ({ lean: async () => [] }));
  t.mock.method(ClassOneRefund, 'find', () => ({ lean: async () => [] }));
  assert.equal((await post(transfer)).status, 409);
});
