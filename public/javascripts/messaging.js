// public/javascripts/messaging.js
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  async function fetchJson(url, opts) {
    const res = await fetch(url, Object.assign({
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    }, opts || {}));
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (j && j.error) ? j.error : 'Request failed';
      throw new Error(msg);
    }
    return j;
  }

  // -------------------------
  // AUTO (ORDER / PAY) helpers
  // -------------------------
  function fillAuto(prefix, ac) {
    // defensive: if element missing (page partially updated), don't crash
    const en = $(prefix + '_autoEnabled'); if (en) en.checked = ac ? (ac.enabled !== false) : true;

    const upt = $(prefix + '_usePerType'); if (upt) upt.checked = ac ? (ac.usePerCustomerTypeTemplates !== false) : true;

    const gt = $(prefix + '_generalTemplate'); if (gt) gt.value = ac ? (ac.generalTemplate || '') : '';

    const ot = $(prefix + '_tplOneTime'); if (ot) ot.value = ac?.templates?.one_time || '';
    const rg = $(prefix + '_tplRegular'); if (rg) rg.value = ac?.templates?.regular || '';
    const ar = $(prefix + '_tplArtist'); if (ar) ar.value = ac?.templates?.artist || '';
    const org = $(prefix + '_tplOrganisation'); if (org) org.value = ac?.templates?.organisation || '';

    const ap = $(prefix + '_appendSignature'); if (ap) ap.checked = ac ? !!ac.appendSignature : false;
    const st = $(prefix + '_signatureText'); if (st) st.value = ac ? (ac.signatureText || 'AHADPRINT') : 'AHADPRINT';

    const fr = $(prefix + '_frequency'); if (fr) fr.value = ac ? (ac.frequency || 'weekly') : 'weekly';
    const hr = $(prefix + '_hour'); if (hr) hr.value = (ac && ac.hour !== undefined && ac.hour !== null) ? String(ac.hour) : '9';
    const mn = $(prefix + '_minute'); if (mn) mn.value = (ac && ac.minute !== undefined && ac.minute !== null) ? String(ac.minute) : '0';

  }

  function readAuto(prefix) {
    return {
        frequency: ($(prefix + '_frequency') && $(prefix + '_frequency').value) ? $(prefix + '_frequency').value : 'weekly',
        hour: ($(prefix + '_hour') && $(prefix + '_hour').value !== '') ? Number($(prefix + '_hour').value) : 9,
        minute: ($(prefix + '_minute') && $(prefix + '_minute').value !== '') ? Number($(prefix + '_minute').value) : 0,

      enabled: !!($(prefix + '_autoEnabled') && $(prefix + '_autoEnabled').checked),
      usePerCustomerTypeTemplates: !!($(prefix + '_usePerType') && $(prefix + '_usePerType').checked),
      generalTemplate: ($(prefix + '_generalTemplate') && $(prefix + '_generalTemplate').value) ? $(prefix + '_generalTemplate').value : '',
      templates: {
        one_time: ($(prefix + '_tplOneTime') && $(prefix + '_tplOneTime').value) ? $(prefix + '_tplOneTime').value : '',
        regular: ($(prefix + '_tplRegular') && $(prefix + '_tplRegular').value) ? $(prefix + '_tplRegular').value : '',
        artist: ($(prefix + '_tplArtist') && $(prefix + '_tplArtist').value) ? $(prefix + '_tplArtist').value : '',
        organisation: ($(prefix + '_tplOrganisation') && $(prefix + '_tplOrganisation').value) ? $(prefix + '_tplOrganisation').value : ''
      },
      appendSignature: !!($(prefix + '_appendSignature') && $(prefix + '_appendSignature').checked),
      signatureText: ($(prefix + '_signatureText') && $(prefix + '_signatureText').value) ? $(prefix + '_signatureText').value : 'AHADPRINT'
    };
  }

function toggleAutoSections() {
  const sel = $('autoEventSelect');
  const orderSec = $('autoOrderSection');
  const paySec = $('autoPaySection');
  const debtSec = $('autoDebtorsSection');
  if (!sel || !orderSec || !paySec || !debtSec) return;

  const v = String(sel.value || 'order').toLowerCase();
  orderSec.style.display = (v === 'order') ? '' : 'none';
  paySec.style.display = (v === 'pay') ? '' : 'none';
  debtSec.style.display = (v === 'debtors') ? '' : 'none';
}

  async function loadConfig() {
    const j = await fetchJson('/admin/messaging/api/config', { method: 'GET' });
    const cfg = j && j.config ? j.config : null;

    const debtorsAuto = cfg?.auto?.debtors || null;
    fillAuto('debtors', debtorsAuto);


    // NEW schema preferred
    const orderAuto = cfg?.auto?.order || null;
    const payAuto = cfg?.auto?.pay || null;

    // Backward compat: if no cfg.auto, treat old fields as order config
    const legacyOrder = (!orderAuto && cfg) ? {
      enabled: cfg.autoEnabled !== false,
      usePerCustomerTypeTemplates: cfg.usePerCustomerTypeTemplates !== false,
      generalTemplate: cfg.generalTemplate || '',
      templates: cfg.templates || {},
      appendSignature: !!cfg.appendSignature,
      signatureText: cfg.signatureText || 'AHADPRINT'
    } : null;

    fillAuto('order', orderAuto || legacyOrder);
    fillAuto('pay', payAuto); // if missing, defaults will apply

    // ensure correct section is shown
    toggleAutoSections();
  }

  async function saveAuto(prefix, event) {
    const btn = $(prefix + '_saveAutoBtn');
    if (btn) btn.disabled = true;

    try {
      const config = readAuto(prefix);

      await fetchJson('/admin/messaging/api/config', {
        method: 'POST',
        body: JSON.stringify({ event, config })
      });

      alert(`Messaging auto config saved for: ${event.toUpperCase()}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // -------------------------
  // MANUAL
  // -------------------------
  function setSelectOptions(select, options) {
    if (!select) return;
    select.innerHTML = '';
    options.forEach(opt => {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    });
  }

  async function loadDebtorsList(typeSel) {
    if (!typeSel) return;
    setSelectOptions(typeSel, [{ value: '', label: 'Loading debtors...' }]);
    try {
      const j = await fetchJson('/admin/messaging/api/debtors', { method: 'GET' });
      const list = (j && j.debtors) ? j.debtors : [];
      const options = [{ value: '', label: 'All debtors' }];
      list.forEach(d => {
        const name = d.name || d.phone || 'Unknown';
        const phone = d.phone ? ` (${d.phone})` : '';
        const outstanding = d.outstanding ? ` - GHS ${d.outstanding}` : '';
        options.push({ value: d.id, label: `${name}${phone}${outstanding}` });
      });
      setSelectOptions(typeSel, options);
    } catch (e) {
      setSelectOptions(typeSel, [{ value: '', label: 'Failed to load debtors' }]);
    }
  }

  function wireManualTarget() {
    const targetSel = $('manualTarget');
    const typeSel = $('manualCustomerType');
    const typeLabel = $('manualCustomerTypeLabel');
    if (!targetSel || !typeSel) return;

    const defaultOptions = Array.from(typeSel.options).map(o => ({
      value: o.value,
      label: o.textContent || ''
    }));
    const defaultLabel = typeLabel ? (typeLabel.textContent || 'Customer type') : 'Customer type';

    async function toggle() {
      const v = targetSel.value;
      if (v === 'customer_type') {
        if (typeLabel) typeLabel.textContent = defaultLabel;
        typeSel.disabled = false;
        setSelectOptions(typeSel, defaultOptions);
        return;
      }
      if (v === 'debtors') {
        if (typeLabel) typeLabel.textContent = 'Debtor';
        typeSel.disabled = false;
        await loadDebtorsList(typeSel);
        return;
      }
      if (typeLabel) typeLabel.textContent = defaultLabel;
      typeSel.disabled = true;
      setSelectOptions(typeSel, defaultOptions);
    }
    targetSel.addEventListener('change', toggle);
    toggle();
  }

  async function sendManual() {
    const msgEl = $('manualMessage');
    if (!msgEl) return;

    const msg = String(msgEl.value || '').trim();
    if (!msg) return alert('Please type a message.');

    const target = $('manualTarget') ? $('manualTarget').value : 'all';
    const customerType = $('manualCustomerType') ? $('manualCustomerType').value : 'one_time';
    const debtorId = (target === 'debtors' && $('manualCustomerType')) ? $('manualCustomerType').value : '';

    const btn = $('sendManualBtn');
    const result = $('manualResult');

    if (btn) btn.disabled = true;
    if (result) result.textContent = 'Sending...';

    try {
      const j = await fetchJson('/admin/messaging/api/send', {
        method: 'POST',
        body: JSON.stringify({ message: msg, target, customerType, debtorId })
      });

      if (result) {
        result.textContent = `Done. Total: ${j.total}, Sent: ${j.success}, Failed: ${j.failed}`;
      }
    } catch (e) {
      if (result) result.textContent = e.message || 'Failed to send';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // -------------------------
  // INIT (supports ajax fragment reload)
  // -------------------------
  function init() {
    // Auto dropdown + sections exist only on messaging page
    const eventSel = $('autoEventSelect');
    const orderSaveBtn = $('order_saveAutoBtn');
    const paySaveBtn = $('pay_saveAutoBtn');
    const manualBtn = $('sendManualBtn');
    const debtSaveBtn = $('debtors_saveAutoBtn');


    // If none exists, we're not on this page
    if (!eventSel && !orderSaveBtn && !paySaveBtn && !manualBtn) return;

    // Wire dropdown toggle (clone to avoid double binding on ajax reload)
    if (eventSel) {
      const cloned = eventSel.cloneNode(true);
      eventSel.parentNode.replaceChild(cloned, eventSel);
      cloned.addEventListener('change', toggleAutoSections);
    }

    // Wire save buttons (clone to avoid double binding)
    if (orderSaveBtn) {
      const b = orderSaveBtn.cloneNode(true);
      orderSaveBtn.parentNode.replaceChild(b, orderSaveBtn);
      b.addEventListener('click', function () { saveAuto('order', 'order').catch(err => alert(err.message || 'Failed')); });
    }

    if (paySaveBtn) {
      const b = paySaveBtn.cloneNode(true);
      paySaveBtn.parentNode.replaceChild(b, paySaveBtn);
      b.addEventListener('click', function () { saveAuto('pay', 'pay').catch(err => alert(err.message || 'Failed')); });
    }

    if (debtSaveBtn) {
    const b = debtSaveBtn.cloneNode(true);
    debtSaveBtn.parentNode.replaceChild(b, debtSaveBtn);
    b.addEventListener('click', function () {
        saveAuto('debtors', 'debtors').catch(err => alert(err.message || 'Failed'));
    });
    }


    // Manual send (clone to avoid double binding)
    if (manualBtn) {
      const b = manualBtn.cloneNode(true);
      manualBtn.parentNode.replaceChild(b, manualBtn);
      b.addEventListener('click', function () { sendManual().catch(err => alert(err.message || 'Failed')); });
    }

    wireManualTarget();
    loadConfig().catch(err => console.error('loadConfig failed', err));

    // Ensure default select shows ORDER
    const sel = $('autoEventSelect');
    if (sel && !sel.value) sel.value = 'order';
    toggleAutoSections();
  }

  // Run now (for normal full load)
  init();

  // Also run after ajax fragment load
  document.addEventListener('ajax:page:loaded', function () {
    init();
  });
})();
