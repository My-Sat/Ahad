const mongoose = require('mongoose');
const ClassOnePrintJob = require('../models/classone_print_job');
const Printer = require('../models/printer');

const PAGE_SIZE = 25;
const formatDate = new Intl.DateTimeFormat('en-GH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Accra'
});

function parseDay(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function buildFilters(query) {
  const schoolId = String(query.schoolId || '').trim();
  const invoice = String(query.invoice || '').trim().slice(0, 80);
  const printerId = String(query.printerId || '').trim();
  const documentType = String(query.documentType || '').trim();
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  if ((schoolId && !mongoose.isValidObjectId(schoolId)) ||
      (printerId && !mongoose.isValidObjectId(printerId)) ||
      (documentType && !['question-paper', 'marking-scheme'].includes(documentType)) ||
      (from && !parseDay(from)) || (to && !parseDay(to)) ||
      (from && to && from > to)) {
    return null;
  }
  const filters = {};
  if (schoolId) filters.schoolId = schoolId;
  if (invoice) filters.invoiceNumber = new RegExp(invoice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (printerId) filters.printer = new mongoose.Types.ObjectId(printerId);
  if (documentType) filters.documentType = documentType;
  if (from || to) {
    filters.createdAt = {};
    if (from) filters.createdAt.$gte = parseDay(from);
    if (to) filters.createdAt.$lt = new Date(parseDay(to).getTime() + 86400000);
  }
  return { filters, selected: { schoolId, invoice, printerId, documentType, from, to } };
}

exports.page = async (req, res) => {
  const input = buildFilters(req.query || {});
  if (!input) return res.status(400).send('Invalid ClassOne print-job filters');
  try {
    const [schools, printers, totals] = await Promise.all([
      ClassOnePrintJob.aggregate([
        { $group: { _id: '$schoolId', name: { $first: '$schoolName' } } },
        { $sort: { name: 1 } }
      ]),
      Printer.find().select('_id name').sort({ name: 1 }).lean(),
      ClassOnePrintJob.aggregate([
        { $match: input.filters },
        { $group: { _id: null, jobs: { $sum: 1 }, copies: { $sum: '$copies' },
          impressions: { $sum: '$impressions' }, revenuePesewas: { $sum: '$revenuePesewas' } } }
      ])
    ]);
    const summary = totals[0] || { jobs: 0, copies: 0, impressions: 0, revenuePesewas: 0 };
    const pages = Math.max(1, Math.ceil(summary.jobs / PAGE_SIZE));
    const requestedPage = Number(req.query.page);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, pages) : 1;
    const jobs = await ClassOnePrintJob.find(input.filters)
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
      .populate('printer', 'name location').lean();
    const pageUrl = (number) => `/admin/classone-print-jobs?${new URLSearchParams({
      ...Object.fromEntries(Object.entries(input.selected).filter(([, value]) => value)),
      page: String(number)
    })}`;
    return res.render('admin/classone_print_jobs', {
      schools, printers, summary, selected: input.selected, page, pages,
      previousUrl: page > 1 ? pageUrl(page - 1) : null,
      nextUrl: page < pages ? pageUrl(page + 1) : null,
      jobs: jobs.map((job) => ({
        ...job,
        printedAtLabel: formatDate.format(job.createdAt),
        printerName: job.printer?.name || 'Printer unavailable',
        documentLabel: job.documentType === 'marking-scheme' ? 'Marking scheme' : 'Question paper',
        revenueLabel: (job.revenuePesewas / 100).toFixed(2)
      })),
      totalRevenueLabel: (summary.revenuePesewas / 100).toFixed(2)
    });
  } catch (error) {
    console.error('classonePrintJobs.page error', error);
    return res.status(500).send('Failed to load ClassOne print jobs');
  }
};

exports.buildFilters = buildFilters;
