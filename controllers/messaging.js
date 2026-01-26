// controllers/messaging.js
const mongoose = require('mongoose');
const MessagingConfig = require('../models/messaging_config');
const MessageCampaign = require('../models/message_campaign');
const Customer = require('../models/customer');
const { sendSms } = require('../utilities/hubtel_sms');

function normalizeCategory(cat) {
  const c = String(cat || '').toLowerCase();
  if (c === 'regular') return 'regular';
  if (c === 'artist') return 'artist';
  if (c === 'organisation') return 'organisation';
  return 'one_time';
}

function categoryLabel(category) {
  const c = normalizeCategory(category);
  if (c === 'regular') return 'Regular';
  if (c === 'artist') return 'Artist';
  if (c === 'organisation') return 'Organisation';
  return 'One-time';
}

function applyTemplate(template, ctx) {
  // Very small safe templating:
  // {name}, {category}, {phone}, {orderId}, {amount}, {totalBeforeDiscount}, {discountAmount},
  // {outstanding}, {ordersCount}, {accBalance}
  let t = String(template || '');
  t = t.replaceAll('{name}', ctx.name || '');
  t = t.replaceAll('{category}', ctx.categoryLabel || '');
  t = t.replaceAll('{phone}', ctx.phone || '');

  t = t.replaceAll('{orderId}', ctx.orderId || '');
  t = t.replaceAll('{amount}', ctx.amount || '');
  t = t.replaceAll('{totalBeforeDiscount}', ctx.totalBeforeDiscount || '');
  t = t.replaceAll('{discountAmount}', ctx.discountAmount || '');

  // ✅ NEW: debtors placeholders
  t = t.replaceAll('{outstanding}', ctx.outstanding || '');
  t = t.replaceAll('{ordersCount}', ctx.ordersCount || '');
  t = t.replaceAll('{accBalance}', ctx.accBalance || '');

  return t.trim();
}

// ---- internal helpers for auto config (supports new schema + backward compat) ----
function normalizeEvent(ev) {
  const e = String(ev || 'order').toLowerCase();
  if (e === 'pay') return 'pay';
  if (e === 'debtors') return 'debtors';
  return 'order';
}

function getAutoConfigForEvent(cfg, event) {
  const ev = normalizeEvent(event);

  // NEW schema preferred: cfg.auto[order|pay]
  if (cfg && cfg.auto && cfg.auto[ev]) return cfg.auto[ev];

  // Backward compat: old top-level config applies to "order" only
  if (ev === 'order' && cfg) {
    return {
      enabled: (cfg.autoEnabled !== false),
      usePerCustomerTypeTemplates: (cfg.usePerCustomerTypeTemplates !== false),
      generalTemplate: String(cfg.generalTemplate || ''),
      templates: cfg.templates || {},
      appendSignature: !!cfg.appendSignature,
      signatureText: String(cfg.signatureText || 'AHADPRINT')
    };
  }

  // No config for this event
  return null;
}

exports.page = async (req, res) => {
  try {
    return res.render('admin/messaging');
  } catch (e) {
    console.error('messaging page error', e);
    return res.status(500).send('Failed to load messaging page');
  }
};

exports.apiGetConfig = async (req, res) => {
  try {
    const cfg = await MessagingConfig.findOne().sort({ updatedAt: -1 }).lean();
    return res.json({ ok: true, config: cfg || null });
  } catch (e) {
    console.error('apiGetConfig error', e);
    return res.status(500).json({ error: 'Failed to load messaging config' });
  }
};

// NEW: save config per event (order/pay)
// Body expected:
//  - { event: 'order'|'pay', config: { enabled, usePerCustomerTypeTemplates, generalTemplate, templates{...}, appendSignature, signatureText } }
// Backward compat: if older UI posts the old shape (autoEnabled, generalTemplate, etc), we treat it as event='order'.
exports.apiSaveConfig = async (req, res) => {
  try {
    const body = req.body || {};

    // If new UI: body.event + body.config
    const hasNewShape = body && (body.event || body.config);

    const event = normalizeEvent(hasNewShape ? body.event : 'order');

    let incoming = hasNewShape ? (body.config || {}) : body;

    // Load latest doc (update-in-place) so order + pay live together
    const latest = await MessagingConfig.findOne().sort({ updatedAt: -1 });
    const doc = latest ? latest : new MessagingConfig({});

    // Ensure auto structure exists
    doc.auto = doc.auto || {};
    doc.auto.order = doc.auto.order || {};
    doc.auto.pay = doc.auto.pay || {};

    // Map incoming into the selected event
    doc.auto[event].enabled = incoming.enabled === true || incoming.enabled === 'true' || incoming.autoEnabled === true || incoming.autoEnabled === 'true';
    doc.auto[event].usePerCustomerTypeTemplates =
      incoming.usePerCustomerTypeTemplates === true || incoming.usePerCustomerTypeTemplates === 'true';

    doc.auto[event].generalTemplate = String(incoming.generalTemplate || '');

    doc.auto[event].templates = {
      one_time: String(incoming.templates?.one_time || ''),
      regular: String(incoming.templates?.regular || ''),
      artist: String(incoming.templates?.artist || ''),
      organisation: String(incoming.templates?.organisation || '')
    };

    doc.auto[event].appendSignature = incoming.appendSignature === true || incoming.appendSignature === 'true';
    doc.auto[event].signatureText = String(incoming.signatureText || 'AHADPRINT');

    // Keep backward compat top-level fields in sync for ORDER event only
    // (helps older code or old UI if still present somewhere)
    if (event === 'order') {
      doc.autoEnabled = doc.auto.order.enabled;
      doc.usePerCustomerTypeTemplates = doc.auto.order.usePerCustomerTypeTemplates;
      doc.generalTemplate = doc.auto.order.generalTemplate;
      doc.templates = doc.auto.order.templates;
      doc.appendSignature = doc.auto.order.appendSignature;
      doc.signatureText = doc.auto.order.signatureText;
    }

        // ✅ scheduling fields (mainly for debtors event; safe for all)
    const freq = String(incoming.frequency || '').toLowerCase();
    if (['daily', 'weekly', 'monthly'].includes(freq)) doc.auto[event].frequency = freq;

    const hour = Number(incoming.hour);
    if (!isNaN(hour) && hour >= 0 && hour <= 23) doc.auto[event].hour = hour;

    const minute = Number(incoming.minute);
    if (!isNaN(minute) && minute >= 0 && minute <= 59) doc.auto[event].minute = minute;

    // If admin changes schedule, reset nextRunAt so scheduler can recompute cleanly
    if (event === 'debtors') {
      doc.auto.debtors.nextRunAt = null;
    }


    doc.updatedBy = req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null;

    await doc.save();
    return res.json({ ok: true });
  } catch (e) {
    console.error('apiSaveConfig error', e);
    return res.status(500).json({ error: 'Failed to save messaging config' });
  }
};

exports.apiSendManual = async (req, res) => {
  try {
    const body = req.body || {};
    const message = String(body.message || '').trim();
    const target = String(body.target || '').toLowerCase(); // all | customer_type
    const customerType = body.customerType ? String(body.customerType) : null;

    if (!message) return res.status(400).json({ error: 'Message is required' });
    if (!['all', 'customer_type', 'debtors'].includes(target)) {
    return res.status(400).json({ error: 'Invalid target' });
    }
    if (target === 'customer_type' && !['one_time', 'regular', 'artist', 'organisation'].includes(String(customerType))) {
      return res.status(400).json({ error: 'Invalid customer type' });
    }

    // Find recipients
    const q = { phone: { $exists: true, $ne: '' } };
    if (target === 'customer_type') q.category = String(customerType);

    // Default: customers list
    let customers = [];

    if (target === 'debtors') {
    // Debtors = customers who have at least one order with outstanding > 0
    // We compute it from Orders (payments vs total), then map to customers.

    const Order = require('../models/order');

    const debtorPipeline = [
        // paidSoFar = sum(payments.amount)
        { $addFields: { paidSoFar: { $sum: { $ifNull: ['$payments.amount', []] } } } },
        // outstanding = total - paidSoFar
        { $addFields: { outstanding: { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$paidSoFar', 0] }] } } },
        { $match: { outstanding: { $gt: 0 }, customer: { $ne: null } } },
        { $group: { _id: '$customer' } }
    ];

    const debtorCustomerIds = await Order.aggregate(debtorPipeline);
    const ids = (debtorCustomerIds || [])
        .map(d => d && d._id ? d._id : null)
        .filter(Boolean);

    // If none, return empty campaign result quickly
    if (!ids.length) {
        return res.json({ ok: true, total: 0, success: 0, failed: 0 });
    }

    customers = await Customer.find({
        _id: { $in: ids },
        phone: { $exists: true, $ne: '' }
    }).select('_id phone firstName businessName category accountBalance').lean();
    } else {
    customers = await Customer.find(q).select('_id phone firstName businessName category accountBalance').lean();
    }

    const campaign = new MessageCampaign({
      mode: 'manual',
      message,
      target,
      customerType: target === 'customer_type' ? String(customerType) : null,
      totalRecipients: customers.length,
      createdBy: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null
    });

    let successCount = 0;
    let failCount = 0;

    // Send sequentially (simple + safe)
    for (const c of customers) {
      try {
        await sendSms({ to: c.phone, content: message });
        successCount++;
      } catch (err) {
        failCount++;
        console.error('Manual SMS failed for', c.phone, err?.message || err);
      }
    }

    campaign.successCount = successCount;
    campaign.failCount = failCount;
    campaign.sentAt = new Date();
    await campaign.save();

    return res.json({
      ok: true,
      total: customers.length,
      success: successCount,
      failed: failCount
    });
  } catch (e) {
    console.error('apiSendManual error', e);
    return res.status(500).json({ error: 'Failed to send messages' });
  }
};

// Helper for orders controller (server-authoritative dynamic message selection)
// NOW supports event: 'order' | 'pay'
exports.buildAutoMessageForCustomer = async function buildAutoMessageForCustomer(customerDoc, event = 'order', orderCtx = null) {
  const cfg = await MessagingConfig.findOne().sort({ updatedAt: -1 }).lean();

  // if no config, return null so caller can fallback to old hardcoded
  if (!cfg) return { enabled: true, content: null };

  const autoCfg = getAutoConfigForEvent(cfg, event);

  // If event not configured, let caller fallback (e.g., pay event may not be configured yet)
  if (!autoCfg) return { enabled: true, content: null };

  // if explicitly disabled
  if (autoCfg.enabled === false) return { enabled: false, content: null };

  const cat = normalizeCategory(customerDoc?.category);
const ctx = {
  phone: customerDoc?.phone ? String(customerDoc.phone) : '',
  categoryLabel: categoryLabel(customerDoc?.category),
  name: (cat === 'artist' || cat === 'organisation')
    ? (customerDoc?.businessName || customerDoc?.phone || '')
    : (customerDoc?.firstName || customerDoc?.businessName || customerDoc?.phone || ''),

  orderId: orderCtx && orderCtx.orderId ? String(orderCtx.orderId) : '',
  amount: (orderCtx && orderCtx.amount !== undefined && orderCtx.amount !== null) ? String(orderCtx.amount) : '',
  totalBeforeDiscount: (orderCtx && orderCtx.totalBeforeDiscount !== undefined && orderCtx.totalBeforeDiscount !== null)
    ? String(orderCtx.totalBeforeDiscount)
    : '',
  discountAmount: (orderCtx && orderCtx.discountAmount !== undefined && orderCtx.discountAmount !== null)
    ? String(orderCtx.discountAmount)
    : '',

  outstanding: (orderCtx && orderCtx.outstanding !== undefined && orderCtx.outstanding !== null)
    ? String(orderCtx.outstanding)
    : '',
  ordersCount: (orderCtx && orderCtx.ordersCount !== undefined && orderCtx.ordersCount !== null)
    ? String(orderCtx.ordersCount)
    : '',
  accBalance: (customerDoc && customerDoc.accountBalance !== undefined && customerDoc.accountBalance !== null)
    ? String(customerDoc.accountBalance)
    : ''
};

  let template = '';
  if (autoCfg.usePerCustomerTypeTemplates) {
    template = String(autoCfg.templates?.[cat] || '');
  }
  if (!template) template = String(autoCfg.generalTemplate || '');

  // If template still empty, let caller fallback to old hardcoded/default
  if (!template) return { enabled: true, content: null };

  let out = applyTemplate(template, ctx);

  if (autoCfg.appendSignature && autoCfg.signatureText) {
    out = `${out}\n${String(autoCfg.signatureText).trim()}`.trim();
  }

  return { enabled: true, content: out };
};

// -----------------------------
// AUTO: periodic debtors campaign
// -----------------------------
function computeNextRun({ frequency, hour, minute }, now = new Date()) {
  // Africa/Accra is UTC+0 in practice; we’ll use server time as-is (your server already treats dates in UTC often)
  const h = (typeof hour === 'number' && hour >= 0 && hour <= 23) ? hour : 9;
  const m = (typeof minute === 'number' && minute >= 0 && minute <= 59) ? minute : 0;
  const freq = ['daily', 'weekly', 'monthly'].includes(String(frequency)) ? String(frequency) : 'weekly';

  const base = new Date(now);
  base.setSeconds(0, 0);

  // Build candidate at today HH:MM
  const candidate = new Date(base);
  candidate.setHours(h, m, 0, 0);

  if (freq === 'daily') {
    if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  if (freq === 'weekly') {
    // Choose next Monday at HH:MM (simple + predictable).
    // If today is Monday and time not passed, it’ll be today.
    const day = candidate.getDay(); // 0 Sun .. 1 Mon .. 6 Sat
    const daysToMon = (1 - day + 7) % 7;
    candidate.setDate(candidate.getDate() + daysToMon);
    if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
    return candidate;
  }

  // monthly: 1st of next month at HH:MM (or this month if still upcoming)
  const y = candidate.getFullYear();
  const mo = candidate.getMonth();
  const firstThisMonth = new Date(y, mo, 1, h, m, 0, 0);
  if (firstThisMonth > now) return firstThisMonth;
  return new Date(y, mo + 1, 1, h, m, 0, 0);
}

exports.runDebtorsAutoCampaign = async function runDebtorsAutoCampaign() {
  const cfg = await MessagingConfig.findOne().sort({ updatedAt: -1 });
  if (!cfg || !cfg.auto || !cfg.auto.debtors) return { ok: true, skipped: true, reason: 'no-config' };

  const dc = cfg.auto.debtors;

  // disabled => no-op
  if (dc.enabled === false) return { ok: true, skipped: true, reason: 'disabled' };

  // Load debtors grouped by customer with total outstanding + count
  const Order = require('../models/order');

  const pipeline = [
    { $addFields: { paidSoFar: { $sum: { $ifNull: ['$payments.amount', []] } } } },
    { $addFields: { outstanding: { $subtract: [{ $ifNull: ['$total', 0] }, { $ifNull: ['$paidSoFar', 0] }] } } },
    { $match: { outstanding: { $gt: 0 }, customer: { $ne: null } } },
    {
      $group: {
        _id: '$customer',
        totalOutstanding: { $sum: '$outstanding' },
        ordersCount: { $sum: 1 }
      }
    }
  ];

  const debtorGroups = await Order.aggregate(pipeline);
  const ids = (debtorGroups || []).map(d => d?._id).filter(Boolean);

  if (!ids.length) {
    // record a campaign with zero recipients (optional, but useful)
    const campaign = new MessageCampaign({
      mode: 'auto',
      message: '[AUTO] Debtors campaign (no recipients)',
      target: 'debtors',
      totalRecipients: 0,
      successCount: 0,
      failCount: 0,
      createdBy: null,
      sentAt: new Date()
    });
    await campaign.save();
    return { ok: true, total: 0, success: 0, failed: 0 };
  }

  // Load customer docs
  const customers = await Customer.find({
    _id: { $in: ids },
    phone: { $exists: true, $ne: '' }
  }).select('_id phone firstName businessName category accountBalance').lean();

  // map customer -> outstanding info
  const grpMap = {};
  debtorGroups.forEach(g => {
    if (g && g._id) grpMap[String(g._id)] = {
      outstanding: Number(g.totalOutstanding || 0).toFixed(2),
      ordersCount: Number(g.ordersCount || 0)
    };
  });

  const campaign = new MessageCampaign({
    mode: 'auto',
    message: '[AUTO] Debtors campaign',
    target: 'debtors',
    totalRecipients: customers.length,
    createdBy: null
  });

  let successCount = 0;
  let failCount = 0;

  for (const c of customers) {
    try {
      const extra = grpMap[String(c._id)] || { outstanding: '0.00', ordersCount: 0 };

      // Build auto message using the configured templates for debtors
      const auto = await exports.buildAutoMessageForCustomer(
        c,
        'debtors',
        {
          outstanding: extra.outstanding,
          ordersCount: extra.ordersCount
        }
      );

      if (auto && auto.enabled === false) {
        // disabled mid-flight => skip
        continue;
      }

      const fallback = `Hello ${c.firstName || c.businessName || ''}. You have an outstanding balance of GH₵ ${extra.outstanding}. Please visit to make payment.`;
      const msg = (auto && auto.content) ? String(auto.content) : fallback;

      if (msg && msg.trim()) {
        await sendSms({ to: c.phone, content: msg });
        successCount++;
      }
    } catch (err) {
      failCount++;
      console.error('Debtors auto SMS failed for', c?.phone, err?.message || err);
    }
  }

  campaign.successCount = successCount;
  campaign.failCount = failCount;
  campaign.sentAt = new Date();
  await campaign.save();

  return { ok: true, total: customers.length, success: successCount, failed: failCount };
};

// -----------------------------
// Scheduler tick helper (DB-lock)
// -----------------------------
exports.schedulerTickDebtors = async function schedulerTickDebtors() {
  const now = new Date();

  // Find latest config
  const cfg = await MessagingConfig.findOne().sort({ updatedAt: -1 });
  if (!cfg || !cfg.auto || !cfg.auto.debtors) return;

  const dc = cfg.auto.debtors;

  if (dc.enabled === false) return;

  // if nextRunAt missing, compute + store
  if (!dc.nextRunAt) {
    dc.nextRunAt = computeNextRun(dc, now);
    await cfg.save();
    return;
  }

  if (new Date(dc.nextRunAt).getTime() > now.getTime()) return;

  // Acquire a lock by atomically pushing nextRunAt forward (prevents double-run on multi instances)
  const next = computeNextRun(dc, now);

  const updated = await MessagingConfig.findOneAndUpdate(
    {
      _id: cfg._id,
      'auto.debtors.enabled': { $ne: false },
      'auto.debtors.nextRunAt': { $lte: now }
    },
    {
      $set: {
        'auto.debtors.lastRunAt': now,
        'auto.debtors.nextRunAt': next
      }
    },
    { new: true }
  );

  // If update failed, someone else ran it
  if (!updated) return;

  // Run campaign
  try {
    await exports.runDebtorsAutoCampaign();
  } catch (e) {
    console.error('Debtors scheduler campaign error', e);
  }
};

