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

  // new multi-rule containers
  custRulesContainer: document.getElementById('custRulesContainer'),
  svcRulesContainer: document.getElementById('svcRulesContainer'),
  catRulesContainer: document.getElementById('catRulesContainer'),

  // templates
  custRuleTemplate: document.getElementById('custRuleTemplate'),
  svcRuleTemplate: document.getElementById('svcRuleTemplate'),
  catRuleTemplate: document.getElementById('catRuleTemplate'),

  // add buttons
  addCustRule: document.getElementById('addCustRule'),
  addSvcRule: document.getElementById('addSvcRule'),
  addCatRule: document.getElementById('addCatRule'),

  btnSave: document.getElementById('saveDiscounts'),
  btnLoad: document.getElementById('loadDiscounts')
};

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

function addRuleRow(scope, data) {
  let container = null;
  let tpl = null;

  if (scope === 'customer_type') { container = els.custRulesContainer; tpl = els.custRuleTemplate; }
  if (scope === 'service') { container = els.svcRulesContainer; tpl = els.svcRuleTemplate; }
  if (scope === 'service_category') { container = els.catRulesContainer; tpl = els.catRuleTemplate; }

  if (!container || !tpl) return;

  const row = cloneTemplateRow(tpl);
  if (!row) return;

  // apply defaults/data
  const targetEl = row.querySelector('.rule-target');
  const modeEl = row.querySelector('.rule-mode');
  const valueEl = row.querySelector('.rule-value');
  const enabledEl = row.querySelector('.rule-enabled');

  if (targetEl) targetEl.value = (data && data.target) ? String(data.target) : '';
  if (modeEl) modeEl.value = (data && data.mode) ? String(data.mode) : 'amount';
  if (valueEl) valueEl.value = (data && data.value !== undefined && data.value !== null) ? String(data.value) : '';
  if (enabledEl) enabledEl.checked = (data && typeof data.enabled !== 'undefined') ? !!data.enabled : true;

  wireRuleRow(row);
  container.appendChild(row);
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

  // group + render rows
  const custRules = rules.filter(r => r && r.scope === 'customer_type');
  const svcRules = rules.filter(r => r && r.scope === 'service');
  const catRules = rules.filter(r => r && r.scope === 'service_category');

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

  // if none exist, give user one empty row to start
  if (!custRules.length) addRuleRow('customer_type');
  if (!svcRules.length) addRuleRow('service');
  if (!catRules.length) addRuleRow('service_category');
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


  load();
});
