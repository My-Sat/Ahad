// public/javascripts/discounts.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  function val(el) { return el ? el.value : ''; }
  function checked(el) { return !!(el && el.checked); }
  function multiValues(sel) {
    if (!sel) return [];
    return Array.from(sel.options).filter(o => o.selected).map(o => o.value);
  }

  const statusEl = document.getElementById('discountSaveStatus');

  function setStatus(msg, isErr=false) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('text-danger', !!isErr);
  }

  const els = {
    generalMode: document.getElementById('generalMode'),
    generalValue: document.getElementById('generalValue'),
    generalEnabled: document.getElementById('generalEnabled'),

    custTargets: document.getElementById('custTargets'),
    custMode: document.getElementById('custMode'),
    custValue: document.getElementById('custValue'),
    custEnabled: document.getElementById('custEnabled'),

    svcTargets: document.getElementById('svcTargets'),
    svcMode: document.getElementById('svcMode'),
    svcValue: document.getElementById('svcValue'),
    svcEnabled: document.getElementById('svcEnabled'),

    catTargets: document.getElementById('catTargets'),
    catMode: document.getElementById('catMode'),
    catValue: document.getElementById('catValue'),
    catEnabled: document.getElementById('catEnabled'),

    btnSave: document.getElementById('saveDiscounts'),
    btnLoad: document.getElementById('loadDiscounts')
  };

  function buildRules() {
    const rules = [];

    // General: only include if value provided
    const gVal = Number(val(els.generalValue));
    if (!isNaN(gVal) && gVal > 0) {
      rules.push({
        scope: 'general',
        mode: val(els.generalMode) || 'amount',
        value: gVal,
        enabled: checked(els.generalEnabled)
      });
    }

    // Customer type rule
    const ct = multiValues(els.custTargets);
    const ctVal = Number(val(els.custValue));
    if (ct.length && !isNaN(ctVal) && ctVal > 0) {
      rules.push({
        scope: 'customer_type',
        targets: ct,
        mode: val(els.custMode) || 'amount',
        value: ctVal,
        enabled: checked(els.custEnabled)
      });
    }

    // Service rule
    const sv = multiValues(els.svcTargets);
    const svVal = Number(val(els.svcValue));
    if (sv.length && !isNaN(svVal) && svVal > 0) {
      rules.push({
        scope: 'service',
        targets: sv,
        mode: val(els.svcMode) || 'amount',
        value: svVal,
        enabled: checked(els.svcEnabled)
      });
    }

    // Category rule
    const cg = multiValues(els.catTargets);
    const cgVal = Number(val(els.catValue));
    if (cg.length && !isNaN(cgVal) && cgVal > 0) {
      rules.push({
        scope: 'service_category',
        targets: cg,
        mode: val(els.catMode) || 'amount',
        value: cgVal,
        enabled: checked(els.catEnabled)
      });
    }

    return rules;
  }

  function applyConfig(cfg) {
    const rules = (cfg && Array.isArray(cfg.rules)) ? cfg.rules : [];

    function find(scope) {
      return rules.find(r => r && r.scope === scope) || null;
    }

    const g = find('general');
    if (g) {
      els.generalMode.value = g.mode || 'amount';
      els.generalValue.value = String(g.value || '');
      els.generalEnabled.checked = !!g.enabled;
    } else {
      els.generalMode.value = 'amount';
      els.generalValue.value = '';
      els.generalEnabled.checked = true;
    }

    const ct = find('customer_type');
    if (ct) {
      els.custMode.value = ct.mode || 'amount';
      els.custValue.value = String(ct.value || '');
      els.custEnabled.checked = !!ct.enabled;
      Array.from(els.custTargets.options).forEach(o => o.selected = (ct.targets || []).includes(o.value));
    }

    const sv = find('service');
    if (sv) {
      els.svcMode.value = sv.mode || 'amount';
      els.svcValue.value = String(sv.value || '');
      els.svcEnabled.checked = !!sv.enabled;
      Array.from(els.svcTargets.options).forEach(o => o.selected = (sv.targets || []).includes(o.value));
    }

    const cg = find('service_category');
    if (cg) {
      els.catMode.value = cg.mode || 'amount';
      els.catValue.value = String(cg.value || '');
      els.catEnabled.checked = !!cg.enabled;
      Array.from(els.catTargets.options).forEach(o => o.selected = (cg.targets || []).includes(o.value));
    }
  }

  async function load() {
    setStatus('Loading...');
    const res = await fetch('/admin/discounts/api', { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
    const j = await res.json().catch(()=>null);
    if (!res.ok || !j || !j.ok) { setStatus('Failed to load discounts', true); return; }
    applyConfig(j.config);
    setStatus('Loaded.');
  }

  async function save() {
    setStatus('Saving...');
    const rules = buildRules();
    const res = await fetch('/admin/discounts', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ rules })
    });
    const j = await res.json().catch(()=>null);
    if (!res.ok || !j || !j.ok) { setStatus((j && j.error) ? j.error : 'Save failed', true); return; }
    setStatus('Saved.');
  }

  els.btnLoad && els.btnLoad.addEventListener('click', load);
  els.btnSave && els.btnSave.addEventListener('click', save);

  load();
});
