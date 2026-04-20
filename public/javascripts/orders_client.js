// public/javascripts/orders_client.js
// Orders client with Books support, printer-aware F/B checkbox and dynamic QTY placeholder.
// Keeps existing logic intact while adding:
//  - Books dropdown + Add Book button
//  - Add book to cart as a single cart line (expanded into items on order submission)
//  - F/B checkbox only shown when serviceRequiresPrinter is true
//  - QTY placeholder shows "Pages" when printer required, otherwise "Qty"



(function () {
  'use strict';

  function initOrdersClient() {
    // only run on Orders -> New page
    const root = document.getElementById('ordersNewPage');
    if (!root) return;

    // prevent double-init on same injected page instance
    if (root.dataset.initDone === '1') return;
    root.dataset.initDone = '1';

    // derive isAdmin from DOM (works for full refresh AND ajax nav)
    window._isAdmin = (root.dataset.isAdmin === 'true');

  // ---------- elements ----------
  const serviceSelect = document.getElementById('serviceSelect');
  const pricesList = document.getElementById('pricesList');
  const cartTbody = document.getElementById('cartTbody');
  const cartTotalEl = document.getElementById('cartTotal');
  const orderNowBtn = document.getElementById('orderNowBtn');
  const saveDraftBtn = document.getElementById('saveDraftBtn');
  const orderJobNoteEl = document.getElementById('orderJobNote');
  const submittedCustomerSelect = document.getElementById('submittedCustomerSelect');
  const reloadSubmittedCustomersBtn = document.getElementById('reloadSubmittedCustomersBtn');
  const orderSubmissionIdEl = document.getElementById('orderSubmissionId');

    // Admin-only manual discount UI (may not exist for non-admin)
  const manualDiscountMode = document.getElementById('manualDiscountMode');
  const manualDiscountValue = document.getElementById('manualDiscountValue');
  const manualAdjustmentType = document.getElementById('manualAdjustmentType');
  const applyManualDiscountBtn = document.getElementById('applyManualDiscountBtn');
  const clearManualDiscountBtn = document.getElementById('clearManualDiscountBtn');
  const manualDiscountSummary = document.getElementById('manualDiscountSummary');

  // IDs in views/orders/new.pug
  const manualDiscountBeforeEl = document.getElementById('manualDiscountTotalBefore');
  const manualDiscountAmountEl = document.getElementById('manualDiscountAmount');
  const manualDiscountAmountLabel = document.getElementById('manualDiscountAmountLabel');

  // client-only state (per order)
  let manualDiscount = null; // { kind:'discount'|'premium', mode:'amount'|'percent', value:number }

    let secretarySubmissions = [];
    let activeSubmission = null;

    function getCurrentCustomerId() {
    const customerEl = document.getElementById('orderCustomerId');
    const id = customerEl && customerEl.value ? String(customerEl.value).trim() : '';
    return id || '';
  }

  function getCurrentSubmissionId() {
    const sid = orderSubmissionIdEl && orderSubmissionIdEl.value ? String(orderSubmissionIdEl.value).trim() : '';
    return sid || '';
  }

  function draftKey(customerId) {
    return customerId ? `orderDraft:${customerId}` : '';
  }

  function readDraft(customerId) {
    try {
      if (!customerId) return null;
      const raw = localStorage.getItem(draftKey(customerId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeDraft(customerId, payload) {
    if (!customerId) return false;
    try {
      localStorage.setItem(draftKey(customerId), JSON.stringify(payload));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearDraft(customerId) {
    if (!customerId) return false;
    try {
      localStorage.removeItem(draftKey(customerId));
      return true;
    } catch (e) {
      return false;
    }
  }

  function updateSaveDraftBtn() {
    if (!saveDraftBtn) return;
    const hasCustomer = !!getCurrentCustomerId();
    saveDraftBtn.disabled = !(hasCustomer && cart && cart.length);
  }

  function loadDraftIntoCart(draft) {
    if (!draft) return;
    if (Array.isArray(draft.cart)) {
      cart = draft.cart;
    }
    if (draft.manualDiscount) {
      manualDiscount = draft.manualDiscount;
      if (manualAdjustmentType) manualAdjustmentType.value = manualDiscount.kind === 'premium' ? 'premium' : 'discount';
      if (manualDiscountMode) manualDiscountMode.value = manualDiscount.mode || 'amount';
      if (manualDiscountValue) manualDiscountValue.value = manualDiscount.value != null ? manualDiscount.value : '';
    } else {
      manualDiscount = null;
      if (manualAdjustmentType) manualAdjustmentType.value = 'discount';
      if (manualDiscountValue) manualDiscountValue.value = '';
    }
    refreshManualAdjustmentButton();
    renderCart();
  }

  async function promptLoadDraft(customerId) {
    const draft = readDraft(customerId);
    if (!draft || !Array.isArray(draft.cart) || !draft.cart.length) return;

    const choice = await (function showDraftModal() {
      return new Promise((resolve) => {
        let modalEl = document.getElementById('draftOrderModal');
        if (!modalEl) {
          const html = `
<div class="modal fade" id="draftOrderModal" tabindex="-1" aria-labelledby="draftOrderModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="draftOrderModalLabel">Saved order found</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body">
        <p>This customer has a saved unfinished order.</p>
        <p class="small text-muted mb-0">Do you want to continue it or discard it?</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-light-custom" data-action="discard">Discard saved order</button>
        <button type="button" class="btn btn-primary" data-action="continue">Continue saved order</button>
      </div>
    </div>
  </div>
</div>`;
          const container = document.createElement('div');
          container.innerHTML = html;
          document.body.appendChild(container.firstElementChild);
          modalEl = document.getElementById('draftOrderModal');
        }

        const btnContinue = modalEl.querySelector('button[data-action="continue"]');
        const btnDiscard = modalEl.querySelector('button[data-action="discard"]');
        const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

        function cleanup() {
          try {
            btnContinue.removeEventListener('click', onContinue);
            btnDiscard.removeEventListener('click', onDiscard);
            modalEl.removeEventListener('hidden.bs.modal', onHidden);
          } catch (e) {}
        }
        function onContinue() { cleanup(); inst.hide(); resolve('continue'); }
        function onDiscard() { cleanup(); inst.hide(); resolve('discard'); }
        function onHidden() { cleanup(); resolve(null); }

        btnContinue.addEventListener('click', onContinue);
        btnDiscard.addEventListener('click', onDiscard);
        modalEl.addEventListener('hidden.bs.modal', onHidden);

        inst.show();
      });
    })();

    if (choice === 'continue') {
      loadDraftIntoCart(draft);
      if (typeof showGlobalToast === 'function') {
        try { showGlobalToast('Loaded saved order', 1800); } catch (e) {}
      }
    } else if (choice === 'discard') {
      clearDraft(customerId);
      if (typeof showGlobalToast === 'function') {
        try { showGlobalToast('Saved order discarded', 1800); } catch (e) {}
      }
    }
  }


  // Orders explorer elements
  const openOrdersExplorerBtn = document.getElementById('openOrdersExplorerBtn');
  const ordersExplorerModalEl = document.getElementById('ordersExplorerModal');
  const ordersExplorerModal = (window.bootstrap && ordersExplorerModalEl) ? new bootstrap.Modal(ordersExplorerModalEl) : null;
  const ordersFromEl = document.getElementById('ordersFrom');
  const ordersToEl = document.getElementById('ordersTo');
  const fetchOrdersBtn = document.getElementById('fetchOrdersBtn');
  const presetTodayBtn = document.getElementById('presetToday');
  const presetYesterdayBtn = document.getElementById('presetYesterday');
  const presetThisWeekBtn = document.getElementById('presetThisWeek');
  const ordersTable = document.getElementById('ordersTable');
  const ordersCountEl = document.getElementById('ordersCount');

  // Order details modal
  const orderDetailsModalEl = document.getElementById('orderDetailsModal');
  const orderDetailsModal = (window.bootstrap && orderDetailsModalEl) ? new bootstrap.Modal(orderDetailsModalEl) : null;
  const orderDetailsMeta = document.getElementById('orderDetailsMeta');
  const orderDetailsJson = document.getElementById('orderDetailsJson'); // we'll fill HTML into this element
  const copyDetailOrderIdBtn = document.getElementById('copyDetailOrderIdBtn');
  const printDetailOrderBtn = document.getElementById('printDetailOrderBtn');

  // ---------- internal state ----------
  let prices = []; // loaded price rules for selected service or book preview
  let cart = [];   // cart lines: either normal item or book line
                   // normal: { isBook:false, serviceId, serviceName, priceRuleId, selectionLabel, unitPrice, pages, pagesOriginal, subtotal, fb, printerId, spoiled }
                   // book  : { isBook:true, bookId, bookName, unitPrice, qty, subtotal, bookItems: [ { serviceId, priceRuleId, pagesOriginal, fb, printerId, spoiled, unitPrice, subtotal, selectionLabel } ] }
  let serviceRequiresPrinter = false;
  let printers = []; // list of printers for the currently loaded service
  let books = [];    // list of available books (basic metadata)
  let serviceToneIndex = Object.create(null);

    // ---- materials stock cache (for Apply-time validation) ----
let materials = [];          // [{ _id, name, stocked, used, remaining, selections:[{unit,subUnit},...] }, ...]
let materialsLoaded = false;
let materialsFetchedAt = 0;  // ms timestamp when materials were last fetched


    // ---------- Service categories (populate category select + filter services) ----------
  const serviceCategorySelect = document.getElementById('serviceCategorySelect');

  function serviceToneFromText(text) {
    const s = String(text || '').toLowerCase();
    const isBw = /(b\/w|black\s*and\s*white|monochrome|\bmono\b|\bbw\b)/i.test(s);
    const isColor = /(colour|color|c\/l|\bcol\b)/i.test(s);
    if (isBw) return 'bw';
    if (isColor) return 'color';
    return 'other';
  }

  function resolvePriceRuleTone(rule, fallbackServiceTone) {
    const fallback = (fallbackServiceTone && fallbackServiceTone !== 'other') ? fallbackServiceTone : 'other';
    const explicit = serviceToneFromText((rule && rule.ruleTone) || '');
    if (explicit !== 'other') return explicit;

    const ruleText = `${(rule && rule.selectionLabel) || ''} ${(rule && rule.customLabel) || ''}`.trim();
    const fromRuleText = serviceToneFromText(ruleText);
    if (fromRuleText !== 'other') return fromRuleText;

    return fallback;
  }

  function canonicalServiceName(name) {
    let s = String(name || '');
    s = s.replace(/\b(color|colour|b\/w|black\s*and\s*white|monochrome)\b/ig, '');
    s = s.replace(/[\(\)\-\_\/]+/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s || String(name || '').trim();
  }

async function loadServiceCategories() {
  if (!serviceCategorySelect) return;
  const cats = (activeSubmission && Array.isArray(activeSubmission.categories))
    ? activeSubmission.categories
    : [];

  if (!cats.length) {
    serviceCategorySelect.innerHTML = '<option value="">-- Select a submitted customer first --</option>';
  } else {
    serviceCategorySelect.innerHTML = '<option value="" disabled selected hidden>-- Select a category --</option>';
    cats.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id || c._id;
      o.textContent = c.name || 'Category';
      serviceCategorySelect.appendChild(o);
    });
  }

  if (serviceSelect) {
    serviceSelect.innerHTML = '<option value="">-- Select a service --</option>';
    prices = [];
    if (typeof renderPrices === 'function') renderPrices();
  }
}

function setSelectedCustomerFromSubmission(sub) {
  const customerIdEl = document.getElementById('orderCustomerId');
  const nameEl = document.getElementById('selectedCustomerName');
  const phoneEl = document.getElementById('selectedCustomerPhone');
  const categoryEl = document.getElementById('selectedCustomerCategory');
  const card = document.getElementById('selectedCustomerCard');
  const prevSubmissionId = activeSubmission ? String(activeSubmission.id || '') : '';
  const nextSubmissionId = sub ? String(sub.id || '') : '';
  const submissionChanged = prevSubmissionId !== nextSubmissionId;

  if (submissionChanged && Array.isArray(cart) && cart.length) {
    cart = [];
    manualDiscount = null;
    if (typeof renderCart === 'function') renderCart();
    if (serviceCategorySelect) serviceCategorySelect.value = '';
    if (serviceSelect) serviceSelect.innerHTML = '<option value="">-- Select a service --</option>';
    prices = [];
    if (typeof renderPrices === 'function') renderPrices();
    if (typeof showGlobalToast === 'function') {
      try { showGlobalToast('Switched customer: previous cart cleared', 1800); } catch (e) {}
    }
  }

  activeSubmission = sub || null;
  if (orderSubmissionIdEl) orderSubmissionIdEl.value = sub ? String(sub.id || '') : '';

  if (!sub) {
    if (customerIdEl) customerIdEl.value = '';
    if (nameEl) nameEl.textContent = '';
    if (phoneEl) phoneEl.textContent = '';
    if (categoryEl) categoryEl.textContent = '';
    if (card) card.style.display = 'none';
    loadServiceCategories();
    updateSaveDraftBtn();
    return;
  }

  if (customerIdEl) customerIdEl.value = sub.customerId ? String(sub.customerId) : '';
  if (nameEl) nameEl.textContent = sub.displayName || '';
  if (phoneEl) phoneEl.textContent = sub.phone || '';
  if (categoryEl) categoryEl.textContent = sub.customerId ? '' : 'Walk-in';
  if (card) card.style.display = '';
  loadServiceCategories();
  updateSaveDraftBtn();
}

function getActiveCustomerCategory() {
  if (!activeSubmission) return '';
  const raw = String(activeSubmission.customerCategory || '').toLowerCase().trim();
  if (raw === 'artist' || raw === 'organisation') return raw;
  return 'customer';
}

async function loadSecretarySubmissions() {
  if (!submittedCustomerSelect) return;
  submittedCustomerSelect.disabled = true;
  submittedCustomerSelect.innerHTML = '<option value="">Loading...</option>';
  try {
    const res = await fetch('/orders/submissions', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'Failed to load');
    secretarySubmissions = Array.isArray(j.submissions) ? j.submissions : [];

    submittedCustomerSelect.innerHTML = '<option value="">-- Select submitted customer/walk-in --</option>';
    secretarySubmissions.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      const suffix = (s.categories && s.categories.length) ? ` (${s.categories.length} categories)` : '';
      opt.textContent = `${s.displayName || 'Customer'}${suffix}`;
      submittedCustomerSelect.appendChild(opt);
    });

    if (activeSubmission) {
      const stillThere = secretarySubmissions.find(s => String(s.id) === String(activeSubmission.id));
      if (stillThere) {
        submittedCustomerSelect.value = String(stillThere.id);
        setSelectedCustomerFromSubmission(stillThere);
      } else {
        setSelectedCustomerFromSubmission(null);
      }
    }
  } catch (err) {
    submittedCustomerSelect.innerHTML = '<option value="">Failed to load submitted customers</option>';
  } finally {
    submittedCustomerSelect.disabled = false;
  }
}

async function loadServicesForCategory(catId) {
  if (!serviceSelect) return;

  serviceSelect.innerHTML = '<option value="">-- Select a service --</option>';
  prices = [];
  renderPrices();

  if (!catId) return;

  try {
    // Load normal services
    const svcRes = await fetch(
      `/admin/service-categories/${encodeURIComponent(catId)}/services`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
    );
    const svcJson = svcRes.ok ? await svcRes.json() : null;
    const services = (svcJson && Array.isArray(svcJson.services)) ? svcJson.services : [];
    const compoundFromCategory = (svcJson && Array.isArray(svcJson.compoundServices)) ? svcJson.compoundServices : [];
    serviceToneIndex = Object.create(null);
    services.forEach(s => { serviceToneIndex[String(s._id)] = serviceToneFromText(s.name); });

    // Merge color/B-W sibling services into one selectable service label.
    const byBase = new Map();
    services.forEach(s => {
      const base = canonicalServiceName(s.name);
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(s);
    });

    byBase.forEach((group, base) => {
      const tones = new Set(group.map(g => serviceToneFromText(g.name)));
      const mergeAsSingle = group.length > 1 && tones.has('color') && tones.has('bw');

      if (mergeAsSingle) {
        const opt = document.createElement('option');
        opt.value = group.map(g => String(g._id)).join(',');
        opt.textContent = base;
        opt.dataset.type = 'service-group';
        opt.dataset.serviceIds = group.map(g => String(g._id)).join(',');
        serviceSelect.appendChild(opt);
        return;
      }

      group.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s._id;
        opt.textContent = s.name;
        opt.dataset.type = 'service';
        serviceSelect.appendChild(opt);
      });
    });

    // Prefer compound services returned by category endpoint.
    // Fallback to /books/for-orders for backward compatibility.
    let booksInCategory = compoundFromCategory;
    if (!booksInCategory.length) {
      const bookRes = await fetch('/books/for-orders', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const bookJson = bookRes.ok ? await bookRes.json() : null;
      const allBooks = (bookJson && Array.isArray(bookJson.books)) ? bookJson.books : [];
      booksInCategory = allBooks.filter(b =>
        String(b.category) === String(catId)
      );
    }

    if (booksInCategory.length) {
      const group = document.createElement('optgroup');
      group.label = 'Compound Services';

      booksInCategory.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b._id;
        opt.textContent = `${b.name} â€” GH₵ ${formatMoney(b.unitPrice)}`;
        opt.dataset.type = 'book';
        group.appendChild(opt);
      });

      serviceSelect.appendChild(group);
    }

  } catch (err) {
    console.error('loadServicesForCategory failed', err);
  }
}
  // bind category change
  if (serviceCategorySelect) {
    serviceCategorySelect.addEventListener('change', function () {
      const cid = this.value || '';
      // clear book preview when changing category
      loadServicesForCategory(cid);
    });
  }

  if (submittedCustomerSelect) {
    submittedCustomerSelect.addEventListener('change', function () {
      const sid = this.value || '';
      if (!sid) {
        setSelectedCustomerFromSubmission(null);
        return;
      }
      const found = secretarySubmissions.find(s => String(s.id) === String(sid)) || null;
      setSelectedCustomerFromSubmission(found);
    });
  }

  if (reloadSubmittedCustomersBtn) {
    reloadSubmittedCustomersBtn.addEventListener('click', async function () {
      const txt = reloadSubmittedCustomersBtn.textContent;
      reloadSubmittedCustomersBtn.disabled = true;
      reloadSubmittedCustomersBtn.textContent = 'Reloading...';
      try {
        await loadSecretarySubmissions();
      } finally {
        reloadSubmittedCustomersBtn.disabled = false;
        reloadSubmittedCustomersBtn.textContent = txt;
      }
    });
  }

  // initial categories load
  loadServiceCategories();
  loadSecretarySubmissions();
  loadMaterialsForStockChecks();


    function computeKeyFromSelections(selections) {
    const parts = (selections || []).map(s => `${String(s.unit)}:${String(s.subUnit)}`);
    parts.sort();
    return parts.join('|');
  }

  // Matches server logic in controllers/orders.js:
  // materialMatchesItem(m.selections, itemSelections)
  function materialMatchesPriceRule(materialSelections, ruleSelections) {
    const ruleSet = new Set((ruleSelections || []).map(s => `${String(s.unit)}:${String(s.subUnit)}`));
    for (const ms of (materialSelections || [])) {
      const key = `${String(ms.unit)}:${String(ms.subUnit)}`;
      if (!ruleSet.has(key)) return false;
    }
    return true;
  }

  async function loadMaterialsForStockChecks() {
    try {
      const res = await fetch('/admin/materials/for-orders', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'Failed to load materials');
      materials = Array.isArray(j.materials) ? j.materials : [];
      // normalize populated selections -> ids so matching works
      materials = Array.isArray(j.materials) ? j.materials : [];
      materialsLoaded = true;
      materialsFetchedAt = Date.now();
      materialsLoaded = true;
      materialsFetchedAt = Date.now();
    } catch (e) {
      // Donâ€™t break ordering if materials canâ€™t load; just skip checks.
      console.warn('loadMaterialsForStockChecks failed', e);
      materials = [];
      materialsLoaded = false;
    }
  }

  async function refreshMaterialsIfStale(force = false) {
  // If not loaded yet, always fetch
  if (!materialsLoaded) return loadMaterialsForStockChecks();

  // Refresh if older than 10 seconds (tune if you want)
  const age = Date.now() - (materialsFetchedAt || 0);
  if (force || age > 10000) {
    return loadMaterialsForStockChecks();
  }
}




  // ---------- helpers ----------
  function formatMoney(n) { return (Number(n) || 0).toFixed(2); }

  function escapeHtml(s) {
    if (!s && s !== 0) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

    function clamp(n, min, max) {
    const x = Number(n);
    if (isNaN(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  function manualAdjustmentKind() {
    const k = manualDiscount && manualDiscount.kind ? String(manualDiscount.kind).toLowerCase() : 'discount';
    return k === 'premium' ? 'premium' : 'discount';
  }

  function manualAdjustmentSign() {
    return manualAdjustmentKind() === 'premium' ? '+' : '-';
  }

  function refreshManualAdjustmentButton() {
    if (!applyManualDiscountBtn) return;
    const kind = manualAdjustmentType ? String(manualAdjustmentType.value || 'discount').toLowerCase() : 'discount';
    applyManualDiscountBtn.textContent = kind === 'premium' ? 'Apply Premium' : 'Apply Discount';
  }

  function computeManualDiscountAmount(baseTotal, disc) {
    if (!disc) return 0;
    const mode = String(disc.mode || '');
    const value = Number(disc.value || 0);

    if (!isFinite(value) || value <= 0) return 0;

    let amt = 0;
    if (mode === 'amount') {
      amt = Math.max(0, value);
    } else if (mode === 'percent') {
      const pct = clamp(value, 0, 100);
      amt = Number((baseTotal * (pct / 100)).toFixed(2));
    }

    // cap at baseTotal
    amt = Math.min(baseTotal, Math.max(0, amt));
    return Number(amt.toFixed(2));
  }

  function updateManualDiscountUI(baseTotal) {
    // hide if not admin or UI not present
    if (!window._isAdmin || !manualDiscountMode || !manualDiscountValue) return;

    const discAmt = computeManualDiscountAmount(baseTotal, manualDiscount);

    if (manualDiscountSummary && discAmt > 0) {
      manualDiscountSummary.style.display = '';
      if (manualDiscountBeforeEl) manualDiscountBeforeEl.textContent = `GH₵ ${formatMoney(baseTotal)}`;
      if (manualDiscountAmountEl) manualDiscountAmountEl.textContent = `${manualAdjustmentSign()} GH₵ ${formatMoney(discAmt)}`;
      if (manualDiscountAmountLabel) manualDiscountAmountLabel.textContent = manualAdjustmentKind() === 'premium' ? 'Premium:' : 'Discount:';

      if (clearManualDiscountBtn) clearManualDiscountBtn.style.display = '';
    } else {
      if (manualDiscountSummary) manualDiscountSummary.style.display = 'none';
      if (clearManualDiscountBtn) clearManualDiscountBtn.style.display = 'none';
    }
  }


  function isoDate(d) {
    const dt = d ? new Date(d) : new Date();
    const yr = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yr}-${mm}-${dd}`;
  }

  // show active preset style
  function setActivePreset(activeBtn) {
    const presets = [presetTodayBtn, presetYesterdayBtn, presetThisWeekBtn].filter(Boolean);
    presets.forEach(btn => {
      if (!btn) return;
      if (btn === activeBtn) {
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-primary');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline-secondary');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
  }

  function subUnitsOnlyFromLabel(selectionLabel) {
    if (!selectionLabel) return '';
    const parts = selectionLabel.split(/\s*\+\s*/);
    const subs = parts.map(part => {
      const idx = part.indexOf(':');
      if (idx >= 0) {
        return part.slice(idx + 1).trim();
      }
      return part.trim();
    }).filter(Boolean);
    return subs.join(', ');
  }

  // Alerts modal (lazy) - dark-surface friendly
  function showAlertModal(message, title = 'Notice') {
    let modalEl = document.getElementById('genericAlertModal');
    if (!modalEl) {
      const html = `
<div class="modal fade" id="genericAlertModal" tabindex="-1" aria-labelledby="genericAlertModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="genericAlertModalLabel"></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body" id="genericAlertModalBody"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-light-custom" data-bs-dismiss="modal">OK</button>
      </div>
    </div>
  </div>
</div>`;
      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      modalEl = document.getElementById('genericAlertModal');
    }
    try {
      const titleEl = modalEl.querySelector('#genericAlertModalLabel');
      const bodyEl = modalEl.querySelector('#genericAlertModalBody');
      if (titleEl) titleEl.textContent = title || 'Notice';
      if (bodyEl) {
        bodyEl.textContent = String(message || '');
        bodyEl.style.whiteSpace = 'pre-line';
      }
      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      inst.show();
    } catch (err) {
      try { alert(message); } catch (e) { console.error('alert fallback failed', e); }
    }
  }

  // Order success modal (lazy) - dark-surface friendly
  function showOrderSuccessModal(orderId, total, jobNote) {
    let modalEl = document.getElementById('orderSuccessModal');
    if (!modalEl) {
      const html = `
<div class="modal fade" id="orderSuccessModal" tabindex="-1" aria-labelledby="orderSuccessModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="orderSuccessModalLabel">Order created</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body">
        <p id="orderSuccessBody">Order created successfully.</p>
        <p class="small text-muted">Use the order ID at payment.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline-light-custom" type="button" id="copyOrderIdBtn" title="Copy order ID">Copy Order ID</button>
        <button class="btn btn-outline-primary" type="button" id="printOrderBtn" title="Print order">Print</button>
        <button class="btn btn-outline-light-custom" data-bs-dismiss="modal" type="button">Close</button>
      </div>
    </div>
  </div>
</div>`;
      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      modalEl = document.getElementById('orderSuccessModal');
    }

    const body = modalEl.querySelector('#orderSuccessBody');
    if (body) {
      const cleanNote = String(jobNote || '').trim();
      body.innerHTML = `
        <strong>Order ID:</strong> <span id="orderSuccessId">${escapeHtml(orderId || '')}</span> <br/>
        <strong>Total:</strong> GH₵ <span id="orderSuccessTotal">${formatMoney(total)}</span>
        ${cleanNote ? `<br/><strong>Note / Job Type:</strong> <span id="orderSuccessJobNote">${escapeHtml(cleanNote)}</span>` : ''}
      `;
    }

    const copyBtn = modalEl.querySelector('#copyOrderIdBtn');
    const printBtn = modalEl.querySelector('#printOrderBtn');

    function fallbackCopyTextToClipboard(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); try { window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch (_) {} } catch (e) { alert('Copy failed â€” select and copy: ' + text); }
      document.body.removeChild(ta);
    }

    function copyOrderId() {
      const idEl = modalEl.querySelector('#orderSuccessId');
      const idText = idEl ? idEl.textContent.trim() : (orderId || '');
      if (!idText) return alert('No order ID');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(idText).then(() => { try { window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch (_) {} }).catch(() => fallbackCopyTextToClipboard(idText));
      } else {
        fallbackCopyTextToClipboard(idText);
      }
    }

    function printOrder() {
      const idEl = modalEl.querySelector('#orderSuccessId');
      const totalEl = modalEl.querySelector('#orderSuccessTotal');
      const noteEl = modalEl.querySelector('#orderSuccessJobNote');
      const idText = idEl ? idEl.textContent.trim() : (orderId || '');
      const totalText = totalEl ? totalEl.textContent.trim() : (formatMoney(total));
      const noteText = noteEl ? noteEl.textContent.trim() : String(jobNote || '').trim();
      const w = window.open('', '_blank', 'toolbar=0,location=0,menubar=0');
      if (!w) {
        alert('Unable to open print window (blocked). Please copy order ID and print manually.');
        return;
      }
      const doc = w.document;
      const title = 'Order ' + (idText || '');
      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111; }
          .wrap { max-width: 560px; margin: 0 auto; text-align: center; }
          .logo { max-height: 80px; margin-bottom: 12px; display: inline-block; }
          h1 { font-size: 20px; margin-bottom: 8px; }
          p { margin: 6px 0; }
          .muted { color: #666; font-size: 13px; }
          .details { text-align: left; display: inline-block; margin-top: 12px; }
        </style>
        </head><body>
        <div class="wrap">
          <img class="logo" src="/public/images/AHAD LOGO.png" alt="AHAD" />
          <h1>Order Created</h1>
          <div class="details">
            <p><strong>Order ID:</strong> ${escapeHtml(idText)}</p>
            <p><strong>Total:</strong> GH₵ ${escapeHtml(totalText)}</p>
            ${noteText ? `<p><strong>Note / Job Type:</strong> ${escapeHtml(noteText)}</p>` : ''}
            <p class="muted">Show this ID at payment.</p>
          </div>
          <p class="small-note">Printed from Ahad POS.</p>
        </div>
        </body></html>`);
      doc.close();
      w.focus();
      const onLoadPrint = () => {
        try { w.print(); } catch (e) { alert('Print failed â€” try copying the order ID.'); }
        setTimeout(()=>{ try { w.close(); } catch (e){} }, 700);
      };
      if (w.document.readyState === 'complete') onLoadPrint(); else { w.onload = onLoadPrint; setTimeout(onLoadPrint, 800); }
    }

    if (copyBtn && !copyBtn._bound) { copyBtn._bound = true; copyBtn.addEventListener('click', copyOrderId); }
    if (printBtn && !printBtn._bound) { printBtn._bound = true; printBtn.addEventListener('click', printOrder); }

    try { const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl); inst.show(); } catch (err) { alert(`Order created: ${orderId}\nTotal: GH₵ ${formatMoney(total)}${jobNote ? `\nNote / Job Type: ${jobNote}` : ''}`); }
  }

// ---------- Price rules rendering ----------
// Renders `prices` array into #pricesList
function renderPrices(bookMode = false) {
  // If not in book preview mode, require an explicit service selection before rendering
  const serviceSelected = (typeof serviceSelect !== 'undefined' && serviceSelect && serviceSelect.value);
  if (!bookMode && !serviceSelected) {
    pricesList.innerHTML = '<p class="text-muted">Select a service to load price rules.</p>';
    return;
  }

  if (!prices || !prices.length) {
    pricesList.innerHTML = '<p class="text-muted">No price rules found for selected service.</p>';
    return;
  }

  const container = document.createElement('div');
  container.className = 'list-group';
  prices.forEach(p => {
    const row = document.createElement('div');
    row.className = 'list-group-item d-flex align-items-center gap-3 flex-nowrap';
    const isColorRule = (p && p.__tone === 'color');
    const isBwRule = (p && p.__tone === 'bw');
    const toneClass = isColorRule ? 'text-danger' : (isBwRule ? 'text-dark' : '');
    const tonePriceClass = isColorRule ? 'text-danger' : (isBwRule ? 'text-dark' : 'text-white');

    // left: label (only subunits)
    const left = document.createElement('div');
    left.className = 'flex-grow-1 text-truncate';
    const subOnly = subUnitsOnlyFromLabel(p.selectionLabel || '');
    const label = document.createElement('div');
    label.innerHTML = `<strong class="d-inline-block text-truncate ${toneClass}" style="max-width:420px;">${escapeHtml(subOnly)}</strong>`;
    left.appendChild(label);

    const hasBackPrice = (p.price2 !== null && p.price2 !== undefined && !isNaN(Number(p.price2)));
    const frontPrice = Number(p.unitPrice || 0);
    const backPrice = hasBackPrice ? Number(p.price2) : null;
    const priceLine = document.createElement('div');
    priceLine.className = 'small text-muted-light mt-1';
    if (hasBackPrice) {
      priceLine.innerHTML = `Front: <strong class="${tonePriceClass}">GH₵ ${formatMoney(frontPrice)}</strong> <span class="mx-1">|</span> F/B: <strong class="${tonePriceClass}">GH₵ ${formatMoney(backPrice)}</strong>`;
    } else {
      priceLine.innerHTML = `Price: <strong class="${tonePriceClass}">GH₵ ${formatMoney(frontPrice)}</strong>`;
    }
    left.appendChild(priceLine);

    // middle: qty input, FB checkbox (only if printer required), optional printer + spoiled inputs
    const mid = document.createElement('div');
    mid.className = 'd-flex align-items-center gap-2 flex-nowrap';

    // inside price rule render block (printing service only)



    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.className = 'form-control form-control-sm pages-input';
    input.placeholder = serviceRequiresPrinter ? 'Pages' : 'Qty';
    input.style.width = serviceRequiresPrinter ? '72px' : '90px';
    mid.appendChild(input);
    
    // factor input (only if printer required)
    if (serviceRequiresPrinter) {
    const factorInput = document.createElement('input');
    factorInput.type = 'number';
    factorInput.min = '1';
    factorInput.step = '1';
    factorInput.value = '';
    factorInput.className = 'form-control form-control-sm factor-input';
    factorInput.placeholder = 'QTY';
    factorInput.style.width = '63px';
    mid.appendChild(factorInput);
    }

    

    // F/B checkbox only for services that require a printer
    let fbInput = null;
    if (serviceRequiresPrinter) {
      const fbWrap = document.createElement('div');
      fbWrap.className = 'form-check form-check-inline ms-1';
      fbInput = document.createElement('input');
      fbInput.type = 'checkbox';
      fbInput.className = 'form-check-input fb-checkbox';
      fbInput.id = `fb-${String(p._id)}`;
      fbInput.setAttribute('data-prid', p._id);
      const fbLabel = document.createElement('label');
      fbLabel.className = 'form-check-label small';
      fbLabel.htmlFor = fbInput.id;
      fbLabel.textContent = 'F/B';
      fbWrap.appendChild(fbInput);
      fbWrap.appendChild(fbLabel);
      mid.appendChild(fbWrap);
    }

    // printer select (if serviceRequiresPrinter)
    if (serviceRequiresPrinter) {
      const printerWrap = document.createElement('div');
      printerWrap.className = 'd-flex align-items-center';
      const sel = document.createElement('select');
      sel.className = 'form-select form-select-sm printer-select';
      sel.style.width = '145px';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = '-- Select printer --';
      sel.appendChild(defaultOpt);

      if (printers && printers.length) {
        printers.forEach(pr => {
          const o = document.createElement('option');
          o.value = pr._id;
          o.textContent = pr.name || pr._id;
          sel.appendChild(o);
        });
      } else {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = 'No printers available';
        sel.appendChild(o);
        sel.disabled = true;
      }
      printerWrap.appendChild(sel);
      mid.appendChild(printerWrap);

      // SPOILED input
      const spoiledWrap = document.createElement('div');
      spoiledWrap.className = 'd-flex align-items-center';
      const spoiledInput = document.createElement('input');
      spoiledInput.type = 'number';
      spoiledInput.min = '0';
      spoiledInput.step = '1';
      spoiledInput.value = '';
      spoiledInput.placeholder = 'Jammed';
      spoiledInput.setAttribute('aria-label', 'Spoiled count');
      spoiledInput.className = 'form-control form-control-sm spoiled-input';
      spoiledInput.style.width = '72px';
      spoiledInput.title = 'Spoiled count';
      spoiledWrap.appendChild(spoiledInput);
      mid.appendChild(spoiledWrap);
    }

    // right: apply button
    const right = document.createElement('div');
    right.className = 'ms-auto';
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-primary apply-price-btn';
    btn.type = 'button';
    btn.dataset.prId = p._id;
    btn.textContent = bookMode ? 'Add Book Item' : 'Apply';
    right.appendChild(btn);

    row.appendChild(left);
    row.appendChild(mid);
    row.appendChild(right);
    container.appendChild(row);
  });

  pricesList.innerHTML = '';
  pricesList.appendChild(container);
}

  // ---------- Load price rules for service ----------
  async function loadPricesForService(serviceId) {
    if (!serviceId) {
      prices = [];
      serviceRequiresPrinter = false;
      printers = [];
      renderPrices();
      return;
    }
    pricesList.innerHTML = '<div class="text-muted">Loading price rulesâ€¦</div>';
    try {
      const cat = getActiveCustomerCategory();
      const url = `/admin/services/${encodeURIComponent(serviceId)}/prices${cat ? `?customerCategory=${encodeURIComponent(cat)}` : ''}`;
      const res = await fetch(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j && j.error) ? j.error : 'Failed to load price rules');
      }
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'No data returned');
      prices = (j.prices || []).map(x => ({
        _id: x._id,
        key: x.key || null,
        selections: Array.isArray(x.selections) ? x.selections : [],
        selectionLabel: x.selectionLabel,
        customLabel: x.customLabel || '',
        ruleTone: x.ruleTone || 'other',
        unitPrice: Number(x.unitPrice),
        price2: (x.price2 !== null && x.price2 !== undefined) ? Number(x.price2) : null,
        serviceId: String(serviceId),
        __tone: resolvePriceRuleTone(x, serviceToneIndex[String(serviceId)] || 'other')
      }));
      serviceRequiresPrinter = !!j.serviceRequiresPrinter;
      printers = (j.printers || []).map(p => ({ _id: p._id, name: p.name }));
      renderPrices();
    } catch (err) {
      console.error('loadPricesForService err', err);
      pricesList.innerHTML = `<p class="text-danger small">Error loading price rules.</p>`;
    }
  }
  async function loadPricesForServiceGroup(serviceIdsCsv) {
    const ids = String(serviceIdsCsv || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (!ids.length) {
      prices = [];
      serviceRequiresPrinter = false;
      printers = [];
      renderPrices();
      return;
    }

    pricesList.innerHTML = '<div class="text-muted">Loading price rules…</div>';
    try {
      const all = await Promise.all(ids.map(async (sid) => {
        const cat = getActiveCustomerCategory();
        const url = `/admin/services/${encodeURIComponent(sid)}/prices${cat ? `?customerCategory=${encodeURIComponent(cat)}` : ''}`;
        const res = await fetch(url, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error((j && j.error) ? j.error : 'Failed to load price rules');
        }
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || 'No data returned');
        return {
          sid,
          prices: Array.isArray(j.prices) ? j.prices : [],
          serviceRequiresPrinter: !!j.serviceRequiresPrinter,
          printers: Array.isArray(j.printers) ? j.printers : []
        };
      }));

      const mergedPrices = [];
      const printerMap = new Map();
      serviceRequiresPrinter = false;

      all.forEach(item => {
        if (item.serviceRequiresPrinter) serviceRequiresPrinter = true;
        item.printers.forEach(p => {
          const key = String(p._id);
          if (!printerMap.has(key)) printerMap.set(key, { _id: p._id, name: p.name });
        });

        item.prices.forEach(x => {
          const toneFromService = serviceToneIndex[String(item.sid)] || 'other';
          mergedPrices.push({
            _id: x._id,
            key: x.key || null,
            selections: Array.isArray(x.selections) ? x.selections : [],
            selectionLabel: x.selectionLabel,
            customLabel: x.customLabel || '',
            ruleTone: x.ruleTone || 'other',
            unitPrice: Number(x.unitPrice),
            price2: (x.price2 !== null && x.price2 !== undefined) ? Number(x.price2) : null,
            serviceId: String(item.sid),
            __tone: resolvePriceRuleTone(x, toneFromService)
          });
        });
      });

      prices = mergedPrices;
      printers = Array.from(printerMap.values());
      renderPrices();
    } catch (err) {
      console.error('loadPricesForServiceGroup err', err);
      pricesList.innerHTML = '<p class="text-danger small">Error loading merged service price rules.</p>';
    }
  }

  // load book preview (converts book items into a prices array for preview)
  async function loadBookPreview(bookId) {
    if (!bookId) {
      // clear preview -> revert to service prices load or blank
      prices = [];
      serviceRequiresPrinter = false;
      printers = [];
      renderPrices();
      return;
    }
    try {
      const res = await fetch(`/books/${encodeURIComponent(bookId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error('Failed to fetch book');
      const j = await res.json().catch(()=>null);
      if (!j || !j.book) throw new Error('Invalid book data');
      const book = j.book;
      // map book items to a synthetic prices array for preview/add
      prices = (book.items || []).map((bi, idx) => ({
        _id: `${book._id}::${idx}`,
        selectionLabel: bi.selectionLabel || '',
        unitPrice: Number(bi.unitPrice || 0),
        price2: null,
        __bookItem: {
          serviceId: bi.service,
          priceRuleId: bi.priceRule,
          pages: bi.pages,
          fb: !!bi.fb,
          printer: bi.printer || null,
          spoiled: bi.spoiled || 0,
          subtotal: Number(bi.subtotal || 0)
        }
      }));
      // conservative: if any item has a printer specified, treat preview as printer-bound
      serviceRequiresPrinter = prices.some(p => p.__bookItem && p.__bookItem.printer);
      printers = []; // optional: fetch printers for preview if you want richer UI
      renderPrices(true);
    } catch (err) {
      console.error('loadBookPreview err', err);
      prices = [];
      renderPrices();
    }
  }

  // Add a book to cart by id and quantity
  async function addBookToCartById(bookId, qty) {
    if (!bookId) return;
    try {
      const res = await fetch(`/books/${encodeURIComponent(bookId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error('Failed to fetch book details');
      const j = await res.json().catch(()=>null);
      if (!j || !j.book) throw new Error('Invalid book data');
      const book = j.book;
      const quantity = Number(qty) || 1;
      const unitPrice = Number(book.unitPrice || 0);
      const subtotal = Number((unitPrice * quantity).toFixed(2));

      // prepare internal bookItems snapshot (used for expansion at order time)
      const bookItems = (book.items || []).map(it => ({
        serviceId: it.service,
        priceRuleId: it.priceRule,
        pagesOriginal: Number(it.pages || 1),
        fb: !!it.fb,
        printerId: it.printer || null,
        spoiled: Number(it.spoiled || 0),
        unitPrice: Number(it.unitPrice || 0),
        subtotal: Number(it.subtotal || 0),
        selectionLabel: it.selectionLabel || ''
      }));

      cart.push({
        isBook: true,
        bookId: book._id,
        bookName: book.name,
        unitPrice,
        qty: quantity,
        subtotal,
        bookItems
      });
      renderCart();
      if (typeof showGlobalToast === 'function') showGlobalToast('Book added to cart', 1600);
    } catch (err) {
      console.error('addBookToCartById err', err);
      showAlertModal('Failed to add book to cart');
    }
  }

// ---------- Add single price rule to cart ----------
function addToCart({
  serviceId,
  serviceName,
  priceRuleId,
  label,
  unitPrice,
  pages,
  factor,          // NEW (optional)
  fb,
  printerId,
  spoiled,
  tone
}) {
  const origPages = Number(pages) || 1;
  const factorVal = Number(factor) && Number(factor) > 0 ? Number(factor) : 1;

  spoiled = Math.max(0, Math.floor(Number(spoiled) || 0));

  // effective quantity used for price calculation (existing logic)
  const effectiveQty = fb ? Math.ceil(origPages / 2) : origPages;

  // subtotal logic:
  // - printing service â†’ unitPrice Ã— effectiveQty Ã— factor
  // - non-printing service â†’ unitPrice Ã— effectiveQty
  const subtotal = Number(
    (
      Number(unitPrice) *
      effectiveQty *
      (printerId ? factorVal : 1)
    ).toFixed(2)
  );

  cart.push({
    isBook: false,
    serviceId,
    serviceName,
    priceRuleId,
    selectionLabel: label,
    unitPrice: Number(unitPrice),

    // what we show in cart
    pages: effectiveQty,

    // original user input (server uses this)
    pagesOriginal: origPages,

    // NEW: factor only meaningful for printing services
    factor: printerId ? factorVal : null,

    subtotal,
    fb: !!fb,
    printerId: printerId || null,
    spoiled,
    tone: tone || 'other'
  });

  renderCart();
}

  // ---------- Render cart ----------
  function renderCart() {
    cartTbody.innerHTML = '';
  if (!cart.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="text-muted" colspan="5">Cart is empty.</td>';
    cartTbody.appendChild(tr);
    cartTotalEl.textContent = 'GH₵ 0.00';
    orderNowBtn.disabled = true;
    updateSaveDraftBtn();

    // âœ… ensure breakdown under totals is hidden when cart empties
    if (manualDiscountSummary) manualDiscountSummary.style.display = 'none';
    if (clearManualDiscountBtn) clearManualDiscountBtn.style.display = 'none';

    return;
  }
    let total = 0;
    cart.forEach((it, idx) => {
      total += it.subtotal;
      const tr = document.createElement('tr');
      tr.dataset.idx = idx;

      let displayLabel = '';
      if (it.isBook) {
        displayLabel = `<div class="small text-muted">Book</div><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px;">${escapeHtml(it.bookName)}</div>`;
      } else {
        const toneClass = (it.tone === 'color') ? 'text-danger' : '';
        displayLabel = `<div class="small text-muted">${escapeHtml(it.serviceName || '')}</div><div class="${toneClass}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px;">${escapeHtml(it.selectionLabel || '')}${(it.spoiled && it.spoiled>0) ? '<br/><small class="text-danger">Spoiled: '+String(it.spoiled)+'</small>' : ''}</div>`;
      }

      let qtyCell = '';
      let factorCell = '';
      let pagesCell = '';

      if (it.isBook) {
        qtyCell = String(it.qty);
        factorCell = '';
        pagesCell = '';
      } else if (it.printerId) {
  // printer service:
  // - QTY column shows factor (copies)
  // - Sheets column should be effective sheets = effectiveQty * factor
  // - Pages column shows raw pages entered
  const f = it.factor ? Number(it.factor) : 1;
  const effectiveQty = Number(it.pages) || 0;           // this is already "effectiveQty" (FB aware)
  const sheets = Math.max(0, Math.floor(effectiveQty * (isNaN(f) ? 1 : f)));

  qtyCell = String(isNaN(f) ? 1 : f);
  factorCell = String(sheets);                          // âœ… Sheets
  pagesCell = String(it.pagesOriginal);                 // raw pages
} else {
        // normal service
        qtyCell = String(it.pages);
        factorCell = '';
        pagesCell = '';
      }

      tr.innerHTML = `
        <td>${displayLabel}</td>
        <td class="text-center">${escapeHtml(pagesCell)}</td>
        <td class="text-center">${escapeHtml(qtyCell)}</td>
        <td class="text-center">${escapeHtml(factorCell)}</td>
        <td class="text-end">GH₵ ${formatMoney(it.unitPrice)}</td>
        <td class="text-end">GH₵ ${formatMoney(it.subtotal)}</td>
        <td class="text-center"><button class="btn btn-sm btn-outline-danger remove-cart-btn" type="button">Remove</button></td>
      `;
      cartTbody.appendChild(tr);
    });
    // existing:
    // cartTotalEl.textContent = 'GH₵ ' + total.toFixed(2);

    // NEW: apply admin manual discount (client-only)
    const baseTotal = Number(total.toFixed(2));
    const discAmt = (window._isAdmin && manualDiscount) ? computeManualDiscountAmount(baseTotal, manualDiscount) : 0;
    const signedAdjustment = (manualAdjustmentKind() === 'premium') ? (-discAmt) : discAmt;
    const finalTotal = Number(Math.max(0, baseTotal - signedAdjustment).toFixed(2));

    // show final in main total
    cartTotalEl.textContent = 'GH₵ ' + finalTotal.toFixed(2);

    // update the manual discount summary box
    updateManualDiscountUI(baseTotal);
    orderNowBtn.disabled = false;
    updateSaveDraftBtn();
  }

  // Admin-only apply discount
  if (window._isAdmin && applyManualDiscountBtn) {
    applyManualDiscountBtn.addEventListener('click', function () {
      if (!cart || !cart.length) return showAlertModal('Add items to cart before applying discount.');

      const mode = manualDiscountMode ? manualDiscountMode.value : 'amount';
      const kind = manualAdjustmentType ? String(manualAdjustmentType.value || 'discount').toLowerCase() : 'discount';
      const v = manualDiscountValue ? Number(manualDiscountValue.value) : 0;

      if (!isFinite(v) || v <= 0) {
        return showAlertModal(`Enter a valid ${kind === 'premium' ? 'premium' : 'discount'} value (> 0).`);
      }

      if (mode === 'percent' && v > 100) {
        return showAlertModal(`Percentage ${kind === 'premium' ? 'premium' : 'discount'} cannot exceed 100%.`);
      }

      manualDiscount = { kind: (kind === 'premium' ? 'premium' : 'discount'), mode, value: Number(v) };
      renderCart(); // refresh totals + summary
      showAlertModal(
        `Manual ${kind === 'premium' ? 'premium' : 'discount'} applied for this order.`,
        kind === 'premium' ? 'Premium' : 'Discount'
      );
    });
  }

  // Admin-only remove discount
  if (window._isAdmin && clearManualDiscountBtn) {
    clearManualDiscountBtn.addEventListener('click', function () {
      manualDiscount = null;
      if (manualDiscountValue) manualDiscountValue.value = '';
      if (manualAdjustmentType) manualAdjustmentType.value = 'discount';
      refreshManualAdjustmentButton();
      renderCart();
      showAlertModal('Manual adjustment removed.', 'Adjustment');
    });
  }

  if (window._isAdmin && manualAdjustmentType) {
    manualAdjustmentType.addEventListener('change', function () {
      refreshManualAdjustmentButton();
      if (manualDiscount && typeof manualDiscount === 'object') {
        manualDiscount.kind = (String(this.value || '').toLowerCase() === 'premium') ? 'premium' : 'discount';
        renderCart();
      }
    });
  }

  refreshManualAdjustmentButton();


  // ---------- Event delegation: Apply / Add buttons ----------
  pricesList.addEventListener('click', async function (e) {
    const btn = e.target.closest('.apply-price-btn');
    if (!btn) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Adding...';
    try {
    const prId = btn.dataset.prId;
    const serviceId = serviceSelect ? serviceSelect.value : null;
    const priceObj = prices.find(p => String(p._id) === String(prId));
    if (!priceObj) return showAlertModal('Price rule not found');

    const row = btn.closest('.list-group-item');
    const pagesInput = row ? row.querySelector('.pages-input') : null;
    const pages = pagesInput && pagesInput.value ? Number(pagesInput.value) : 1;

    let factor = 1;
    if (serviceRequiresPrinter) {
      const factorInput = row ? row.querySelector('.factor-input') : null;
      if (factorInput && factorInput.value !== '') {
        const f = Number(factorInput.value);
        factor = (!isNaN(f) && f > 0) ? f : 1;
      }
    }


    const fbCheckbox = row ? row.querySelector('.fb-checkbox') : null;
    const fbChecked = fbCheckbox ? fbCheckbox.checked : false;

    let selectedPrinterId = null;
    if (serviceRequiresPrinter) {
      const printerSelect = row ? row.querySelector('.printer-select') : null;
      selectedPrinterId = printerSelect ? (printerSelect.value || null) : null;
      if (!selectedPrinterId) {
        showAlertModal('This service requires a printer. Please choose a printer before adding to cart.', 'Printer required');
        return;
      }
    }

    let spoiled = 0;
    const spoiledInput = row ? row.querySelector('.spoiled-input') : null;
    if (spoiledInput && spoiledInput.value !== undefined && spoiledInput.value !== null && String(spoiledInput.value).trim() !== '') {
      const n = Number(spoiledInput.value);
      spoiled = (isNaN(n) || n < 0) ? 0 : Math.floor(n);
    }

        // ---------- MATERIAL STOCK CHECKS (Apply-time) ----------
    // Only for normal service price rules (not book preview synthetic rules)
    // because only normal rules have selections coming from /admin/services/:id/prices
    if (!priceObj.__bookItem) {
      // Always refresh material stock occasionally so we don't rely on stale remaining values
      await refreshMaterialsIfStale(false);

      // compute count exactly like controllers/orders.js material logic:
      // baseCount = fb ? ceil(pages/2) : pages; count = baseCount + spoiled
      const pgs = Math.max(1, Math.floor(Number(pages) || 1));
      const baseCount = fbChecked ? Math.ceil(pgs / 2) : pgs;
      const spoiledCount = Math.max(0, Math.floor(Number(spoiled) || 0));

      // factor only meaningful for printing services
      const factorMul = serviceRequiresPrinter ? Math.max(1, Math.floor(Number(factor) || 1)) : 1;

      // âœ… match server: (baseCount + spoiled) Ã— factor
      const countNeeded = (Math.max(0, baseCount) + spoiledCount) * factorMul;

      // If materials cache isn't loaded, skip checks (donâ€™t block order flow)
      if (materialsLoaded && Array.isArray(materials) && materials.length) {
        const ruleSelections = Array.isArray(priceObj.selections) ? priceObj.selections : [];

        // Find all materials whose selection-set is a subset of this rule selections
        const matched = materials.filter(m => materialMatchesPriceRule(m.selections || [], ruleSelections));

        if (matched.length) {
          const blocks = [];
          const warns = [];

          matched.forEach(m => {
            const stocked = Number(m.stocked || 0);
            const remaining = Number(m.remaining || 0);

            if (remaining <= 0) {
              blocks.push(`"${m.name}" is out of stock (Remaining: 0).Contact admin to restock.`);
              return;
            }

            if (countNeeded > remaining) {
              blocks.push(`"${m.name}" insufficient stock (Needed: ${countNeeded}, Remaining: ${remaining}). Contact admin to restock.`);
              return;
            }

            // warn when remaining < 10% of stocked (only if stocked > 0)
            if (stocked > 0) {
              const ratio = remaining / stocked;
              if (ratio < 0.10) {
                warns.push(`Low stock warning: "${m.name}" remaining is below 10% (Remaining: ${remaining} of ${stocked}).`);
              }
            }
          });

          if (blocks.length) {
            showAlertModal(blocks.join('\n'), 'Stock unavailable');
            return; // âœ… block adding to cart
          }

          if (warns.length) {
            showAlertModal(warns.join('\n'), 'Low stock');
            // âœ… allow add to cart after warning
          }
        }
      }
    }


    // If a book preview item (bookMode) has __bookItem metadata, add either an underlying item or treat specially.
    if (priceObj.__bookItem) {
      // Treat this as adding the underlying item as a normal cart item (keeps behavior intuitive)
      addToCart({
        serviceId: priceObj.__bookItem.serviceId,
        serviceName: '', // not always available in preview; the server will reconcile names for display
        priceRuleId: priceObj.__bookItem.priceRuleId,
        label: subUnitsOnlyFromLabel(priceObj.selectionLabel || ''),
        unitPrice: Number(priceObj.unitPrice || 0),
        pages: pages,
        factor,
        fb: fbChecked,
        printerId: selectedPrinterId || priceObj.__bookItem.printer,
        spoiled,
        tone: priceObj.__tone || serviceToneFromText(priceObj.selectionLabel || '')
      });
    } else {
      // Normal service price add
      const serviceName = (serviceSelect && serviceSelect.options[serviceSelect.selectedIndex]) ? (serviceSelect.options[serviceSelect.selectedIndex].text || '') : '';
      // choose unitPrice: price2 if FB and available, else price
      let chosenPrice = Number(priceObj.unitPrice);
      if (fbChecked && priceObj.price2 !== null && priceObj.price2 !== undefined) {
        chosenPrice = Number(priceObj.price2);
      }
      const effectiveServiceId = priceObj.serviceId || serviceId;
      addToCart({ serviceId: effectiveServiceId, serviceName, priceRuleId: prId, label: subUnitsOnlyFromLabel(priceObj.selectionLabel || ''), unitPrice: chosenPrice, pages, factor, fb: fbChecked, printerId: selectedPrinterId, spoiled, tone: priceObj.__tone || serviceToneFromText(priceObj.selectionLabel || '') });
    }

    // clear inputs
    try {
      if (pagesInput) pagesInput.value = '';
      const factorInput = row ? row.querySelector('.factor-input') : null;
      if (factorInput) factorInput.value = '';
      if (fbCheckbox) { fbCheckbox.checked = false; }
      const printerSelect = row ? row.querySelector('.printer-select') : null;
      if (printerSelect) { printerSelect.selectedIndex = 0; }
      if (spoiledInput) spoiledInput.value = '';
    } catch (err) {
      console.warn('Failed to clear inputs after Apply', err);
    }

    if (typeof showGlobalToast === 'function') showGlobalToast('Added to cart', 1600);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // remove from cart
  cartTbody.addEventListener('click', function (e) {
    const btn = e.target.closest('.remove-cart-btn');
    if (!btn) return;
    const tr = btn.closest('tr');
    const idx = Number(tr.dataset.idx);
    if (!isNaN(idx)) {
      cart.splice(idx, 1);
      renderCart();
      if (typeof showGlobalToast === 'function') showGlobalToast('Removed from cart', 1200);
    }
  });

  // ---------- showAddBookModal ----------
  function showAddBookModal(bookId) {
    // Create or reuse modal HTML
    let modalEl = document.getElementById('addBookModal');
    if (!modalEl) {
      const html = `
<div class="modal fade" id="addBookModal" tabindex="-1" aria-labelledby="addBookModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-sm modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="addBookModalLabel">Add Service to Cart</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body">
        <div id="addBookModalBody">
          <div class="mb-2"><strong id="addBookName"></strong></div>
          <div class="mb-2 small text-muted">Unit Price: GH₵ <span id="addBookUnitPrice">0.00</span></div>
          <div class="mb-3">
            <label class="form-label small mb-1">Quantity</label>
            <input type="number" min="1" value="1" class="form-control form-control-sm" id="addBookQty" />
          </div>
          <div id="addBookPreview" class="small text-muted"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline-light-custom btn-sm" data-bs-dismiss="modal" type="button">Cancel</button>
        <button class="btn btn-primary btn-sm" id="confirmAddBookBtn" type="button">Add to Cart</button>
      </div>
    </div>
  </div>
</div>
`;
      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      modalEl = document.getElementById('addBookModal');
    }

    const modalInst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

    // Fill in book name/price from cached `books` if available
    const bookMeta = books.find(b => String(b._id) === String(bookId));
    const nameEl = modalEl.querySelector('#addBookName');
    const priceEl = modalEl.querySelector('#addBookUnitPrice');
    const qtyEl = modalEl.querySelector('#addBookQty');
    const previewEl = modalEl.querySelector('#addBookPreview');
    const confirmBtn = modalEl.querySelector('#confirmAddBookBtn');

    if (bookMeta) {
      if (nameEl) nameEl.textContent = bookMeta.name || '';
      if (priceEl) priceEl.textContent = formatMoney(bookMeta.unitPrice || 0);
      if (previewEl) previewEl.textContent = `This will add all price rules included in "${bookMeta.name}" multiplied by the quantity you enter. Each underlying rule will be posted to the server separately when placing the order.`;
    } else {
      if (nameEl) nameEl.textContent = 'Loading...';
      if (priceEl) priceEl.textContent = '0.00';
      if (previewEl) previewEl.textContent = '';
      fetch(`/books/${encodeURIComponent(bookId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(r => r.ok ? r.json().catch(()=>null) : null)
        .then(j => {
          if (j && j.book) {
            if (nameEl) nameEl.textContent = j.book.name || '';
            if (priceEl) priceEl.textContent = formatMoney(Number(j.book.unitPrice || 0));
            if (previewEl) previewEl.textContent = `This will add all price rules included in "${j.book.name}" multiplied by the quantity you enter. Each underlying rule will be posted to the server separately when placing the order.`;
          } else {
            if (nameEl) nameEl.textContent = '(book)';
          }
        }).catch(()=>{ if (nameEl) nameEl.textContent = '(book)'; });
    }

    function cleanup() {
      if (confirmBtn && confirmBtn._bound) {
        confirmBtn.removeEventListener('click', confirmHandler);
        confirmBtn._bound = false;
      }
      modalEl.removeEventListener('hidden.bs.modal', onHidden);
    }

    async function confirmHandler() {
      const qty = Number(qtyEl && qtyEl.value ? qtyEl.value : 1) || 1;
      // call existing addBookToCartById to keep behavior identical (it fetches book details and stores bookItems)
      await addBookToCartById(bookId, qty);
      // Reset dropdown back to default and reload service prices (so UI doesn't stay in preview)
      try {
        if (serviceSelect && serviceSelect.value) loadPricesForService(serviceSelect.value);
        else { prices = []; renderPrices(); }
      } catch (e) { /* ignore */ }
      try { modalInst.hide(); } catch (e) {}
    }

    function onHidden() {
      cleanup();
    }

    // bind confirm handler once
    if (confirmBtn && !confirmBtn._bound) {
      confirmBtn.addEventListener('click', confirmHandler);
      confirmBtn._bound = true;
    }

    modalEl.addEventListener('hidden.bs.modal', onHidden);
    qtyEl && (qtyEl.value = '1');
    modalInst.show();
  }

// ---------- Order placement ----------
async function placeOrderFlow() {
  if (!cart || !cart.length) return;

  orderNowBtn.disabled = true;
  const originalText = orderNowBtn.textContent;
  orderNowBtn.textContent = 'Placing...';

  try {
    // Build payload items
    const items = [];

    cart.forEach(line => {
      if (line.isBook) {
        // expand to underlying rules. Multiply raw pages by book quantity
        (line.bookItems || []).forEach(bi => {
          const rawPages =
            (typeof bi.pagesOriginal === 'number'
              ? bi.pagesOriginal
              : Number(bi.pagesOriginal || bi.pages || 1));

          const pagesToSend = rawPages * Number(line.qty || 1);

          items.push({
            serviceId: bi.serviceId,
            priceRuleId: bi.priceRuleId,
            pages: pagesToSend,
            factor: bi.printerId ? (bi.factor || 1) : undefined,
            fb: !!bi.fb,
            printerId: bi.printerId || null,
            spoiled: bi.spoiled || 0
          });
        });
      } else {
        const rawPages =
          (typeof line.pagesOriginal !== 'undefined')
            ? Number(line.pagesOriginal)
            : Number(line.pages || 1);

        items.push({
          serviceId: line.serviceId,
          priceRuleId: line.priceRuleId,
          pages: rawPages,
          factor: line.printerId ? (line.factor || 1) : undefined,
          fb: !!line.fb,
          printerId: line.printerId || null,
          spoiled: line.spoiled || 0
        });
      }
    });

      const payload = {
        items,
        submissionId: getCurrentSubmissionId() || null,
        customerId:
          (document.getElementById('orderCustomerId') &&
           document.getElementById('orderCustomerId').value)
            ? document.getElementById('orderCustomerId').value
            : null
      };
      if (orderJobNoteEl) {
        const jobNote = String(orderJobNoteEl.value || '').trim();
        if (jobNote) payload.jobNote = jobNote;
      }

    // -----------------------------------------
    // Admin-only: manual discount (per order)
    // - applied after cart is built
    // - not saved as config, must be re-applied each order
    // - server remains authoritative (will ignore for non-admin)
    // -----------------------------------------
    try {
        if (window._isAdmin) {
        // This assumes you added the admin-only UI in new.pug and the client-only state:
        // let manualDiscount = null; // { mode:'amount'|'percent', value:number }
        // If manualDiscount is set and valid, attach it.
          if (typeof manualDiscount !== 'undefined' && manualDiscount && typeof manualDiscount === 'object') {
            const kind = String(manualDiscount.kind || 'discount').trim().toLowerCase();
            const mode = String(manualDiscount.mode || '').trim();
            const value = Number(manualDiscount.value);

            const validKind = (kind === 'discount' || kind === 'premium');
            const validMode = (mode === 'amount' || mode === 'percent');
            const validValue = isFinite(value) && value > 0 && (mode !== 'percent' || value <= 100);

            if (validKind && validMode && validValue) {
              payload.manualDiscount = { kind, mode, value: Number(value) };
            }
          }
        }
    } catch (e) {
      // don't block order placement if discount attachment fails
      console.warn('Failed to attach manualDiscount to payload', e);
    }

    const res = await fetch('/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify(payload)
    });

    const j = await res.json().catch(() => null);
    if (!res.ok) {
      // If order failed due to stock, refresh materials so user sees correct state immediately
      await refreshMaterialsIfStale(true);

      // Show richer error if server returned details array (stock pre-check does)
      if (j && j.details && Array.isArray(j.details) && j.details.length) {
        const msg = (j.error ? String(j.error) : 'Order creation failed') + '\n\n' + j.details.join('\n');
        showAlertModal(msg);
      } else {
        showAlertModal((j && j.error) ? j.error : 'Order creation failed');
      }
      return;
    }

    showOrderSuccessModal(j.orderId, j.total, (j && j.jobNote) ? j.jobNote : (orderJobNoteEl ? orderJobNoteEl.value : ''));
    if (typeof showGlobalToast === 'function') {
      showGlobalToast(`Order created: ${j.orderId}`, 3200);
    }

    setSelectedCustomerFromSubmission(null);
    if (submittedCustomerSelect) submittedCustomerSelect.value = '';
    await loadSecretarySubmissions();

    // Stock just changed on the server â€” force refresh so next Apply uses updated remaining
    await refreshMaterialsIfStale(true);

      // Reset cart and discount (discount must be re-applied per order)
      cart = [];
      if (orderJobNoteEl) orderJobNoteEl.value = '';
      // clear any saved draft for this customer after a successful order
    const currentCustomerId = getCurrentCustomerId();
    if (currentCustomerId) clearDraft(currentCustomerId);

    try {
      if (window._isAdmin) {
        if (typeof manualDiscount !== 'undefined') manualDiscount = null;

        const mdValEl = document.getElementById('manualDiscountValue');
        const mdModeEl = document.getElementById('manualDiscountMode');
        const mdTypeEl = document.getElementById('manualAdjustmentType');
        const mdSummaryEl = document.getElementById('manualDiscountSummary');
        const mdClearBtn = document.getElementById('clearManualDiscountBtn');

        if (mdValEl) mdValEl.value = '';
        if (mdModeEl) mdModeEl.value = 'amount';
        if (mdTypeEl) mdTypeEl.value = 'discount';
        if (mdSummaryEl) mdSummaryEl.style.display = 'none';
        if (mdClearBtn) mdClearBtn.style.display = 'none';
        refreshManualAdjustmentButton();
      }
    } catch (e) {
      // ignore
    }

    renderCart();
  } catch (err) {
    console.error('create order err', err);
    showAlertModal('Failed to create order');
  } finally {
    orderNowBtn.disabled = false;
    orderNowBtn.textContent = originalText;
  }
}

  // New "Order Now" handler: check for customer modal as before
  orderNowBtn.addEventListener('click', async function () {
    if (!cart.length) return;

    const submissionId = getCurrentSubmissionId();
    if (!submissionId) {
      showAlertModal('Select a submitted customer/walk-in before placing an order.');
      return;
    }

    await placeOrderFlow();
  });

  if (saveDraftBtn) {
    saveDraftBtn.addEventListener('click', function () {
      const customerId = getCurrentCustomerId();
      if (!customerId) return showAlertModal('Attach a customer before saving a draft.');
      if (!cart || !cart.length) return showAlertModal('Add items to the cart before saving.');
      const ok = writeDraft(customerId, {
        cart,
        manualDiscount,
        savedAt: new Date().toISOString()
      });
      if (ok) {
        if (typeof showGlobalToast === 'function') {
          try { showGlobalToast('Draft saved', 1600); } catch (e) {}
        }
      } else {
        showAlertModal('Failed to save draft (storage error).');
      }
    });
  }

  if (submittedCustomerSelect) {
    submittedCustomerSelect.addEventListener('change', function () {
      const cid = getCurrentCustomerId();
      if (cid) promptLoadDraft(cid);
      updateSaveDraftBtn();
    });
  }

  // ---------- Orders explorer wiring (same behavior as before) ----------
  if (openOrdersExplorerBtn) {
    openOrdersExplorerBtn.addEventListener('click', function () {
      // set default today range
      const today = new Date();
      if (ordersFromEl && ordersToEl) {
        ordersFromEl.value = isoDate(today);
        ordersToEl.value = isoDate(today);
      }
      if (ordersExplorerModal) ordersExplorerModal.show();
      const from = (ordersFromEl && ordersFromEl.value) ? ordersFromEl.value : isoDate(new Date());
      const to = (ordersToEl && ordersToEl.value) ? ordersToEl.value : isoDate(new Date());
      fetchOrdersList(from, to);
    });
  }

  if (presetTodayBtn) presetTodayBtn.addEventListener('click', function () {
    const today = new Date();
    if (ordersFromEl && ordersToEl) { ordersFromEl.value = isoDate(today); ordersToEl.value = isoDate(today); }
    setActivePreset(presetTodayBtn);
  });
  if (presetYesterdayBtn) presetYesterdayBtn.addEventListener('click', function () {
    const d = new Date(); d.setDate(d.getDate() - 1);
    if (ordersFromEl && ordersToEl) { ordersFromEl.value = isoDate(d); ordersToEl.value = isoDate(d); }
    setActivePreset(presetYesterdayBtn);
  });
  if (presetThisWeekBtn) presetThisWeekBtn.addEventListener('click', function () {
    const now = new Date();
    const day = now.getDay(); // 0..6
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    if (ordersFromEl && ordersToEl) { ordersFromEl.value = isoDate(monday); ordersToEl.value = isoDate(now); }
    setActivePreset(presetThisWeekBtn);
  });

  if (fetchOrdersBtn) {
    fetchOrdersBtn.addEventListener('click', function () {
      const from = ordersFromEl.value || isoDate(new Date());
      const to = ordersToEl.value || isoDate(new Date());
      if (new Date(from) > new Date(to)) {
        alert('From date cannot be after To date');
        return;
      }
      fetchOrdersList(from, to);
    });
  }

  // ---------- Fetch orders list used by explorer ----------
  async function fetchOrdersList(from, to) {
    try {
      const url = `/orders/list?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) {
        const ct = res.headers.get('content-type') || '';
        let msg = `Failed to fetch orders (${res.status})`;
        if (ct.includes('application/json')) {
          const j = await res.json().catch(()=>null);
          if (j && j.error) msg = j.error;
        }
        renderOrdersListError(msg);
        return;
      }
      const j = await res.json().catch(()=>null);
      if (!j || !Array.isArray(j.orders)) {
        renderOrdersListError('Invalid response from server (expected array of orders).');
        return;
      }
      renderOrdersList(j.orders);
    } catch (err) {
      console.error('fetchOrdersList err', err);
      renderOrdersListError('Network error while fetching orders.');
    }
  }

  function renderOrdersListError(msg) {
    if (!ordersTable) return;
    const tbody = ordersTable.querySelector('tbody');
    tbody.innerHTML = `<tr><td class="text-muted" colspan="6">${escapeHtml(msg)}</td></tr>`;
    if (ordersCountEl) ordersCountEl.textContent = '0 results';
  }

function renderOrdersList(orders) {
  if (!ordersTable) return;

  const tbody = ordersTable.querySelector('tbody');

  if (!orders || !orders.length) {
    tbody.innerHTML = '<tr><td class="text-muted" colspan="6">No orders in this range.</td></tr>';
    if (ordersCountEl) ordersCountEl.textContent = '0 results';
    return;
  }

  tbody.innerHTML = '';

  const grouped = {};
  (orders || []).forEach(o => {
    const key = String(o && o.name ? o.name : 'Walk-in');
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(o);
  });

  let groupIndex = 0;
  Object.entries(grouped).forEach(([nameRaw, items]) => {
    if (!items || items.length <= 1) {
      const o = items[0];
      const orderId = o.orderId || o._id || '';
      const safeOrderId = escapeHtml(orderId);
      const name = escapeHtml(o.name || 'Walk-in');
      const jobNote = escapeHtml(o.jobNote || '-');
      const viewHref = '/orders/view/' + encodeURIComponent(orderId);
      const created = o.createdAt
        ? formatDateTimeForDisplay(o.createdAt)
        : (o.createdAt || '');

      const tr = document.createElement('tr');
      tr.dataset.orderId = orderId;
      tr.innerHTML = `
        <td>
          <a href="${viewHref}"
             class="orders-explorer-open-order"
             title="Order ID: ${safeOrderId}">
            ${name}
          </a>
        </td>
        <td>${jobNote}</td>
        <td class="text-end">GH₵ ${formatMoney(o.total)}</td>
        <td>${escapeHtml(o.status || '')}</td>
        <td>${escapeHtml(created)}</td>
        <td class="text-center">
          <button
            class="btn btn-sm btn-outline-secondary view-order-btn"
            data-order-id="${safeOrderId}">
            View
          </button>
        </td>
      `;
      tbody.appendChild(tr);
      return;
    }

    const groupId = `orders-group-${groupIndex++}`;
    const safeName = escapeHtml(nameRaw || 'Walk-in');
    const groupTotal = items.reduce((s, it) => s + Number(it.total || 0), 0);
    const latestCreated = items
      .map(it => it && it.createdAt ? new Date(it.createdAt) : null)
      .filter(d => d && !isNaN(d.getTime()))
      .sort((a, b) => b - a)[0];

    const groupTr = document.createElement('tr');
    groupTr.className = 'table-active orders-group-toggle';
    groupTr.setAttribute('data-target', groupId);
    groupTr.setAttribute('aria-expanded', 'false');
    groupTr.style.cursor = 'pointer';
    groupTr.innerHTML = `
      <td>
        <span class="me-2 orders-group-toggle-icon"><i class="bi bi-chevron-right"></i></span>
        <strong>${safeName}</strong>
        <span class="text-muted ms-2">(${items.length} orders)</span>
      </td>
      <td><span class="text-muted">-</span></td>
      <td class="text-end">GH₵ ${formatMoney(groupTotal)}</td>
      <td>Grouped</td>
      <td>${latestCreated ? escapeHtml(formatDateTimeForDisplay(latestCreated.toISOString())) : '-'}</td>
      <td class="text-center"><span class="text-muted">Expand</span></td>
    `;
    tbody.appendChild(groupTr);

    items.forEach(o => {
      const orderId = o.orderId || o._id || '';
      const safeOrderId = escapeHtml(orderId);
      const jobNote = escapeHtml(o.jobNote || '-');
      const viewHref = '/orders/view/' + encodeURIComponent(orderId);
      const created = o.createdAt
        ? formatDateTimeForDisplay(o.createdAt)
        : (o.createdAt || '');

      const tr = document.createElement('tr');
      tr.className = `orders-group-row ${groupId}`;
      tr.style.display = 'none';
      tr.dataset.orderId = orderId;
      tr.innerHTML = `
        <td>
          <a href="${viewHref}"
             class="orders-explorer-open-order"
             title="Order ID: ${safeOrderId}">
            ${safeName}
          </a>
        </td>
        <td>${jobNote}</td>
        <td class="text-end">GH₵ ${formatMoney(o.total)}</td>
        <td>${escapeHtml(o.status || '')}</td>
        <td>${escapeHtml(created)}</td>
        <td class="text-center">
          <button
            class="btn btn-sm btn-outline-secondary view-order-btn"
            data-order-id="${safeOrderId}">
            View
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  });

  if (ordersCountEl) {
    ordersCountEl.textContent = `${orders.length} result${orders.length > 1 ? 's' : ''}`;
  }
}

  // ---------- view order details (orders explorer / detail modal) ----------
  async function viewOrderDetails(orderId) {
    if (!orderId) return;
    try {
      const res = await fetch(`/orders/list/${encodeURIComponent(orderId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        const msg = j && j.error ? j.error : `Failed to fetch order ${orderId}`;
        if (orderDetailsMeta) orderDetailsMeta.textContent = msg;
        if (orderDetailsJson) orderDetailsJson.textContent = '';
        if (orderDetailsModal) orderDetailsModal.show();
        return;
      }
      const j = await res.json().catch(()=>null);
      if (!j || !j.order) {
        if (orderDetailsMeta) orderDetailsMeta.textContent = 'Order not found';
        if (orderDetailsJson) orderDetailsJson.textContent = '';
        if (orderDetailsModal) orderDetailsModal.show();
        return;
      }
      const o = j.order;
      const jobNote = String(o.jobNote || '').trim();

      const metaText = `Order ID: ${o.orderId} â€” Total: GH₵ ${formatMoney(o.total)} â€” Status: ${o.status} â€” Created: ${formatDateTimeForDisplay(o.createdAt)}${jobNote ? ` â€” Note / Job Type: ${jobNote}` : ''}`;
      if (orderDetailsMeta) orderDetailsMeta.textContent = metaText;

      let html = '';
      if (o.items && o.items.length) {
        html += `<div class="table-responsive"><table class="table table-sm table-borderless mb-0"><thead><tr>
          <th>Selection</th><th class="text-center">QTY</th><th class="text-end">Unit</th><th class="text-end">Subtotal</th><th class="text-center">Printer</th>
        </tr></thead><tbody>`;

        o.items.forEach(it => {
          const rawLabel = it.selectionLabel || '';
          const selLabel = subUnitsOnlyFromLabel(rawLabel) || (it.selections && it.selections.length ? it.selections.map(s => (s.subUnit ? (s.subUnit.name || String(s.subUnit)) : '')).join(', ') : '(no label)');
          const isFb = (it.fb === true) || (typeof rawLabel === 'string' && rawLabel.includes('(F/B)'));
          const cleanLabel = isFb ? selLabel.replace(/\s*\(F\/B\)\s*$/i, '').trim() : selLabel;

          // IMPORTANT: display the stored subtotal and pages â€” do not recompute based on pages only.
          const qty = (typeof it.pages !== 'undefined' && it.pages !== null) ? String(it.pages) : '1';
          const unitPrice = (typeof it.unitPrice === 'number' || !isNaN(Number(it.unitPrice))) ? formatMoney(it.unitPrice) : (it.unitPrice || '');
          const subtotal = (typeof it.subtotal === 'number' || !isNaN(Number(it.subtotal))) ? formatMoney(it.subtotal) : (it.subtotal || '');
          const printerStr = it.printer ? escapeHtml(String(it.printer)) : '-';

          const labelHtml = `<div>${escapeHtml(cleanLabel)}${isFb ? ' <span class="badge bg-secondary ms-2">F/B</span>' : ''}</div>`;

          html += `<tr>
            <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;">${labelHtml}</td>
            <td class="text-center">${escapeHtml(qty)}</td>
            <td class="text-end">GH₵ ${escapeHtml(unitPrice)}</td>
            <td class="text-end">GH₵ ${escapeHtml(subtotal)}</td>
            <td class="text-center">${printerStr}</td>
          </tr>`;
        });

        html += `</tbody></table></div>`;
      } else {
        html += '<p class="text-muted small mb-0">No items listed for this order.</p>';
      }

      html += `<div class="mt-3 small text-muted">
        <div>Created: ${formatDateTimeForDisplay(o.createdAt)}</div>
        ${jobNote ? `<div>Note / Job Type: ${escapeHtml(jobNote)}</div>` : ''}
        <div>Paid at: ${o.paidAt ? formatDateTimeForDisplay(o.paidAt) : 'Not paid'}</div>
      </div>`;

      if (orderDetailsJson) {
        orderDetailsJson.innerHTML = html;
      }
      if (orderDetailsModal) orderDetailsModal.show();
    } catch (err) {
      console.error('viewOrderDetails err', err);
      if (orderDetailsMeta) orderDetailsMeta.textContent = 'Network error while fetching order';
      if (orderDetailsJson) orderDetailsJson.textContent = '';
      if (orderDetailsModal) orderDetailsModal.show();
    }
  }

  // Orders table click delegation (view button)
  if (ordersTable) {
    ordersTable.addEventListener('click', function (ev) {
      const toggleRow = ev.target.closest('.orders-group-toggle');
      if (toggleRow) {
        const target = toggleRow.dataset.target;
        const expanded = toggleRow.getAttribute('aria-expanded') === 'true';
        const rows = ordersTable.querySelectorAll(`.${target}`);
        rows.forEach(r => { r.style.display = expanded ? 'none' : ''; });
        toggleRow.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        const icon = toggleRow.querySelector('.orders-group-toggle-icon');
        if (icon) {
          icon.innerHTML = expanded
            ? '<i class="bi bi-chevron-right"></i>'
            : '<i class="bi bi-chevron-down"></i>';
        }
        return;
      }
      const a = ev.target.closest('.orders-explorer-open-order');
      if (a) return; // allow native navigation
      const vbtn = ev.target.closest('.view-order-btn');
      if (vbtn) {
        const id = vbtn.dataset.orderId;
        if (id) window.location.href = '/orders/view/' + encodeURIComponent(id);
      }
    });
  }

  // copy / print from detail modal
  if (copyDetailOrderIdBtn) {
    copyDetailOrderIdBtn.addEventListener('click', function () {
      const text = (orderDetailsMeta && orderDetailsMeta.textContent) ? orderDetailsMeta.textContent.split('â€”')[0].replace('Order ID:', '').trim() : '';
      if (!text) return alert('No order ID available');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(()=> { try { window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch(_){}; }).catch(()=> { alert('Copy failed'); });
      else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch(e){ alert('Copy failed'); } document.body.removeChild(ta); }
    });
  }
  if (printDetailOrderBtn) {
    printDetailOrderBtn.addEventListener('click', function () {
      const meta = orderDetailsMeta ? orderDetailsMeta.textContent : '';
      const html = orderDetailsJson ? orderDetailsJson.innerHTML : '';
      const w = window.open('', '_blank', 'toolbar=0,location=0,menubar=0');
      if (!w) { alert('Unable to open print window (blocked).'); return; }
      const title = 'Order details';
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font-family:Arial,Helvetica,sans-serif;padding:22px;color:#111}pre{white-space:pre-wrap;background:#f8f9fa;padding:12px;border-radius:6px}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #eee}</style>
        </head><body>
        <div><img src="/public/images/AHAD LOGO.png" style="max-height:60px"/></div>
        <h2>Order</h2><p>${escapeHtml(meta || '')}</p>
        <div>${html || '<p>No details</p>'}</div>
        </body></html>`);
      w.document.close();
      w.focus();
      setTimeout(()=>{ try { w.print(); } catch(e){ alert('Print failed'); } setTimeout(()=>{ try{ w.close(); } catch(e){} }, 700); }, 400);
    });
  }

if (serviceSelect) {
  serviceSelect.addEventListener('change', function () {
    const selectedOption = this.options[this.selectedIndex];
    const value = this.value;

    if (!value || !selectedOption) {
      prices = [];
      renderPrices();
      return;
    }

    const type = selectedOption.dataset.type;

    // ---------- Compound Service (Book) ----------
    if (type === 'book') {
      // reset service pricing UI
      prices = [];
      renderPrices();

      // IMPORTANT: show quantity modal (previous behavior)
      showAddBookModal(value);

      // reset select so user can re-open it later
      this.selectedIndex = 0;
      return;
    }

    // ---------- Merged Service Group ----------
    if (type === 'service-group') {
      const idsCsv = selectedOption.dataset.serviceIds || value || '';
      loadPricesForServiceGroup(idsCsv);
      return;
    }

    // ---------- Normal Service ----------
    loadPricesForService(value);
  });
}

  // initial render and load books list
  renderCart();
  if (booksDropdown) loadBooks();
  updateSaveDraftBtn();

  // If page loads with a pre-attached customer, check for drafts
  const initialCustomerId = getCurrentCustomerId();
  if (initialCustomerId) {
    promptLoadDraft(initialCustomerId);
  }

  // fetchOrdersList helper used earlier
  function formatDateTimeForDisplay(dtStr) {
    try {
      const d = new Date(dtStr);
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2,'0');
      const min = String(d.getMinutes()).padStart(2,'0');
      const ss = String(d.getSeconds()).padStart(2,'0');
      return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss}`;
    } catch (e) { return dtStr || ''; }
  }

  // Expose internal helpers for debugging
  window._ordersClient = {
    loadPricesForService,
    loadBooks,
    loadBookPreview,
    addBookToCartById,
    prices,
    cart,
    serviceRequiresPrinter,
    printers,
    renderCart
  };

  }

  // init on full page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrdersClient);
  } else {
    initOrdersClient();
  }

  // init on ajax navigation swaps (dashboard_nav.js dispatches this)
  document.addEventListener('ajax:page:loaded', function () {
    initOrdersClient();
  });
})();





