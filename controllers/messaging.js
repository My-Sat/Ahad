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
  // Very small safe templating: {name}, {category}, {phone}
  let t = String(template || '');
  t = t.replaceAll('{name}', ctx.name || '');
  t = t.replaceAll('{category}', ctx.categoryLabel || '');
  t = t.replaceAll('{phone}', ctx.phone || '');
  return t.trim();
}

// ---- internal helpers for auto config (supports new schema + backward compat) ----
function normalizeEvent(ev) {
  const e = String(ev || 'order').toLowerCase();
  return (e === 'pay') ? 'pay' : 'order';
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
    if (!['all', 'customer_type'].includes(target)) return res.status(400).json({ error: 'Invalid target' });
    if (target === 'customer_type' && !['one_time', 'regular', 'artist', 'organisation'].includes(String(customerType))) {
      return res.status(400).json({ error: 'Invalid customer type' });
    }

    // Find recipients
    const q = { phone: { $exists: true, $ne: '' } };
    if (target === 'customer_type') q.category = String(customerType);

    const customers = await Customer.find(q).select('_id phone firstName businessName category').lean();

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
exports.buildAutoMessageForCustomer = async function buildAutoMessageForCustomer(customerDoc, event = 'order') {
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
      : (customerDoc?.firstName || customerDoc?.businessName || customerDoc?.phone || '')
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
