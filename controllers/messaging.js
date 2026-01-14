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

function applyTemplate(template, ctx) {
  // Very small safe templating: {name}, {category}, {phone}
  let t = String(template || '');
  t = t.replaceAll('{name}', ctx.name || '');
  t = t.replaceAll('{category}', ctx.categoryLabel || '');
  t = t.replaceAll('{phone}', ctx.phone || '');
  return t.trim();
}

function categoryLabel(category) {
  const c = normalizeCategory(category);
  if (c === 'regular') return 'Regular';
  if (c === 'artist') return 'Artist';
  if (c === 'organisation') return 'Organisation';
  return 'One-time';
}

exports.page = async (req, res) => {
  try {
    return res.render('admin/messaging'); // fragment loads into #main-content
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

exports.apiSaveConfig = async (req, res) => {
  try {
    const body = req.body || {};

    const doc = new MessagingConfig({
      autoEnabled: body.autoEnabled === true || body.autoEnabled === 'true',
      usePerCustomerTypeTemplates: body.usePerCustomerTypeTemplates === true || body.usePerCustomerTypeTemplates === 'true',
      generalTemplate: String(body.generalTemplate || ''),
      templates: {
        one_time: String(body.templates?.one_time || ''),
        regular: String(body.templates?.regular || ''),
        artist: String(body.templates?.artist || ''),
        organisation: String(body.templates?.organisation || '')
      },
      appendSignature: body.appendSignature === true || body.appendSignature === 'true',
      signatureText: String(body.signatureText || 'AHADPRINT'),
      updatedBy: req.user?._id ? new mongoose.Types.ObjectId(req.user._id) : null
    });

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
    if (target === 'customer_type' && !['one_time','regular','artist','organisation'].includes(String(customerType))) {
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

    // Send sequentially (simple + safe). If you want speed later, do small concurrency batches.
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
exports.buildAutoMessageForCustomer = async function buildAutoMessageForCustomer(customerDoc) {
  const cfg = await MessagingConfig.findOne().sort({ updatedAt: -1 }).lean();

  // if no config, return null so caller can fallback to old hardcoded
  if (!cfg) return { enabled: true, content: null };

  // if explicitly disabled
  if (cfg.autoEnabled === false) return { enabled: false, content: null };

  const cat = normalizeCategory(customerDoc?.category);
  const ctx = {
    phone: customerDoc?.phone ? String(customerDoc.phone) : '',
    categoryLabel: categoryLabel(customerDoc?.category),
    name: (cat === 'artist' || cat === 'organisation')
      ? (customerDoc?.businessName || customerDoc?.phone || '')
      : (customerDoc?.firstName || customerDoc?.businessName || customerDoc?.phone || '')
  };

  let template = '';
  if (cfg.usePerCustomerTypeTemplates) {
    template = String(cfg.templates?.[cat] || '');
  }
  if (!template) template = String(cfg.generalTemplate || '');

  // If template still empty, let caller fallback to old hardcoded
  if (!template) return { enabled: true, content: null };

  let out = applyTemplate(template, ctx);

  if (cfg.appendSignature && cfg.signatureText) {
    out = `${out}\n${String(cfg.signatureText).trim()}`.trim();
  }

  return { enabled: true, content: out };
};
