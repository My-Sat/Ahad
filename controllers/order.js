// controllers/orders.js
const crypto = require('crypto');
const Service = require('../models/service');
const ServicePrice = require('../models/service_price');
const Order = require('../models/order');
const Customer = require('../models/customer');
const CustomerAccountTxn = require('../models/customer_account_txn');
const Printer = require('../models/printer');
const mongoose = require('mongoose');
const Material = require('../models/material');
const { MaterialUsage, MaterialAggregate } = require('../models/material_usage');
const { ObjectId } = require('mongoose').Types;
const DiscountConfig = require('../models/discount');
const Store = require('../models/store');
const StoreStock = require('../models/store_stock');


function customerTypeLabel(category) {
  const c = String(category || '').toLowerCase();
  if (c === 'regular') return 'Regular';
  if (c === 'artist') return 'Artist';
  if (c === 'organisation') return 'Organisation';
  return 'One-time';
}

function paidSoFar(order) {
  const pays = order.payments || [];
  return pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

exports.apiPayFromCustomerAccount = async (req, res) => {
  let session = null;

  try {
    const orderId = req.params.orderId;
    const mode = (req.body && req.body.mode) ? String(req.body.mode).toLowerCase() : 'auto';

    session = await mongoose.startSession();
    let result = null;

    await session.withTransaction(async () => {
      const order = await Order.findOne({ orderId }).session(session);
      if (!order) {
        const e = new Error('Order not found');
        e.statusCode = 404;
        throw e;
      }
      if (!order.customer) {
        const e = new Error('Order has no customer attached');
        e.statusCode = 400;
        throw e;
      }

      const total = Number(order.total || 0);
      const paid = (order.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const outstanding = Number((total - paid).toFixed(2));

      if (outstanding <= 0) {
        const e = new Error('Order already settled');
        e.statusCode = 400;
        throw e;
      }

      const customer = await Customer.findById(order.customer).session(session);
      if (!customer) {
        const e = new Error('Customer not found');
        e.statusCode = 400;
        throw e;
      }

      const bal = Number(customer.accountBalance || 0);
      const apply = Number(Math.min(bal, outstanding).toFixed(2));

      if (apply <= 0) {
        const e = new Error('Customer account balance is 0.00');
        e.statusCode = 400;
        throw e;
      }

      // debit customer
      customer.accountBalance = Number((bal - apply).toFixed(2));
      await customer.save({ session });

      // ledger txn
      await CustomerAccountTxn.create([{
        customer: customer._id,
        type: 'debit',
        amount: apply,
        note: `Paid order ${order.orderId} from account`,
        recordedBy: req.user?._id || null,
        recordedByName: req.user?.name || req.user?.username || ''
      }], { session });

      // record payment on order
      order.payments = order.payments || [];
      order.payments.push({
        method: 'account',
        amount: apply,
        meta: { source: 'customer_account', mode },
        note: 'Paid from customer account',
        recordedBy: req.user?._id || null,
        recordedByName: req.user?.name || req.user?.username || '',
        createdAt: new Date()
      });

      const newPaid = paid + apply;
      const newOutstanding = Number((total - newPaid).toFixed(2));

      if (newOutstanding <= 0) {
        order.status = 'paid';
        order.paidAt = new Date();
      }

      await order.save({ session });

      result = {
        ok: true,
        usedFromAccount: apply,
        newBalance: Number(customer.accountBalance || 0),
        outstanding: newOutstanding,
        status: order.status
      };
    });

    return res.json(result);
  } catch (e) {
    console.error('apiPayFromCustomerAccount error', e);
    if (e && e.statusCode) return res.status(e.statusCode).json({ ok: false, error: e.message });
    return res.status(500).json({ ok: false, error: 'Server error' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

function buildThankYouSms(category) {
  const label = customerTypeLabel(category);

  // Keep wording correct for categories that never "migrate to regular" (artist/organisation).
  if (String(category || '').toLowerCase() === 'regular') {
    return `Thank you for doing business with us. You are currently a ${label} customer. Continue doing business with us to maintain your Regular status and enjoy our discounts.`;
  }

  if (String(category || '').toLowerCase() === 'artist' || String(category || '').toLowerCase() === 'organisation') {
    return `Thank you for doing business with us. You are currently an ${label} customer. We appreciate your continued support—ask about our available discounts on your next visit.`;
  }

  // one_time default
  return `Thank you for doing business with us. You are currently a ${label} customer. Continue doing business with us to be upgraded to Regular customer status and enjoy our discounts.`;
}



async function getActiveDiscountRules() {
  const cfg = await DiscountConfig.findOne().sort({ updatedAt: -1 }).lean();
  const rules = (cfg && Array.isArray(cfg.rules)) ? cfg.rules : [];
  return rules.filter(r => r && r.enabled);
}

function computeDiscountAmount(baseTotal, rule) {
  if (!rule) return 0;
  if (rule.mode === 'amount') return Math.max(0, Number(rule.value || 0));
  if (rule.mode === 'percent') {
    const pct = Math.max(0, Math.min(100, Number(rule.value || 0)));
    return Number((baseTotal * (pct / 100)).toFixed(2));
  }
  return 0;
}

// Choose best single discount among applicable rules
  async function pickBestDiscount({ baseTotal, customerId, customerCategory, serviceIds, serviceCategoryIds }) {
  const rules = await getActiveDiscountRules();
  if (!rules.length) return null;

  const candidates = [];

  for (const r of rules) {
    if (!r || !r.scope) continue;

    if (r.scope === 'general') {
      candidates.push({ rule: r, label: 'General' });
      continue;
    }

    if (r.scope === 'customer_type') {
      if (customerCategory && (r.targets || []).includes(String(customerCategory))) {
        candidates.push({ rule: r, label: `Customer Type: ${customerCategory}` });
      }
      continue;
    }

    if (r.scope === 'customer') {
      if (customerId && (r.targets || []).includes(String(customerId))) {
        candidates.push({ rule: r, label: 'Customer match' });
      }
      continue;
    }


    if (r.scope === 'service') {
      const hit = (r.targets || []).some(t => serviceIds.has(String(t)));
      if (hit) candidates.push({ rule: r, label: 'Service match' });
      continue;
    }

    if (r.scope === 'service_category') {
      const hit = (r.targets || []).some(t => serviceCategoryIds.has(String(t)));
      if (hit) candidates.push({ rule: r, label: 'Category match' });
      continue;
    }
  }

  if (!candidates.length) return null;

  // compute amounts, pick highest benefit (capped at baseTotal)
  let best = null;
  for (const c of candidates) {
    const amt = computeDiscountAmount(baseTotal, c.rule);
    const capped = Math.min(baseTotal, Math.max(0, amt));
    if (!best || capped > best.amount) {
      best = { ...c, amount: Number(capped.toFixed(2)) };
    }
  }

  return best;
}

function makeOrderId() {
  // short, human-readable id: 8 chars base36
  return (Date.now().toString(36) + crypto.randomBytes(3).toString('hex')).slice(-10).toUpperCase();
}

// helper: subset match (material selections must be contained in item selections)
function materialMatchesItem(matSelections, itemSelections) {
  const itemSet = new Set((itemSelections || []).map(s => `${String(s.unit)}:${String(s.subUnit)}`));
  for (const ms of (matSelections || [])) {
    const key = `${String(ms.unit)}:${String(ms.subUnit)}`;
    if (!itemSet.has(key)) return false;
  }
  return true;
}


// Render order creation page
exports.newOrderPage = async (req, res) => {
  try {
    const services = await Service.find().select('_id name').sort('name').lean();

    // optional preselected customer
    let customer = null;
    const customerId = req.query.customerId;
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
      const Customer = require('../models/customer');
      customer = await Customer.findById(customerId).select('_id firstName businessName phone category').lean();
    }

    res.render('orders/new', { services, customer });
  } catch (err) {
    console.error('newOrderPage error', err);
    res.status(500).send('Error loading order page');
  }
};

exports.viewOrderPage = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).send('Missing orderId');

    // find order and include payments/items
    const orderDoc = await Order.findOne({ orderId }).lean();
    if (!orderDoc) return res.status(404).send('Order not found');

    // Populate service names for items
try {
  const serviceIds = Array.from(
    new Set((orderDoc.items || []).map(it => String(it.service)))
  );

  if (serviceIds.length) {
    const services = await Service.find({ _id: { $in: serviceIds } })
      .select('_id name')
      .lean();

    const smap = {};
    services.forEach(s => {
      smap[String(s._id)] = s.name;
    });

    orderDoc.items = (orderDoc.items || []).map(it => ({
      ...it,
      serviceName: smap[String(it.service)] || 'Unknown Service'
    }));
  }
} catch (e) {
  console.error('Failed to populate service names for order view', e);
}


    // Manually populate customer (mirroring apiGetOrderById and newOrderPage prefill logic)
    let customer = null;
    if (orderDoc.customer) {
      try {
        const Customer = require('../models/customer');
        customer = await Customer.findById(orderDoc.customer).select('_id firstName businessName phone category').lean();
      } catch (e) {
        console.error('Failed to populate customer for order view', e);
      }
    }

    // Populate printer names for items that reference a printer (non-blocking; keep behavior consistent)
    try {
      const printerIds = Array.from(new Set((orderDoc.items || []).filter(it => it.printer).map(it => String(it.printer))));
      let printers = [];
      if (printerIds.length) {
        printers = await Printer.find({ _id: { $in: printerIds } }).select('_id name').lean();
      }
      const pmap = {};
      printers.forEach(p => { pmap[String(p._id)] = p.name || String(p._id); });
      orderDoc.items = (orderDoc.items || []).map(it => {
        if (it.printer) {
          const pid = String(it.printer);
          return Object.assign({}, it, { printerName: (pmap[pid] || pid) });
        }
        return Object.assign({}, it, { printerName: null });
      });
    } catch (e) {
      console.error('Failed to populate printers for order view', e);
      // keep original items if population fails
      orderDoc.items = orderDoc.items || [];
    }

    // compute payments summary
    let paidSoFar = 0;
    if (orderDoc.payments && Array.isArray(orderDoc.payments)) {
      for (const p of orderDoc.payments) {
        const a = Number(p && p.amount ? p.amount : 0);
        if (!isNaN(a)) paidSoFar += a;
      }
    }
    paidSoFar = Number(paidSoFar.toFixed(2));
    const total = Number(orderDoc.total || 0);
    const outstanding = Number((total - paidSoFar).toFixed(2));

    // render server-side page
let handler = null;
    if (orderDoc.handledBy) {
      try {
        const User = require('../models/user');
        const h = await User.findById(orderDoc.handledBy).select('_id name username').lean();
        if (h) handler = h;
      } catch (e) {
        console.error('Failed to populate handler for order view', e);
      }
    }

    // render server-side page
    // -----------------------------
    // DISCOUNT DISPLAY (view page)
    // -----------------------------
    const totalBeforeDiscount =
      (orderDoc.totalBeforeDiscount !== undefined && orderDoc.totalBeforeDiscount !== null)
        ? Number(orderDoc.totalBeforeDiscount)
        : (Number(orderDoc.total || 0) + Number(orderDoc.discountAmount || 0));

    const discountAmount = Number(orderDoc.discountAmount || 0);

    const discountLabel =
      (orderDoc.discountBreakdown && orderDoc.discountBreakdown.label)
        ? String(orderDoc.discountBreakdown.label)
        : 'Discount';

    return res.render('orders/view', {
      order: orderDoc,
      paidSoFar,
      outstanding,
      customer,
      handler,

      // ✅ expose discount info to template
      totalBeforeDiscount,
      discountAmount,
      discountLabel,
      discountBreakdown: orderDoc.discountBreakdown || null
    });
    } catch (err) {
    console.error('viewOrderPage error', err);
    return res.status(500).send('Error loading order');
  }
};

// Render payment page
exports.payPage = async (req, res) => {
  try {
    res.render('orders/pay');
  } catch (err) {
    console.error('payPage error', err);
    res.status(500).send('Error loading payment page');
  }
};

// API: create order
// expects body: { items: [{ serviceId, priceRuleId, pages (optional), fb (optional boolean), printerId (optional) } , ...] }
// Server-authoritative pricing: when items[].fb is true and the price rule has price2, use price2.
exports.apiCreateOrder = async (req, res) => {
  try {
    let { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    // normalize pages, fb flag and validate shape; also normalize printerId (may be null)
    items = items.map(it => {
      const pages = Number(it.pages) || 1;
      const fb = (it.fb === true || it.fb === 'true' || it.fb === 1 || it.fb === '1') ? true : false;
      let spoiled = 0;
      if (it.spoiled !== undefined && it.spoiled !== null && String(it.spoiled).trim() !== '') {
        const sp = Number(it.spoiled);
        spoiled = (isNaN(sp) || sp < 0) ? 0 : Math.floor(sp);
      }
let factor = 1;
if (it.factor !== undefined && it.factor !== null && String(it.factor).trim() !== '') {
  const f = Number(it.factor);
  factor = (isNaN(f) || f < 1) ? 1 : Math.floor(f);
}

return {
  serviceId: it.serviceId,
  priceRuleId: it.priceRuleId,
  pages,
  factor,              // NEW
  fb,
  printerId: it.printerId || null,
  spoiled
};
    });

    const builtItems = [];
    let total = 0;

for (const it of items) {
  if (!mongoose.Types.ObjectId.isValid(it.serviceId) || !mongoose.Types.ObjectId.isValid(it.priceRuleId)) {
    return res.status(400).json({ error: 'Invalid IDs in items' });
  }

  // populate selections/unit/subUnit so we can store and later match materials
  const pr = await ServicePrice.findById(it.priceRuleId).populate('selections.unit selections.subUnit').lean();
  if (!pr) return res.status(404).json({ error: `Price rule ${it.priceRuleId} not found` });

  // Determine which price to use: use price2 only when client requested FB and price2 exists
// Check whether this service requires a printer
const svc = await Service.findById(it.serviceId).lean();
const svcRequiresPrinter = !!(svc && svc.requiresPrinter);

// normalize factor (pricing factor comes from client)
let pricingFactor = 1;
if (svcRequiresPrinter && it.factor !== undefined && it.factor !== null && String(it.factor).trim() !== '') {
  const f = Number(it.factor);
  pricingFactor = (isNaN(f) || f < 1) ? 1 : Math.floor(f);
}

// Determine which price to use: use price2 only when client requested FB and price2 exists
let unitPrice = Number(pr.price);
let usedFB = false;
if (it.fb && pr.price2 !== undefined && pr.price2 !== null) {
  unitPrice = Number(pr.price2);
  usedFB = true;
}

const pages = Number(it.pages) || 1;

// determine effective quantity for pricing: if FB was used for this line
const effectiveQtyForPrice = usedFB ? Math.ceil(pages / 2) : pages;

// ✅ APPLY pricing factor HERE
const subtotal = Number(
  (unitPrice * effectiveQtyForPrice * pricingFactor).toFixed(2)
);

// Build human-friendly selection label (append F/B suffix always when usedFB)
const baseLabel = pr.selectionLabel || ((pr.selections || []).map(s => {
  const u = s.unit && s.unit.name ? s.unit.name : String(s.unit);
  const su = s.subUnit && s.subUnit.name ? s.subUnit.name : String(s.subUnit);
  return `${u}: ${su}`;
}).join(' + '));
const selectionLabel = baseLabel + (usedFB ? ' (F/B)' : '');

// store selections as unit/subUnit objectIds (not populated objects)
const selectionsForOrder = (pr.selections || []).map(s => ({
  unit: s.unit && s.unit._id ? s.unit._id : s.unit,
  subUnit: s.subUnit && s.subUnit._id ? s.subUnit._id : s.subUnit
}));
  // Determine printer-type for this price rule (inspect populated subUnit names)
  let printerType = null;
  try {
    // prefer 'colour' if any subunit contains 'colour' or 'color', otherwise 'monochrome' if present
    const subs = (pr.selections || []).map(s => (s.subUnit && s.subUnit.name) ? String(s.subUnit.name) : '');
    const hasColour = subs.some(n => /colour|color/i.test(n));
    const hasMono = subs.some(n => /monochrome/i.test(n));
    if (hasColour) printerType = 'colour';
    else if (hasMono) printerType = 'monochrome';
  } catch (e) {
    printerType = null;
  }


  // validate printer if required
  let printerId = null;
  if (svcRequiresPrinter) {
    if (!it.printerId || !mongoose.Types.ObjectId.isValid(it.printerId)) {
      return res.status(400).json({ error: 'Printer required for one or more items' });
    }
    const prDoc = await Printer.findById(it.printerId).lean();
    if (!prDoc) return res.status(400).json({ error: `Printer ${it.printerId} not found` });
    printerId = new mongoose.Types.ObjectId(it.printerId);
  } else {
    // if provided but invalid, ignore or validate format
    if (it.printerId && mongoose.Types.ObjectId.isValid(it.printerId)) {
      // allow storing if client provided printer for non-required service (optional)
      const maybePrinter = await Printer.findById(it.printerId).lean();
      if (maybePrinter) printerId = new mongoose.Types.ObjectId(it.printerId);
    }
  }

  // store pages as original pages so other parts (material matching, printer usage) still use original pages
  // compute print factor from populated pr.selections -> subUnit.factor (default 1)
  let printFactor = 1;
  try {
    if (pr && Array.isArray(pr.selections)) {
      // multiply factors of any populated subUnits (most cases only one relevant subUnit like size)
      printFactor = pr.selections.reduce((acc, s) => {
        const f = (s && s.subUnit && (s.subUnit.factor !== undefined && s.subUnit.factor !== null)) ? Number(s.subUnit.factor) : 1;
        const fv = (isNaN(f) || f <= 0) ? 1 : f;
        return acc * fv;
      }, 1);
      // coerce to integer
      printFactor = Math.max(1, Math.floor(printFactor));
    }
  } catch (pfErr) {
    printFactor = 1;
  }

  builtItems.push({
    service: it.serviceId,
    printer: printerId, // may be null
    selections: selectionsForOrder,
    selectionLabel,
    unitPrice,
    pages,               // raw pages entered by user (kept for material/printer logic)
    effectiveQty: effectiveQtyForPrice, // server-authoritative quantity used for pricing (e.g. ceil(pages/2) when F/B)
    factor: pricingFactor,             // NEW: quantity multiplier for printer-required services
    subtotal,            // computed using effectiveQty (server authoritative)
    spoiled: Number(it.spoiled) || 0,
    fb: !!(it.fb || usedFB),  // store original intent (client flag) OR our usedFB calc
    printerType, // NEW: 'monochrome' | 'colour' | null
    printFactor // NEW: multiplier for printer counts (default 1)
  });
  total += subtotal;
}
    total = Number(total.toFixed(2));

    const order = new Order({
      orderId: makeOrderId(),
      items: builtItems,
      total
    });

    const customerId = req.body.customerId;
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
      order.customer = new mongoose.Types.ObjectId(customerId);
    }

    // NEW: attach the currently logged-in user as the handler of this order (if available)
    try {
      if (req.user && req.user._id) {
        order.handledBy = new mongoose.Types.ObjectId(req.user._id);
      }
    } catch (e) {
      // don't fail order creation if attaching fails for some reason
      console.error('Failed to attach handler to order', e);
    }

// -----------------------------
// MATERIAL STOCK PRE-CHECK (MULTI-STORE)
// Only the OPERATIONAL store is consumable.
// Track only materials added (active) in operational store.
// -----------------------------
try {
  const opStore = await Store.findOne({ isOperational: true }).lean();
  if (!opStore) {
    return res.status(409).json({
      error: 'No operational store configured. Ask Admin to set an operational store in Stock dashboard.'
    });
  }

  const opStocks = await StoreStock.find({ store: opStore._id, active: true })
    .populate('material', '_id name selections')
    .lean();

  if (opStocks && opStocks.length) {
    const requiredByMaterial = new Map(); // materialId -> needed

    // cache source stock info
    const stockInfo = new Map(); // materialId -> { name, stocked }
    for (const st of opStocks) {
      if (st && st.material && st.material._id) {
        stockInfo.set(String(st.material._id), { name: st.material.name, stocked: Number(st.stocked || 0) });
      }
    }

    // compute required needs
    for (let idx = 0; idx < builtItems.length; idx++) {
      const it = builtItems[idx];
      const itemSelections = it.selections || [];

      const pages = Number(it.pages) || 1;
      const isFb = !!it.fb;
      const baseCount = (!pages || pages <= 0) ? 1 : (isFb ? Math.ceil(pages / 2) : pages);

      const spoiled = (it.spoiled !== undefined && it.spoiled !== null)
        ? Math.floor(Number(it.spoiled) || 0)
        : 0;

      const factorMul = (it.printer && it.factor !== undefined && it.factor !== null)
        ? Math.max(1, Math.floor(Number(it.factor) || 1))
        : 1;

      const countNeeded = (Math.max(0, baseCount) + Math.max(0, spoiled)) * factorMul;
      if (countNeeded <= 0) continue;

      for (const st of opStocks) {
        const m = st.material;
        if (!m || !m.selections || !m.selections.length) continue;

        if (materialMatchesItem(m.selections, itemSelections)) {
          const mid = String(m._id);
          requiredByMaterial.set(mid, (requiredByMaterial.get(mid) || 0) + countNeeded);
        }
      }
    }

    if (requiredByMaterial.size) {
      const matIds = Array.from(requiredByMaterial.keys()).map(id => new mongoose.Types.ObjectId(id));
      const aggDocs = await MaterialAggregate.find({ store: opStore._id, material: { $in: matIds } }).lean();

      const aggMap = {};
      aggDocs.forEach(a => { aggMap[String(a.material)] = Number(a.total || 0); });

      const blocks = [];
      for (const [mid, need] of requiredByMaterial.entries()) {
        const info = stockInfo.get(mid);
        const stocked = info ? Number(info.stocked || 0) : 0;
        const used = aggMap[mid] || 0;
        const remaining = Math.max(0, stocked - used);

        const name = info ? info.name : 'Material';
        if (remaining <= 0) blocks.push(`"${name}" is out of stock in operational store (Remaining: 0).`);
        else if (need > remaining) blocks.push(`"${name}" insufficient in operational store (Needed: ${need}, Remaining: ${remaining}).`);
      }

      if (blocks.length) {
        return res.status(409).json({
          error: 'Some materials in this order are out of stock in the operational store. Contact Admin to restock or transfer stock.',
          details: blocks,
          operationalStore: { _id: opStore._id, name: opStore.name }
        });
      }
    }
  }
} catch (stockCheckErr) {
  console.error('Material stock pre-check error', stockCheckErr);
  return res.status(500).json({ error: 'Failed to verify material stock' });
}

// -----------------------------
// DISCOUNT (server-authoritative)
// Priority: Manual (admin-only) > Auto rules
// -----------------------------
const baseTotal = Number(total || 0);

// 1) Manual discount (admin only)
let manual = null;
try {
  const isAdmin = req.user && req.user.role && String(req.user.role).toLowerCase() === 'admin';
  if (isAdmin && req.body && req.body.manualDiscount && typeof req.body.manualDiscount === 'object') {
    const md = req.body.manualDiscount;
    const mode = String(md.mode || '').trim();
    const value = Number(md.value);

    if ((mode === 'amount' || mode === 'percent') && isFinite(value) && value > 0) {
      if (mode === 'percent' && value > 100) {
        // ignore invalid percent
      } else {
        manual = { mode, value: Number(value) };
      }
    }
  }
} catch (e) {
  manual = null;
}

let discountAmount = 0;
let discountBreakdown = null;

if (manual) {
  // compute manual discount
  discountAmount = computeDiscountAmount(baseTotal, manual);
  discountAmount = Number(Math.min(baseTotal, Math.max(0, discountAmount)).toFixed(2));

  if (discountAmount > 0) {
    discountBreakdown = {
      scope: 'manual',
      mode: manual.mode,
      value: manual.value,
      computed: discountAmount,
      label: 'Manual discount'
    };
  }
} else {
  // 2) Auto discounts (existing behavior)
  let customerCategory = null;
  try {
    if (order.customer) {
      const c = await Customer.findById(order.customer).select('_id category').lean();
      if (c && c.category) customerCategory = String(c.category);
    }
  } catch (e) {
    console.error('Discount: failed to load customer category', e);
  }

  const serviceIds = new Set();
  for (const bi of (builtItems || [])) {
    if (bi && bi.service) serviceIds.add(String(bi.service));
  }

  const serviceCategoryIds = new Set();
  try {
    const svcDocs = await Service.find({ _id: { $in: Array.from(serviceIds) } })
      .select('_id category')
      .lean();

    (svcDocs || []).forEach(s => {
      if (s && s.category) serviceCategoryIds.add(String(s.category));
    });
  } catch (e) {
    console.error('Discount: failed to load service categories', e);
  }

  const customerIdForDiscount = order.customer ? String(order.customer) : null;

  const best = await pickBestDiscount({
    baseTotal,
    customerId: customerIdForDiscount,
    customerCategory,
    serviceIds,
    serviceCategoryIds
  });

  if (best && best.amount > 0) {
    discountAmount = Number(best.amount || 0);
    discountBreakdown = {
      scope: best.rule.scope,
      mode: best.rule.mode,
      value: best.rule.value,
      computed: discountAmount,
      label: best.label
    };
  }
}

// Apply discount
const finalTotal = Number(Math.max(0, baseTotal - Number(discountAmount || 0)).toFixed(2));

// store snapshot on the order doc before saving
order.totalBeforeDiscount = baseTotal;
order.discountAmount = Number(discountAmount || 0);
order.discountBreakdown = discountBreakdown;

// IMPORTANT: total becomes final payable total
order.total = finalTotal;

    await order.save();

// If the order has a customer attached, re-evaluate their 'regular' status
// AND send a thank-you SMS with the customer's current type.
try {
  if (order.customer) {
    const customerController = require('./customer');

    // 1) Update regular status and wait (so category is accurate)
    let updatedCustomer = null;
    try {
      updatedCustomer = await customerController.updateRegularStatus(order.customer);
    } catch (e) {
      console.error('updateRegularStatus failed for customer', String(order.customer), e);
    }

    // 2) Load latest customer (ensure we have phone + category)
    let cust = updatedCustomer;
    if (!cust) {
      try {
        cust = await Customer.findById(order.customer).select('_id phone category').lean();
      } catch (e) {
        console.error('Failed to reload customer after order', String(order.customer), e);
      }
    }

    // 3) Send SMS (do not block order success if SMS fails)
    try {
      if (cust && cust.phone) {
      const { sendSms } = require('../utilities/hubtel_sms');
      const messagingController = require('./messaging');

      // Ask messaging config what to send (or whether to send)
      const auto = await messagingController.buildAutoMessageForCustomer(
        cust,
        'order',
        {
          orderId: order.orderId,
          amount: order.total, // final payable total
          totalBeforeDiscount: order.totalBeforeDiscount ?? '',
          discountAmount: order.discountAmount ?? ''
        }
      );

      // auto.enabled false => admin disabled auto messages
      if (auto && auto.enabled === false) {
        // do nothing
      } else {
        // If no configured content, fallback to old hardcoded message
        const msg = (auto && auto.content) ? auto.content : buildThankYouSms(cust.category);
        if (msg && String(msg).trim()) {
          await sendSms({ to: cust.phone, content: msg });
        }
      }
            }
          } catch (smsErr) {
            console.error('Failed to send customer thank-you SMS', smsErr);
          }
        }
      } catch (e) {
        console.error('post-order regular update + SMS error', e);
      }

// --- MATERIAL MATCHING & RECORDING (OPERATIONAL STORE ONLY) ---
try {
  const opStore = await Store.findOne({ isOperational: true }).lean();
  if (!opStore) {
    // No operational store => no tracking
    return;
  }

  const opStocks = await StoreStock.find({ store: opStore._id, active: true })
    .populate('material', '_id selections')
    .lean();

  if (!opStocks.length) return;

  for (let idx = 0; idx < builtItems.length; idx++) {
    const it = builtItems[idx];
    const itemSelections = it.selections || [];

    for (const st of opStocks) {
      const m = st.material;
      if (!m || !m.selections || !m.selections.length) continue;

      if (materialMatchesItem(m.selections, itemSelections)) {
        const pages = Number(it.pages) || 1;
        const isFb = !!it.fb;
        const baseCount = (!pages || pages <= 0) ? 1 : (isFb ? Math.ceil(pages / 2) : pages);

        const spoiled = (it.spoiled !== undefined && it.spoiled !== null)
          ? Math.floor(Number(it.spoiled) || 0)
          : 0;

        const factorMul = (it.printer && it.factor !== undefined && it.factor !== null)
          ? Math.max(1, Math.floor(Number(it.factor) || 1))
          : 1;

        const count = (Math.max(0, baseCount) + Math.max(0, spoiled)) * factorMul;

        await MaterialUsage.create({
          store: opStore._id,
          material: m._id,
          orderId: order.orderId,
          orderRef: order._id,
          itemIndex: idx,
          count
        });

        await MaterialAggregate.findOneAndUpdate(
          { store: opStore._id, material: m._id },
          { $inc: { total: count } },
          { upsert: true, new: true }
        );
      }
    }
  }
} catch (matErr) {
  console.error('Material matching/recording error', matErr);
}

        // --- PRINTER USAGE RECORDING ---
try {
  const PrinterUsage = require('../models/printer_usage');
  // for each order item, if printer exists, increment that printer by pages (QTY)
for (let idx = 0; idx < builtItems.length; idx++) {
  const it = builtItems[idx];
  if (!it.printer) continue;
  // pages (raw) default is 1 already
  const pages = Number(it.pages) || 1;
  // base count is floor(pages) (we intentionally don't include 'spoiled' for printer usage)
  const baseCount = Math.max(0, Math.floor(pages));
  const factor = (it.printFactor && !isNaN(Number(it.printFactor))) ? Math.max(1, Math.floor(Number(it.printFactor))) : 1;
  // final usage count applied to printer = baseCount * factor
  const usageCount = Math.max(0, Math.floor(baseCount * factor));

  // determine type for this usage (may be 'monochrome'|'colour'|null)
  const usageType = (it.printerType === 'monochrome' || it.printerType === 'colour') ? it.printerType : null;

  // create usage record (store final usageCount)
  await PrinterUsage.create({
    printer: it.printer,
    orderId: order.orderId,
    orderRef: order._id,
    itemIndex: idx,
    count: usageCount,
    type: usageType,
    note: 'order-created'
  });

  // update printer aggregate (atomic increment) with usageCount
  try {
    if (usageType === 'monochrome') {
      await Printer.findByIdAndUpdate(it.printer, { $inc: { monochromeCount: usageCount, totalCount: usageCount } });
    } else if (usageType === 'colour') {
      await Printer.findByIdAndUpdate(it.printer, { $inc: { colourCount: usageCount, totalCount: usageCount } });
    } else {
      await Printer.findByIdAndUpdate(it.printer, { $inc: { totalCount: usageCount } });
    }
  } catch (pErr) {
    console.error('Failed to increment printer counts', pErr, 'printerId=', it.printer);
  }
}
} catch (puErr) {
  console.error('Printer usage recording error', puErr);
}
    // return order info
    return res.json({ ok: true, orderId: order.orderId, total: order.total });
  } catch (err) {
    console.error('apiCreateOrder error', err);
    return res.status(500).json({ error: 'Error creating order' });
  }
};

// API: fetch order by orderId (returns order summary)
exports.apiGetOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: 'No orderId provided' });

    // Pull raw order first (lean), then we enrich deliberately
    const order = await Order.findOne({ orderId })
      .lean();

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // -----------------------------
    // Populate printer names for items that reference a printer
    // Keep your old behavior (printer becomes name string),
    // but ALSO preserve original id in printerId to avoid future breakage.
    // -----------------------------
    try {
      const printerIds = Array.from(
        new Set((order.items || [])
          .filter(it => it && it.printer)
          .map(it => String(it.printer)))
      );

      if (printerIds.length) {
        const printers = await Printer.find({ _id: { $in: printerIds } })
          .select('_id name')
          .lean();

        const pmap = {};
        printers.forEach(p => { pmap[String(p._id)] = p.name || String(p._id); });

        order.items = (order.items || []).map(it => {
          if (it && it.printer) {
            const pid = String(it.printer);
            return Object.assign({}, it, {
              printerId: it.printer,               // preserve original id
              printerName: pmap[pid] || pid,       // explicit name field
              printer: (pmap[pid] || pid)          // keep existing behavior: replace printer with name string
            });
          }
          return it;
        });
      }
    } catch (pErr) {
      console.error('Failed to populate printer names for order items', pErr);
      // keep original values
    }

    // -----------------------------
    // Populate service names for order items (unchanged, but safer)
    // -----------------------------
    try {
      const serviceIds = Array.from(new Set(
        (order.items || [])
          .filter(it => it && it.service)
          .map(it => String(it.service))
      ));

      if (serviceIds.length) {
        const Service = require('../models/service');
        const services = await Service.find({ _id: { $in: serviceIds } })
          .select('_id name')
          .lean();

        const smap = {};
        services.forEach(s => { smap[String(s._id)] = s.name; });

        order.items = (order.items || []).map(it => {
          if (it && it.service) {
            const sid = String(it.service);
            return Object.assign({}, it, {
              serviceName: smap[sid] || it.serviceName || 'Service'
            });
          }
          return Object.assign({}, it, { serviceName: it?.serviceName || 'Service' });
        });
      } else {
        order.items = (order.items || []).map(it =>
          Object.assign({}, it, { serviceName: it?.serviceName || 'Service' })
        );
      }
    } catch (sErr) {
      console.error('Failed to populate service names for order items', sErr);
      order.items = (order.items || []).map(it =>
        Object.assign({}, it, { serviceName: it?.serviceName || 'Service' })
      );
    }

    // -----------------------------
    // Populate customer info (INCLUDING account balance)
    // IMPORTANT: do not strip account fields like before
    // -----------------------------
    let customerInfo = null;
    let customerAccountBalance = 0;

    try {
      const Customer = require('../models/customer');

      // order.customer could be ObjectId, string, or already an object (depending on how it was created)
      const customerId =
        order.customer && typeof order.customer === 'object'
          ? (order.customer._id ? String(order.customer._id) : String(order.customer))
          : (order.customer ? String(order.customer) : null);

      if (customerId) {
        const c = await Customer.findById(customerId)
          .select('_id firstName businessName phone category accountBalance creditBalance account')
          .lean();

        if (c) {
          // Support multiple schema shapes
          customerAccountBalance = Number(
            c.accountBalance ??
            c.account?.balance ??
            c.creditBalance ??
            0
          ) || 0;

          customerInfo = Object.assign({}, c, {
            accountBalance: customerAccountBalance
          });
        }
      }
    } catch (e) {
      console.error('Failed to populate customer', e);
    }

    // -----------------------------
    // Populate payments.recordedBy user objects if present
    // -----------------------------
    try {
      if (order.payments && Array.isArray(order.payments) && order.payments.length) {
        const recIds = Array.from(new Set(
          order.payments
            .filter(p => p && p.recordedBy)
            .map(p => String(p.recordedBy))
            .filter(Boolean)
        ));

        if (recIds.length) {
          const User = require('../models/user');
          const users = await User.find({ _id: { $in: recIds } })
            .select('_id name username')
            .lean();

          const umap = {};
          users.forEach(u => { umap[String(u._id)] = u; });

          order.payments = order.payments.map(p => {
            if (p && p.recordedBy) {
              const id = String(p.recordedBy);
              const u = umap[id];
              return Object.assign({}, p, {
                recordedBy: u || p.recordedBy,
                recordedByName: (p.recordedByName || (u && (u.name || u.username)) || '')
              });
            }
            return Object.assign({}, p, { recordedByName: (p && p.recordedByName) ? p.recordedByName : '' });
          });
        } else {
          order.payments = order.payments.map(p =>
            Object.assign({}, p, { recordedByName: (p && p.recordedByName) ? p.recordedByName : '' })
          );
        }
      } else {
        order.payments = order.payments || [];
      }
    } catch (payPopErr) {
      console.error('Failed to populate payment.recordedBy', payPopErr);
      order.payments = order.payments || [];
    }

    // -----------------------------
    // Compute payments summary
    // -----------------------------
    let paidSoFar = 0;
    if (order.payments && Array.isArray(order.payments)) {
      for (const p of order.payments) {
        const a = Number(p && p.amount ? p.amount : 0);
        if (!isNaN(a)) paidSoFar += a;
      }
    }
    paidSoFar = Number(paidSoFar.toFixed(2));

    const total = Number(order.total || 0);
    const outstanding = Number((total - paidSoFar).toFixed(2));

    // -----------------------------
    // Populate handler info (safe for id/object)
    // -----------------------------
    let handlerInfo = null;
    try {
      const User = require('../models/user');
      const handlerId =
        order.handledBy && typeof order.handledBy === 'object'
          ? (order.handledBy._id ? String(order.handledBy._id) : String(order.handledBy))
          : (order.handledBy ? String(order.handledBy) : null);

      if (handlerId) {
        const h = await User.findById(handlerId).select('_id name username').lean();
        if (h) handlerInfo = h;
      }
    } catch (e) {
      console.error('Failed to populate handler for apiGetOrderById', e);
    }

    // -----------------------------
    // Return minimal data plus payments summary + customer account balance
    // -----------------------------
    return res.json({
      ok: true,

      // ✅ this helps orders_pay.js show balance reliably
      customerAccountBalance: Number(customerAccountBalance.toFixed(2)),

      order: {
        orderId: order.orderId,

        // totals
        total: order.total,

        // discount fields needed by pay page
        totalBeforeDiscount: order.totalBeforeDiscount,
        discountAmount: order.discountAmount,
        discountBreakdown: order.discountBreakdown,

        status: order.status,
        items: order.items || [],
        createdAt: order.createdAt,
        paidAt: order.paidAt,

        paidSoFar,
        outstanding,

        payments: order.payments || [],

        // ✅ customer now includes account balance
        customer: customerInfo
          ? Object.assign({}, customerInfo, { accountBalance: customerAccountBalance })
          : null,

        handledBy: handlerInfo
      }
    });

  } catch (err) {
    console.error('apiGetOrderById error', err);
    return res.status(500).json({ error: 'Error fetching order' });
  }
};

// API: mark order paid (record payment)
// POST /api/orders/:orderId/pay
exports.apiPayOrder = async (req, res) => {
  let session = null;

  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: 'No orderId provided' });

    // Accept JSON body for payment metadata:
    // { paymentMethod, momoNumber, momoTxId, chequeNumber, partPayment (bool), partPaymentAmount (number), note, meta }
    const body = req.body || {};
    const rawMethod = (body.paymentMethod || 'cash').toString().toLowerCase().trim();
    const isPart = !!body.partPayment;

    // NOTE: "account" payments should go through /orders/:orderId/pay-from-account
    if (rawMethod === 'account') {
      return res.status(400).json({ error: 'Use "Pay from account" option for account payments.' });
    }

    // Normalize method (only allow these to be stored as-is)
    const allowed = ['cash', 'momo', 'cheque', 'other'];
    const method = allowed.includes(rawMethod) ? rawMethod : 'other';

    // Determine received amount (what cashier typed / received physically)
    // - If partPayment toggle is ON: must provide partPaymentAmount
    // - If partPayment toggle is OFF: if partPaymentAmount provided, treat it as received (allows overpay for customers)
    //   otherwise default to remaining outstanding (i.e. full settlement)
    let receivedAmount = null;

    if (isPart) {
      receivedAmount = Number(body.partPaymentAmount || 0);
      if (isNaN(receivedAmount) || receivedAmount <= 0) {
        return res.status(400).json({ error: 'Invalid part payment amount' });
      }
    } else {
      if (body.partPaymentAmount !== undefined && body.partPaymentAmount !== null && String(body.partPaymentAmount).trim() !== '') {
        receivedAmount = Number(body.partPaymentAmount);
        if (isNaN(receivedAmount) || receivedAmount <= 0) {
          return res.status(400).json({ error: 'Invalid payment amount' });
        }
      }
      // else we’ll set it after we compute outstanding (default full settlement)
    }

    // Start transaction (keeps order payment + customer credit atomic)
    session = await mongoose.startSession();
    let result = null;

    await session.withTransaction(async () => {
      // Load order inside the session
      const order = await Order.findOne({ orderId }).session(session);
      if (!order) {
        // throw to abort transaction; we’ll return proper response outside
        const e = new Error('Order not found');
        e.statusCode = 404;
        throw e;
      }

      // Compute current paid + outstanding BEFORE this payment
      const currentPaid = order.paidSoFar
        ? order.paidSoFar()
        : (order.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);

      const total = Number(order.total || 0);
      const outstandingBefore = Number((total - Number(currentPaid || 0)).toFixed(2));

      const wasPaidAlready = (order.status === 'paid' && (Number(currentPaid) >= total));
      if (wasPaidAlready || outstandingBefore <= 0) {
        const e = new Error('Order already paid');
        e.statusCode = 400;
        throw e;
      }

      // Default received amount for “full payment” (no manual amount provided)
      if (receivedAmount === null) {
        receivedAmount = outstandingBefore;
      }

      if (!receivedAmount || isNaN(receivedAmount) || receivedAmount <= 0) {
        const e = new Error('Payment amount must be greater than zero');
        e.statusCode = 400;
        throw e;
      }

      // Overpayment rule:
      // - If order has a customer: allow overpay and credit excess to customer account
      // - If no customer: block overpay
      const hasCustomer = !!order.customer;

      let toRecordAmount = Number(receivedAmount);
      let creditExcess = 0;

      if (toRecordAmount > outstandingBefore) {
        if (!hasCustomer) {
          const e = new Error('Payment cannot exceed outstanding for walk-in orders');
          e.statusCode = 400;
          throw e;
        }
        creditExcess = Number((toRecordAmount - outstandingBefore).toFixed(2));
        toRecordAmount = Number(outstandingBefore.toFixed(2));
      }

      // Basic guards
      if (toRecordAmount <= 0) {
        const e = new Error('Nothing to pay on this order');
        e.statusCode = 400;
        throw e;
      }

      // Validate momo/cheque details if method needs them (light validation)
      const meta = {};
      if (method === 'momo') {
        if (body.momoNumber) meta.momoNumber = String(body.momoNumber);
        if (body.momoTxId) meta.momoTxId = String(body.momoTxId);
      } else if (method === 'cheque') {
        if (body.chequeNumber) meta.chequeNumber = String(body.chequeNumber);
      }

      // Attach extra meta
      if (body.meta && typeof body.meta === 'object') Object.assign(meta, body.meta);

      // Always store what was received + what was credited (if any)
      meta.receivedAmount = Number(receivedAmount.toFixed(2));
      if (creditExcess > 0) meta.creditExcess = Number(creditExcess.toFixed(2));

      // Build note
      const baseNote = String(body.note || (isPart ? 'part-payment' : 'full-payment')).trim();
      const note =
        creditExcess > 0
          ? `${baseNote ? baseNote + ' — ' : ''}Overpayment credited: GH₵ ${creditExcess.toFixed(2)}`
          : baseNote;

      const payment = {
        method,
        amount: Number(toRecordAmount.toFixed(2)),
        meta,
        note,
        createdAt: new Date(),
        recordedBy: null,
        recordedByName: ''
      };

      try {
        if (req.user && req.user._id) {
          payment.recordedBy = new mongoose.Types.ObjectId(req.user._id);
          payment.recordedByName = (req.user.name || req.user.username || '').toString();
        }
      } catch (e) {
        console.error('Failed to attach recordedBy to payment', e);
      }

      order.payments = order.payments || [];
      order.payments.push(payment);

      // Recompute after adding payment
      const newPaidSoFar = order.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const outstandingAfter = Number((total - newPaidSoFar).toFixed(2));

      let becamePaidNow = false;
      if (outstandingAfter <= 0) {
        order.status = 'paid';
        order.paidAt = new Date();
        becamePaidNow = true;
      }

      await order.save({ session });

      // If overpayment and has customer, credit customer account + ledger record
      if (creditExcess > 0 && hasCustomer) {
        const customerId = order.customer; // ObjectId
        const customer = await Customer.findById(customerId).session(session);
        if (!customer) {
          const e = new Error('Customer not found for overpayment credit');
          e.statusCode = 400;
          throw e;
        }

        const beforeBal = Number(customer.accountBalance || 0);
        customer.accountBalance = Number((beforeBal + creditExcess).toFixed(2));
        await customer.save({ session });

        await CustomerAccountTxn.create(
          [
            {
              customer: customer._id,
              type: 'credit',
              amount: Number(creditExcess.toFixed(2)),
              note: `Overpayment credit from order ${order.orderId}`,
              recordedBy: payment.recordedBy || null,
              recordedByName: payment.recordedByName || ''
            }
          ],
          { session }
        );
      }

      result = {
        ok: true,
        orderId: order.orderId,
        paidSoFar: Number(newPaidSoFar.toFixed(2)),
        outstanding: Number(outstandingAfter.toFixed(2)),
        status: order.status,
        receivedAmount: Number(receivedAmount.toFixed(2)),
        creditedToAccount: Number(creditExcess.toFixed(2)),
        becamePaidNow,
        // used by SMS logic after commit
        _customerId: order.customer || null
      };
    });

    // --- AUTO SMS ON PAY (dynamic) ---
    // only when this request transitions order -> paid
    try {
      if (result && result.ok && result.becamePaidNow && result._customerId) {
        const cust = await Customer.findById(result._customerId)
          .select('_id phone category firstName businessName')
          .lean();

        if (cust && cust.phone) {
          const messagingController = require('./messaging');
          const auto = await messagingController.buildAutoMessageForCustomer(
            cust,
            'pay',
            {
              orderId: result.orderId,
              amount: undefined // keep template free; if you want, you can re-fetch order total here
            }
          );

          if (!(auto && auto.enabled === false)) {
            const fallback = 'Thank you for your payment. We appreciate doing business with you.';
            const msg = (auto && auto.content) ? String(auto.content) : fallback;

            if (msg && msg.trim()) {
              const { sendSms } = require('../utilities/hubtel_sms');
              await sendSms({ to: cust.phone, content: msg });
            }
          }
        }
      }
    } catch (smsErr) {
      console.error('Failed to send PAY auto SMS', smsErr);
    }

    // Cleanup extra internal field
    if (result && result._customerId !== undefined) delete result._customerId;

    return res.json(result || { ok: true });
  } catch (err) {
    console.error('apiPayOrder error', err);

    // If we threw an error with a statusCode inside the transaction
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Request failed' });
    }

    return res.status(500).json({ error: 'Error paying order' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};

// POST /orders/pay-bulk
exports.apiPayBulkDebtor = async (req, res) => {
  try {
    const { orderIds, paymentMethod, momoNumber, momoTxId, chequeNumber } = req.body;

    if (!Array.isArray(orderIds) || !orderIds.length) {
      return res.status(400).json({ error: 'No orders provided for bulk payment' });
    }

    // Optional: normalize method (keep existing behavior defaulting to 'cash')
    const method = (paymentMethod || 'cash').toString().toLowerCase();
    const safeMethod = ['cash', 'momo', 'cheque', 'other'].includes(method) ? method : 'other';

    for (const oid of orderIds) {
      const order = await Order.findOne({ orderId: oid });
      if (!order) continue;

      const paidSoFar = (order.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const outstanding = Number(order.total || 0) - paidSoFar;
      if (outstanding <= 0) continue;

      order.payments = order.payments || [];
      order.payments.push({
        method: safeMethod,
        amount: Number(outstanding),
        meta: {
          momoNumber,
          momoTxId,
          chequeNumber
        },
        note: 'bulk-full-payment',
        createdAt: new Date(),
        recordedBy: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null,
        recordedByName: (req.user?.name || req.user?.username || '').toString()
      });

      const wasPaidAlready = (order.status === 'paid'); // simple state check
      order.status = 'paid';
      order.paidAt = new Date();

      await order.save();

      // -----------------------------
      // AUTO SMS ON PAY (dynamic) - bulk
      // only send if it wasn't already paid before
      // -----------------------------
      try {
        if (!wasPaidAlready && order.customer) {
          const cust = await Customer.findById(order.customer)
            .select('_id phone category firstName businessName')
            .lean();

          if (cust && cust.phone) {
            const messagingController = require('./messaging');
            const auto = await messagingController.buildAutoMessageForCustomer(
              cust,
              'pay',
              {
                orderId: order.orderId,
                amount: order.total,
                totalBeforeDiscount: order.totalBeforeDiscount ?? '',
                discountAmount: order.discountAmount ?? ''
              }
            );

            if (auto && auto.enabled === false) {
              // no-op
            } else {
              const fallback = 'Thank you for your payment. We appreciate doing business with you.';
              const msg = (auto && auto.content) ? String(auto.content) : fallback;

              if (msg && msg.trim()) {
                const { sendSms } = require('../utilities/hubtel_sms');
                await sendSms({ to: cust.phone, content: msg });
              }
            }
          }
        }
      } catch (smsErr) {
        console.error('Bulk pay: failed to send PAY auto SMS for order', oid, smsErr);
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('apiPayBulkDebtor error', err);
    return res.status(500).json({ error: 'Bulk payment failed' });
  }
};



// API: list debtors (orders with outstanding > 0)
// GET /api/debtors
exports.apiGetDebtors = async (req, res) => {
  try {
    // Build base match for date/other filters if needed (currently none)
    // We'll inject a handledBy filter for non-admins.

    // Determine if we should restrict to current user
    let userMatch = null;
    try {
      const isAdmin = req.user && req.user.role && String(req.user.role).toLowerCase() === 'admin';
      if (!isAdmin && req.user && req.user._id) {
        userMatch = { handledBy: new mongoose.Types.ObjectId(req.user._id) };
      }
    } catch (e) {
      console.warn('apiGetDebtors: could not determine user filter', e);
    }

    // aggregate: compute paidSoFar and outstanding per order then filter outstanding > 0
    const pipeline = [
      // optionally restrict to orders for this user
      ...(userMatch ? [{ $match: userMatch }] : []),

      // compute paidSoFar (sum of payments.amount)
      { $addFields: { paidSoFar: { $sum: { $ifNull: ['$payments.amount', []] } } } },
      // outstanding = total - paidSoFar
      { $addFields: { outstanding: { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$paidSoFar', 0] }] } } },
      // only those with outstanding > 0
      { $match: { outstanding: { $gt: 0 } } },

      // lookup customer doc (if order.customer references a Customer)
      { $lookup: {
          from: 'customers',
          localField: 'customer',
          foreignField: '_id',
          as: 'customer_doc'
      } },

      // derive a debtorName: prefer explicit order.customerName,
      // otherwise use customer_doc info (artist -> businessName|phone, else firstName|businessName|phone),
      // otherwise fallback to empty string
      { $addFields: {
        debtorName: {
          $ifNull: [
            '$customerName',
            {
              $cond: [
                { $gt: [ { $size: '$customer_doc' }, 0 ] },
                {
                  $let: {
                    vars: { c: { $arrayElemAt: ['$customer_doc', 0] } },
                    in: {
                      $cond: [
                        { $in: ['$$c.category', ['artist', 'organisation']] },
                        {
                          $ifNull: [
                            '$$c.businessName',
                            { $ifNull: ['$$c.phone', ''] }
                          ]
                        },
                        {
                          $ifNull: [
                            '$$c.firstName',
                            {
                              $ifNull: [
                                '$$c.businessName',
                                { $ifNull: ['$$c.phone', ''] }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  }
                },
                ''
              ]
            }
          ]
        }
      }},
      // project fields useful for frontend
      { $project: {
          orderId: 1,
          total: 1,
          paidSoFar: 1,
          outstanding: 1,
          debtorName: 1,
          createdAt: 1,
          status: 1
      } },

      { $sort: { createdAt: -1 } },
      { $limit: 1000 }
    ];

    const rows = await Order.aggregate(pipeline);

    // Normalize output so amounts are numbers with 2 decimals
    const out = (rows || []).map(r => ({
      orderId: r.orderId,
      debtorName: r.debtorName || '',
      amountDue: Number((r.total || 0).toFixed(2)),
      paidSoFar: Number((r.paidSoFar || 0).toFixed(2)),
      outstanding: Number((r.outstanding || 0).toFixed(2)),
      createdAt: r.createdAt,
      status: r.status
    }));

    return res.json({ ok: true, debtors: out });
  } catch (err) {
    console.error('apiGetDebtors error', err);
    return res.status(500).json({ error: 'Error fetching debtors' });
  }
};

exports.apiListOrders = async (req, res) => {
  try {
    // Accepts ?from=YYYY-MM-DD&to=YYYY-MM-DD
    const { from, to } = req.query || {};
    // Helper: parse YYYY-MM-DD into Date start/end-of-day
    function parseDateStart(dstr) {
      if (!dstr) return null;
      const d = new Date(dstr + 'T00:00:00Z');
      if (isNaN(d.getTime())) return null;
      return d;
    }
    function parseDateEnd(dstr) {
      if (!dstr) return null;
      const d = new Date(dstr + 'T23:59:59.999Z');
      if (isNaN(d.getTime())) return null;
      return d;
    }

    // Default: today in server UTC (client is Africa/Accra but server should interpret ISO date)
    const todayIso = new Date();
    const defaultFrom = new Date(Date.UTC(todayIso.getUTCFullYear(), todayIso.getUTCMonth(), todayIso.getUTCDate(), 0, 0, 0, 0));
    const defaultTo = new Date(Date.UTC(todayIso.getUTCFullYear(), todayIso.getUTCMonth(), todayIso.getUTCDate(), 23, 59, 59, 999));

    const start = parseDateStart(from) || defaultFrom;
    const end = parseDateEnd(to) || defaultTo;

    // Protect: don't allow huge ranges — limit to 365 days by default
    const maxRangeMs = 365 * 24 * 60 * 60 * 1000;
    if (end - start > maxRangeMs) {
      return res.status(400).json({ error: 'Date range too large (max 365 days)' });
    }

    // Query orders in range, newest first, limit to 1000 for safety
    const q = { createdAt: { $gte: start, $lte: end } };

    // IMPORTANT: restrict list to current user unless admin
    try {
      const isAdmin = req.user && req.user.role && String(req.user.role).toLowerCase() === 'admin';
      if (!isAdmin && req.user && req.user._id) {
        q.handledBy = new mongoose.Types.ObjectId(req.user._id);
      }
      // If req.user is missing we fall back to existing behavior (no extra filter).
    } catch (e) {
      // don't block; fallback to existing behavior
      console.warn('apiListOrders: could not apply user filter', e);
    }

    const orders = await Order.find(q)
      .populate('customer', 'firstName businessName category phone')
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    // Map to minimal info the client needs in the list
const out = orders.map(o => {
  let displayName = 'Walk-in';

  if (o.customer) {
    if (o.customer.category === 'artist') {
      displayName =
        o.customer.businessName ||
        o.customer.phone ||
        'Artist';
    } else {
      displayName =
        o.customer.firstName ||
        o.customer.businessName ||
        o.customer.phone ||
        'Customer';
    }
  }

  return {
    _id: o._id,
    name: displayName,      // ✅ NEW
    orderId: o.orderId,     // keep for actions
    total: o.total,
    status: o.status,
    createdAt: o.createdAt
  };
});

    return res.json({ ok: true, orders: out });
  } catch (err) {
    console.error('apiListOrders error', err);
    return res.status(500).json({ error: 'Error listing orders' });
  }
};
