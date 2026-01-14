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

  async function loadConfig() {
    const j = await fetchJson('/admin/messaging/api/config', { method: 'GET' });
    const cfg = j && j.config ? j.config : null;

    // defaults
    $('autoEnabled').checked = cfg ? !!cfg.autoEnabled : true;
    $('usePerType').checked = cfg ? !!cfg.usePerCustomerTypeTemplates : true;

    $('generalTemplate').value = cfg ? (cfg.generalTemplate || '') : '';
    $('tplOneTime').value = cfg ? (cfg.templates?.one_time || '') : '';
    $('tplRegular').value = cfg ? (cfg.templates?.regular || '') : '';
    $('tplArtist').value = cfg ? (cfg.templates?.artist || '') : '';
    $('tplOrganisation').value = cfg ? (cfg.templates?.organisation || '') : '';

    $('appendSignature').checked = cfg ? !!cfg.appendSignature : false;
    $('signatureText').value = cfg ? (cfg.signatureText || 'AHADPRINT') : 'AHADPRINT';
  }

  async function saveConfig() {
    const payload = {
      autoEnabled: $('autoEnabled').checked,
      usePerCustomerTypeTemplates: $('usePerType').checked,
      generalTemplate: $('generalTemplate').value || '',
      templates: {
        one_time: $('tplOneTime').value || '',
        regular: $('tplRegular').value || '',
        artist: $('tplArtist').value || '',
        organisation: $('tplOrganisation').value || ''
      },
      appendSignature: $('appendSignature').checked,
      signatureText: $('signatureText').value || 'AHADPRINT'
    };

    await fetchJson('/admin/messaging/api/config', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    alert('Messaging config saved.');
  }

  function wireManualTarget() {
    const targetSel = $('manualTarget');
    const typeSel = $('manualCustomerType');

    function toggle() {
      const v = targetSel.value;
      typeSel.disabled = (v !== 'customer_type');
    }
    targetSel.addEventListener('change', toggle);
    toggle();
  }

  async function sendManual() {
    const msg = String($('manualMessage').value || '').trim();
    if (!msg) return alert('Please type a message.');

    const target = $('manualTarget').value;
    const customerType = $('manualCustomerType').value;

    $('sendManualBtn').disabled = true;
    $('manualResult').textContent = 'Sending...';

    try {
      const j = await fetchJson('/admin/messaging/api/send', {
        method: 'POST',
        body: JSON.stringify({
          message: msg,
          target,
          customerType
        })
      });

      $('manualResult').textContent =
        `Done. Total: ${j.total}, Sent: ${j.success}, Failed: ${j.failed}`;
    } catch (e) {
      $('manualResult').textContent = e.message || 'Failed to send';
    } finally {
      $('sendManualBtn').disabled = false;
    }
  }

  function init() {
    // Only run if we're on messaging page (because dashboard_nav can re-run scripts)
    if (!$('saveAutoBtn') || !$('sendManualBtn')) return;

    $('saveAutoBtn').addEventListener('click', saveConfig);
    $('sendManualBtn').addEventListener('click', sendManual);

    wireManualTarget();
    loadConfig().catch(err => console.error('loadConfig failed', err));
  }

  // Run now (for normal full load)
  init();

  // Also run after ajax fragment load
  document.addEventListener('ajax:page:loaded', function () {
    init();
  });
})();
