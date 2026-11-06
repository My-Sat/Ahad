const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const ClassOnePrintJob = require('../models/classone_print_job');
const Printer = require('../models/printer');
const { buildFilters, page } = require('../controllers/classonePrintJobs');

test('ClassOne print-job filters validate dates and escape invoice search', () => {
  const schoolId = new mongoose.Types.ObjectId().toString();
  const printerId = new mongoose.Types.ObjectId().toString();
  const input = buildFilters({
    schoolId, printerId, invoice: 'C1.*', documentType: 'marking-scheme',
    from: '2026-11-01', to: '2026-11-04'
  });

  assert.equal(input.filters.schoolId, schoolId);
  assert.equal(String(input.filters.printer), printerId);
  assert.equal(input.filters.documentType, 'marking-scheme');
  assert.equal(input.filters.invoiceNumber.test('C1.*'), true);
  assert.equal(input.filters.invoiceNumber.test('C1-123'), false);
  assert.equal(input.filters.createdAt.$gte.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(input.filters.createdAt.$lt.toISOString(), '2026-11-05T00:00:00.000Z');
  assert.equal(buildFilters({ from: '2026-11-04', to: '2026-11-01' }), null);
  assert.equal(buildFilters({ from: '2026-02-30' }), null);
  assert.equal(buildFilters({ documentType: 'order' }), null);
  assert.equal(buildFilters({ schoolId: 'not-an-id' }), null);
});

test('ClassOne print-job page renders filtered, paginated bridge records without writes', async (t) => {
  const schoolId = new mongoose.Types.ObjectId().toString();
  const printerId = new mongoose.Types.ObjectId();
  const job = {
    createdAt: new Date('2026-11-04T10:00:00Z'), schoolName: 'Example School',
    invoiceNumber: 'C1P-2026-01', documentType: 'question-paper',
    pages: 3, copies: 20, impressions: 60, spoiledFaces: 0,
    revenuePesewas: 2500, type: 'monochrome', printMode: 'duplex',
    printer: { _id: printerId, name: 'Printer One' }
  };
  let queriedFilters;
  let skipped;
  t.mock.method(ClassOnePrintJob, 'aggregate', async (pipeline) => pipeline[0].$group
    ? [{ _id: schoolId, name: 'Example School' }]
    : [{ jobs: 26, copies: 520, impressions: 1560, revenuePesewas: 65000 }]);
  t.mock.method(Printer, 'find', () => ({
    select() { return this; }, sort() { return this; },
    async lean() { return [{ _id: printerId, name: 'Printer One' }]; }
  }));
  t.mock.method(ClassOnePrintJob, 'find', (filters) => {
    queriedFilters = filters;
    return {
      sort() { return this; }, skip(value) { skipped = value; return this; },
      limit() { return this; }, populate() { return this; },
      async lean() { return [job]; }
    };
  });
  let rendered;
  const response = { render(view, locals) { rendered = { view, locals }; } };

  await page({ query: { schoolId, page: '2' } }, response);

  assert.equal(rendered.view, 'admin/classone_print_jobs');
  assert.equal(queriedFilters.schoolId, schoolId);
  assert.equal(skipped, 25);
  assert.equal(rendered.locals.page, 2);
  assert.equal(rendered.locals.pages, 2);
  assert.match(rendered.locals.previousUrl, /schoolId=/);
  assert.equal(rendered.locals.nextUrl, null);
  assert.equal(rendered.locals.totalRevenueLabel, '650.00');
  assert.equal(rendered.locals.jobs[0].printerName, 'Printer One');
  assert.equal(rendered.locals.jobs[0].revenueLabel, '25.00');
});
