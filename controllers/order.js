// controllers/orders.js
const crypto = require('crypto');
const Service = require('../models/service');
const ServicePrice = require('../models/service_price');
const Order = require('../models/order');
const Customer = require('../models/customer');
const CustomerAccountTxn = require('../models/customer_account_txn');
const Printer = require('../models/printer');
const PrinterUsage = require('../models/printer_usage');
const mongoose = require('mongoose');
const Material = require('../models/material');
const { MaterialUsage, MaterialAggregate } = require('../models/material_usage');
const { ObjectId } = require('mongoose').Types;
const DiscountConfig = require('../models/discount');
const Store = require('../models/store');
const StoreStock = require('../models/store_stock');
const StockPurchase = require('../models/stock_purchase');
const StoreStockAdjustment = require('../models/store_stock_adjustment');
const StoreStockTransfer = require('../models/store_stock_transfer');
const RegistrationSubmission = require('../models/registration_submission');
const CartInvoice = require('../models/cart_invoice');
const InvoiceCounter = require('../models/invoice_counter');
const User = require('../models/user');
const Book = require('../models/book');
const {
  resolvePaymentCashBookContext,
  recordCashBookMovement
} = require('../utilities/cash_books');
const { consumeStockLots } = require('../utilities/stock_lots');
const {
  actorFromReq,
  postOrderRevenue,
  postOrderPayment,
  postMaterialUsageCost,
  postOutsourcedCost,
  postPrinterDepreciation,
  round2,
  roundUnitCost
} = require('../utilities/accounting');

function positiveCountFactor(value, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function roundCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : 0;
}

async function resolveMaterialUnitCostSnapshot(stockDoc, storeId, materialId) {
  const stored = roundUnitCost(stockDoc && stockDoc.averageUnitCost ? stockDoc.averageUnitCost : 0);
  if (!stockDoc || !storeId || !materialId || stored <= 0) return stored;

  // Older stock rows may have averageUnitCost rounded to 2 decimals. Rebuild the
  // moving average from purchase totals only when the stock history is simple.
  if (Math.abs(stored - round2(stored)) > 0.000001) return stored;

  const stockId = stockDoc._id;
  const [hasTransfer, hasManualAdjustment, purchases, usages] = await Promise.all([
    stockId
      ? StoreStockTransfer.exists({ $or: [{ fromStock: stockId }, { toStock: stockId }] })
      : null,
    stockId
      ? StoreStockAdjustment.exists({ stock: stockId, kind: { $nin: ['add', 'purchase'] } })
      : null,
    StockPurchase.find({ store: storeId, material: materialId })
      .select('_id quantity totalCost createdAt')
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    MaterialUsage.find({ store: storeId, material: materialId })
      .select('_id count createdAt')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
  ]);

  if (hasTransfer || hasManualAdjustment || !purchases.length) return stored;

  const events = [];
  purchases.forEach(p => {
    const qty = Math.max(0, Number(p.quantity || 0));
    const totalCost = round2(p.totalCost || 0);
    if (qty > 0 && totalCost > 0) {
      events.push({ type: 'purchase', qty, totalCost, createdAt: p.createdAt, _id: p._id });
    }
  });
  usages.forEach(u => {
    const qty = Math.max(0, Number(u.count || 0));
    if (qty > 0) events.push({ type: 'usage', qty, createdAt: u.createdAt, _id: u._id });
  });

  events.sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a._id || '').localeCompare(String(b._id || ''));
  });

  let remaining = 0;
  let average = 0;
  events.forEach(event => {
    if (event.type === 'purchase') {
      const oldValue = remaining * average;
      remaining += event.qty;
      average = remaining > 0 ? roundUnitCost((oldValue + event.totalCost) / remaining) : average;
    } else if (event.type === 'usage') {
      remaining = Math.max(0, remaining - event.qty);
    }
  });

  if (average > 0 && Math.abs(average - stored) > 0.000001 && stockId) {
    await StoreStock.updateOne(
      { _id: stockId, averageUnitCost: stored },
      { $set: { averageUnitCost: average } }
    );
  }

  return average > 0 ? average : stored;
}


async function getUsableCustomerCredit(customerId, session = null) {
  if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) return 0;
  const cid = new mongoose.Types.ObjectId(customerId);

  const pipeline = [
    { $match: { customer: cid } },
    {
      $group: {
        _id: null,
        credits: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
        debits: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } },
        count: { $sum: 1 }
      }
    }
  ];

  const agg = await CustomerAccountTxn.aggregate(pipeline).session(session || null);
  if (agg && agg[0] && Number(agg[0].count || 0) > 0) {
    const net = Number((Number(agg[0].credits || 0) - Number(agg[0].debits || 0)).toFixed(2));
    return Number(Math.max(0, net).toFixed(2));
  }

  // Legacy fallback: if no txns exist yet, honor stored accountBalance.
  const c = await Customer.findById(cid).select('accountBalance').session(session || null);
  return Number(Math.max(0, Number(c?.accountBalance || 0)).toFixed(2));
}

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

      const bal = await getUsableCustomerCredit(customer._id, session);
      const apply = Number(Math.min(bal, outstanding).toFixed(2));

      if (apply <= 0) {
        const e = new Error('Customer account balance is 0.00');
        e.statusCode = 400;
        throw e;
      }

      // debit customer
      customer.accountBalance = Number((bal - apply).toFixed(2));
      await customer.save({ session });

      // ledger txn:
      // paying from account consumes customer's credit, so this is a DEBIT entry.
      await CustomerAccountTxn.create([{
        customer: customer._id,
        type: 'debit',
        amount: apply,
        note: `Paid from account ${order.orderId}`,
        recordedBy: req.user?._id || null,
        recordedByName: req.user?.name || req.user?.username || ''
      }], { session });

      // Ensure original order entry is tagged as account-settled for visibility in ledger.
      await CustomerAccountTxn.updateMany(
        {
          customer: customer._id,
          type: 'debit',
          note: `Order placed ${order.orderId}`
        },
        { $set: { note: `Order placed ${order.orderId} (A/C)` } },
        { session }
      );

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
      const savedPayment = order.payments && order.payments.length
        ? order.payments[order.payments.length - 1]
        : null;
      if (savedPayment) {
        await postOrderPayment(order, savedPayment, actorFromReq(req), session);
      }

      result = {
        ok: true,
        usedFromAccount: apply,
        newBalance: Number(customer.accountBalance || 0),
        outstanding: newOutstanding,
        status: order.status,
        // used by SMS logic after commit
        _customerId: order.customer || null,
        _orderId: order.orderId,
        _paymentAmount: Number(apply.toFixed(2)),
        _totalBeforeDiscount: order.totalBeforeDiscount ?? null,
        _discountAmount: order.discountAmount ?? null
      };
    });

    // --- AUTO SMS ON PAY (dynamic) ---
    try {
      if (result && result.ok && result._customerId) {
        const cust = await Customer.findById(result._customerId)
          .select('_id phone category firstName businessName accountBalance')
          .lean();

        if (cust && cust.phone) {
          const messagingController = require('./messaging');
          const auto = await messagingController.buildAutoMessageForCustomer(
            cust,
            'pay',
            {
              orderId: result._orderId,
              amount: result._paymentAmount,
              totalBeforeDiscount: result._totalBeforeDiscount ?? '',
              discountAmount: result._discountAmount ?? '',
              outstanding: result.outstanding
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
      console.error('Failed to send PAY auto SMS (account)', smsErr);
    }

    // Cleanup extra internal fields
    if (result && result._customerId !== undefined) delete result._customerId;
    if (result && result._orderId !== undefined) delete result._orderId;
    if (result && result._paymentAmount !== undefined) delete result._paymentAmount;
    if (result && result._totalBeforeDiscount !== undefined) delete result._totalBeforeDiscount;
    if (result && result._discountAmount !== undefined) delete result._discountAmount;

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

function computeTaxAmount(taxableTotal, tax) {
  if (!tax) return 0;
  const base = Math.max(0, Number(taxableTotal || 0));
  const value = Number(tax.value || 0);
  if (!isFinite(value) || value <= 0) return 0;
  if (tax.mode === 'amount') return Number(Math.max(0, value).toFixed(2));
  if (tax.mode === 'percent') {
    const pct = Math.max(0, Math.min(100, value));
    return Number((base * (pct / 100)).toFixed(2));
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

async function maxExistingInvoiceSeq(yearSuffix) {
  const latest = await CartInvoice.find({ invoiceNo: new RegExp(`^\\d{4}${yearSuffix}$`) })
    .select('invoiceNo')
    .sort({ invoiceNo: -1 })
    .limit(1)
    .lean();

  for (const inv of latest) {
    const n = Number(String(inv.invoiceNo || '').slice(0, 4));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

async function makeInvoiceNo() {
  const year = new Date().getFullYear();
  const yearSuffix = String(year).slice(-2);

  let counter = await InvoiceCounter.findOneAndUpdate(
    { year },
    { $inc: { seq: 1 } },
    { new: true }
  );

  if (!counter) {
    const startingSeq = await maxExistingInvoiceSeq(yearSuffix);
    try {
      await InvoiceCounter.create({ year, seq: startingSeq });
    } catch (err) {
      if (!err || err.code !== 11000) throw err;
    }

    counter = await InvoiceCounter.findOneAndUpdate(
      { year },
      { $inc: { seq: 1 } },
      { new: true }
    );
  }

  if (!counter) throw new Error('Unable to allocate invoice number');
  if (Number(counter.seq || 0) > 9999) throw new Error(`Invoice number limit reached for ${year}`);

  return `${String(counter.seq).padStart(4, '0')}${yearSuffix}`;
}

function invoicePayload(inv) {
  if (!inv) return null;
  return {
    id: String(inv._id),
    invoiceNo: inv.invoiceNo,
    customerId: inv.customer ? String(inv.customer._id || inv.customer) : '',
    customerName: inv.customerName || '',
    customerPhone: inv.customerPhone || '',
    customerCategory: inv.customerCategory || '',
    categories: (inv.categories || []).map(c => ({
      id: c.id ? String(c.id._id || c.id) : '',
      name: c.name || ''
    })).filter(c => c.id),
    cart: inv.cart || [],
    manualDiscount: inv.manualDiscount || null,
    manualTax: inv.manualTax || null,
    jobNote: inv.jobNote || '',
    totals: inv.totals || {},
    status: inv.status || 'open',
    convertedOrderId: inv.convertedOrderId || '',
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt
  };
}

function currentUtcDayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

async function loadOperationalStockContext() {
  const opStore = await Store.findOne({ isOperational: true }).lean();
  if (!opStore) return { opStore: null, opStocks: [] };

  const opStocks = await StoreStock.find({ store: opStore._id, active: true })
    .populate('material', '_id name selections baseUnitName')
    .lean();

  return { opStore, opStocks };
}

function buildMaterialRequirements(builtItems, opStocks) {
  const requirements = [];

  for (let idx = 0; idx < (builtItems || []).length; idx++) {
    const it = builtItems[idx];
    if (it && Number(it.outsourcedTotal || 0) > 0) continue;

    const isLargeFormatItem = String(it && it.pricingMode || '').toLowerCase() === 'large_format';
    if (isLargeFormatItem) {
      const materialId = it && it.largeFormatMaterial ? String(it.largeFormatMaterial) : '';
      const count = roundCount(Number(it && it.largeFormatConsumedSquareFeet || 0));
      if (!materialId || count <= 0) continue;

      const st = (opStocks || []).find(stock => {
        const mid = stock && stock.material && stock.material._id ? String(stock.material._id) : String(stock && stock.material || '');
        return mid === materialId;
      });

      requirements.push({
        stock: st || null,
        material: st && st.material ? st.material : { _id: materialId, name: it.largeFormatMaterialName || 'Large Format material' },
        itemIndex: idx,
        count,
        source: 'large_format',
        serviceName: it.serviceName || 'Large Format'
      });
      continue;
    }

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

    const count = (Math.max(0, baseCount) + Math.max(0, spoiled)) * factorMul;
    if (count <= 0) continue;

    for (const st of (opStocks || [])) {
      const m = st.material;
      if (!m || !m.selections || !m.selections.length) continue;

      if (materialMatchesItem(m.selections, itemSelections)) {
        requirements.push({
          stock: st,
          material: m,
          itemIndex: idx,
          count
        });
      }
    }
  }

  return requirements;
}

function scheduleOrderPostResponseTasks({ orderId, materialUsageIds, printerUsageIds, outsourcedArtistTotals, actor }) {
  setImmediate(async () => {
    try {
      const order = await Order.findOne({ orderId }).lean();
      if (!order) return;

      const tasks = [];

      tasks.push((async () => {
        try {
          await postOrderRevenue(order, actor);
          for (const payment of (order.payments || [])) {
            await postOrderPayment(order, payment, actor);
          }
        } catch (err) {
          console.error('Background accounting order revenue/payment posting failed', err);
        }
      })());

      tasks.push((async () => {
        try {
          const usages = materialUsageIds && materialUsageIds.length
            ? await MaterialUsage.find({ _id: { $in: materialUsageIds } }).lean()
            : [];
          for (const usage of usages) {
            await postMaterialUsageCost(usage, actor);
          }
        } catch (err) {
          console.error('Background material usage accounting failed', err);
        }
      })());

      tasks.push((async () => {
        try {
          const usages = printerUsageIds && printerUsageIds.length
            ? await PrinterUsage.find({ _id: { $in: printerUsageIds } })
            : [];
          for (const usage of usages) {
            await postPrinterDepreciation(usage, actor);
          }
        } catch (err) {
          console.error('Background printer depreciation accounting failed', err);
        }
      })());

      tasks.push((async () => {
        try {
          for (const entry of (outsourcedArtistTotals || [])) {
            if (!entry || !entry.artistId || Number(entry.amount || 0) <= 0) continue;
            await postOutsourcedCost(order, entry.artistId, Number(entry.amount || 0), actor);
          }
        } catch (err) {
          console.error('Background outsourced cost accounting failed', err);
        }
      })());

      tasks.push((async () => {
        try {
          if (!order.customer) return;
          const customerController = require('./customer');
          let cust = await customerController.updateRegularStatus(order.customer);
          if (!cust) {
            cust = await Customer.findById(order.customer).select('_id phone category accountBalance').lean();
          }
          if (!cust || !cust.phone) return;

          const { sendSms } = require('../utilities/hubtel_sms');
          const messagingController = require('./messaging');
          const auto = await messagingController.buildAutoMessageForCustomer(
            cust,
            'order',
            {
              orderId: order.orderId,
              amount: order.total,
              totalBeforeDiscount: order.totalBeforeDiscount ?? '',
              discountAmount: order.discountAmount ?? ''
            }
          );

          if (auto && auto.enabled === false) return;
          const msg = (auto && auto.content) ? auto.content : buildThankYouSms(cust.category);
          if (msg && String(msg).trim()) {
            await sendSms({ to: cust.phone, content: msg });
          }
        } catch (err) {
          console.error('Background post-order customer status/SMS failed', err);
        }
      })());

      await Promise.allSettled(tasks);
    } catch (err) {
      console.error('Background post-order task runner failed', err);
    }
  });
}


// Render order creation page
exports.newOrderPage = async (req, res) => {
  try {
    const services = await Service.find().select('_id name').sort({ orderIndex: 1, name: 1 }).lean();

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

exports.apiSaveCartInvoice = async (req, res) => {
  try {
    const body = req.body || {};
    const rawCart = Array.isArray(body.cart) ? body.cart.slice(0, 100) : [];
    const cart = rawCart.map(line => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) return line;
      const clean = Object.assign({}, line);
      const invoiceLabelOverride = String(clean.invoiceLabelOverride || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      if (invoiceLabelOverride) clean.invoiceLabelOverride = invoiceLabelOverride;
      else delete clean.invoiceLabelOverride;
      return clean;
    });
    if (!cart.length) return res.status(400).json({ error: 'Invoice cart is empty' });

    const invoiceId = String(body.invoiceId || '').trim();
    const submissionId = String(body.submissionId || '').trim();
    const jobNote = String(body.jobNote || '').trim().slice(0, 140);
    const isAdmin = req.user && req.user.role && String(req.user.role).toLowerCase() === 'admin';
    const manualDiscount = isAdmin && body.manualDiscount && typeof body.manualDiscount === 'object' ? body.manualDiscount : null;
    const manualTax = isAdmin && body.manualTax && typeof body.manualTax === 'object' ? body.manualTax : null;
    const totals = body.totals && typeof body.totals === 'object' ? Object.assign({}, body.totals) : {};
    if (!isAdmin) {
      const baseTotal = Number(cart.reduce((sum, item) => sum + Number(item && item.subtotal || 0), 0).toFixed(2));
      totals.adjustmentAmount = 0;
      totals.taxAmount = 0;
      totals.tax = null;
      totals.taxableTotal = baseTotal;
      totals.finalTotal = baseTotal;
    }

    let invoice = null;
    let source = null;

    if (invoiceId && mongoose.Types.ObjectId.isValid(invoiceId)) {
      invoice = await CartInvoice.findOne({ _id: new mongoose.Types.ObjectId(invoiceId), status: 'open' });
      if (!invoice) return res.status(404).json({ error: 'Open invoice not found' });
    } else {
      if (!submissionId || !mongoose.Types.ObjectId.isValid(submissionId)) {
        return res.status(400).json({ error: 'Select a submitted customer/walk-in before saving an invoice.' });
      }

      source = await RegistrationSubmission.findOne({
        _id: new mongoose.Types.ObjectId(submissionId),
        status: 'pending'
      })
        .populate('customer', '_id firstName businessName phone category')
        .populate('categories', '_id name')
        .lean();

      if (!source) return res.status(409).json({ error: 'Selected submission is no longer available. Refresh and try again.' });
    }

    if (!invoice) {
      const customerDoc = source && source.customer && typeof source.customer === 'object' ? source.customer : null;
      const customerName = customerDoc
        ? String(customerDoc.businessName || customerDoc.firstName || customerDoc.phone || source.displayName || '').trim()
        : String(source.displayName || '').trim();

      invoice = new CartInvoice({
        invoiceNo: await makeInvoiceNo(),
        customer: customerDoc && customerDoc._id ? customerDoc._id : null,
        customerName,
        customerPhone: String((customerDoc && customerDoc.phone) || source.phone || '').trim(),
        customerCategory: String((customerDoc && customerDoc.category) || '').trim(),
        sourceSubmission: source._id,
        categories: (source.categories || []).map(c => ({ id: c._id, name: c.name || '' })),
        createdBy: req.user?._id || null,
        createdByName: req.user?.name || req.user?.username || ''
      });
    }

    invoice.cart = cart;
    invoice.manualDiscount = manualDiscount;
    invoice.manualTax = manualTax;
    invoice.jobNote = jobNote;
    invoice.totals = totals;
    await invoice.save();

    return res.json({ ok: true, invoice: invoicePayload(invoice) });
  } catch (err) {
    console.error('apiSaveCartInvoice error', err);
    if (err && err.code === 11000) return res.status(409).json({ error: 'Invoice number collision. Try again.' });
    return res.status(500).json({ error: 'Error saving invoice' });
  }
};

exports.apiListCartInvoices = async (req, res) => {
  try {
    const qRaw = String(req.query.q || '').trim();
    const invoiceId = String(req.query.invoiceId || '').trim();
    const filter = {};

    if (invoiceId) {
      if (!mongoose.Types.ObjectId.isValid(invoiceId)) return res.status(400).json({ error: 'Invalid invoice id' });
      filter._id = new mongoose.Types.ObjectId(invoiceId);
    } else if (qRaw) {
      const safe = qRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(safe, 'i');
      filter.$or = [
        { invoiceNo: regex },
        { customerName: regex },
        { customerPhone: regex }
      ];
      filter.status = { $ne: 'cancelled' };
    } else {
      filter.status = 'open';
    }

    const rows = await CartInvoice.find(filter)
      .sort({ updatedAt: -1 })
      .limit(invoiceId ? 1 : 20)
      .lean();

    return res.json({ ok: true, invoices: rows.map(invoicePayload) });
  } catch (err) {
    console.error('apiListCartInvoices error', err);
    return res.status(500).json({ error: 'Error loading invoices' });
  }
};

exports.apiRemoveCartInvoice = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid invoice id' });
    }

    const invoice = await CartInvoice.findOne({
      _id: new mongoose.Types.ObjectId(id),
      status: 'open'
    });

    if (!invoice) return res.status(404).json({ error: 'Open invoice not found' });

    invoice.status = 'cancelled';
    await invoice.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error('apiRemoveCartInvoice error', err);
    return res.status(500).json({ error: 'Error removing invoice' });
  }
};

// API: create order
// expects body: { items: [{ serviceId, priceRuleId, pages (optional), fb (optional boolean), printerId (optional) } , ...] }
// Server-authoritative pricing: when items[].fb is true and the price rule has price2, use price2.
exports.apiCreateOrder = async (req, res) => {
  try {
    let { items } = req.body;
    const jobNote = String(req.body && req.body.jobNote ? req.body.jobNote : '').trim().slice(0, 140);
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

const pricingMode = String(it.pricingMode || it.itemType || '').toLowerCase().trim();
const largeFormatLength = Number(it.largeFormatLength || it.length || 0);
const largeFormatBreadth = Number(it.largeFormatBreadth || it.breadth || 0);
const largeFormatUnit = String(it.largeFormatUnit || it.measurementUnit || 'feet').toLowerCase().trim() === 'inches'
  ? 'inches'
  : 'feet';
const largeFormatQty = Math.max(1, Math.floor(Number(it.largeFormatQty || it.quantity || factor || 1)));

return {
  serviceId: it.serviceId,
  priceRuleId: it.priceRuleId || null,
  pricingMode,
  largeFormatLength,
  largeFormatBreadth,
  largeFormatUnit,
  largeFormatQty,
  pages,
  factor,              // NEW
  fb,
  printerId: it.printerId || null,
  spoiled,
  outsourced: it.outsourced === true || it.outsourced === 'true' || it.outsourced === 1 || it.outsourced === '1',
  outsourcedArtistId: it.outsourcedArtistId || null,
  outsourcedArtistName: it.outsourcedArtistName || '',
  outsourcedQty: it.outsourcedQty,
  outsourcedAmount: it.outsourcedAmount
};
    });

    const submissionId = String(req.body && req.body.submissionId ? req.body.submissionId : '').trim();
    const invoiceId = String(req.body && req.body.invoiceId ? req.body.invoiceId : '').trim();
    let invoice = null;
    let submission = null;

    if (invoiceId && mongoose.Types.ObjectId.isValid(invoiceId)) {
      invoice = await CartInvoice.findOne({
        _id: new mongoose.Types.ObjectId(invoiceId),
        status: 'open'
      }).lean();

      if (!invoice) {
        return res.status(409).json({ error: 'Selected invoice is no longer available. Refresh and try again.' });
      }

      submission = {
        _id: invoice.sourceSubmission || null,
        customer: invoice.customer || null,
        displayName: invoice.customerName || '',
        phone: invoice.customerPhone || '',
        categories: (invoice.categories || []).map(c => c.id).filter(Boolean),
        fromInvoice: true
      };
    } else {
      if (!submissionId || !mongoose.Types.ObjectId.isValid(submissionId)) {
        return res.status(400).json({ error: 'Select a submitted customer or saved invoice first.' });
      }

      submission = await RegistrationSubmission.findOne({
        _id: new mongoose.Types.ObjectId(submissionId),
        status: 'pending'
      }).select('_id customer displayName categories').lean();

      if (!submission) {
        return res.status(409).json({ error: 'Selected submission is no longer available. Refresh and try again.' });
      }
    }

    const allowedCategoryIds = new Set((submission.categories || []).map(id => String(id && id._id ? id._id : id)));
    if (!allowedCategoryIds.size) {
      return res.status(400).json({ error: 'Submitted customer has no allowed categories.' });
    }
    const allowedCategoryObjectIds = Array.from(allowedCategoryIds)
      .filter(id => mongoose.Types.ObjectId.isValid(id))
      .map(id => new mongoose.Types.ObjectId(id));

    for (const it of items) {
      const isLargeFormatLine = String(it.pricingMode || '').toLowerCase() === 'large_format';
      if (!mongoose.Types.ObjectId.isValid(it.serviceId) || (!isLargeFormatLine && !mongoose.Types.ObjectId.isValid(it.priceRuleId))) {
        return res.status(400).json({ error: 'Invalid IDs in items' });
      }
    }

    const itemServiceIdStrings = Array.from(new Set(items.map(it => String(it.serviceId))));
    const itemPriceRuleIdStrings = Array.from(new Set(items
      .map(it => String(it.priceRuleId || '').trim())
      .filter(id => mongoose.Types.ObjectId.isValid(id))));
    const itemPrinterIdStrings = Array.from(new Set(
      items
        .map(it => String(it.printerId || '').trim())
        .filter(id => mongoose.Types.ObjectId.isValid(id))
    ));
    const outsourcedArtistIdStrings = Array.from(new Set(
      items
        .map(it => String(it.outsourcedArtistId || '').trim())
        .filter(id => mongoose.Types.ObjectId.isValid(id))
    ));

    const [priceRules, services, printers, outsourcedArtists, compoundBooks] = await Promise.all([
      ServicePrice.find({ _id: { $in: itemPriceRuleIdStrings.map(id => new mongoose.Types.ObjectId(id)) } })
        .populate('selections.unit selections.subUnit')
        .lean(),
      Service.find({ _id: { $in: itemServiceIdStrings.map(id => new mongoose.Types.ObjectId(id)) } })
        .populate('category', '_id name nameNormalized')
        .populate('largeFormatMaterial', '_id name baseUnitName')
        .lean(),
      itemPrinterIdStrings.length
        ? Printer.find({ _id: { $in: itemPrinterIdStrings.map(id => new mongoose.Types.ObjectId(id)) } }).lean()
        : Promise.resolve([]),
      outsourcedArtistIdStrings.length
        ? Customer.find({ _id: { $in: outsourcedArtistIdStrings.map(id => new mongoose.Types.ObjectId(id)) } })
          .select('_id category businessName firstName phone')
          .lean()
        : Promise.resolve([]),
      allowedCategoryObjectIds.length
        ? Book.find({
          category: { $in: allowedCategoryObjectIds },
          'items.service': { $in: itemServiceIdStrings.map(id => new mongoose.Types.ObjectId(id)) },
          ...(itemPriceRuleIdStrings.length
            ? { 'items.priceRule': { $in: itemPriceRuleIdStrings.map(id => new mongoose.Types.ObjectId(id)) } }
            : {})
        }).select('items.service items.priceRule').lean()
        : Promise.resolve([])
    ]);

    const priceRuleMap = new Map(priceRules.map(pr => [String(pr._id), pr]));
    const serviceMap = new Map(services.map(svc => [String(svc._id), svc]));
    const printerMap = new Map(printers.map(prn => [String(prn._id), prn]));
    const outsourcedArtistMap = new Map(outsourcedArtists.map(artist => [String(artist._id), artist]));
    const compoundAllowedPairs = new Set();
    (compoundBooks || []).forEach(book => {
      (book.items || []).forEach(item => {
        if (item && item.service && item.priceRule) {
          compoundAllowedPairs.add(`${String(item.service)}:${String(item.priceRule)}`);
        }
      });
    });

    const builtItems = [];
    let total = 0;
    const canMarkOutsourced = req.user && req.user.role && String(req.user.role).toLowerCase() === 'admin';

    for (const it of items) {
      const svc = serviceMap.get(String(it.serviceId));
      if (!svc) {
        return res.status(404).json({ error: `Service ${it.serviceId} not found` });
      }
      if (!svc.category) {
        return res.status(400).json({ error: `Service "${svc.name || it.serviceId}" is not assigned to a category` });
      }

      const svcCategoryId = String(
        svc.category && svc.category._id ? svc.category._id : svc.category
      );
      let isAuthorizedByCategory = allowedCategoryIds.has(svcCategoryId);

      // Compound-service fallback:
      // when a book is placed, its underlying services may belong to other categories.
      // In that case, allow the item if it belongs to a Book that is in an allowed category.
      if (!isAuthorizedByCategory && allowedCategoryObjectIds.length) {
        isAuthorizedByCategory = it.priceRuleId
          ? compoundAllowedPairs.has(`${String(it.serviceId)}:${String(it.priceRuleId)}`)
          : false;
      }

      if (!isAuthorizedByCategory) {
        return res.status(400).json({ error: 'One or more selected services are outside secretary-assigned categories.' });
      }

      const isLargeFormatService = String(svc.pricingMode || '').toLowerCase() === 'large_format';
      const svcRequiresPrinter = isLargeFormatService || !!(svc && svc.requiresPrinter);

      let outsourcedArtist = null;
      let outsourcedArtistName = '';
      let outsourcedQty = 0;
      let outsourcedAmount = 0;
      let outsourcedTotal = 0;
      const rawQty = Number(it.outsourcedQty);
      const rawAmount = Number(it.outsourcedAmount);
      let customerRequestedQty = Math.max(
        1,
        Math.floor(Number(svcRequiresPrinter ? it.factor : it.pages) || 1)
      );
      if (isLargeFormatService) customerRequestedQty = Math.max(1, Math.floor(Number(it.largeFormatQty || 1)));
      const hasOutsourcedInput =
        (it.outsourcedArtistId && String(it.outsourcedArtistId).trim()) ||
        (it.outsourcedArtistName && String(it.outsourcedArtistName).trim()) ||
        (!isNaN(rawQty) && rawQty > 0) ||
        (!isNaN(rawAmount) && rawAmount > 0);
      const isOutSourcedLine = !!it.outsourced || !!hasOutsourcedInput;
      const requiresOwnPrinter = svcRequiresPrinter && !isOutSourcedLine;

      if (isOutSourcedLine) {
        if (!canMarkOutsourced) {
          return res.status(403).json({ error: 'Only Admin can mark services as out-sourced.' });
        }

        if (!it.outsourcedArtistId || !mongoose.Types.ObjectId.isValid(it.outsourcedArtistId)) {
          return res.status(400).json({ error: 'Select a valid artist for outsourced service.' });
        }

        const artist = outsourcedArtistMap.get(String(it.outsourcedArtistId));
        if (!artist || String(artist.category || '').toLowerCase() !== 'artist') {
          return res.status(400).json({ error: 'Selected outsourced handler must be an Artist customer.' });
        }

        outsourcedArtist = artist._id;
        outsourcedArtistName = String(
          artist.businessName || artist.firstName || artist.phone || it.outsourcedArtistName || ''
        ).trim();
        outsourcedQty = customerRequestedQty;
        outsourcedAmount = Math.max(0, Number(rawAmount || 0));

        if (outsourcedQty <= 0 || outsourcedAmount <= 0) {
          return res.status(400).json({ error: 'Enter valid outsourced Amount for outsourced service.' });
        }

        if (!isLargeFormatService) {
          outsourcedTotal = Number((outsourcedQty * outsourcedAmount).toFixed(2));
        }
      }

      if (isLargeFormatService) {
        const length = Number(it.largeFormatLength);
        const breadth = Number(it.largeFormatBreadth);
        const quantity = Math.max(1, Math.floor(Number(it.largeFormatQty || it.factor || 1)));
        const unit = String(it.largeFormatUnit || 'feet').toLowerCase() === 'inches' ? 'inches' : 'feet';
        const amountPerSquareFeet = Number(svc.largeFormatRate || 0);
        const largeFormatMaterialDoc = svc.largeFormatMaterial && typeof svc.largeFormatMaterial === 'object'
          ? svc.largeFormatMaterial
          : null;
        const largeFormatMaterialId = largeFormatMaterialDoc && largeFormatMaterialDoc._id
          ? largeFormatMaterialDoc._id
          : (svc.largeFormatMaterial || null);
        const wastePercent = Math.max(0, Number(svc.largeFormatWastePercent || 0));
        const minimumSquareFeet = Math.max(0, Number(svc.largeFormatMinimumSquareFeet || 0));
        if (!isFinite(length) || length <= 0 || !isFinite(breadth) || breadth <= 0) {
          return res.status(400).json({ error: `Enter valid length and breadth for ${svc.name || 'Large Format service'}` });
        }
        if (!isFinite(quantity) || quantity <= 0) {
          return res.status(400).json({ error: `Enter valid QTY for ${svc.name || 'Large Format service'}` });
        }
        if (!isFinite(amountPerSquareFeet) || amountPerSquareFeet <= 0) {
          return res.status(400).json({ error: `Large Format amount is not configured for ${svc.name || 'service'}` });
        }
        if (!isOutSourcedLine && (!largeFormatMaterialId || !mongoose.Types.ObjectId.isValid(String(largeFormatMaterialId)))) {
          return res.status(400).json({ error: `Large Format stock material is not configured for ${svc.name || 'service'}. Configure it under Service Details.` });
        }
        let printerId = null;
        if (requiresOwnPrinter) {
          if (!it.printerId || !mongoose.Types.ObjectId.isValid(it.printerId)) {
            return res.status(400).json({ error: 'Printer required for one or more Large Format items' });
          }
          const prDoc = printerMap.get(String(it.printerId));
          if (!prDoc) return res.status(400).json({ error: `Printer ${it.printerId} not found` });
          printerId = new mongoose.Types.ObjectId(it.printerId);
        } else if (!isOutSourcedLine && it.printerId && mongoose.Types.ObjectId.isValid(it.printerId) && printerMap.has(String(it.printerId))) {
          printerId = new mongoose.Types.ObjectId(it.printerId);
        }
        const squareFeetEach = unit === 'inches'
          ? Number(((length * breadth) / 144).toFixed(4))
          : Number((length * breadth).toFixed(4));
        const squareFeetTotal = Number((squareFeetEach * quantity).toFixed(4));
        if (isOutSourcedLine) {
          outsourcedQty = squareFeetTotal;
          outsourcedTotal = Number((squareFeetTotal * outsourcedAmount).toFixed(2));
        }
        const consumedSquareFeet = isOutSourcedLine
          ? 0
          : roundCount(Math.max(minimumSquareFeet, squareFeetTotal * (1 + (wastePercent / 100))));
        const subtotal = Number((squareFeetTotal * amountPerSquareFeet).toFixed(2));
        const selectionLabel = `${svc.name || 'Large Format'} - ${length} x ${breadth} ${unit === 'inches' ? 'inches' : 'feet'} (${squareFeetEach.toFixed(2)} sq ft each) x ${quantity}`;

        builtItems.push({
          service: it.serviceId,
          printer: printerId,
          selections: [],
          pricingMode: 'large_format',
          largeFormatLength: length,
          largeFormatBreadth: breadth,
          largeFormatUnit: unit,
          largeFormatQty: quantity,
          largeFormatSquareFeet: squareFeetTotal,
          largeFormatMaterial: isOutSourcedLine ? null : largeFormatMaterialId,
          largeFormatMaterialName: largeFormatMaterialDoc ? String(largeFormatMaterialDoc.name || '') : '',
          largeFormatWastePercent: isOutSourcedLine ? 0 : wastePercent,
          largeFormatConsumedSquareFeet: consumedSquareFeet,
          selectionLabel,
          unitPrice: amountPerSquareFeet,
          pages: squareFeetEach,
          effectiveQty: squareFeetTotal,
          factor: quantity,
          subtotal,
          spoiled: 0,
          fb: false,
          printerType: null,
          printFactor: quantity,
          outsourcedArtist,
          outsourcedArtistName,
          outsourcedQty,
          outsourcedAmount,
          outsourcedTotal
        });
        total += subtotal;
        continue;
      }

      const pr = priceRuleMap.get(String(it.priceRuleId));
      if (!pr) return res.status(404).json({ error: `Price rule ${it.priceRuleId} not found` });

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

      // APPLY pricing factor HERE
      const subtotal = Number(
        (unitPrice * effectiveQtyForPrice * pricingFactor).toFixed(2)
      );

      // Build human-friendly selection label (append F/B suffix always when usedFB)
      const baseLabel = (pr.customLabel && String(pr.customLabel).trim()) || ((pr.selections || []).map(s => {
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
        // prefer 'colour' if any subunit indicates colour, otherwise monochrome if present
        const subs = (pr.selections || []).map(s => (s.subUnit && s.subUnit.name) ? String(s.subUnit.name) : '');
        const hasColour = subs.some(n => /(colour|color|c\/l|\bcol\b)/i.test(n));
        const hasMono = subs.some(n => /(monochrome|\bmono\b|black\s*and\s*white|b\/w)/i.test(n));
        if (hasColour) printerType = 'colour';
        else if (hasMono) printerType = 'monochrome';
      } catch (e) {
        printerType = null;
      }

      // validate printer if required
      let printerId = null;
      if (requiresOwnPrinter) {
        if (!it.printerId || !mongoose.Types.ObjectId.isValid(it.printerId)) {
          return res.status(400).json({ error: 'Printer required for one or more items' });
        }
        const prDoc = printerMap.get(String(it.printerId));
        if (!prDoc) return res.status(400).json({ error: `Printer ${it.printerId} not found` });
        printerId = new mongoose.Types.ObjectId(it.printerId);
      } else {
        // if provided but invalid, ignore or validate format
        if (!isOutSourcedLine && it.printerId && mongoose.Types.ObjectId.isValid(it.printerId) && printerMap.has(String(it.printerId))) {
          // allow storing if client provided printer for non-required service (optional)
          printerId = new mongoose.Types.ObjectId(it.printerId);
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
          // Keep configured decimal print factors intact (e.g. 0.5, 1.5).
          printFactor = positiveCountFactor(roundCount(printFactor), 1);
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
        spoiled: isOutSourcedLine ? 0 : (Number(it.spoiled) || 0),
        fb: !!(it.fb || usedFB),  // store original intent (client flag) OR our usedFB calc
        printerType, // NEW: 'monochrome' | 'colour' | null
        printFactor, // NEW: multiplier for printer counts (default 1)
        outsourcedArtist,
        outsourcedArtistName,
        outsourcedQty,
        outsourcedAmount,
        outsourcedTotal
      });
      total += subtotal;
    }
    total = Number(total.toFixed(2));

    const bodyCustomerId = String(req.body && req.body.customerId ? req.body.customerId : '').trim();
    if (submission.customer && bodyCustomerId && String(submission.customer) !== bodyCustomerId) {
      return res.status(400).json({ error: 'Selected customer does not match submitted customer.' });
    }

    const order = new Order({
      orderId: makeOrderId(),
      items: builtItems,
      jobNote,
      total
    });

    if (submission.customer && mongoose.Types.ObjectId.isValid(String(submission.customer))) {
      order.customer = new mongoose.Types.ObjectId(String(submission.customer));
    } else {
      order.customerName = String(submission.displayName || '').trim() || 'Walk-in';
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
let stockContext = { opStore: null, opStocks: [] };
let materialRequirements = [];
try {
  const hasInHouseItems = (builtItems || []).some(it => Number(it && it.outsourcedTotal ? it.outsourcedTotal : 0) <= 0);
  if (hasInHouseItems) {
    stockContext = await loadOperationalStockContext();
    if (!stockContext.opStore) {
      return res.status(409).json({
        error: 'No operational store configured. Ask Admin to set an operational store in Stock dashboard.'
      });
    }

    materialRequirements = buildMaterialRequirements(builtItems, stockContext.opStocks);
  }
  if (materialRequirements.length) {
    const requiredByMaterial = new Map(); // materialId -> needed

    // cache source stock info
    const stockInfo = new Map(); // materialId -> { name, stocked }
    for (const st of stockContext.opStocks) {
      if (st && st.material && st.material._id) {
        stockInfo.set(String(st.material._id), { name: st.material.name, stocked: Number(st.stocked || 0) });
      }
    }

    for (const reqLine of materialRequirements) {
      const mid = String(reqLine.material._id);
      const existing = requiredByMaterial.get(mid) || { need: 0, name: '' };
      requiredByMaterial.set(mid, {
        need: Number(existing.need || 0) + Number(reqLine.count || 0),
        name: existing.name || String(reqLine.material.name || 'Material')
      });
    }

    if (requiredByMaterial.size) {
      const matIds = Array.from(requiredByMaterial.keys()).map(id => new mongoose.Types.ObjectId(id));
      const aggDocs = await MaterialAggregate.find({ store: stockContext.opStore._id, material: { $in: matIds } }).lean();

      const aggMap = {};
      aggDocs.forEach(a => { aggMap[String(a.material)] = Number(a.total || 0); });

      const blocks = [];
      for (const [mid, reqInfo] of requiredByMaterial.entries()) {
        const need = Number(reqInfo && reqInfo.need ? reqInfo.need : 0);
        const info = stockInfo.get(mid);
        const stocked = info ? Number(info.stocked || 0) : 0;
        const used = aggMap[mid] || 0;
        const remaining = Math.max(0, stocked - used);

        const name = info ? info.name : (reqInfo && reqInfo.name ? reqInfo.name : 'Material');
        if (remaining <= 0) blocks.push(`"${name}" is out of stock in operational store (Remaining: 0).`);
        else if (need > remaining) blocks.push(`"${name}" insufficient in operational store (Needed: ${need}, Remaining: ${remaining}).`);
      }

      if (blocks.length) {
        return res.status(409).json({
          error: 'Some materials in this order are out of stock in the operational store. Contact Admin to restock or transfer stock.',
          details: blocks,
          operationalStore: { _id: stockContext.opStore._id, name: stockContext.opStore.name }
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
// Ensure regular status is up to date before computing discounts
try {
  if (order.customer) {
    const customerController = require('./customer');
    await customerController.updateRegularStatus(order.customer);
  }
} catch (e) {
  console.error('pre-discount regular update failed', e);
}

const baseTotal = Number(total || 0);

// 1) Manual discount (admin only)
let manual = null;
const isAdmin = req.user && req.user.role && String(req.user.role).toLowerCase() === 'admin';
try {
  if (isAdmin && req.body && req.body.manualDiscount && typeof req.body.manualDiscount === 'object') {
    const md = req.body.manualDiscount;
    const kindRaw = String(md.kind || 'discount').trim().toLowerCase();
    const kind = (kindRaw === 'premium') ? 'premium' : 'discount';
    const mode = String(md.mode || '').trim();
    const value = Number(md.value);

    if ((mode === 'amount' || mode === 'percent') && isFinite(value) && value > 0) {
      if (mode === 'percent' && value > 100) {
        // ignore invalid percent
      } else {
        manual = { kind, mode, value: Number(value) };
      }
    }
  }
} catch (e) {
  manual = null;
}

let manualTax = null;
try {
  if (isAdmin && req.body && req.body.tax && typeof req.body.tax === 'object') {
    const tx = req.body.tax;
    const mode = String(tx.mode || '').trim();
    const value = Number(tx.value);
    if ((mode === 'amount' || mode === 'percent') && isFinite(value) && value > 0) {
      if (!(mode === 'percent' && value > 100)) {
        manualTax = { mode, value: Number(value) };
      }
    }
  }
} catch (e) {
  manualTax = null;
}

let discountAmount = 0;
let discountBreakdown = null;

if (manual) {
  // compute manual discount/premium adjustment
  const unsignedAmount = Number(Math.min(baseTotal, Math.max(0, computeDiscountAmount(baseTotal, manual))).toFixed(2));
  const signedAmount = manual.kind === 'premium' ? -unsignedAmount : unsignedAmount;
  discountAmount = signedAmount;

  if (unsignedAmount > 0) {
    discountBreakdown = {
      scope: 'manual',
      kind: manual.kind,
      mode: manual.mode,
      value: manual.value,
      computed: unsignedAmount,
      label: manual.kind === 'premium' ? 'Manual premium' : 'Manual discount'
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
    Array.from(serviceIds).forEach(sid => {
      const s = serviceMap.get(String(sid));
      if (s && s.category) serviceCategoryIds.add(String(s.category._id || s.category));
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
      kind: 'discount',
      mode: best.rule.mode,
      value: best.rule.value,
      computed: discountAmount,
      label: best.label
    };
  }
}

// Apply discount/premium adjustment, then tax on the adjusted amount.
const adjustedTotalBeforeTax = Number(Math.max(0, baseTotal - Number(discountAmount || 0)).toFixed(2));
let taxAmount = 0;
let taxBreakdown = null;
if (manualTax) {
  taxAmount = Number(computeTaxAmount(adjustedTotalBeforeTax, manualTax).toFixed(2));
  if (taxAmount > 0) {
    taxBreakdown = {
      scope: 'manual',
      mode: manualTax.mode,
      value: manualTax.value,
      taxableAmount: adjustedTotalBeforeTax,
      computed: taxAmount,
      label: 'VAT'
    };
  }
}
const finalTotal = Number((adjustedTotalBeforeTax + Number(taxAmount || 0)).toFixed(2));

// store snapshot on the order doc before saving
order.totalBeforeDiscount = baseTotal;
order.discountAmount = Number(discountAmount || 0);
order.discountBreakdown = discountBreakdown;
order.taxAmount = Number(taxAmount || 0);
order.taxBreakdown = taxBreakdown;

// IMPORTANT: total becomes final payable total
order.total = finalTotal;

    // -------------------------------------------------
    // Customer account coupling on order creation:
    // 1) record order as DEBIT
    // 2) auto-settle from available credit (accountBalance) if any
    // -------------------------------------------------
    try {
      if (order.customer) {
        const recBy = req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null;
        const recByName = (req.user?.name || req.user?.username || '').toString();

        let customer = null;
        let apply = 0;
        let availableCredit = 0;
        try {
          customer = await Customer.findById(order.customer);
          if (customer) {
            availableCredit = await getUsableCustomerCredit(customer._id);
            const canApply = Math.max(0, Number(order.total || 0));
            apply = Number(Math.min(availableCredit, canApply).toFixed(2));
          }
        } catch (e) {
          customer = null;
          apply = 0;
          availableCredit = 0;
        }

        // Every customer order increases debtor side.
        // Tag with (A/C) when the order is auto-paid from account.
        const orderPlacedNote = apply > 0
          ? `Order placed ${order.orderId} (A/C)`
          : `Order placed ${order.orderId}`;
        await CustomerAccountTxn.create([{
          customer: order.customer,
          type: 'debit',
          amount: Number(order.total || 0),
          note: orderPlacedNote,
          recordedBy: recBy,
          recordedByName: recByName
        }]);

        if (customer) {

          if (apply > 0) {
            order.payments = order.payments || [];
            order.payments.push({
              method: 'account',
              amount: apply,
              meta: { source: 'auto_on_order_create' },
              note: `Auto payment from account for order ${order.orderId}`,
              createdAt: new Date(),
              recordedBy: recBy,
              recordedByName: recByName
            });

            const paidSoFar = (order.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
            const outstandingAfterApply = Number((Number(order.total || 0) - paidSoFar).toFixed(2));
            if (outstandingAfterApply <= 0) {
              order.status = 'paid';
              order.paidAt = new Date();
            }

            customer.accountBalance = Number((availableCredit - apply).toFixed(2));
            await customer.save();

            // IMPORTANT:
            // Do not add a CREDIT entry here. The order debit already records the debt,
            // and account-based settlement is represented by reducing accountBalance plus
            // order payment method='account'. Adding a credit here would cancel out the
            // debit and incorrectly preserve the prior net balance.
          }
        }
      }
    } catch (accountCouplingErr) {
      console.error('order create account coupling error', accountCouplingErr);
    }

    await order.save();

    const accountingActor = actorFromReq(req);
    const materialUsageIdsForAccounting = [];
    const printerUsageIdsForAccounting = [];
    const outsourcedArtistTotalsForAccounting = [];

    // Credit outsourced artists for work rendered to us.
    try {
      const recBy = req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null;
      const recByName = (req.user?.name || req.user?.username || '').toString();
      const artistTotals = new Map();

      for (const item of (order.items || [])) {
        if (!item || !item.outsourcedArtist || !Number(item.outsourcedTotal || 0)) continue;
        const aid = String(item.outsourcedArtist);
        const sum = Number(artistTotals.get(aid) || 0) + Number(item.outsourcedTotal || 0);
        artistTotals.set(aid, Number(sum.toFixed(2)));
      }

      for (const [artistId, amount] of artistTotals.entries()) {
        if (amount <= 0) continue;
        outsourcedArtistTotalsForAccounting.push({ artistId, amount: Number(amount.toFixed(2)) });
        await CustomerAccountTxn.create([{
          customer: new mongoose.Types.ObjectId(artistId),
          type: 'credit',
          amount: Number(amount.toFixed(2)),
          note: `Out-sourced service credit from order ${order.orderId}`,
          recordedBy: recBy,
          recordedByName: recByName
        }]);
      }
    } catch (outsourceCreditErr) {
      console.error('Failed to credit outsourced artists', outsourceCreditErr);
    }

    try {
      if (submission && submission._id && mongoose.Types.ObjectId.isValid(String(submission._id))) {
        await RegistrationSubmission.updateOne(
          { _id: submission._id, status: 'pending' },
          {
            $set: {
              status: 'consumed',
              consumedAt: new Date(),
              consumedOrderId: order.orderId,
              consumedBy: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null
            }
          }
        );
      }
      if (invoice && invoice._id) {
        await CartInvoice.updateOne(
          { _id: invoice._id, status: 'open' },
          {
            $set: {
              status: 'converted',
              convertedAt: new Date(),
              convertedOrderId: order.orderId,
              convertedBy: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null
            }
          }
        );
      }
    } catch (consumeErr) {
      console.error('Failed to consume registration submission/invoice', consumeErr);
    }

// --- MATERIAL MATCHING & RECORDING (OPERATIONAL STORE ONLY) ---
try {
  const opStore = stockContext.opStore;
  if (opStore && materialRequirements.length) {
    for (const reqLine of materialRequirements) {
      const st = reqLine.stock;
      const m = reqLine.material;
      const count = Number(reqLine.count || 0);
      if (!st || !m || !m._id || count <= 0) continue;

      const lotCost = await consumeStockLots({
        store: opStore._id,
        stock: st._id,
        material: m._id,
        quantity: count,
        sourceRef: order.orderId
      });
      const unitCostSnapshot = lotCost.weightedUnitCost;
      const totalCost = lotCost.totalCost;

      const usage = await MaterialUsage.create({
        store: opStore._id,
        material: m._id,
        orderId: order.orderId,
        orderRef: order._id,
        itemIndex: reqLine.itemIndex,
        count,
        unitCostSnapshot,
        totalCost,
        lots: lotCost.lots || []
      });
      materialUsageIdsForAccounting.push(usage._id);

      await MaterialAggregate.findOneAndUpdate(
        { store: opStore._id, material: m._id },
        { $inc: { total: count } },
        { upsert: true, new: true }
      );
    }
  }
} catch (matErr) {
  console.error('Material matching/recording error', matErr);
}

        // --- PRINTER USAGE RECORDING ---
try {
  // for each order item, if printer exists, increment that printer by pages (QTY)
for (let idx = 0; idx < builtItems.length; idx++) {
  const it = builtItems[idx];
  if (Number(it && it.outsourcedTotal ? it.outsourcedTotal : 0) > 0) continue;
  if (!it.printer) continue;
  // pages (raw) default is 1 already
  const pages = Number(it.pages) || 1;
  // Large Format printer usage is tracked by square feet; normal jobs keep the existing whole-page count.
  const isLargeFormatUsage = String(it.pricingMode || '').toLowerCase() === 'large_format';
  const baseCount = isLargeFormatUsage
    ? Math.max(0, roundCount(pages))
    : Math.max(0, Math.floor(pages));
  const factor = positiveCountFactor(it.printFactor, 1);
  // final usage count applied to printer = baseCount * configured service factor
  const usageCount = Math.max(0, roundCount(baseCount * factor));

  // determine type for this usage (may be 'monochrome'|'colour'|null)
  const usageType = (it.printerType === 'monochrome' || it.printerType === 'colour') ? it.printerType : null;

  // create usage record (store final usageCount)
  const printerUsage = await PrinterUsage.create({
    printer: it.printer,
    orderId: order.orderId,
    orderRef: order._id,
    itemIndex: idx,
    count: usageCount,
    type: usageType,
    note: 'order-created'
  });
  printerUsageIdsForAccounting.push(printerUsage._id);

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

    scheduleOrderPostResponseTasks({
      orderId: order.orderId,
      materialUsageIds: materialUsageIdsForAccounting,
      printerUsageIds: printerUsageIdsForAccounting,
      outsourcedArtistTotals: outsourcedArtistTotalsForAccounting,
      actor: accountingActor
    });

    // return order info
    return res.json({
      ok: true,
      orderId: order.orderId,
      total: order.total,
      taxAmount: order.taxAmount,
      taxBreakdown: order.taxBreakdown,
      jobNote: String(order.jobNote || '').trim()
    });
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
          let netBalance = null;
          try {
            const agg = await CustomerAccountTxn.aggregate([
              { $match: { customer: new mongoose.Types.ObjectId(customerId) } },
              {
                $group: {
                  _id: null,
                  credits: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
                  debits: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } }
                }
              }
            ]);
            if (agg && agg[0]) {
              netBalance = Number((Number(agg[0].credits || 0) - Number(agg[0].debits || 0)).toFixed(2));
            }
          } catch (balErr) {
            console.error('Failed to compute customer net balance', balErr);
          }

          // Support multiple schema shapes
          customerAccountBalance = Number(
            c.accountBalance ??
            c.account?.balance ??
            c.creditBalance ??
            0
          ) || 0;

          customerInfo = Object.assign({}, c, {
            accountBalance: customerAccountBalance,
            accountNetBalance: netBalance
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
          jobNote: String(order.jobNote || '').trim(),

          // totals
          total: order.total,

        // discount fields needed by pay page
        totalBeforeDiscount: order.totalBeforeDiscount,
        discountAmount: order.discountAmount,
        discountBreakdown: order.discountBreakdown,
        taxAmount: order.taxAmount,
        taxBreakdown: order.taxBreakdown,

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

// API: apply manual discount to existing order (admin only)
exports.apiApplyManualDiscount = async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: 'No orderId provided' });

    const isAdmin = req.user && req.user.role && String(req.user.role).toLowerCase() === 'admin';
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const hasAdjustment = Math.abs(Number(order.discountAmount || 0)) > 0;
    if (hasAdjustment) return res.status(400).json({ error: 'Order already has an adjustment applied' });

    const kindRaw = String(req.body?.kind || 'discount').toLowerCase();
    const kind = (kindRaw === 'premium') ? 'premium' : 'discount';
    const mode = String(req.body?.mode || '').toLowerCase();
    const value = Number(req.body?.value || 0);

    if (!['amount', 'percent'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid adjustment mode' });
    }
    if (!isFinite(value) || value <= 0) {
      return res.status(400).json({ error: 'Invalid adjustment value' });
    }
    if (mode === 'percent' && value > 100) {
      return res.status(400).json({ error: 'Percentage adjustment cannot exceed 100%' });
    }

    const baseTotal =
      (order.totalBeforeDiscount !== undefined && order.totalBeforeDiscount !== null)
        ? Number(order.totalBeforeDiscount)
        : Number(order.total || 0);

    if (!isFinite(baseTotal) || baseTotal <= 0) {
      return res.status(400).json({ error: 'Invalid order total' });
    }

    const unsignedAmount = computeDiscountAmount(baseTotal, { mode, value });
    if (!isFinite(unsignedAmount) || unsignedAmount <= 0) {
      return res.status(400).json({ error: 'Adjustment amount must be greater than zero' });
    }
    const discountAmount = Number((kind === 'premium' ? -unsignedAmount : unsignedAmount).toFixed(2));

    const paidSoFar = (order.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const adjustedTotalBeforeTax = Number(Math.max(0, baseTotal - discountAmount).toFixed(2));
    let taxAmount = 0;
    let taxBreakdown = null;
    if (order.taxBreakdown && typeof order.taxBreakdown === 'object') {
      const existingTax = order.taxBreakdown;
      const taxMode = String(existingTax.mode || '').trim();
      const taxValue = Number(existingTax.value || 0);
      if ((taxMode === 'amount' || taxMode === 'percent') && isFinite(taxValue) && taxValue > 0 && !(taxMode === 'percent' && taxValue > 100)) {
        taxAmount = Number(computeTaxAmount(adjustedTotalBeforeTax, { mode: taxMode, value: taxValue }).toFixed(2));
        if (taxAmount > 0) {
          taxBreakdown = Object.assign({}, existingTax, {
            taxableAmount: adjustedTotalBeforeTax,
            computed: taxAmount
          });
        }
      }
    }
    const newTotal = Number((adjustedTotalBeforeTax + Number(taxAmount || 0)).toFixed(2));

    if (kind === 'discount' && newTotal < paidSoFar) {
      return res.status(400).json({ error: 'Discount exceeds remaining balance' });
    }

    order.totalBeforeDiscount = Number(baseTotal.toFixed(2));
    order.discountAmount = Number(discountAmount.toFixed(2));
    order.discountBreakdown = {
      scope: 'manual',
      kind,
      mode,
      value,
      computed: Number(unsignedAmount.toFixed(2)),
      label: kind === 'premium' ? 'Manual premium' : 'Manual discount'
    };
    order.taxAmount = Number(taxAmount || 0);
    order.taxBreakdown = taxBreakdown;
    order.total = newTotal;

    const outstandingAfter = Number((newTotal - paidSoFar).toFixed(2));
    if (outstandingAfter <= 0) {
      order.status = 'paid';
      if (!order.paidAt) order.paidAt = new Date();
    }

    await order.save();

    return res.json({
      ok: true,
      orderId: order.orderId,
      total: order.total,
      totalBeforeDiscount: order.totalBeforeDiscount,
      discountAmount: order.discountAmount,
      discountBreakdown: order.discountBreakdown,
      taxAmount: order.taxAmount,
      taxBreakdown: order.taxBreakdown,
      outstanding: outstandingAfter
    });
  } catch (err) {
    console.error('apiApplyManualDiscount error', err);
    return res.status(500).json({ error: 'Error applying discount' });
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
      return res.status(400).json({ error: 'Account payments are applied automatically where applicable.' });
    }

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

      const cashBookContext = await resolvePaymentCashBookContext(body, session);
      const method = cashBookContext.method;
      if (method === 'account') {
        const e = new Error('Account payments are applied automatically where applicable.');
        e.statusCode = 400;
        throw e;
      }

      const meta = Object.assign({}, cashBookContext.meta || {});

      // Always store what was received + what was credited (if any)
      meta.receivedAmount = Number(receivedAmount.toFixed(2));
      if (creditExcess > 0) meta.creditExcess = Number(creditExcess.toFixed(2));
      const receiptContextInput = (body.receiptContext && typeof body.receiptContext === 'object')
        ? body.receiptContext
        : {};
      const receiptNumber = (value, fallback) => {
        const n = Number(value);
        return isNaN(n) ? Number(fallback || 0) : Number(n.toFixed(2));
      };
      const receiptPreviousDebt = receiptNumber(receiptContextInput.previousCustomerDebt, 0);

      // Build note
      const baseNote = String(body.note || (isPart ? 'part-payment' : 'full-payment')).trim();
      const note =
        creditExcess > 0
          ? `${baseNote ? baseNote + ' — ' : ''}Overpayment credited: GH₵ ${creditExcess.toFixed(2)}`
          : baseNote;

      const payment = {
        method,
        cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
        cashBookName: cashBookContext.cashBook ? (cashBookContext.cashBook.name || '') : '',
        cashBookKind: cashBookContext.cashBook ? (meta.cashBookKind || cashBookContext.cashBook.kind || 'cash') : null,
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

      meta.receiptContext = {
        previousOutstanding: receiptNumber(receiptContextInput.previousOutstanding, outstandingBefore),
        previousCustomerDebt: receiptPreviousDebt,
        receivedAmount: Number(receivedAmount.toFixed(2)),
        remainingAfter: Number(Math.max(0, outstandingAfter).toFixed(2)),
        totalBalance: Number((Math.max(0, receiptPreviousDebt) + Math.max(0, outstandingAfter)).toFixed(2)),
        paymentMethod: method,
        receiptDate: payment.createdAt,
        recordedByName: payment.recordedByName || ''
      };
      if (order.payments && order.payments.length) {
        order.payments[order.payments.length - 1].meta = meta;
      }

      let becamePaidNow = false;
      if (outstandingAfter <= 0) {
        order.status = 'paid';
        order.paidAt = new Date();
        becamePaidNow = true;
      }

      await order.save({ session });
      const savedPayment = order.payments && order.payments.length
        ? order.payments[order.payments.length - 1]
        : payment;

      if (cashBookContext.cashBook) {
        await recordCashBookMovement({
          cashBook: cashBookContext.cashBook,
          type: 'inflow',
          amount: Number(receivedAmount.toFixed(2)),
          sourceType: 'order_payment',
          sourceId: order._id,
          sourceRef: order.orderId,
          note: `Payment received for order ${order.orderId}`,
          meta,
          recordedBy: payment.recordedBy || null,
          recordedByName: payment.recordedByName || '',
          session
        });
      }

      await postOrderPayment(order, savedPayment, {
        postedBy: payment.recordedBy || null,
        postedByName: payment.recordedByName || ''
      }, session);

      // Ledger: order payment reduces debtor side (credit entry)
      if (hasCustomer) {
        await CustomerAccountTxn.create(
          [
            {
              customer: order.customer,
              type: 'credit',
              amount: Number(toRecordAmount.toFixed(2)),
              note: `Order payment ${order.orderId}`,
              cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
              cashBookName: cashBookContext.cashBook ? (cashBookContext.cashBook.name || '') : '',
              cashBookKind: cashBookContext.cashBook ? (meta.cashBookKind || cashBookContext.cashBook.kind || 'cash') : null,
              cashDirection: cashBookContext.cashBook ? 'inflow' : null,
              cashMeta: meta,
              recordedBy: payment.recordedBy || null,
              recordedByName: payment.recordedByName || ''
            }
          ],
          { session }
        );
      }

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
              cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
              cashBookName: cashBookContext.cashBook ? (cashBookContext.cashBook.name || '') : '',
              cashBookKind: cashBookContext.cashBook ? (meta.cashBookKind || cashBookContext.cashBook.kind || 'cash') : null,
              cashDirection: cashBookContext.cashBook ? 'inflow' : null,
              cashMeta: meta,
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
        paymentId: savedPayment && savedPayment._id ? String(savedPayment._id) : '',
        becamePaidNow,
        _totalBeforeDiscount: order.totalBeforeDiscount ?? null,
        _discountAmount: order.discountAmount ?? null,
        // used by SMS logic after commit
        _customerId: order.customer || null
      };
    });

    // --- AUTO SMS ON PAY (dynamic) ---
    try {
      if (result && result.ok && result._customerId) {
        const cust = await Customer.findById(result._customerId)
          .select('_id phone category firstName businessName accountBalance')
          .lean();

        if (cust && cust.phone) {
          const messagingController = require('./messaging');
          const auto = await messagingController.buildAutoMessageForCustomer(
            cust,
            'pay',
            {
              orderId: result.orderId,
              amount: result.receivedAmount,
              totalBeforeDiscount: result._totalBeforeDiscount ?? '',
              discountAmount: result._discountAmount ?? '',
              outstanding: result.outstanding
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
    if (result && result._totalBeforeDiscount !== undefined) delete result._totalBeforeDiscount;
    if (result && result._discountAmount !== undefined) delete result._discountAmount;

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
  let session = null;

  try {
    const { orderIds } = req.body;

    if (!Array.isArray(orderIds) || !orderIds.length) {
      return res.status(400).json({ error: 'No orders provided for bulk payment' });
    }

    const body = req.body || {};
    const rawMethod = String(body.paymentMethod || 'cash').toLowerCase().trim();
    if (rawMethod === 'account') {
      return res.status(400).json({ error: 'Account payments are applied automatically where applicable.' });
    }

    const smsJobs = [];
    session = await mongoose.startSession();

    await session.withTransaction(async () => {
      const cashBookContext = await resolvePaymentCashBookContext(body, session);
      const method = cashBookContext.method;
      if (method === 'account') {
        const e = new Error('Account payments are applied automatically where applicable.');
        e.statusCode = 400;
        throw e;
      }

      const recordedBy = req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null;
      const recordedByName = (req.user?.name || req.user?.username || '').toString();

      for (const oid of orderIds) {
        const order = await Order.findOne({ orderId: oid }).session(session);
        if (!order) continue;

        const paidSoFar = (order.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const outstanding = Number((Number(order.total || 0) - paidSoFar).toFixed(2));
        if (outstanding <= 0) continue;

        const meta = Object.assign({}, cashBookContext.meta || {});
        meta.receivedAmount = Number(outstanding.toFixed(2));

        order.payments = order.payments || [];
        order.payments.push({
          method,
          cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
          cashBookName: cashBookContext.cashBook ? (cashBookContext.cashBook.name || '') : '',
          cashBookKind: cashBookContext.cashBook ? (meta.cashBookKind || cashBookContext.cashBook.kind || 'cash') : null,
          amount: Number(outstanding.toFixed(2)),
          meta,
          note: 'bulk-full-payment',
          createdAt: new Date(),
          recordedBy,
          recordedByName
        });

        const wasPaidAlready = (order.status === 'paid'); // simple state check
        order.status = 'paid';
        order.paidAt = new Date();

        await order.save({ session });
        const savedPayment = order.payments && order.payments.length
          ? order.payments[order.payments.length - 1]
          : null;

        if (cashBookContext.cashBook) {
          await recordCashBookMovement({
            cashBook: cashBookContext.cashBook,
            type: 'inflow',
            amount: Number(outstanding.toFixed(2)),
            sourceType: 'order_payment_bulk',
            sourceId: order._id,
            sourceRef: order.orderId,
            note: `Bulk payment received for order ${order.orderId}`,
            meta,
            recordedBy,
            recordedByName,
            session
          });
        }

        if (savedPayment) {
          await postOrderPayment(order, savedPayment, { postedBy: recordedBy, postedByName: recordedByName }, session);
        }

        if (order.customer) {
          await CustomerAccountTxn.create([{
            customer: order.customer,
            type: 'credit',
            amount: Number(outstanding.toFixed(2)),
            note: `Order payment ${order.orderId} (bulk)`,
            cashBook: cashBookContext.cashBook ? cashBookContext.cashBook._id : null,
            cashBookName: cashBookContext.cashBook ? (cashBookContext.cashBook.name || '') : '',
            cashBookKind: cashBookContext.cashBook ? (meta.cashBookKind || cashBookContext.cashBook.kind || 'cash') : null,
            cashDirection: cashBookContext.cashBook ? 'inflow' : null,
            cashMeta: meta,
            recordedBy,
            recordedByName
          }], { session });
        }

        if (!wasPaidAlready && order.customer) {
          smsJobs.push({
            orderId: order.orderId,
            customer: order.customer,
            amount: order.total,
            totalBeforeDiscount: order.totalBeforeDiscount ?? '',
            discountAmount: order.discountAmount ?? ''
          });
        }
      }
    });

      // -----------------------------
      // AUTO SMS ON PAY (dynamic) - bulk
      // only send if it wasn't already paid before
      // -----------------------------
    for (const smsJob of smsJobs) {
      try {
          const cust = await Customer.findById(smsJob.customer)
            .select('_id phone category firstName businessName accountBalance')
            .lean();

          if (cust && cust.phone) {
            const messagingController = require('./messaging');
            const auto = await messagingController.buildAutoMessageForCustomer(
              cust,
              'pay',
              {
                orderId: smsJob.orderId,
                amount: smsJob.amount,
                totalBeforeDiscount: smsJob.totalBeforeDiscount,
                discountAmount: smsJob.discountAmount
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
      } catch (smsErr) {
        console.error('Bulk pay: failed to send PAY auto SMS for order', smsJob.orderId, smsErr);
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('apiPayBulkDebtor error', err);
    if (err && err.statusCode) return res.status(err.statusCode).json({ error: err.message || 'Bulk payment failed' });
    return res.status(500).json({ error: 'Bulk payment failed' });
  } finally {
    try { if (session) session.endSession(); } catch (e) {}
  }
};



// API: list debtors (orders with outstanding > 0)
// GET /api/debtors
exports.apiGetDebtors = async (req, res) => {
  try {
    // Build base match for date/other filters if needed (currently none)
    // We'll inject a handledBy filter for non-admins.

    // Determine visibility by role:
    // - admin: all debtors
    // - cashier: only debts from clerk-handled orders (exclude admin-handled debts)
    // - others (e.g. clerk): own handled orders only
    let userMatch = null;
    try {
      const role = req.user && req.user.role ? String(req.user.role).toLowerCase() : '';
      const isAdmin = role === 'admin';
      const isCashier = role === 'cashier';

      if (!isAdmin && isCashier) {
        const clerkRows = await User.find({ role: 'clerk' }).select('_id').lean();
        const clerkIds = (clerkRows || []).map(u => u && u._id).filter(Boolean);
        userMatch = clerkIds.length
          ? { handledBy: { $in: clerkIds } }
          : { handledBy: { $in: [] } };
      } else if (!isAdmin && req.user && req.user._id) {
        userMatch = { handledBy: new mongoose.Types.ObjectId(req.user._id) };
      }
    } catch (e) {
      console.warn('apiGetDebtors: could not determine user filter', e);
    }

        const q = String(req.query.q || '').trim();

    // Escape regex input to avoid regex injection / invalid patterns
    function escapeRegex(s) {
      return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const qRegex = q ? new RegExp(escapeRegex(q), 'i') : null;


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

      // Normalize customer id for mixed legacy data:
      // - ObjectId
      // - string ObjectId
      // - populated object like { _id: ... }
      { $addFields: {
          customerRawId: {
            $cond: [
              { $eq: [{ $type: '$customer' }, 'object'] },
              { $ifNull: ['$customer._id', '$customer'] },
              '$customer'
            ]
          }
      } },
      { $addFields: {
          customerObjId: {
            $convert: { input: '$customerRawId', to: 'objectId', onError: null, onNull: null }
          }
      } },

      // lookup customer doc (if order.customer references a Customer)
      { $lookup: {
          from: 'customers',
          localField: 'customerObjId',
          foreignField: '_id',
          as: 'customer_doc'
      } },

            // Pull customer phone (if customer exists) for phone search + display
      { $addFields: {
        customerPhone: {
          $cond: [
            { $gt: [ { $size: '$customer_doc' }, 0 ] },
            { $let: { vars: { c: { $arrayElemAt: ['$customer_doc', 0] } }, in: { $ifNull: ['$$c.phone', ''] } } },
            ''
          ]
        }
      }},


      // derive a debtorName: prefer explicit order.customerName,
      // otherwise use customer_doc info (artist -> businessName|phone, else firstName|businessName|phone),
      // otherwise fallback to empty string
      { $addFields: {
        debtorName: {
          $let: {
            vars: {
              explicitName: { $trim: { input: { $ifNull: ['$customerName', ''] } } }
            },
            in: {
              $cond: [
                { $gt: [{ $strLenCP: '$$explicitName' }, 0] },
                '$$explicitName',
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
                    { $ifNull: [{ $toString: '$customerObjId' }, ''] }
                  ]
                }
              ]
            }
          }
        }
      }},

            // Optional search filter: debtor name / phone / order id
      ...(qRegex ? [{
        $match: {
          $or: [
            { debtorName: { $regex: qRegex } },
            { customerPhone: { $regex: qRegex } },
            { orderId: { $regex: qRegex } },
            { jobNote: { $regex: qRegex } },
            { customerName: { $regex: qRegex } } // if you store it sometimes
          ]
        }
      }] : []),

      // project fields useful for frontend
        { $project: {
            orderId: 1,
            customer: '$customerObjId',
            jobNote: 1,
            total: 1,
            paidSoFar: 1,
            outstanding: 1,
            payments: 1,
            debtorName: 1,
          customerPhone: 1,   // <-- add this
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
      customerId: r.customer ? String(r.customer) : '',
      jobNote: String(r.jobNote || '').trim(),
      debtorName: r.debtorName || '',
      customerPhone: r.customerPhone || '',   // <-- add this
      amountDue: Number((r.total || 0).toFixed(2)),
      paidSoFar: Number((r.paidSoFar || 0).toFixed(2)),
      outstanding: Number((r.outstanding || 0).toFixed(2)),
      payments: (Array.isArray(r.payments) ? r.payments : []).map(p => ({
        amount: Number((Number(p.amount || 0)).toFixed(2)),
        method: p.method || '',
        cashBookName: p.cashBookName || '',
        cashBookKind: p.cashBookKind || '',
        note: p.note || '',
        recordedByName: p.recordedByName || '',
        createdAt: p.createdAt || null
      })),
      createdAt: r.createdAt,
      status: r.status
    }));

    return res.json({ ok: true, debtors: out });
  } catch (err) {
    console.error('apiGetDebtors error', err);
    return res.status(500).json({ error: 'Error fetching debtors' });
  }
};

// GET /orders/submissions
// Returns pending secretary submissions (for Jobs page dropdown)
exports.apiListSecretarySubmissions = async (req, res) => {
  try {
    const rows = await RegistrationSubmission.find({
      status: 'pending'
    })
      .populate('customer', '_id category')
      .populate('categories', '_id name')
      .sort({ createdAt: 1 })
      .lean();

    const submissions = (rows || []).map(r => ({
      id: String(r._id),
      displayName: String(r.displayName || '').trim(),
      phone: String(r.phone || '').trim(),
      customerId: (r.customer && r.customer._id) ? String(r.customer._id) : '',
      customerCategory: (r.customer && r.customer.category) ? String(r.customer.category) : '',
      walkInNumber: (r.walkInNumber == null ? null : Number(r.walkInNumber)),
      categories: Array.isArray(r.categories)
        ? r.categories.map(c => ({ id: String(c._id), name: c.name }))
        : [],
      createdAt: r.createdAt
    }));

    return res.json({ ok: true, submissions });
  } catch (err) {
    console.error('apiListSecretarySubmissions error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load submitted customers' });
  }
};

// API: list creditors (customers with net credit balance > 0)
// GET /orders/creditors
exports.apiGetCreditors = async (req, res) => {
  try {
    let allowedCustomerIds = null;
    try {
      const isAdmin = req.user && req.user.role && String(req.user.role).toLowerCase() === 'admin';
      if (!isAdmin && req.user && req.user._id) {
        const ids = await Order.distinct('customer', {
          handledBy: new mongoose.Types.ObjectId(req.user._id),
          customer: { $type: 'objectId', $ne: null }
        });

        allowedCustomerIds = (ids || [])
          .map(id => String(id || '').trim())
          .filter(Boolean)
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));

        if (!allowedCustomerIds.length) {
          return res.json({ ok: true, creditors: [] });
        }
      }
    } catch (e) {
      console.warn('apiGetCreditors: could not determine user filter', e);
    }

    const q = String(req.query.q || '').trim();
    function escapeRegex(s) {
      return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const qRegex = q ? new RegExp(escapeRegex(q), 'i') : null;

    const pipeline = [
      { $match: allowedCustomerIds ? { customer: { $in: allowedCustomerIds } } : {} },
      {
        $group: {
          _id: '$customer',
          credits: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
          debits: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } },
          lastTxnAt: { $max: '$createdAt' }
        }
      },
      { $addFields: { creditBalance: { $subtract: ['$credits', '$debits'] } } },
      { $match: { creditBalance: { $gt: 0 } } },
      {
        $lookup: {
          from: 'customers',
          localField: '_id',
          foreignField: '_id',
          as: 'customer_doc'
        }
      },
      { $unwind: { path: '$customer_doc', preserveNullAndEmptyArrays: false } },
      {
        $addFields: {
          creditorName: {
            $cond: [
              { $in: ['$customer_doc.category', ['artist', 'organisation']] },
              {
                $ifNull: [
                  '$customer_doc.businessName',
                  { $ifNull: ['$customer_doc.phone', ''] }
                ]
              },
              {
                $ifNull: [
                  '$customer_doc.firstName',
                  {
                    $ifNull: [
                      '$customer_doc.businessName',
                      { $ifNull: ['$customer_doc.phone', ''] }
                    ]
                  }
                ]
              }
            ]
          }
        }
      },
      ...(qRegex ? [{
        $match: {
          $or: [
            { creditorName: { $regex: qRegex } },
            { 'customer_doc.phone': { $regex: qRegex } },
            { 'customer_doc.firstName': { $regex: qRegex } },
            { 'customer_doc.businessName': { $regex: qRegex } }
          ]
        }
      }] : []),
      {
        $project: {
          customerId: '$_id',
          creditorName: 1,
          phone: { $ifNull: ['$customer_doc.phone', ''] },
          category: { $ifNull: ['$customer_doc.category', 'one_time'] },
          creditBalance: 1,
          lastTxnAt: 1
        }
      },
      { $sort: { creditBalance: -1, lastTxnAt: -1 } },
      { $limit: 1000 }
    ];

    const rows = await CustomerAccountTxn.aggregate(pipeline);
    const out = (rows || []).map(r => ({
      customerId: r.customerId ? String(r.customerId) : '',
      creditorName: String(r.creditorName || '').trim(),
      phone: String(r.phone || '').trim(),
      category: String(r.category || 'one_time'),
      creditBalance: Number((Number(r.creditBalance || 0)).toFixed(2)),
      lastTxnAt: r.lastTxnAt || null
    }));

    return res.json({ ok: true, creditors: out });
  } catch (err) {
    console.error('apiGetCreditors error', err);
    return res.status(500).json({ error: 'Error fetching creditors' });
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

    const listScope = String(req.query.scope || '').toLowerCase();
    const isPayScope = listScope === 'pay';

    // IMPORTANT: restrict list to current user unless admin
    try {
      const role = req.user && req.user.role ? String(req.user.role).toLowerCase() : '';
      const isAdmin = role === 'admin';
      if (!isAdmin && req.user && req.user._id) {
        if (isPayScope) {
          // Non-admins should not see orders handled by admins.
          const User = require('../models/user');
          const admins = await User.find({ role: 'admin' }).select('_id').lean();
          const adminIds = admins.map(a => a._id).filter(Boolean);
          if (adminIds.length) {
            q.handledBy = { $nin: adminIds };
          }
        } else {
          q.handledBy = new mongoose.Types.ObjectId(req.user._id);
        }
      }
      // If req.user is missing we fall back to existing behavior (no extra filter).
    } catch (e) {
      // don't block; fallback to existing behavior
      console.warn('apiListOrders: could not apply user filter', e);
    }

    const orders = await Order.find(q)
      .populate('customer', 'firstName businessName category phone')
      .populate('items.outsourcedArtist', 'businessName firstName phone category accountBalance')
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    // Map to minimal info the client needs in the list
const out = orders.map(o => {
  let displayName = String(o.customerName || '').trim() || 'Walk-in';

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

  const paidInRange = (o.payments || []).reduce((sum, p) => {
    const amt = Number(p && p.amount ? p.amount : 0);
    if (!amt) return sum;
    const ts = p && p.createdAt ? new Date(p.createdAt) : null;
    if (!ts || isNaN(ts.getTime())) return sum;
    if (ts < start || ts > end) return sum;
    return sum + amt;
  }, 0);
  const outsourcedTotal = (o.items || []).reduce((sum, item) => {
    return sum + Number(item && item.outsourcedTotal ? item.outsourcedTotal : 0);
  }, 0);
  const outsourcedDetails = (o.items || [])
    .filter(item => Number(item && item.outsourcedTotal ? item.outsourcedTotal : 0) > 0)
    .map(item => {
      const artistDoc = item && item.outsourcedArtist && typeof item.outsourcedArtist === 'object'
        ? item.outsourcedArtist
        : null;
      const artistName = String(
        item.outsourcedArtistName ||
        (artistDoc && (artistDoc.businessName || artistDoc.firstName || artistDoc.phone)) ||
        'Artist'
      ).trim();
      const artistId = artistDoc && artistDoc._id
        ? String(artistDoc._id)
        : (item.outsourcedArtist ? String(item.outsourcedArtist) : '');

      return {
        artistId,
        artistName,
        artistAccountBalance: artistDoc ? Number(artistDoc.accountBalance || 0) : null,
        selectionLabel: String(item.selectionLabel || '').trim(),
        qty: Number(item.outsourcedQty || 0),
        amount: Number(item.outsourcedAmount || 0),
        total: Number(item.outsourcedTotal || 0)
      };
    });

    return {
      _id: o._id,
      name: displayName,      // ✅ NEW
      jobNote: String(o.jobNote || '').trim(),
      orderId: o.orderId,     // keep for actions
      total: o.total,
    outsourcedTotal: Number(outsourcedTotal.toFixed(2)),
    isOutsourced: outsourcedTotal > 0,
    paidInRange: Number(paidInRange.toFixed(2)),
    outsourcedDetails,
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
