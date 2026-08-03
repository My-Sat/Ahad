// controllers/books.js
const mongoose = require('mongoose');
const Service = require('../models/service');
const ServiceCategory = require('../models/service_category');
const ServicePrice = require('../models/service_price');
const Book = require('../models/book'); // assume you have a Book model
const { ObjectId } = mongoose.Types;

/**
 * Helper: build selectionLabel from populated ServicePrice doc
 */
function buildSelectionLabelFromPrice(pr) {
  try {
    if (pr.customLabel && String(pr.customLabel).trim()) return String(pr.customLabel).trim();
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

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function bookletSheetsFromPages(pages) {
  return Math.max(1, Math.ceil(Math.max(1, Number(pages) || 1) / 4));
}

/**
 * Compute effective unit price & subtotal for an item spec:
 * itemSpec: { priceRuleId, pages, quantity, fb, booklet, spoiled, unitDiscountAmount }
 * Returns the server-authoritative gross price, unit discount and net subtotal.
 */
async function computeItemSnapshot(itemSpec) {
  if (!itemSpec || !itemSpec.priceRuleId) throw new Error('Missing priceRuleId');

  if (!ObjectId.isValid(itemSpec.priceRuleId)) throw new Error('Invalid priceRuleId');

  const pr = await ServicePrice.findById(itemSpec.priceRuleId)
    .populate('selections.unit selections.subUnit')
    .lean();

  if (!pr) throw new Error(`Price rule not found: ${itemSpec.priceRuleId}`);

  // choose unitPrice: use price2 if fb and price2 present; otherwise price
  const booklet = isTruthyFlag(itemSpec.booklet);
  const wantFb = booklet || isTruthyFlag(itemSpec.fb);
  let unitPrice = Number(pr.price || 0);
  if (wantFb && pr.price2 !== undefined && pr.price2 !== null) {
    unitPrice = Number(pr.price2);
  }

  const pages = Number(itemSpec.pages || 1) || 1;
  const quantity = Math.max(1, Math.floor(Number(itemSpec.quantity) || 1));
  const effectiveQty = booklet ? bookletSheetsFromPages(pages) : (wantFb ? Math.ceil(pages / 2) : pages);
  const pricingQty = effectiveQty * quantity;
  const rawDiscount = itemSpec.unitDiscountAmount === undefined || itemSpec.unitDiscountAmount === null || String(itemSpec.unitDiscountAmount).trim() === ''
    ? 0
    : Number(itemSpec.unitDiscountAmount);
  if (!Number.isFinite(rawDiscount) || rawDiscount < 0) {
    const err = new Error('Enter a valid price rule discount amount.');
    err.code = 'INVALID_UNIT_DISCOUNT';
    throw err;
  }
  const unitDiscountAmount = Number(rawDiscount.toFixed(2));
  if (unitDiscountAmount > unitPrice) {
    const err = new Error(`Unit discount cannot exceed the selected price of ${unitPrice.toFixed(2)}.`);
    err.code = 'INVALID_UNIT_DISCOUNT';
    throw err;
  }

  const discountedUnitPrice = Number((unitPrice - unitDiscountAmount).toFixed(2));
  const grossSubtotal = Number((unitPrice * pricingQty).toFixed(2));
  const lineDiscountAmount = Number((unitDiscountAmount * pricingQty).toFixed(2));
  const subtotal = Number((discountedUnitPrice * pricingQty).toFixed(2));

  const selectionLabel = buildSelectionLabelFromPrice(pr);

  return {
    unitPrice,
    effectiveQty,
    pricingQty,
    quantity,
    unitDiscountAmount,
    discountedUnitPrice,
    grossSubtotal,
    lineDiscountAmount,
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
    const isAdmin =
      req.user &&
      req.user.role &&
      String(req.user.role).toLowerCase() === 'admin';

    const query = isAdmin
      ? {} // admins see all
      : { hideForNonAdmin: { $ne: true } }; // non-admin filter

    const rows = await Book.find(query, {
      name: 1,
      unitPrice: 1
    }).sort({ name: 1 }).lean();

    const books = rows.map(r => ({
      _id: r._id,
      name: r.name,
      unitPrice: Number(r.unitPrice || 0)
    }));

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
    const categories = await ServiceCategory.find().sort('name').lean();

    return res.render('books/new', {
      title: 'Add and Cost Compound Service',
      categories
    });
  } catch (err) {
    console.error('books.getNewPage error', err);
    return res.status(500).send('Error loading book editor');
  }
};

exports.listForOrders = async (req, res) => {
  try {
    const isAdmin =
      req.user?.role &&
      String(req.user.role).toLowerCase() === 'admin';

    const categories = await require('../models/service_category')
      .find(isAdmin ? {} : { showInOrders: true })
      .select('_id')
      .lean();

    const catIds = categories.map(c => c._id);

    const books = await Book.find({ category: { $in: catIds } })
      .select('_id name category unitPrice')
      .lean();

    return res.json({ ok:true, books });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false });
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

    // Legacy non-printer items stored QTY in `pages`; printer items used pages literally.
    const items = [];
    for (const it of (book.items || [])) {
      const hasStoredQuantity = it.quantity !== undefined && it.quantity !== null;
      const quantity = hasStoredQuantity
        ? Math.max(1, Math.floor(Number(it.quantity) || 1))
        : (it.printer ? 1 : Math.max(1, Math.floor(Number(it.pages) || 1)));
      const pages = hasStoredQuantity || it.printer
        ? Math.max(1, Math.floor(Number(it.pages) || 1))
        : 1;

      if (it.priceRule && (!it.unitPrice || !it.subtotal || !it.selectionLabel)) {
        try {
          const snap = await computeItemSnapshot({
            priceRuleId: it.priceRule,
            pages,
            quantity,
            fb: it.fb,
            booklet: it.booklet,
            unitDiscountAmount: it.unitDiscountAmount,
            spoiled: it.spoiled
          });
          items.push(Object.assign({}, it, {
            pages,
            quantity,
            unitPrice: snap.unitPrice,
            unitDiscountAmount: snap.unitDiscountAmount,
            discountedUnitPrice: snap.discountedUnitPrice,
            grossSubtotal: snap.grossSubtotal,
            lineDiscountAmount: snap.lineDiscountAmount,
            subtotal: snap.subtotal,
            selectionLabel: snap.selectionLabel
          }));
        } catch (e) {
          // if compute fails for a saved book item, preserve what's stored
          items.push(Object.assign({}, it, { pages, quantity }));
        }
      } else {
        items.push(Object.assign({}, it, { pages, quantity }));
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
 * Body: { name, items: [ { priceRuleId, pages, quantity, fb, booklet, printerId, spoiled, unitDiscountAmount } ] }
 * Computes per-item unitPrice & subtotal using ServicePrice server authoritative logic,
 * stores book with snapshots: service, priceRule, pages, quantity, fb, booklet, printer, spoiled, unitPrice, subtotal, selectionLabel
 */
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    const name = (body.name || '').trim();
    const itemsIn = Array.isArray(body.items) ? body.items : [];

    const categoryId = body.categoryId;
    if (!categoryId || !ObjectId.isValid(categoryId)) {
      return res.status(400).json({ ok:false, error:'Service category is required' });
    }


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
      const quantity = Math.max(1, Math.floor(Number(it.quantity || 1)));
      const booklet = isTruthyFlag(it.booklet);
      const fb = booklet || isTruthyFlag(it.fb);
      const spoiled = it.spoiled !== undefined && it.spoiled !== null ? Math.max(0, Math.floor(Number(it.spoiled) || 0)) : 0;
      const printer = (it.printerId && ObjectId.isValid(it.printerId)) ? new ObjectId(it.printerId) : null;

      // compute snapshot using service_price authoritative logic
      const snap = await computeItemSnapshot({
        priceRuleId: it.priceRuleId,
        pages,
        quantity,
        fb,
        booklet,
        spoiled,
        unitDiscountAmount: it.unitDiscountAmount
      });

      const itemRecord = {
        service: snap.serviceId || null,
        priceRule: new ObjectId(it.priceRuleId),
        pages,
        quantity,
        fb,
        booklet,
        printer: printer,
        spoiled,
        unitPrice: snap.unitPrice,
        unitDiscountAmount: snap.unitDiscountAmount,
        discountedUnitPrice: snap.discountedUnitPrice,
        grossSubtotal: snap.grossSubtotal,
        lineDiscountAmount: snap.lineDiscountAmount,
        subtotal: snap.subtotal,
        selectionLabel: snap.selectionLabel
      };

      itemsOut.push(itemRecord);
      totalUnitPrice += Number(snap.subtotal || 0);
    }

    // store summary unitPrice for book as sum of item subtotals
    const bookDoc = new Book({
      name,
      category: new ObjectId(categoryId),
      items: itemsOut,
      unitPrice: Number(totalUnitPrice.toFixed(2))
    });

    await bookDoc.save();

    return res.json({ ok: true, bookId: bookDoc._id, unitPrice: bookDoc.unitPrice });
  } catch (err) {
    // duplicate key (name) handling
    if (err && err.code === 11000) {
      return res.status(400).json({ ok: false, error: 'Book name already exists' });
    }
    if (err && err.code === 'INVALID_UNIT_DISCOUNT') {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('books.create error', err);
    return res.status(500).json({ ok: false, error: 'Error creating book' });
  }
};

/**
 * PUT /books/:id
 * Update existing book (edit)
 */
exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'Invalid book id' });
    }

    const body = req.body || {};
    const name = (body.name || '').trim();
    const itemsIn = Array.isArray(body.items) ? body.items : [];

    const categoryId = body.categoryId;
    if (!categoryId || !ObjectId.isValid(categoryId)) {
      return res.status(400).json({ ok:false, error:'Service category is required' });
    }
    

    if (!name) return res.status(400).json({ ok: false, error: 'Book name is required' });
    if (!itemsIn.length) return res.status(400).json({ ok: false, error: 'At least one item is required' });

    const itemsOut = [];
    let totalUnitPrice = 0;

    for (const it of itemsIn) {
      if (!it.priceRuleId || !ObjectId.isValid(it.priceRuleId)) {
        return res.status(400).json({ ok: false, error: 'Invalid priceRuleId in items' });
      }

      const pages = Math.max(1, Math.floor(Number(it.pages || 1)));
      const quantity = Math.max(1, Math.floor(Number(it.quantity || 1)));
      const booklet = isTruthyFlag(it.booklet);
      const fb = booklet || isTruthyFlag(it.fb);
      const spoiled = Math.max(0, Math.floor(Number(it.spoiled || 0)));
      const printer = (it.printerId && ObjectId.isValid(it.printerId))
        ? new ObjectId(it.printerId)
        : null;

      const snap = await computeItemSnapshot({
        priceRuleId: it.priceRuleId,
        pages,
        quantity,
        fb,
        booklet,
        spoiled,
        unitDiscountAmount: it.unitDiscountAmount
      });

      itemsOut.push({
        service: snap.serviceId || null,
        priceRule: new ObjectId(it.priceRuleId),
        pages,
        quantity,
        fb,
        booklet,
        printer,
        spoiled,
        unitPrice: snap.unitPrice,
        unitDiscountAmount: snap.unitDiscountAmount,
        discountedUnitPrice: snap.discountedUnitPrice,
        grossSubtotal: snap.grossSubtotal,
        lineDiscountAmount: snap.lineDiscountAmount,
        subtotal: snap.subtotal,
        selectionLabel: snap.selectionLabel
      });

      totalUnitPrice += Number(snap.subtotal || 0);
    }

    const updated = await Book.findByIdAndUpdate(
      id,
      {
        name,
        category: new ObjectId(categoryId),
        items: itemsOut,
        unitPrice: Number(totalUnitPrice.toFixed(2))
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Book not found' });
    }

    return res.json({ ok: true });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ ok: false, error: 'Book name already exists' });
    }
    if (err && err.code === 'INVALID_UNIT_DISCOUNT') {
      return res.status(400).json({ ok: false, error: err.message });
    }
    console.error('books.update error', err);
    return res.status(500).json({ ok: false, error: 'Error updating book' });
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
