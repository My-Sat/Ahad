// public/javascripts/discounts.js
function initDiscountsPage() {
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

  custRulesContainer: document.getElementById('custRulesContainer'),
  svcRulesContainer: document.getElementById('svcRulesContainer'),
  catRulesContainer: document.getElementById('catRulesContainer'),

  customerRulesContainer: document.getElementById('customerRulesContainer'),

  custRuleTemplate: document.getElementById('custRuleTemplate'),
  svcRuleTemplate: document.getElementById('svcRuleTemplate'),
  catRuleTemplate: document.getElementById('catRuleTemplate'),

  customerRuleTemplate: document.getElementById('customerRuleTemplate'),

  addCustRule: document.getElementById('addCustRule'),
  addSvcRule: document.getElementById('addSvcRule'),
  addCatRule: document.getElementById('addCatRule'),

  addCustomerRule: document.getElementById('addCustomerRule'),

  btnSave: document.getElementById('saveDiscounts'),
  btnLoad: document.getElementById('loadDiscounts')
  };

  if (!els.btnSave || !els.btnLoad) return;
  if (els.btnSave.dataset.discountInit === '1') return;
  els.btnSave.dataset.discountInit = '1';

function cloneTemplateRow(tplEl) {
  if (!tplEl) return null;
  const frag = tplEl.content.cloneNode(true);
  return frag.firstElementChild || frag.querySelector('.discount-rule-row');
}

function wireRuleRow(rowEl) {
  if (!rowEl) return;
  const removeBtn = rowEl.querySelector('.rule-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      rowEl.remove();
    });
  }
}

function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

async function fetchCustomerResults(q, by) {
  const url = `/admin/discounts/customer-search?q=${encodeURIComponent(q)}&by=${encodeURIComponent(by)}`;
  const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || !j.ok) return [];
  return Array.isArray(j.results) ? j.results : [];
}

function wireCustomerSearch(rowEl) {
  const byEl = rowEl.querySelector('.customer-search-by');
  const qEl = rowEl.querySelector('.customer-search-q');
  const targetEl = rowEl.querySelector('.rule-target');
  if (!byEl || !qEl || !targetEl) return;

  const run = debounce(async () => {
    const q = String(qEl.value || '').trim();
    const by = String(byEl.value || 'name');
    targetEl.innerHTML = '<option value="">-- Select customer --</option>';

    if (q.length < 2) return; // avoid huge queries
    const results = await fetchCustomerResults(q, by);

    for (const c of results) {
      const opt = document.createElement('option');
      opt.value = c._id;
      opt.textContent = c.label || c.phone || c._id;
      targetEl.appendChild(opt);
    }
  }, 250);

  qEl.addEventListener('input', run);
  byEl.addEventListener('change', run);
}


function addRuleRow(scope, data) {
  let container = null;
  let tpl = null;

  if (scope === 'customer_type') { container = els.custRulesContainer; tpl = els.custRuleTemplate; }
  if (scope === 'service') { container = els.svcRulesContainer; tpl = els.svcRuleTemplate; }
  if (scope === 'service_category') { container = els.catRulesContainer; tpl = els.catRuleTemplate; }

  // ✅ NEW
  if (scope === 'customer') { container = els.customerRulesContainer; tpl = els.customerRuleTemplate; }

  if (!container || !tpl) return;

  const row = cloneTemplateRow(tpl);
  if (!row) return;

  const targetEl = row.querySelector('.rule-target');
  const modeEl = row.querySelector('.rule-mode');
  const valueEl = row.querySelector('.rule-value');
  const enabledEl = row.querySelector('.rule-enabled');

  if (modeEl) modeEl.value = (data && data.mode) ? String(data.mode) : 'amount';
  if (valueEl) valueEl.value = (data && data.value !== undefined && data.value !== null) ? String(data.value) : '';
  if (enabledEl) enabledEl.checked = (data && typeof data.enabled !== 'undefined') ? !!data.enabled : true;

  // for customer scope, target is set after search/selection
  if (targetEl && data && data.target) targetEl.value = String(data.target);

  wireRuleRow(row);
  container.appendChild(row);

  //  if customer row, wire search
  if (scope === 'customer') wireCustomerSearch(row);
}

function collectScopeRules(scope, containerEl) {
  const rows = containerEl ? Array.from(containerEl.querySelectorAll(`.discount-rule-row[data-scope="${scope}"]`)) : [];
  const out = [];

  // block duplicates per-scope
  const seenTargets = new Set();

  rows.forEach(row => {
    const targetEl = row.querySelector('.rule-target');
    const modeEl = row.querySelector('.rule-mode');
    const valueEl = row.querySelector('.rule-value');
    const enabledEl = row.querySelector('.rule-enabled');

    const target = targetEl ? String(targetEl.value || '').trim() : '';
    const mode = modeEl ? String(modeEl.value || 'amount') : 'amount';
    const value = Number(valueEl ? valueEl.value : NaN);
    const enabled = !!(enabledEl && enabledEl.checked);

    // ignore incomplete rows
    if (!target) return;
    if (!isFinite(value) || value <= 0) return;

    if (seenTargets.has(target)) {
      // ignore duplicates (user picked same target twice)
      return;
    }
    seenTargets.add(target);

    out.push({
      scope,
      targets: [target], // IMPORTANT: one target per rule
      mode,
      value,
      enabled
    });
  });

  return out;
}


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

  // Multiple rules per scope (one target each)
  rules.push(...collectScopeRules('customer_type', els.custRulesContainer));
  rules.push(...collectScopeRules('service', els.svcRulesContainer));
  rules.push(...collectScopeRules('service_category', els.catRulesContainer));
  rules.push(...collectScopeRules('customer', els.customerRulesContainer)); 


  return rules;
}

function applyConfig(cfg) {
  const rules = (cfg && Array.isArray(cfg.rules)) ? cfg.rules : [];

  // --- General (single) ---
  const g = rules.find(r => r && r.scope === 'general') || null;
  if (g) {
    els.generalMode.value = g.mode || 'amount';
    els.generalValue.value = String(g.value || '');
    els.generalEnabled.checked = !!g.enabled;
  } else {
    els.generalMode.value = 'amount';
    els.generalValue.value = '';
    els.generalEnabled.checked = true;
  }

  // clear existing rows
  if (els.custRulesContainer) els.custRulesContainer.innerHTML = '';
  if (els.svcRulesContainer) els.svcRulesContainer.innerHTML = '';
  if (els.catRulesContainer) els.catRulesContainer.innerHTML = '';
  if (els.customerRulesContainer) els.customerRulesContainer.innerHTML = '';

  // group + render rows
  const custRules = rules.filter(r => r && r.scope === 'customer_type');
  const svcRules = rules.filter(r => r && r.scope === 'service');
  const catRules = rules.filter(r => r && r.scope === 'service_category');
  const customerRules = rules.filter(r => r && r.scope === 'customer');

  custRules.forEach(r => addRuleRow('customer_type', {
    target: (r.targets && r.targets[0]) ? r.targets[0] : '',
    mode: r.mode || 'amount',
    value: r.value,
    enabled: !!r.enabled
  }));
  svcRules.forEach(r => addRuleRow('service', {
    target: (r.targets && r.targets[0]) ? r.targets[0] : '',
    mode: r.mode || 'amount',
    value: r.value,
    enabled: !!r.enabled
  }));
  catRules.forEach(r => addRuleRow('service_category', {
    target: (r.targets && r.targets[0]) ? r.targets[0] : '',
    mode: r.mode || 'amount',
    value: r.value,
    enabled: !!r.enabled
  }));

  customerRules.forEach(r => addRuleRow('customer', {
    target: (r.targets && r.targets[0]) ? r.targets[0] : '',
    mode: r.mode || 'amount',
    value: r.value,
    enabled: !!r.enabled
  }));

  // if none exist, give user one empty row to start
  if (!custRules.length) addRuleRow('customer_type');
  if (!svcRules.length) addRuleRow('service');
  if (!catRules.length) addRuleRow('service_category');
  if (!customerRules.length) addRuleRow('customer');
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
  els.addCustRule && els.addCustRule.addEventListener('click', () => addRuleRow('customer_type'));
  els.addSvcRule && els.addSvcRule.addEventListener('click', () => addRuleRow('service'));
  els.addCatRule && els.addCatRule.addEventListener('click', () => addRuleRow('service_category'));
  els.addCustomerRule && els.addCustomerRule.addEventListener('click', () => addRuleRow('customer')); 



  load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initDiscountsPage();
  }, { once: true });
} else {
  initDiscountsPage();
}

document.addEventListener('ajax:page:loaded', function () {
  initDiscountsPage();
});
