// controllers/books.js
const mongoose = require('mongoose');
const Service = require('../models/service');
const ServicePrice = require('../models/service_price');
const Book = require('../models/book'); // assume you have a Book model
const { ObjectId } = mongoose.Types;

/**
 * Helper: build selectionLabel from populated ServicePrice doc
 */
function buildSelectionLabelFromPrice(pr) {
  try {
    if (pr.selectionLabel) return pr.selectionLabel;
    if (!pr.selections || !pr.selections.length) return '';
    return (pr.selections || []).map(s => {
      const u = (s.unit && s.unit.name) ? s.unit.name : (s.unit ? String(s.unit) : '');
      const su = (s.subUnit && s.subUnit.name) ? s.subUnit.name : (s.subUnit ? String(s.subUnit) : '');
      return `${u}: ${su}`;
    }).join(' + ');
  } catch (e) {
    return '';
  }
}

/**
 * Compute effective unit price & subtotal for an item spec:
 * itemSpec: { priceRuleId, pages (number), fb (bool), spoiled (int) }
 * Returns { unitPrice, effectiveQty, subtotal, selectionLabel, serviceId }
 */
async function computeItemSnapshot(itemSpec) {
  if (!itemSpec || !itemSpec.priceRuleId) throw new Error('Missing priceRuleId');

  if (!ObjectId.isValid(itemSpec.priceRuleId)) throw new Error('Invalid priceRuleId');

  const pr = await ServicePrice.findById(itemSpec.priceRuleId)
    .populate('selections.unit selections.subUnit')
    .lean();

  if (!pr) throw new Error(`Price rule not found: ${itemSpec.priceRuleId}`);

  // choose unitPrice: use price2 if fb and price2 present; otherwise price
  const wantFb = !!itemSpec.fb;
  let unitPrice = Number(pr.price || 0);
  if (wantFb && pr.price2 !== undefined && pr.price2 !== null) {
    unitPrice = Number(pr.price2);
  }

  const pages = Number(itemSpec.pages || 1) || 1;
  const effectiveQty = wantFb ? Math.ceil(pages / 2) : pages;
  const spoiled = itemSpec.spoiled !== undefined && itemSpec.spoiled !== null ? Math.max(0, Math.floor(Number(itemSpec.spoiled) || 0)) : 0;
  const totalCount = Math.max(0, effectiveQty) + Math.max(0, spoiled);
  const subtotal = Number((unitPrice * effectiveQty).toFixed(2));

  const selectionLabel = buildSelectionLabelFromPrice(pr);

  return {
    unitPrice,
    effectiveQty,
    subtotal,
    selectionLabel,
    serviceId: pr.service || null,
    rawPriceRule: pr
  };
}

/**
 * GET /books/list
 * returns JSON: { ok: true, books: [{ _id, name, unitPrice }] }
 */
exports.list = async (req, res) => {
  try {
    // lightweight list: id, name, unitPrice
    const rows = await Book.find({}, { name: 1, unitPrice: 1 }).sort({ name: 1 }).lean();
    const books = (rows || []).map(r => ({ _id: r._id, name: r.name, unitPrice: Number(r.unitPrice || 0) }));
    return res.json({ ok: true, books });
  } catch (err) {
    console.error('books.list error', err);
    return res.status(500).json({ ok: false, error: 'Error fetching books' });
  }
};

/**
 * GET /books/new  --> render create page (server-rendered UI)
 */
exports.getNewPage = async (req, res) => {
  try {
    // load services & price rules to let the "Add and Cost Book" page populate UI
    const services = await Service.find().select('_id name requiresPrinter components').lean();
    // we will not eagerly load every price rule here; client will request /admin/services/:id/prices as before
    return res.render('books/new', {
      title: 'Add and Cost Book',
      services
    });
  } catch (err) {
    console.error('books.getNewPage error', err);
    return res.status(500).send('Error loading book editor');
  }
};

/**
 * GET /books/:id  (AJAX JSON) - returns book details OR { ok:true, book: null } for 'new'
 * Note: route ordering must have /new BEFORE /:id to avoid "new" being treated as an id.
 */
exports.get = async (req, res) => {
  try {
    const id = req.params.id;

    // special-case 'new' (do not attempt findById)
    if (id === 'new') {
      return res.json({ ok: true, book: null });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid book id' });
    }

    const book = await Book.findById(id).lean();
    if (!book) return res.status(404).json({ ok: false, error: 'Book not found' });

    // ensure items have selectionLabel/unitPrice/subtotal (in case older books miss them)
    const items = [];
    for (const it of (book.items || [])) {
      if (it.priceRule && (!it.unitPrice || !it.subtotal || !it.selectionLabel)) {
        try {
          const snap = await computeItemSnapshot({
            priceRuleId: it.priceRule,
            pages: it.pages,
            fb: it.fb,
            spoiled: it.spoiled
          });
          items.push(Object.assign({}, it, {
            unitPrice: snap.unitPrice,
            subtotal: snap.subtotal,
            selectionLabel: snap.selectionLabel
          }));
        } catch (e) {
          // if compute fails for a saved book item, preserve what's stored
          items.push(it);
        }
      } else {
        items.push(it);
      }
    }

    const out = Object.assign({}, book, { items });
    return res.json({ ok: true, book: out });
  } catch (err) {
    console.error('books.get error', err);
    return res.status(500).json({ ok: false, error: 'Error fetching book' });
  }
};

/**
 * POST /books
 * Body: { name, items: [ { priceRuleId, pages, fb, printerId, spoiled } ] }
 * Computes per-item unitPrice & subtotal using ServicePrice server authoritative logic,
 * stores book with snapshots: service, priceRule, pages, fb, printer, spoiled, unitPrice, subtotal, selectionLabel
 */
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    const name = (body.name || '').trim();
    const itemsIn = Array.isArray(body.items) ? body.items : [];

    if (!name) return res.status(400).json({ ok: false, error: 'Book name is required' });
    if (!itemsIn.length) return res.status(400).json({ ok: false, error: 'At least one item is required' });

    const itemsOut = [];
    let totalUnitPrice = 0;

    for (const it of itemsIn) {
      // minimal validation
      if (!it.priceRuleId || !ObjectId.isValid(it.priceRuleId)) {
        return res.status(400).json({ ok: false, error: 'Invalid priceRuleId in items' });
      }
      // pages default to 1
      const pages = Math.max(1, Math.floor(Number(it.pages || 1)));
      const fb = !!it.fb;
      const spoiled = it.spoiled !== undefined && it.spoiled !== null ? Math.max(0, Math.floor(Number(it.spoiled) || 0)) : 0;
      const printer = (it.printerId && ObjectId.isValid(it.printerId)) ? new ObjectId(it.printerId) : null;

      // compute snapshot using service_price authoritative logic
      const snap = await computeItemSnapshot({ priceRuleId: it.priceRuleId, pages, fb, spoiled });

      const itemRecord = {
        service: snap.serviceId || null,
        priceRule: new ObjectId(it.priceRuleId),
        pages,
        fb,
        printer: printer,
        spoiled,
        unitPrice: snap.unitPrice,
        subtotal: snap.subtotal,
        selectionLabel: snap.selectionLabel
      };

      itemsOut.push(itemRecord);
      totalUnitPrice += Number(snap.subtotal || 0);
    }

    // store summary unitPrice for book as sum of item subtotals
    const bookDoc = new Book({
      name,
      items: itemsOut,
      unitPrice: Number(totalUnitPrice.toFixed(2))
    });

    await bookDoc.save();

    return res.json({ ok: true, bookId: bookDoc._id, unitPrice: bookDoc.unitPrice });
  } catch (err) {
    console.error('books.create error', err);
    // duplicate key (name) handling
    if (err && err.code === 11000) {
      return res.status(400).json({ ok: false, error: 'Book name already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Error creating book' });
  }
};

/**
 * Optional: DELETE /books/:id
 */
exports.delete = async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });
    await Book.findByIdAndDelete(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('books.delete error', err);
    return res.status(500).json({ ok: false, error: 'Error deleting book' });
  }
};


/**
 * GET /books  -> render the books management page (list & delete)
 */
exports.listPage = async (req, res) => {
  try {
    // lightweight list for rendering (server-rendered table)
    const rows = await Book.find({}, { name: 1, unitPrice: 1, createdAt: 1 }).sort({ createdAt: -1 }).lean();
    return res.render('books/index', {
      title: 'Books',
      books: rows
    });
  } catch (err) {
    console.error('books.listPage error', err);
    return res.status(500).send('Error loading books page');
  }
};
