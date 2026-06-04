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
  const outsourcedCartTotalEl = document.getElementById('outsourcedCartTotal');
  const outsourcedCartWrapEl = document.getElementById('outsourcedCartWrap');
  const orderNowBtn = document.getElementById('orderNowBtn');
  const saveDraftBtn = document.getElementById('saveDraftBtn');
  const saveCartInvoiceBtn = document.getElementById('saveCartInvoiceBtn');
  const printCartInvoiceBtn = document.getElementById('printCartInvoiceBtn');
  const shareCartInvoiceBtn = document.getElementById('shareCartInvoiceBtn');
  const orderJobNoteEl = document.getElementById('orderJobNote');
  const submittedCustomerSelect = document.getElementById('submittedCustomerSelect');
  const reloadSubmittedCustomersBtn = document.getElementById('reloadSubmittedCustomersBtn');
  const orderSubmissionIdEl = document.getElementById('orderSubmissionId');
  const orderInvoiceIdEl = document.getElementById('orderInvoiceId');
  const cartInvoiceSearchInput = document.getElementById('cartInvoiceSearchInput');
  const cartInvoicesList = document.getElementById('cartInvoicesList');
  const reloadCartInvoicesBtn = document.getElementById('reloadCartInvoicesBtn');
  const openCartInvoicesModalBtn = document.getElementById('openCartInvoicesModalBtn');
  const cartInvoiceActionsBtn = document.getElementById('cartInvoiceActionsBtn');
  const cartInvoicesModalEl = document.getElementById('cartInvoicesModal');
  const cartInvoicesModal = (window.bootstrap && cartInvoicesModalEl) ? new bootstrap.Modal(cartInvoicesModalEl) : null;

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
  const cartTaxMode = document.getElementById('cartTaxMode');
  const cartTaxValue = document.getElementById('cartTaxValue');
  const applyCartTaxBtn = document.getElementById('applyCartTaxBtn');
  const clearCartTaxBtn = document.getElementById('clearCartTaxBtn');
  const cartTaxSummary = document.getElementById('cartTaxSummary');
  const cartTaxableAmountEl = document.getElementById('cartTaxableAmount');
  const cartTaxAmountEl = document.getElementById('cartTaxAmount');

  // client-only state (per order)
  let manualDiscount = null; // { kind:'discount'|'premium', mode:'amount'|'percent', value:number }
  let manualTax = null; // { mode:'amount'|'percent', value:number }

    let secretarySubmissions = [];
    let activeSubmission = null;
    let activeInvoice = null;
    let cartInvoiceSearchTimer = null;

    function getCurrentCustomerId() {
    const customerEl = document.getElementById('orderCustomerId');
    const id = customerEl && customerEl.value ? String(customerEl.value).trim() : '';
    return id || '';
  }

  function getCurrentSubmissionId() {
    const sid = orderSubmissionIdEl && orderSubmissionIdEl.value ? String(orderSubmissionIdEl.value).trim() : '';
    return sid || '';
  }

  function getCurrentInvoiceId() {
    const iid = orderInvoiceIdEl && orderInvoiceIdEl.value ? String(orderInvoiceIdEl.value).trim() : '';
    return iid || '';
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

  function updateCartInvoiceButtons() {
    const hasCart = Array.isArray(cart) && cart.length > 0;
    if (saveCartInvoiceBtn) saveCartInvoiceBtn.disabled = !hasCart;
    if (printCartInvoiceBtn) printCartInvoiceBtn.disabled = !hasCart;
    if (shareCartInvoiceBtn) shareCartInvoiceBtn.disabled = !hasCart;
  }

  function loadDraftIntoCart(draft) {
    if (!draft) return;
    if (Array.isArray(draft.cart)) {
      cart = draft.cart;
    }
    if (window._isAdmin && draft.manualDiscount) {
      manualDiscount = draft.manualDiscount;
      if (manualAdjustmentType) manualAdjustmentType.value = manualDiscount.kind === 'premium' ? 'premium' : 'discount';
      if (manualDiscountMode) manualDiscountMode.value = manualDiscount.mode || 'amount';
      if (manualDiscountValue) manualDiscountValue.value = manualDiscount.value != null ? manualDiscount.value : '';
    } else {
      manualDiscount = null;
      if (manualAdjustmentType) manualAdjustmentType.value = 'discount';
      if (manualDiscountValue) manualDiscountValue.value = '';
    }
    if (window._isAdmin && draft.manualTax) {
      manualTax = draft.manualTax;
      if (cartTaxMode) cartTaxMode.value = manualTax.mode || 'amount';
      if (cartTaxValue) cartTaxValue.value = manualTax.value != null ? manualTax.value : '';
    } else {
      manualTax = null;
      if (cartTaxMode) cartTaxMode.value = 'amount';
      if (cartTaxValue) cartTaxValue.value = '';
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
  const toggleOutsourcedOrdersBtn = document.getElementById('toggleOutsourcedOrdersBtn');
  const outsourcedArtistBalanceFilterWrap = document.getElementById('outsourcedArtistBalanceFilterWrap');
  const outsourcedArtistBalanceFilter = document.getElementById('outsourcedArtistBalanceFilter');
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

  function setOrderDetailsActionsVisible(visible) {
    [copyDetailOrderIdBtn, printDetailOrderBtn].forEach(btn => {
      if (btn) btn.style.display = visible ? '' : 'none';
    });
  }

  // ---------- internal state ----------
  let prices = []; // loaded price rules for selected service or book preview
  let cart = [];   // cart lines: either normal item or book line
                   // normal: { isBook:false, serviceId, serviceName, priceRuleId, selectionLabel, unitPrice, pages, pagesOriginal, subtotal, fb, printerId, spoiled, outsourcedArtistId, outsourcedArtistName, outsourcedQty, outsourcedAmount, outsourcedTotal }
                   // book  : { isBook:true, bookId, bookName, unitPrice, qty, subtotal, bookItems: [ { serviceId, priceRuleId, pagesOriginal, fb, printerId, spoiled, unitPrice, subtotal, selectionLabel } ] }
  let serviceRequiresPrinter = false;
  let printers = []; // list of printers for the currently loaded service
  let books = [];    // list of available books (basic metadata)
  let serviceToneIndex = Object.create(null);

    // ---- materials stock cache (for Apply-time validation) ----
let materials = [];          // [{ _id, name, stocked, used, remaining, selections:[{unit,subUnit},...] }, ...]
let materialsLoaded = false;
let materialsFetchedAt = 0;  // ms timestamp when materials were last fetched
let selectedServiceCategoryName = '';
let selectedServiceCategoryIsOutsourced = false;
let ordersExplorerMode = 'normal';
let lastOrdersList = [];
let outsourcedOrderDetailsByKey = Object.create(null);


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

  function isOutSourcedCategoryName(name) {
    return /out[\s-]*sourced/i.test(String(name || '').trim());
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
      o.dataset.name = c.name || '';
      serviceCategorySelect.appendChild(o);
    });
  }

  if (serviceSelect) {
    serviceSelect.innerHTML = '<option value="">-- Select a service --</option>';
    prices = [];
    if (typeof renderPrices === 'function') renderPrices();
  }
}

function setSelectedCustomerFromSubmission(sub, opts) {
  opts = opts || {};
  const customerIdEl = document.getElementById('orderCustomerId');
  const nameEl = document.getElementById('selectedCustomerName');
  const phoneEl = document.getElementById('selectedCustomerPhone');
  const categoryEl = document.getElementById('selectedCustomerCategory');
  const card = document.getElementById('selectedCustomerCard');
  const prevSubmissionId = activeSubmission ? String(activeSubmission.id || '') : '';
  const nextSubmissionId = sub ? String(sub.id || '') : '';
  const submissionChanged = prevSubmissionId !== nextSubmissionId;

  if (submissionChanged && Array.isArray(cart) && cart.length && !opts.preserveCart) {
    cart = [];
    manualDiscount = null;
    manualTax = null;
    activeInvoice = null;
    if (orderInvoiceIdEl) orderInvoiceIdEl.value = '';
    if (cartTaxValue) cartTaxValue.value = '';
    if (cartTaxMode) cartTaxMode.value = 'amount';
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
  if (!opts.fromInvoice) {
    activeInvoice = null;
    if (orderInvoiceIdEl) orderInvoiceIdEl.value = '';
  }
  if (orderSubmissionIdEl) orderSubmissionIdEl.value = (sub && !opts.fromInvoice) ? String(sub.id || '') : '';

  if (!sub) {
    if (customerIdEl) customerIdEl.value = '';
    if (nameEl) nameEl.textContent = '';
    if (phoneEl) phoneEl.textContent = '';
    if (categoryEl) categoryEl.textContent = '';
    if (card) card.style.display = 'none';
    activeInvoice = null;
    if (orderInvoiceIdEl) orderInvoiceIdEl.value = '';
    selectedServiceCategoryName = '';
    selectedServiceCategoryIsOutsourced = false;
    loadServiceCategories();
    updateSaveDraftBtn();
    return;
  }

  if (customerIdEl) customerIdEl.value = sub.customerId ? String(sub.customerId) : '';
  if (nameEl) nameEl.textContent = sub.displayName || '';
  if (phoneEl) phoneEl.textContent = sub.phone || '';
  if (categoryEl) {
    if (sub.customerCategory) categoryEl.textContent = customerTypeDisplay(sub.customerCategory);
    else categoryEl.textContent = sub.customerId ? '' : 'Walk-in';
  }
  if (card) card.style.display = '';
  selectedServiceCategoryName = '';
  selectedServiceCategoryIsOutsourced = false;
  loadServiceCategories();
  updateSaveDraftBtn();
}

function getActiveCustomerCategory() {
  if (!activeSubmission) return '';
  const raw = String(activeSubmission.customerCategory || '').toLowerCase().trim();
  if (raw === 'artist' || raw === 'organisation') return raw;
  return 'customer';
}

function customerTypeDisplay(category) {
  const raw = String(category || '').toLowerCase().trim();
  if (raw === 'artist') return 'Artist';
  if (raw === 'organisation') return 'Organisation';
  if (raw === 'regular') return 'Regular';
  if (raw === 'one_time' || raw === 'customer') return 'One-Time';
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
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

    if (activeSubmission && !activeInvoice) {
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

function invoiceCustomerLabel(inv) {
  return String((inv && (inv.customerName || inv.customerPhone || inv.invoiceNo)) || 'Customer').trim();
}

function invoiceToSubmission(inv) {
  return {
    id: '',
    customerId: inv.customerId || '',
    displayName: invoiceCustomerLabel(inv),
    phone: inv.customerPhone || '',
    customerCategory: inv.customerCategory || '',
    categories: Array.isArray(inv.categories) ? inv.categories : []
  };
}

function renderCartInvoices(rows) {
  if (!cartInvoicesList) return;
  const invoices = Array.isArray(rows) ? rows : [];
  if (!invoices.length) {
    cartInvoicesList.innerHTML = '<div class="list-group-item dark-surface text-muted-light">No open invoices found.</div>';
    return;
  }

  cartInvoicesList.innerHTML = invoices.map(inv => {
    const total = inv && inv.totals ? Number(inv.totals.finalTotal || inv.totals.total || 0) : 0;
    const status = String(inv.status || 'open');
    const canLoad = status === 'open';
    return `
      <div class="list-group-item dark-surface d-flex justify-content-between align-items-center gap-2">
        <div class="min-width-0">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <strong class="text-white">${escapeHtml(invoiceCustomerLabel(inv))}</strong>
            <span class="badge bg-info text-dark">${escapeHtml(inv.invoiceNo || 'Invoice')}</span>
            <span class="badge ${canLoad ? 'bg-success' : 'bg-secondary'}">${escapeHtml(status)}</span>
          </div>
          <div class="small text-muted-light">
            ${escapeHtml(inv.customerPhone || '')}
            ${total > 0 ? ` · GH₵ ${formatMoney(total)}` : ''}
            ${inv.convertedOrderId ? ` · Order ${escapeHtml(inv.convertedOrderId)}` : ''}
          </div>
        </div>
        <div class="d-flex gap-2 flex-shrink-0">
          <button class="btn btn-sm btn-outline-light-custom load-cart-invoice-btn" type="button" data-invoice-id="${escapeHtml(inv.id || '')}" ${canLoad ? '' : 'disabled'}>Load</button>
          <button class="btn btn-sm btn-outline-danger remove-cart-invoice-btn" type="button" data-invoice-id="${escapeHtml(inv.id || '')}" ${canLoad ? '' : 'disabled'}>Remove</button>
        </div>
      </div>
    `;
  }).join('');
}

async function loadCartInvoices(q) {
  if (!cartInvoicesList) return;
  cartInvoicesList.innerHTML = '<div class="list-group-item dark-surface text-muted-light">Loading invoices...</div>';
  try {
    const params = new URLSearchParams();
    const term = String(q || '').trim();
    if (term) params.set('q', term);
    const res = await fetch(`/orders/invoices?${params.toString()}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'Failed to load invoices');
    renderCartInvoices(j.invoices || []);
  } catch (err) {
    console.error('loadCartInvoices failed', err);
    cartInvoicesList.innerHTML = '<div class="list-group-item dark-surface text-danger">Failed to load invoices.</div>';
  }
}

function loadInvoiceIntoCart(inv) {
  if (String(inv && inv.status || 'open') !== 'open') {
    showAlertModal('This invoice has already been converted to an order.');
    return;
  }
  if (!inv || !Array.isArray(inv.cart) || !inv.cart.length) {
    showAlertModal('This invoice has no cart lines.');
    return;
  }

  activeInvoice = inv;
  if (orderInvoiceIdEl) orderInvoiceIdEl.value = inv.id || '';
  if (submittedCustomerSelect) submittedCustomerSelect.value = '';
  setSelectedCustomerFromSubmission(invoiceToSubmission(inv), { preserveCart: true, fromInvoice: true });

  cart = inv.cart;
  manualDiscount = window._isAdmin ? (inv.manualDiscount || null) : null;
  manualTax = window._isAdmin ? (inv.manualTax || null) : null;
  if (manualAdjustmentType) manualAdjustmentType.value = manualDiscount && manualDiscount.kind === 'premium' ? 'premium' : 'discount';
  if (manualDiscountMode) manualDiscountMode.value = manualDiscount ? (manualDiscount.mode || 'amount') : 'amount';
  if (manualDiscountValue) manualDiscountValue.value = manualDiscount && manualDiscount.value != null ? manualDiscount.value : '';
  if (cartTaxMode) cartTaxMode.value = manualTax ? (manualTax.mode || 'amount') : 'amount';
  if (cartTaxValue) cartTaxValue.value = manualTax && manualTax.value != null ? manualTax.value : '';
  if (orderJobNoteEl) orderJobNoteEl.value = inv.jobNote || '';
  refreshManualAdjustmentButton();
  renderCart();
  showAlertModal(`Invoice ${inv.invoiceNo || ''} loaded into cart.`, 'Invoice loaded');
}

async function saveCurrentCartInvoice(showNotice) {
  if (!cart || !cart.length) {
    showAlertModal('Add items to cart before saving an invoice.');
    return null;
  }

  const submissionId = getCurrentSubmissionId();
  const invoiceId = getCurrentInvoiceId();
  if (!submissionId && !invoiceId) {
    showAlertModal('Select a submitted customer/walk-in or load an existing invoice first.');
    return null;
  }

  const payload = {
    invoiceId: invoiceId || null,
    submissionId: submissionId || null,
    customerId: getCurrentCustomerId() || null,
    cart,
    manualDiscount: window._isAdmin ? manualDiscount : null,
    manualTax: window._isAdmin ? manualTax : null,
    totals: cartTotalsSnapshot(),
    jobNote: orderJobNoteEl ? String(orderJobNoteEl.value || '').trim() : ''
  };

  const originalHtml = saveCartInvoiceBtn ? saveCartInvoiceBtn.innerHTML : '';
  if (saveCartInvoiceBtn) {
    saveCartInvoiceBtn.disabled = true;
    saveCartInvoiceBtn.textContent = 'Saving...';
  }
  try {
    const res = await fetch('/orders/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(payload)
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok || !j.invoice) throw new Error((j && j.error) || 'Failed to save invoice');
    activeInvoice = j.invoice;
    if (orderInvoiceIdEl) orderInvoiceIdEl.value = j.invoice.id || '';
    if (showNotice) showAlertModal(`Invoice saved: ${j.invoice.invoiceNo}`, 'Invoice');
    loadCartInvoices(cartInvoiceSearchInput ? cartInvoiceSearchInput.value : '');
    return j.invoice;
  } catch (err) {
    console.error('save invoice failed', err);
    showAlertModal(err.message || 'Failed to save invoice.');
    return null;
  } finally {
    if (saveCartInvoiceBtn) {
      saveCartInvoiceBtn.disabled = false;
      saveCartInvoiceBtn.innerHTML = originalHtml || '<i class="bi bi-save me-1"></i>Save Invoice';
      updateCartInvoiceButtons();
    }
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
        opt.textContent = `${b.name} — GH₵ ${formatMoney(b.unitPrice)}`;
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
      const opt = this.options && this.selectedIndex >= 0 ? this.options[this.selectedIndex] : null;
      selectedServiceCategoryName = opt ? String(opt.dataset.name || opt.textContent || '') : '';
      selectedServiceCategoryIsOutsourced = isOutSourcedCategoryName(selectedServiceCategoryName);
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

  if (reloadCartInvoicesBtn) {
    reloadCartInvoicesBtn.addEventListener('click', function () {
      loadCartInvoices(cartInvoiceSearchInput ? cartInvoiceSearchInput.value : '');
    });
  }

  if (cartInvoiceActionsBtn) {
    const wrap = cartInvoiceActionsBtn.closest('.cart-invoice-actions');
    const menu = wrap ? wrap.querySelector('.dropdown-menu') : null;
    if (menu) {
      document.querySelectorAll('body > .cart-invoice-floating-menu[data-owner="orders-new"]').forEach(existing => {
        if (existing !== menu) existing.remove();
      });
      menu.dataset.owner = 'orders-new';
      menu.classList.add('cart-invoice-floating-menu');
      document.body.appendChild(menu);
    }

    function hideInvoiceActionsMenu() {
      if (!menu) return;
      menu.classList.remove('show');
      menu.style.display = 'none';
      cartInvoiceActionsBtn.setAttribute('aria-expanded', 'false');
    }

    function showInvoiceActionsMenu() {
      if (!menu) return;
      menu.style.display = 'block';
      menu.style.visibility = 'hidden';
      menu.classList.add('show');
      menu.style.position = 'fixed';
      menu.style.maxHeight = '';
      menu.style.overflowY = '';

      const rect = cartInvoiceActionsBtn.getBoundingClientRect();
      const viewportPadding = 10;
      const menuWidth = Math.max(menu.offsetWidth || 0, 210);
      const menuHeight = Math.max(menu.scrollHeight || menu.offsetHeight || 0, 180);
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
      const availableHeight = Math.max(120, (openUp ? spaceAbove : spaceBelow) - 8);
      const finalHeight = Math.min(menuHeight, availableHeight);

      let top = openUp ? (rect.top - finalHeight - 8) : (rect.bottom + 8);
      top = Math.max(viewportPadding, Math.min(top, window.innerHeight - finalHeight - viewportPadding));

      let left = rect.right - menuWidth;
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - menuWidth - viewportPadding));

      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.width = `${menuWidth}px`;
      menu.style.maxHeight = `${finalHeight}px`;
      menu.style.overflowY = menuHeight > finalHeight ? 'auto' : 'visible';
      menu.style.visibility = 'visible';
      cartInvoiceActionsBtn.setAttribute('aria-expanded', 'true');
    }

    cartInvoiceActionsBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (!menu) return;
      if (menu.classList.contains('show') && menu.style.display !== 'none') {
        hideInvoiceActionsMenu();
      } else {
        showInvoiceActionsMenu();
      }
    });

    if (menu) {
      menu.addEventListener('click', function (ev) {
        ev.stopPropagation();
        const item = ev.target.closest('.dropdown-item');
        if (item) setTimeout(hideInvoiceActionsMenu, 80);
      });
    }

    document.addEventListener('click', function (ev) {
      if (!menu || !menu.classList.contains('show')) return;
      if (ev.target === cartInvoiceActionsBtn || cartInvoiceActionsBtn.contains(ev.target)) return;
      if (menu.contains(ev.target)) return;
      hideInvoiceActionsMenu();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') hideInvoiceActionsMenu();
    });

    window.addEventListener('resize', hideInvoiceActionsMenu);
    window.addEventListener('scroll', hideInvoiceActionsMenu, true);
  }

  if (openCartInvoicesModalBtn) {
    openCartInvoicesModalBtn.addEventListener('click', function () {
      document.querySelectorAll('body > .cart-invoice-floating-menu.show').forEach(menu => {
        menu.classList.remove('show');
        menu.style.display = 'none';
      });
      if (cartInvoiceActionsBtn) cartInvoiceActionsBtn.setAttribute('aria-expanded', 'false');
      if (cartInvoicesModal) cartInvoicesModal.show();
      loadCartInvoices(cartInvoiceSearchInput ? cartInvoiceSearchInput.value : '');
      if (cartInvoiceSearchInput) {
        setTimeout(() => {
          try { cartInvoiceSearchInput.focus(); } catch (e) {}
        }, 250);
      }
    });
  }

  if (cartInvoiceSearchInput) {
    cartInvoiceSearchInput.addEventListener('input', function () {
      if (cartInvoiceSearchTimer) clearTimeout(cartInvoiceSearchTimer);
      const q = this.value || '';
      cartInvoiceSearchTimer = setTimeout(function () {
        loadCartInvoices(q);
      }, 220);
    });
  }

  if (cartInvoicesList) {
    cartInvoicesList.addEventListener('click', function (ev) {
      const removeBtn = ev.target.closest('.remove-cart-invoice-btn');
      if (removeBtn) {
        const invoiceId = removeBtn.dataset.invoiceId || '';
        if (!invoiceId) return;
        if (!confirm('Remove this saved invoice from the list?')) return;
        removeBtn.disabled = true;
        removeBtn.textContent = 'Removing...';
        fetch(`/orders/invoices/${encodeURIComponent(invoiceId)}`, {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        })
          .then(res => res.json().then(j => ({ ok: res.ok, j })))
          .then(({ ok, j }) => {
            if (!ok || !j || !j.ok) throw new Error((j && j.error) || 'Failed to remove invoice');
            if (getCurrentInvoiceId() === invoiceId) {
              activeInvoice = null;
              if (orderInvoiceIdEl) orderInvoiceIdEl.value = '';
            }
            loadCartInvoices(cartInvoiceSearchInput ? cartInvoiceSearchInput.value : '');
          })
          .catch(err => {
            console.error('remove invoice failed', err);
            showAlertModal(err.message || 'Failed to remove invoice.');
            loadCartInvoices(cartInvoiceSearchInput ? cartInvoiceSearchInput.value : '');
          });
        return;
      }

      const btn = ev.target.closest('.load-cart-invoice-btn');
      if (!btn) return;
      const invoiceId = btn.dataset.invoiceId || '';
      if (!invoiceId) return;
      const rows = Array.from(cartInvoicesList.querySelectorAll('.load-cart-invoice-btn'));
      rows.forEach(b => { b.disabled = true; });
      fetch(`/orders/invoices?invoiceId=${encodeURIComponent(invoiceId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(res => res.json().then(j => ({ ok: res.ok, j })))
        .then(({ ok, j }) => {
          if (!ok || !j || !j.ok || !j.invoices || !j.invoices[0]) {
            throw new Error((j && j.error) || 'Failed to load invoice');
          }
          loadInvoiceIntoCart(j.invoices[0]);
          if (cartInvoicesModal) cartInvoicesModal.hide();
        })
        .catch(err => {
          console.error('load invoice failed', err);
          showAlertModal(err.message || 'Failed to load invoice.');
        })
        .finally(() => {
          loadCartInvoices(cartInvoiceSearchInput ? cartInvoiceSearchInput.value : '');
        });
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
      // Don’t break ordering if materials can’t load; just skip checks.
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

  function computeTaxAmount(taxableTotal, tax) {
    if (!tax) return 0;
    const mode = String(tax.mode || '');
    const value = Number(tax.value || 0);
    const base = Math.max(0, Number(taxableTotal || 0));

    if (!isFinite(value) || value <= 0) return 0;
    if (mode === 'amount') return Number(Math.max(0, value).toFixed(2));
    if (mode === 'percent') {
      const pct = clamp(value, 0, 100);
      return Number((base * (pct / 100)).toFixed(2));
    }
    return 0;
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

  function updateTaxUI(taxableTotal) {
    if (!window._isAdmin || !cartTaxSummary) {
      if (cartTaxSummary) cartTaxSummary.style.display = 'none';
      if (clearCartTaxBtn) clearCartTaxBtn.style.display = 'none';
      return;
    }
    const taxAmt = computeTaxAmount(taxableTotal, manualTax);
    if (cartTaxSummary && taxAmt > 0) {
      cartTaxSummary.style.display = '';
      if (cartTaxableAmountEl) cartTaxableAmountEl.textContent = `GH\u20B5 ${formatMoney(taxableTotal)}`;
      if (cartTaxAmountEl) cartTaxAmountEl.textContent = `+ GH\u20B5 ${formatMoney(taxAmt)}`;
      if (clearCartTaxBtn) clearCartTaxBtn.style.display = '';
    } else {
      if (cartTaxSummary) cartTaxSummary.style.display = 'none';
      if (clearCartTaxBtn) clearCartTaxBtn.style.display = 'none';
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
      try { document.execCommand('copy'); try { window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch (_) {} } catch (e) { alert('Copy failed — select and copy: ' + text); }
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
      const noteEl = modalEl.querySelector('#orderSuccessJobNote');
      const idText = idEl ? idEl.textContent.trim() : (orderId || '');
      const noteText = noteEl ? noteEl.textContent.trim() : String(jobNote || '').trim();
      const printedAt = new Date().toLocaleString();
      const w = window.open('', '_blank', 'toolbar=0,location=0,menubar=0');
      if (!w) {
        alert('Unable to open print window (blocked). Please copy order ID and print manually.');
        return;
      }
      const doc = w.document;
      const title = 'AHADPRINT';
      const logoSrc = `${window.location.origin}/images/AHAD%20LOGO3.jpeg`;
      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          @page { margin: 0; }
          body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 24px; color: #111; }
          .wrap { max-width: 720px; margin: 0 auto; }
          .brand { display: flex; align-items: flex-start; justify-content: center; gap: 22px; margin-bottom: 18px; }
          .logo { max-height: 72px; max-width: 110px; object-fit: contain; display: block; }
          .brand-name { font-size: 24px; font-weight: 800; letter-spacing: .08em; white-space: nowrap; }
          .brand-company { min-width: 180px; flex: 0 0 180px; }
          .brand-info { text-align: left; border-left: 1px solid #ddd; padding-left: 18px; max-width: 390px; }
          .brand-line { color: #333; font-size: 11px; line-height: 1.35; }
          h1 { font-size: 20px; margin: 0 0 8px; text-align: center; }
          p { margin: 6px 0; }
          .muted { color: #666; font-size: 13px; }
          .details { text-align: left; display: inline-block; margin-top: 12px; border: 1px solid #ddd; border-radius: 10px; padding: 14px 18px; }
          .center { text-align: center; }
          .small-note { color: #666; font-size: 12px; margin-top: 18px; text-align: center; }
        </style>
        </head><body>
        <div class="wrap">
          <div class="brand">
            <img class="logo" src="${escapeHtml(logoSrc)}" alt="AHADPRINT logo" />
            <div class="brand-company">
              <div class="brand-name">AHADPRINT</div>
              <div class="muted">Order Slip</div>
            </div>
            <div class="brand-info">
              <div class="brand-line"><strong>Services:</strong> Digital Printing, Sales of Home Use Computers, Stationery and general merchandise.</div>
              <div class="brand-line"><strong>Location:</strong> Tamale Technical University.</div>
              <div class="brand-line"><strong>Tel:</strong> 0244104350.</div>
              <div class="brand-line"><strong>WhatsApp:</strong> 0558590262</div>
            </div>
          </div>
          <h1>Order Created</h1>
          <div class="center"><div class="details">
            <p><strong>Order ID:</strong> ${escapeHtml(idText)}</p>
            <p><strong>Date:</strong> ${escapeHtml(printedAt)}</p>
            ${noteText ? `<p><strong>Note / Job Type:</strong> ${escapeHtml(noteText)}</p>` : ''}
            <p class="muted">Show this ID at payment.</p>
          </div></div>
          <p class="small-note">Printed from Ahad POS.</p>
        </div>
        </body></html>`);
      doc.close();
      w.focus();
      const onLoadPrint = () => {
        try { w.print(); } catch (e) { alert('Print failed - try copying the order ID.'); }
        setTimeout(()=>{ try { w.close(); } catch (e){} }, 700);
      };
      const runWhenLogoReady = () => {
        const logo = w.document.querySelector('.logo');
        if (logo && !logo.complete) {
          let done = false;
          const go = () => {
            if (done) return;
            done = true;
            setTimeout(onLoadPrint, 120);
          };
          logo.onload = go;
          logo.onerror = go;
          setTimeout(go, 1400);
          return;
        }
        setTimeout(onLoadPrint, 120);
      };
      if (w.document.readyState === 'complete') runWhenLogoReady(); else { w.onload = runWhenLogoReady; setTimeout(runWhenLogoReady, 1200); }
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
  const wrapper = document.createElement('div');
  const sharedControls = document.createElement('div');
  sharedControls.className = 'd-flex align-items-center gap-3 flex-wrap mb-2 px-2 py-2 rounded-3';
  sharedControls.style.background = 'rgba(255,255,255,.06)';
  sharedControls.style.border = '1px solid rgba(255,255,255,.10)';
  sharedControls.innerHTML = `
    <span class="small text-muted-light me-1">Use one entry for all loaded rules:</span>
    ${serviceRequiresPrinter ? `
      <label class="form-check form-check-inline small mb-0">
        <input class="form-check-input same-pages-toggle" type="checkbox">
        <span class="form-check-label">Use Same Pages</span>
      </label>
    ` : ''}
    <label class="form-check form-check-inline small mb-0">
      <input class="form-check-input same-qty-toggle" type="checkbox">
      <span class="form-check-label">Use Same QTY</span>
    </label>
    ${serviceRequiresPrinter ? `
      <label class="form-check form-check-inline small mb-0">
        <input class="form-check-input same-printer-toggle" type="checkbox">
        <span class="form-check-label">Use Same Printer</span>
      </label>
    ` : ''}
  `;
  wrapper.appendChild(sharedControls);
  wrapper.appendChild(container);

  function sharedToggleChecked(selector) {
    const toggle = sharedControls.querySelector(selector);
    return !!(toggle && toggle.checked);
  }

  function syncRuleInputs(selector, value, sourceEl) {
    container.querySelectorAll(selector).forEach(el => {
      if (el === sourceEl || el.disabled) return;
      el.value = value;
    });
  }

  function syncFromFirstFilled(selector) {
    const first = Array.from(container.querySelectorAll(selector))
      .find(el => !el.disabled && String(el.value || '').trim() !== '');
    if (first) syncRuleInputs(selector, first.value, first);
  }

  const qtySyncSelector = serviceRequiresPrinter ? '.factor-input' : '.pages-input';
  sharedControls.addEventListener('change', function (e) {
    const target = e.target;
    if (!target || !target.checked) return;
    if (target.classList.contains('same-pages-toggle')) syncFromFirstFilled('.pages-input');
    if (target.classList.contains('same-qty-toggle')) syncFromFirstFilled(qtySyncSelector);
    if (target.classList.contains('same-printer-toggle')) syncFromFirstFilled('.printer-select');
  });

  container.addEventListener('input', function (e) {
    const target = e.target;
    if (!target) return;
    if (serviceRequiresPrinter && target.classList.contains('pages-input') && sharedToggleChecked('.same-pages-toggle')) {
      syncRuleInputs('.pages-input', target.value, target);
    }
    if (target.matches(qtySyncSelector) && sharedToggleChecked('.same-qty-toggle')) {
      syncRuleInputs(qtySyncSelector, target.value, target);
    }
  });

  container.addEventListener('change', function (e) {
    const target = e.target;
    if (!target) return;
    if (target.classList.contains('printer-select') && sharedToggleChecked('.same-printer-toggle')) {
      syncRuleInputs('.printer-select', target.value, target);
    }
    if (serviceRequiresPrinter && target.classList.contains('pages-input') && sharedToggleChecked('.same-pages-toggle')) {
      syncRuleInputs('.pages-input', target.value, target);
    }
    if (target.matches(qtySyncSelector) && sharedToggleChecked('.same-qty-toggle')) {
      syncRuleInputs(qtySyncSelector, target.value, target);
    }
  });

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

    if (selectedServiceCategoryIsOutsourced) {
      const outAmt = document.createElement('input');
      outAmt.type = 'number';
      outAmt.min = '0.01';
      outAmt.step = '0.01';
      outAmt.placeholder = 'Artist Amount';
      outAmt.className = 'form-control form-control-sm outsourced-amount-input';
      outAmt.style.width = '112px';
      mid.appendChild(outAmt);

      const artistLookup = document.createElement('input');
      artistLookup.type = 'text';
      artistLookup.placeholder = 'Artist phone/name';
      artistLookup.className = 'form-control form-control-sm outsourced-artist-lookup';
      artistLookup.style.width = '140px';
      mid.appendChild(artistLookup);

      const artistMeta = document.createElement('input');
      artistMeta.type = 'hidden';
      artistMeta.className = 'outsourced-artist-id';
      mid.appendChild(artistMeta);

      const artistMetaName = document.createElement('input');
      artistMetaName.type = 'hidden';
      artistMetaName.className = 'outsourced-artist-name';
      mid.appendChild(artistMetaName);
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
  pricesList.appendChild(wrapper);
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
    pricesList.innerHTML = '<div class="text-muted">Loading price rules…</div>';
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
  tone,
  outsourcedArtistId,
  outsourcedArtistName,
  outsourcedQty,
  outsourcedAmount
}) {
  const origPages = Number(pages) || 1;
  const factorVal = Number(factor) && Number(factor) > 0 ? Number(factor) : 1;

  spoiled = Math.max(0, Math.floor(Number(spoiled) || 0));

  // effective quantity used for price calculation (existing logic)
  const effectiveQty = fb ? Math.ceil(origPages / 2) : origPages;

  // subtotal logic:
  // - printing service → unitPrice × effectiveQty × factor
  // - non-printing service → unitPrice × effectiveQty
  const subtotal = Number(
    (
      Number(unitPrice) *
      effectiveQty *
      (printerId ? factorVal : 1)
    ).toFixed(2)
  );
  const outQty = Math.max(0, Math.floor(Number(outsourcedQty || 0)));
  const outAmount = Math.max(0, Number(outsourcedAmount || 0));
  const outsourcedTotal = Number((outQty > 0 && outAmount > 0 ? outQty * outAmount : 0).toFixed(2));

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
    tone: tone || 'other',
    outsourcedArtistId: outsourcedArtistId ? String(outsourcedArtistId) : '',
    outsourcedArtistName: outsourcedArtistName ? String(outsourcedArtistName) : '',
    outsourcedQty: outQty,
    outsourcedAmount: outAmount,
    outsourcedTotal
  });

  renderCart();
}

  // ---------- Render cart ----------
  function renderCart() {
    cartTbody.innerHTML = '';
  if (!cart.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="text-muted" colspan="7">Cart is empty.</td>';
    cartTbody.appendChild(tr);
    cartTotalEl.textContent = 'GH₵ 0.00';
    const outsourcedTotalNodeEmpty = document.getElementById('outsourcedCartTotal') || outsourcedCartTotalEl;
    if (outsourcedTotalNodeEmpty) outsourcedTotalNodeEmpty.textContent = 'GH\u20b5 0.00';
    const outsourcedWrapEmpty = document.getElementById('outsourcedCartWrap') || outsourcedCartWrapEl;
    if (outsourcedWrapEmpty) outsourcedWrapEmpty.style.display = 'none';
    orderNowBtn.disabled = true;
    updateSaveDraftBtn();
    updateCartInvoiceButtons();

    // ✅ ensure breakdown under totals is hidden when cart empties
    if (manualDiscountSummary) manualDiscountSummary.style.display = 'none';
    if (cartTaxSummary) cartTaxSummary.style.display = 'none';
    if (clearManualDiscountBtn) clearManualDiscountBtn.style.display = 'none';
    if (clearCartTaxBtn) clearCartTaxBtn.style.display = 'none';

    return;
  }
    let total = 0;
    let outsourcedCostTotal = 0;

    const groups = [];
    const groupMap = new Map();
    cart.forEach((it, idx) => {
      const rawTitle = it && it.isBook
        ? 'Compound Services'
        : String((it && it.serviceName) || 'Service').trim();
      const title = rawTitle || 'Service';
      const groupKey = `${it && it.isBook ? 'book' : 'service'}:${title.toLowerCase()}`;
      let group = groupMap.get(groupKey);
      if (!group) {
        group = { key: groupKey, title, type: it && it.isBook ? 'book' : 'service', items: [] };
        groupMap.set(groupKey, group);
        groups.push(group);
      }
      group.items.push({ item: it, index: idx });
    });

    groups.forEach(group => {
      const groupSubtotal = Number(group.items.reduce((sum, row) => {
        return sum + Number(row && row.item ? row.item.subtotal || 0 : 0);
      }, 0).toFixed(2));
      const headerTr = document.createElement('tr');
      headerTr.className = 'cart-service-group-row';
      headerTr.innerHTML = `
        <td colspan="7" class="pt-3 pb-1">
          <div class="d-flex align-items-center gap-2 flex-wrap px-2 py-2 rounded-3" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);">
            <strong class="text-white">${escapeHtml(group.title)}</strong>
          </div>
        </td>
      `;
      cartTbody.appendChild(headerTr);

      group.items.forEach(({ item: it, index: idx }) => {
      total += it.subtotal;
      outsourcedCostTotal += Number(it.outsourcedTotal || 0);
      const tr = document.createElement('tr');
      tr.dataset.idx = idx;

      let displayLabel = '';
      if (it.isBook) {
        displayLabel = `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px;">${escapeHtml(it.bookName)}</div>`;
      } else {
        const toneClass = (it.tone === 'color') ? 'text-danger' : '';
        const outsourcedMeta = (Number(it.outsourcedTotal || 0) > 0)
          ? `<br/><small class="text-info">Out-Sourced: ${escapeHtml(it.outsourcedArtistName || 'Artist')} | QTY ${escapeHtml(String(it.outsourcedQty || 0))} | GH₵ ${escapeHtml(formatMoney(it.outsourcedAmount || 0))} = GH₵ ${escapeHtml(formatMoney(it.outsourcedTotal || 0))}</small>`
          : '';
        displayLabel = `<div class="${toneClass}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px;">${escapeHtml(it.selectionLabel || '')}${(it.spoiled && it.spoiled>0) ? '<br/><small class="text-danger">Spoiled: '+String(it.spoiled)+'</small>' : ''}${outsourcedMeta}</div>`;
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
  factorCell = String(sheets);                          // ✅ Sheets
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

      const subtotalTr = document.createElement('tr');
      subtotalTr.className = 'cart-service-subtotal-row';
      subtotalTr.innerHTML = `
        <td colspan="5" class="text-end pt-1 pb-3">
          <span class="small text-muted-light">${escapeHtml(group.title)} subtotal:</span>
        </td>
        <td class="text-end pt-1 pb-3">
          <strong class="text-white">GH\u20b5 ${formatMoney(groupSubtotal)}</strong>
        </td>
        <td></td>
      `;
      cartTbody.appendChild(subtotalTr);
    });
    // existing:
    // cartTotalEl.textContent = 'GH₵ ' + total.toFixed(2);

    // NEW: apply admin manual discount (client-only)
    const baseTotal = Number(total.toFixed(2));
    const discAmt = (window._isAdmin && manualDiscount) ? computeManualDiscountAmount(baseTotal, manualDiscount) : 0;
    const signedAdjustment = (manualAdjustmentKind() === 'premium') ? (-discAmt) : discAmt;
    const taxableTotal = Number(Math.max(0, baseTotal - signedAdjustment).toFixed(2));
    const taxAmt = (window._isAdmin && manualTax) ? computeTaxAmount(taxableTotal, manualTax) : 0;
    const finalTotal = Number((taxableTotal + taxAmt).toFixed(2));

    // show final in main total
    cartTotalEl.textContent = 'GH₵ ' + finalTotal.toFixed(2);
    const outsourcedTotalNode = document.getElementById('outsourcedCartTotal') || outsourcedCartTotalEl;
    if (outsourcedTotalNode) outsourcedTotalNode.textContent = 'GH\u20b5 ' + Number(outsourcedCostTotal.toFixed(2)).toFixed(2);
    const outsourcedWrap = document.getElementById('outsourcedCartWrap') || outsourcedCartWrapEl;
    if (outsourcedWrap) outsourcedWrap.style.display = outsourcedCostTotal > 0 ? '' : 'none';

    // update the manual discount summary box
    updateManualDiscountUI(baseTotal);
    updateTaxUI(taxableTotal);
    orderNowBtn.disabled = false;
    updateSaveDraftBtn();
    updateCartInvoiceButtons();
  }

  function cartTotalsSnapshot() {
    const baseTotal = Number((Array.isArray(cart) ? cart.reduce((sum, it) => sum + Number(it.subtotal || 0), 0) : 0).toFixed(2));
    const outsourcedCostTotal = Number((Array.isArray(cart) ? cart.reduce((sum, it) => sum + Number(it.outsourcedTotal || 0), 0) : 0).toFixed(2));
    const adjustmentAmount = (window._isAdmin && manualDiscount) ? computeManualDiscountAmount(baseTotal, manualDiscount) : 0;
    const isPremium = manualAdjustmentKind() === 'premium';
    const taxableTotal = Number(Math.max(0, baseTotal - (isPremium ? -adjustmentAmount : adjustmentAmount)).toFixed(2));
    const taxAmount = (window._isAdmin && manualTax) ? computeTaxAmount(taxableTotal, manualTax) : 0;
    const finalTotal = Number((taxableTotal + taxAmount).toFixed(2));
    return {
      baseTotal,
      outsourcedCostTotal,
      adjustmentAmount,
      adjustmentKind: isPremium ? 'premium' : 'discount',
      taxableTotal,
      taxAmount,
      tax: window._isAdmin ? manualTax : null,
      finalTotal
    };
  }

  function cartLineSnapshot(it) {
    if (it && it.isBook) {
      const components = Array.isArray(it.bookItems) && it.bookItems.length
        ? `Includes: ${it.bookItems.map(bi => bi.selectionLabel || '').filter(Boolean).join(' + ')}`
        : '';
      return {
        description: it.bookName || 'Compound service',
        service: 'Compound Service',
        pages: '',
        qty: String(it.qty || 1),
        sheets: '',
        unitPrice: Number(it.unitPrice || 0),
        subtotal: Number(it.subtotal || 0),
        note: components
      };
    }

    const hasPrinter = !!(it && it.printerId);
    const f = hasPrinter ? (Number(it.factor || 1) || 1) : 1;
    const effectiveQty = Number((it && it.pages) || 0) || 0;
    const sheets = hasPrinter ? Math.max(0, Math.floor(effectiveQty * f)) : '';
    const outsourcedTotal = Number((it && it.outsourcedTotal) || 0);
    const noteParts = [];
    if (it && it.spoiled && Number(it.spoiled) > 0) noteParts.push(`Spoiled: ${Number(it.spoiled)}`);
    if (outsourcedTotal > 0) {
      noteParts.push(`Out-Sourced: ${it.outsourcedArtistName || 'Artist'} | QTY ${it.outsourcedQty || 0} | ${formatCediPlain(it.outsourcedAmount || 0)} = ${formatCediPlain(outsourcedTotal)}`);
    }

    return {
      description: (it && it.selectionLabel) || '',
      service: (it && it.serviceName) || '',
      pages: hasPrinter ? String((it && it.pagesOriginal) || '') : '',
      qty: hasPrinter ? String(f) : String((it && it.pages) || ''),
      sheets: sheets === '' ? '' : String(sheets),
      unitPrice: Number((it && it.unitPrice) || 0),
      subtotal: Number((it && it.subtotal) || 0),
      note: noteParts.join(' | ')
    };
  }

  function groupInvoiceLines(lines) {
    const groups = [];
    const groupMap = new Map();
    (Array.isArray(lines) ? lines : []).forEach(line => {
      const title = String((line && line.service) || 'Service').trim() || 'Service';
      const key = title.toLowerCase();
      let group = groupMap.get(key);
      if (!group) {
        group = { title, items: [], subtotal: 0 };
        groupMap.set(key, group);
        groups.push(group);
      }
      group.items.push(line);
      group.subtotal += Number((line && line.subtotal) || 0);
    });
    groups.forEach(group => {
      group.subtotal = Number(group.subtotal.toFixed(2));
    });
    return groups;
  }

  function formatCediPlain(n) {
    return `GH\u20B5 ${formatMoney(n)}`;
  }

  function selectedCustomerSnapshot() {
    const name = (document.getElementById('selectedCustomerName')?.textContent || '').trim();
    const phone = (document.getElementById('selectedCustomerPhone')?.textContent || '').trim();
    const category = (document.getElementById('selectedCustomerCategory')?.textContent || '').trim();
    return {
      name: name || 'Customer',
      phone,
      category,
      jobNote: orderJobNoteEl ? String(orderJobNoteEl.value || '').trim() : ''
    };
  }

  function invoiceNumber() {
    if (activeInvoice && activeInvoice.invoiceNo) return String(activeInvoice.invoiceNo);
    return `0000${String(new Date().getFullYear()).slice(-2)}`;
  }

  function safeInvoiceFileName() {
    const customer = selectedCustomerSnapshot();
    const rawName = String(customer.name || activeInvoice?.customerName || activeInvoice?.customerPhone || 'customer').trim();
    const safeName = rawName
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    return `${safeName || 'customer'}_invoice.pdf`;
  }

  function buildCartInvoiceHtml() {
    const customer = selectedCustomerSnapshot();
    const totals = cartTotalsSnapshot();
    const lines = (cart || []).map(cartLineSnapshot);
    const groups = groupInvoiceLines(lines);
    const now = new Date();
    const invNo = invoiceNumber();
    const adjustmentLabel = totals.adjustmentKind === 'premium' ? 'Premium' : 'Discount';
    const adjustmentSign = totals.adjustmentKind === 'premium' ? '+' : '-';
    const taxLabel = totals.tax && totals.tax.mode === 'percent'
      ? `VAT (${Number(totals.tax.value || 0)}%)`
      : 'VAT';
    let rowNo = 0;
    const rows = groups.map(group => {
      const itemRows = group.items.map(line => {
        rowNo += 1;
        return `
          <tr>
            <td>${rowNo}</td>
            <td>
              <div>${escapeHtml(line.description || '')}</div>
              ${line.note ? `<div class="muted">${escapeHtml(line.note)}</div>` : ''}
            </td>
            <td>${escapeHtml(line.pages || '')}</td>
            <td>${escapeHtml(line.qty || '')}</td>
            <td>${escapeHtml(line.sheets || '')}</td>
            <td class="right">${formatCediPlain(line.unitPrice)}</td>
            <td class="right">${formatCediPlain(line.subtotal)}</td>
          </tr>
        `;
      }).join('');
      return `
        <tr class="invoice-service-header">
          <td colspan="7"><strong>${escapeHtml(group.title)}</strong></td>
        </tr>
        ${itemRows}
        <tr class="invoice-service-subtotal">
          <td colspan="6" class="right"><strong>${escapeHtml(group.title)} subtotal:</strong></td>
          <td class="right"><strong>${formatCediPlain(group.subtotal)}</strong></td>
        </tr>
      `;
    }).join('');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Invoice ${escapeHtml(invNo)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 12px; }
    .header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 14px; margin-bottom: 16px; }
    .brand { display: flex; align-items: flex-start; gap: 12px; max-width: 620px; }
    .logo { max-height: 62px; max-width: 160px; object-fit: contain; }
    .company-block { min-width: 118px; }
    .company-name { margin-top: 0; font-size: 17px; font-weight: 800; letter-spacing: .08em; white-space: nowrap; }
    .business-info { border-left: 1px solid #ddd; padding-left: 12px; }
    .business-line { color: #333; font-size: 10.5px; line-height: 1.35; max-width: 360px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: .03em; }
    h2 { margin: 0 0 6px; font-size: 15px; }
    .muted { color: #555; font-size: 11px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 16px; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px 6px; vertical-align: top; }
    th { background: #f2f4f7; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .right { text-align: right; white-space: nowrap; }
    .invoice-service-header td { background: #eef2ff; border-top: 1px solid #c7d2fe; border-bottom: 1px solid #c7d2fe; padding-top: 9px; padding-bottom: 9px; }
    .invoice-service-subtotal td { background: #fafafa; border-bottom: 2px solid #d1d5db; }
    .totals { margin-left: auto; width: 310px; margin-top: 16px; }
    .totals div { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee; }
    .totals .grand { font-weight: 700; font-size: 15px; border-bottom: 2px solid #111; }
    .notice { margin-top: 18px; padding: 10px; background: #fff8e1; border: 1px solid #f0d46a; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <img class="logo" src="/public/images/AHAD LOGO3.jpeg" alt="AHAD">
      <div class="company-block">
        <div class="company-name">AHADPRINT</div>
        <div class="muted">Invoice</div>
      </div>
      <div class="business-info">
        <div class="business-line"><strong>Services:</strong> Digital Printing, Sales of Home Use Computers, Stationery and general merchandise.</div>
        <div class="business-line"><strong>Location:</strong> Tamale Technical University.</div>
        <div class="business-line"><strong>Tel:</strong> 0244104350.</div>
        <div class="business-line"><strong>WhatsApp:</strong> 0558590262</div>
      </div>
    </div>
    <div class="right">
      <h1>INVOICE</h1>
      <div><strong>No:</strong> ${escapeHtml(invNo)}</div>
      <div><strong>Date:</strong> ${escapeHtml(now.toLocaleString())}</div>
    </div>
  </div>
  <div class="grid">
    <div class="box">
      <h2>Customer</h2>
      <div><strong>${escapeHtml(customer.name)}</strong></div>
      ${customer.phone ? `<div>Phone: ${escapeHtml(customer.phone)}</div>` : ''}
      ${customer.category ? `<div>Type: ${escapeHtml(customer.category)}</div>` : ''}
    </div>
    <div class="box">
      <h2>Job Details</h2>
      <div>${customer.jobNote ? escapeHtml(customer.jobNote) : 'No note provided'}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Selection</th>
        <th>Pages</th>
        <th>QTY</th>
        <th>Sheets</th>
        <th class="right">Unit</th>
        <th class="right">Subtotal</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    ${totals.adjustmentAmount > 0 ? `<div><span>${adjustmentLabel}</span><strong>${adjustmentSign} ${formatCediPlain(totals.adjustmentAmount)}</strong></div>` : ''}
    ${totals.taxAmount > 0 ? `<div><span>VATable amount</span><strong>${formatCediPlain(totals.taxableTotal)}</strong></div><div><span>${taxLabel}</span><strong>+ ${formatCediPlain(totals.taxAmount)}</strong></div>` : ''}
    ${totals.outsourcedCostTotal > 0 ? `<div><span>Out-Sourced Cost Total</span><strong>${formatCediPlain(totals.outsourcedCostTotal)}</strong></div>` : ''}
    <div class="grand"><span>Total</span><strong>${formatCediPlain(totals.finalTotal)}</strong></div>
  </div>
</body>
</html>`;
  }

  async function printCartInvoice() {
    if (!cart || !cart.length) return showAlertModal('Add items to cart before printing an invoice.');
    const saved = await saveCurrentCartInvoice(false);
    if (!saved) return;
    const w = window.open('', '_blank', 'toolbar=0,location=0,menubar=0');
    if (!w) return showAlertModal('Unable to open print window. Please allow pop-ups for this site.');
    w.document.open();
    w.document.write(buildCartInvoiceHtml());
    w.document.close();
    w.focus();
    setTimeout(() => {
      try { w.print(); } catch (e) { showAlertModal('Print failed.'); }
    }, 450);
  }

  function sanitizePdfText(text) {
    return String(text || '')
      .replace(/GH\u20B5/g, 'GHS')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[^\x20-\x7E]/g, '');
  }

  function pdfEscape(text) {
    return sanitizePdfText(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function wrapPdfLine(text, maxLen) {
    const words = sanitizePdfText(text).split(/\s+/);
    const lines = [];
    let current = '';
    words.forEach(word => {
      if (!word) return;
      if ((current + ' ' + word).trim().length > maxLen) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = (current ? current + ' ' : '') + word;
      }
    });
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  function bytesToHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
      out += bytes[i].toString(16).padStart(2, '0').toUpperCase();
    }
    return out;
  }

  function getJpegDimensions(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    let offset = 2;
    const sofMarkers = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]);

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xFF) {
        offset += 1;
        continue;
      }
      while (bytes[offset] === 0xFF) offset += 1;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xD9 || marker === 0xDA) break;
      if (offset + 1 >= bytes.length) break;
      const length = (bytes[offset] << 8) + bytes[offset + 1];
      if (!length || offset + length > bytes.length) break;
      if (sofMarkers.has(marker) && length >= 7) {
        return {
          height: (bytes[offset + 3] << 8) + bytes[offset + 4],
          width: (bytes[offset + 5] << 8) + bytes[offset + 6],
          components: bytes[offset + 7] || 3
        };
      }
      offset += length;
    }
    return null;
  }

  async function loadInvoiceLogoForPdf() {
    try {
      const res = await fetch('/images/AHAD LOGO3.jpeg', { cache: 'force-cache' });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const dims = getJpegDimensions(bytes);
      if (!dims || !dims.width || !dims.height) return null;
      return { bytes, width: dims.width, height: dims.height, components: dims.components || 3 };
    } catch (e) {
      return null;
    }
  }

  async function buildCartInvoicePdfBlob() {
    const customer = selectedCustomerSnapshot();
    const totals = cartTotalsSnapshot();
    const rows = (cart || []).map(cartLineSnapshot);
    const groups = groupInvoiceLines(rows);
    const logo = await loadInvoiceLogoForPdf();
    const lines = [];
    const pad = (text, width) => sanitizePdfText(text).slice(0, width).padEnd(width, ' ');
    const money = n => `GHS ${formatMoney(n)}`;
    const totalLine = (label, value, prefix) => {
      const amount = prefix ? `${prefix} ${money(value)}` : money(value);
      lines.push(`${pad(label, 64)}${amount.padStart(24)}`);
    };

    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(`Invoice No: ${invoiceNumber()}`);
    lines.push('');
    lines.push(`Customer: ${customer.name}`);
    if (customer.phone) lines.push(`Phone: ${customer.phone}`);
    if (customer.category) lines.push(`Type: ${customer.category}`);
    if (customer.jobNote) lines.push(`Job Note: ${customer.jobNote}`);
    lines.push('');
    lines.push('ITEMS');
    lines.push('No  Selection                              Pg   Qty  Shts        Unit     Subtotal');
    lines.push('--  -------------------------------------- ---- ---- ----- ---------- ------------');
    let rowNo = 0;
    groups.forEach(group => {
      lines.push('');
      lines.push(sanitizePdfText(group.title).toUpperCase());
      group.items.forEach(line => {
        rowNo += 1;
        const selection = String(line.description || '').trim() || 'Selection';
        const wrappedSelection = wrapPdfLine(selection, 38);
        const first = wrappedSelection.shift() || '';
        lines.push(
          `${String(rowNo).padEnd(3)} ${pad(first, 38)} ${pad(line.pages || '-', 4)} ${pad(line.qty || '-', 4)} ${pad(line.sheets || '-', 5)} ${money(line.unitPrice).padStart(10)} ${money(line.subtotal).padStart(12)}`
        );
        wrappedSelection.forEach(extra => {
          lines.push(`    ${pad(extra, 38)}`);
        });
        if (line.note) {
          wrapPdfLine(line.note.replace(/GH\u20B5/g, 'GHS'), 84).forEach(noteLine => {
            lines.push(`    ${noteLine}`);
          });
        }
      });
      lines.push(`${pad(`${group.title} subtotal:`, 64)}${money(group.subtotal).padStart(24)}`);
    });
    lines.push('');
    lines.push('--------------------------------------------------------------------------------');
    if (totals.adjustmentAmount > 0) {
      totalLine(totals.adjustmentKind === 'premium' ? 'Premium' : 'Discount', totals.adjustmentAmount, totals.adjustmentKind === 'premium' ? '+' : '-');
    }
    if (totals.taxAmount > 0) {
      const taxLabel = totals.tax && totals.tax.mode === 'percent'
        ? `VAT (${Number(totals.tax.value || 0)}%)`
        : 'VAT';
      totalLine('VATable amount', totals.taxableTotal);
      totalLine(taxLabel, totals.taxAmount, '+');
    }
    if (totals.outsourcedCostTotal > 0) totalLine('Out-Sourced Cost Total', totals.outsourcedCostTotal);
    totalLine('TOTAL', totals.finalTotal);

    const wrapped = [];
    lines.forEach(line => {
      const cleanLine = sanitizePdfText(line);
      // Table rows are pre-padded for Courier; wrapping every line would collapse
      // the spacing and make headers drift away from their columns.
      if (cleanLine.length <= 92) {
        wrapped.push(cleanLine);
      } else {
        wrapPdfLine(cleanLine, 92).forEach(w => wrapped.push(w));
      }
    });

    const pageSize = logo ? 44 : 48;
    const pages = [];
    for (let i = 0; i < wrapped.length; i += pageSize) pages.push(wrapped.slice(i, i + pageSize));
    if (!pages.length) pages.push(['Invoice']);

    const objects = [];
    const addObj = body => {
      objects.push(body);
      return objects.length;
    };

    const catalogId = addObj(''); // placeholder
    const pagesId = addObj(''); // placeholder
    const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
    const fontBoldId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');
    let imageId = null;
    let logoDrawCommand = '';
    if (logo) {
      const imgWidth = 72;
      const imgHeight = Math.min(58, Math.max(30, Number((imgWidth * (logo.height / logo.width)).toFixed(2))));
      const imgX = 50;
      const imgY = 765;
      const colorSpace = logo.components === 1 ? '/DeviceGray' : (logo.components === 4 ? '/DeviceCMYK' : '/DeviceRGB');
      const imageStream = `${bytesToHex(logo.bytes)}>`;
      imageId = addObj(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream`);
      logoDrawCommand = `q\n${imgWidth} 0 0 ${imgHeight} ${imgX} ${imgY} cm\n/Im1 Do\nQ`;
    }
    const buildPdfHeaderCommands = () => {
      const commands = [];
      if (logoDrawCommand) commands.push(logoDrawCommand);
      const companyX = logoDrawCommand ? 136 : 50;
      const infoX = logoDrawCommand ? 278 : 198;
      const addHeaderLabelValue = (x, y, label, value, valueDx) => {
        commands.push(
          'BT',
          '/F2 8 Tf',
          `${x} ${y} Td`,
          `(${pdfEscape(label)}) Tj`,
          'ET',
          'BT',
          '/F1 8 Tf',
          `${x + valueDx} ${y} Td`,
          `(${pdfEscape(value)}) Tj`,
          'ET'
        );
      };
      commands.push(
        'BT',
        '/F2 18 Tf',
        `${companyX} 803 Td`,
        `(${pdfEscape('AHADPRINT')}) Tj`,
        '/F1 9 Tf',
        `0 -16 Td`,
        `(${pdfEscape('INVOICE')}) Tj`,
        'ET'
      );
      addHeaderLabelValue(infoX, 807, 'Services:', 'Digital Printing, Sales of Home Use Computers,', 46);
      commands.push('BT', '/F1 8 Tf', `${infoX} 796 Td`, `(${pdfEscape('Stationery and general merchandise.')}) Tj`, 'ET');
      addHeaderLabelValue(infoX, 785, 'Location:', 'Tamale Technical University.', 48);
      addHeaderLabelValue(infoX, 774, 'Tel:', '0244104350.', 22);
      addHeaderLabelValue(infoX, 763, 'WhatsApp:', '0558590262', 52);
      return commands;
    };
    const pageIds = [];

    pages.forEach(pageLines => {
      const commands = buildPdfHeaderCommands();
      commands.push('BT', '/F1 10 Tf', '50 724 Td');
      pageLines.forEach((line, idx) => {
        if (idx > 0) commands.push('0 -14 Td');
        commands.push(`(${pdfEscape(line)}) Tj`);
      });
      commands.push('ET');
      const stream = commands.join('\n');
      const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const xObjectResource = imageId ? `/XObject << /Im1 ${imageId} 0 R >> ` : '';
      const pageId = addObj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> ${xObjectResource}>> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    });

    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((body, idx) => {
      offsets.push(pdf.length);
      pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }

  async function shareCartInvoicePdf() {
    if (!cart || !cart.length) return showAlertModal('Add items to cart before sharing an invoice.');
    const originalHtml = shareCartInvoiceBtn ? shareCartInvoiceBtn.innerHTML : '';
    if (shareCartInvoiceBtn) {
      shareCartInvoiceBtn.disabled = true;
      shareCartInvoiceBtn.textContent = 'Preparing...';
    }
    try {
      const saved = await saveCurrentCartInvoice(false);
      if (!saved) return;
      const blob = await buildCartInvoicePdfBlob();
      const filename = safeInvoiceFileName();
      const file = (typeof File !== 'undefined')
        ? new File([blob], filename, { type: 'application/pdf' })
        : null;

      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({
          title: 'Invoice',
          text: 'Invoice from AHADPRINT',
          files: [file]
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showAlertModal('PDF downloaded. You can attach and send it to the customer.', 'Invoice PDF');
      }
    } catch (err) {
      console.error('share invoice failed', err);
      showAlertModal('Failed to prepare the invoice PDF.');
    } finally {
      if (shareCartInvoiceBtn) {
        shareCartInvoiceBtn.disabled = false;
        shareCartInvoiceBtn.innerHTML = originalHtml || 'Send / Share PDF';
        updateCartInvoiceButtons();
      }
    }
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

  if (window._isAdmin && applyCartTaxBtn) {
    applyCartTaxBtn.addEventListener('click', function () {
      if (!cart || !cart.length) return showAlertModal('Add items to cart before applying VAT.');

      const mode = cartTaxMode ? String(cartTaxMode.value || 'amount').toLowerCase() : 'amount';
      const value = cartTaxValue ? Number(cartTaxValue.value) : 0;

      if (mode !== 'amount' && mode !== 'percent') {
        return showAlertModal('Select a valid VAT mode.');
      }

      if (!isFinite(value) || value <= 0) {
        return showAlertModal('Enter a valid VAT value (> 0).');
      }

      if (mode === 'percent' && value > 100) {
        return showAlertModal('VAT percentage cannot exceed 100%.');
      }

      manualTax = { mode, value: Number(value) };
      renderCart();
      showAlertModal('VAT applied for this order.', 'VAT');
    });
  }

  if (window._isAdmin && clearCartTaxBtn) {
    clearCartTaxBtn.addEventListener('click', function () {
      manualTax = null;
      if (cartTaxValue) cartTaxValue.value = '';
      if (cartTaxMode) cartTaxMode.value = 'amount';
      renderCart();
      showAlertModal('VAT removed.', 'VAT');
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

  if (printCartInvoiceBtn) {
    printCartInvoiceBtn.addEventListener('click', printCartInvoice);
  }

  if (shareCartInvoiceBtn) {
    shareCartInvoiceBtn.addEventListener('click', shareCartInvoicePdf);
  }

  if (saveCartInvoiceBtn) {
    saveCartInvoiceBtn.addEventListener('click', function () {
      saveCurrentCartInvoice(true);
    });
  }

  async function lookupArtistByTerm(term) {
    const q = String(term || '').trim();
    if (!q) return null;

    try {
      const exactRes = await fetch(`/customers/lookup?phone=${encodeURIComponent(q)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const exact = await exactRes.json().catch(() => null);
      if (exactRes.ok && exact && exact.found && exact.customer) {
        const c = exact.customer;
        if (String(c.category || '').toLowerCase() === 'artist') return c;
      }
    } catch (e) {}

    try {
      const res = await fetch(`/customers/search?q=${encodeURIComponent(q)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const j = await res.json().catch(() => null);
      const rows = (res.ok && j && Array.isArray(j.results)) ? j.results : [];
      const artist = rows.find(r => String(r.category || '').toLowerCase() === 'artist');
      return artist || null;
    } catch (e) {
      return null;
    }
  }

  function artistDisplayName(c) {
    return String((c && (c.businessName || c.firstName || c.phone)) || 'Artist').trim();
  }

  async function searchArtistsByTerm(term) {
    const q = String(term || '').trim();
    if (!q) return [];

    const byId = new Map();
    function addArtist(c) {
      if (!c || String(c.category || '').toLowerCase() !== 'artist') return;
      const id = String(c._id || c.id || '').trim();
      if (!id || byId.has(id)) return;
      byId.set(id, c);
    }

    try {
      const exactRes = await fetch(`/customers/lookup?phone=${encodeURIComponent(q)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const exact = await exactRes.json().catch(() => null);
      if (exactRes.ok && exact && exact.found && exact.customer) addArtist(exact.customer);
    } catch (e) {}

    try {
      const res = await fetch(`/customers/search?q=${encodeURIComponent(q)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const j = await res.json().catch(() => null);
      const rows = (res.ok && j && Array.isArray(j.results)) ? j.results : [];
      rows.forEach(addArtist);
    } catch (e) {}

    return Array.from(byId.values()).slice(0, 8);
  }

  let outsourcedArtistSuggestionsBox = null;
  let outsourcedArtistLookupTimer = null;
  let activeOutsourcedArtistInput = null;

  function createOutsourcedArtistSuggestionsBox() {
    if (outsourcedArtistSuggestionsBox) return outsourcedArtistSuggestionsBox;
    outsourcedArtistSuggestionsBox = document.createElement('div');
    outsourcedArtistSuggestionsBox.className = 'list-group position-absolute shadow-sm';
    outsourcedArtistSuggestionsBox.style.zIndex = 1065;
    outsourcedArtistSuggestionsBox.style.maxHeight = '260px';
    outsourcedArtistSuggestionsBox.style.overflow = 'auto';
    outsourcedArtistSuggestionsBox.style.minWidth = '280px';
    outsourcedArtistSuggestionsBox.style.display = 'none';
    document.body.appendChild(outsourcedArtistSuggestionsBox);
    return outsourcedArtistSuggestionsBox;
  }

  function positionOutsourcedArtistSuggestionsBox(input) {
    const target = input || activeOutsourcedArtistInput;
    if (!outsourcedArtistSuggestionsBox || !target) return;
    const rect = target.getBoundingClientRect();
    outsourcedArtistSuggestionsBox.style.left = (rect.left + window.scrollX) + 'px';
    outsourcedArtistSuggestionsBox.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    outsourcedArtistSuggestionsBox.style.width = Math.max(rect.width, 280) + 'px';
  }

  function hideOutsourcedArtistSuggestions() {
    if (outsourcedArtistSuggestionsBox) outsourcedArtistSuggestionsBox.style.display = 'none';
  }

  function setOutsourcedArtistSelection(input, artist) {
    if (!input || !artist) return;
    const row = input.closest('.list-group-item');
    const idEl = row ? row.querySelector('.outsourced-artist-id') : null;
    const nameEl = row ? row.querySelector('.outsourced-artist-name') : null;
    const id = String(artist._id || artist.id || '').trim();
    const name = artistDisplayName(artist);

    input.value = name;
    input.dataset.selectedArtistId = id;
    if (idEl) idEl.value = id;
    if (nameEl) nameEl.value = name;
    hideOutsourcedArtistSuggestions();
  }

  function clearOutsourcedArtistSelection(input) {
    if (!input) return;
    const row = input.closest('.list-group-item');
    const idEl = row ? row.querySelector('.outsourced-artist-id') : null;
    const nameEl = row ? row.querySelector('.outsourced-artist-name') : null;
    delete input.dataset.selectedArtistId;
    if (idEl) idEl.value = '';
    if (nameEl) nameEl.value = '';
  }

  function renderOutsourcedArtistSuggestions(input, rows) {
    createOutsourcedArtistSuggestionsBox();
    activeOutsourcedArtistInput = input;
    positionOutsourcedArtistSuggestionsBox(input);
    if (!outsourcedArtistSuggestionsBox) return;

    if (!rows || !rows.length) {
      outsourcedArtistSuggestionsBox.style.display = 'none';
      return;
    }

    outsourcedArtistSuggestionsBox.innerHTML = '';
    rows.forEach(artist => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-group-item list-group-item-action';
      const name = artistDisplayName(artist);
      btn.innerHTML = `
        <div class="d-flex w-100 justify-content-between align-items-center">
          <strong>${escapeHtml(name)}</strong>
          <span class="badge bg-info text-dark">Artist</span>
        </div>
        <div class="small text-muted">${escapeHtml(artist.phone || '')}</div>
      `;
      btn.addEventListener('click', function () {
        setOutsourcedArtistSelection(input, artist);
      });
      outsourcedArtistSuggestionsBox.appendChild(btn);
    });
    outsourcedArtistSuggestionsBox.style.display = '';
  }

  async function runOutsourcedArtistLiveSearch(input) {
    if (!input) return;
    const q = String(input.value || '').trim();
    if (!q) {
      hideOutsourcedArtistSuggestions();
      return;
    }
    const rows = await searchArtistsByTerm(q);
    if (input !== activeOutsourcedArtistInput) return;
    if (String(input.value || '').trim() !== q) return;
    renderOutsourcedArtistSuggestions(input, rows);
  }

  async function registerArtistQuick(prefillTerm) {
    const phone = String(prompt('Artist phone number:', String(prefillTerm || '').trim()) || '').trim();
    if (!phone) return null;
    const businessName = String(prompt('Artist name/business name:', '') || '').trim();
    if (!businessName) return null;

    const res = await fetch('/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ category: 'artist', phone, businessName, firstName: '', notes: '' })
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.customer) {
      throw new Error((j && j.error) ? j.error : 'Failed to register artist');
    }
    return j.customer;
  }


  // ---------- Event delegation: Apply / Add buttons ----------
  pricesList.addEventListener('input', function (e) {
    const input = e.target.closest('.outsourced-artist-lookup');
    if (!input) return;

    activeOutsourcedArtistInput = input;
    clearOutsourcedArtistSelection(input);
    if (outsourcedArtistLookupTimer) clearTimeout(outsourcedArtistLookupTimer);

    const q = String(input.value || '').trim();
    if (!q) {
      hideOutsourcedArtistSuggestions();
      return;
    }

    outsourcedArtistLookupTimer = setTimeout(function () {
      runOutsourcedArtistLiveSearch(input);
    }, 220);
  });

  pricesList.addEventListener('focusin', function (e) {
    const input = e.target.closest('.outsourced-artist-lookup');
    if (!input) return;
    activeOutsourcedArtistInput = input;
    createOutsourcedArtistSuggestionsBox();
    positionOutsourcedArtistSuggestionsBox(input);
    if (String(input.value || '').trim() && !input.dataset.selectedArtistId) {
      if (outsourcedArtistLookupTimer) clearTimeout(outsourcedArtistLookupTimer);
      outsourcedArtistLookupTimer = setTimeout(function () {
        runOutsourcedArtistLiveSearch(input);
      }, 120);
    }
  });

  pricesList.addEventListener('keydown', function (e) {
    const input = e.target.closest('.outsourced-artist-lookup');
    if (!input) return;
    if (e.key === 'Escape') hideOutsourcedArtistSuggestions();
  });

  document.addEventListener('click', function (e) {
    if (!outsourcedArtistSuggestionsBox) return;
    if (activeOutsourcedArtistInput && e.target === activeOutsourcedArtistInput) return;
    if (outsourcedArtistSuggestionsBox.contains(e.target)) return;
    hideOutsourcedArtistSuggestions();
  });

  window.addEventListener('resize', function () {
    positionOutsourcedArtistSuggestionsBox();
  });

  window.addEventListener('scroll', function () {
    positionOutsourcedArtistSuggestionsBox();
  }, true);

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

    let outsourcedArtistId = '';
    let outsourcedArtistName = '';
    let outsourcedQty = 0;
    let outsourcedAmount = 0;

    if (selectedServiceCategoryIsOutsourced) {
      const outAmtInput = row ? row.querySelector('.outsourced-amount-input') : null;
      const outArtistLookup = row ? row.querySelector('.outsourced-artist-lookup') : null;
      const outArtistId = row ? row.querySelector('.outsourced-artist-id') : null;
      const outArtistName = row ? row.querySelector('.outsourced-artist-name') : null;

      outsourcedQty = Math.max(1, Math.floor(Number(serviceRequiresPrinter ? factor : pages) || 1));
      outsourcedAmount = Math.max(0, Number(outAmtInput && outAmtInput.value ? outAmtInput.value : 0));
      outsourcedArtistId = String(outArtistId && outArtistId.value ? outArtistId.value : '').trim();
      outsourcedArtistName = String(outArtistName && outArtistName.value ? outArtistName.value : '').trim();

      const hasOutData = outsourcedAmount > 0 || String((outArtistLookup && outArtistLookup.value) || '').trim();
      if (hasOutData) {
        if (outsourcedAmount <= 0) {
          showAlertModal('For Out-Sourced service, enter valid Artist Amount.', 'Out-Sourced');
          return;
        }

        if (!outsourcedArtistId) {
          const term = String((outArtistLookup && outArtistLookup.value) || '').trim();
          if (!term) {
            showAlertModal('Lookup/select an Artist for this out-sourced service.', 'Out-Sourced');
            return;
          }
          const foundArtist = await lookupArtistByTerm(term);
          let artist = foundArtist;
          if (!artist) {
            const shouldRegister = confirm('Artist not found. Register this artist now?');
            if (!shouldRegister) return;
            artist = await registerArtistQuick(term);
          }
          outsourcedArtistId = String(artist._id || '').trim();
          outsourcedArtistName = String(artist.businessName || artist.firstName || artist.phone || term).trim();
          if (outArtistId) outArtistId.value = outsourcedArtistId;
          if (outArtistName) outArtistName.value = outsourcedArtistName;
          if (outArtistLookup) outArtistLookup.value = outsourcedArtistName;
        }
      } else {
        outsourcedQty = 0;
      }
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

      // ✅ match server: (baseCount + spoiled) × factor
      const countNeeded = (Math.max(0, baseCount) + spoiledCount) * factorMul;

      // If materials cache isn't loaded, skip checks (don’t block order flow)
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
            return; // ✅ block adding to cart
          }

          if (warns.length) {
            showAlertModal(warns.join('\n'), 'Low stock');
            // ✅ allow add to cart after warning
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
        tone: priceObj.__tone || serviceToneFromText(priceObj.selectionLabel || ''),
        outsourcedArtistId,
        outsourcedArtistName,
        outsourcedQty,
        outsourcedAmount
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
      addToCart({ serviceId: effectiveServiceId, serviceName, priceRuleId: prId, label: subUnitsOnlyFromLabel(priceObj.selectionLabel || ''), unitPrice: chosenPrice, pages, factor, fb: fbChecked, printerId: selectedPrinterId, spoiled, tone: priceObj.__tone || serviceToneFromText(priceObj.selectionLabel || ''), outsourcedArtistId, outsourcedArtistName, outsourcedQty, outsourcedAmount });
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
      const outAmtInput = row ? row.querySelector('.outsourced-amount-input') : null;
      const outArtistLookup = row ? row.querySelector('.outsourced-artist-lookup') : null;
      const outArtistId = row ? row.querySelector('.outsourced-artist-id') : null;
      const outArtistName = row ? row.querySelector('.outsourced-artist-name') : null;
      if (outAmtInput) outAmtInput.value = '';
      if (outArtistLookup) outArtistLookup.value = '';
      if (outArtistId) outArtistId.value = '';
      if (outArtistName) outArtistName.value = '';
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
      if (getCurrentInvoiceId()) {
        const savedInvoice = await saveCurrentCartInvoice(false);
        if (!savedInvoice) return;
      }

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
            spoiled: bi.spoiled || 0,
            outsourcedArtistId: line.outsourcedArtistId || '',
            outsourcedArtistName: line.outsourcedArtistName || '',
            outsourcedQty: line.outsourcedQty || 0,
            outsourcedAmount: line.outsourcedAmount || 0
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
          spoiled: line.spoiled || 0,
          outsourcedArtistId: line.outsourcedArtistId || '',
          outsourcedArtistName: line.outsourcedArtistName || '',
          outsourcedQty: line.outsourcedQty || 0,
          outsourcedAmount: line.outsourcedAmount || 0
        });
      }
    });

      const payload = {
        items,
        submissionId: getCurrentSubmissionId() || null,
        invoiceId: getCurrentInvoiceId() || null,
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

    try {
      if (window._isAdmin && manualTax && typeof manualTax === 'object') {
        const mode = String(manualTax.mode || '').trim().toLowerCase();
        const value = Number(manualTax.value);
        const validMode = (mode === 'amount' || mode === 'percent');
        const validValue = isFinite(value) && value > 0 && (mode !== 'percent' || value <= 100);
        if (validMode && validValue) {
          payload.tax = { mode, value: Number(value) };
        }
      }
    } catch (e) {
      console.warn('Failed to attach VAT to payload', e);
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

    const completedCustomerId = getCurrentCustomerId();

    showOrderSuccessModal(j.orderId, j.total, (j && j.jobNote) ? j.jobNote : (orderJobNoteEl ? orderJobNoteEl.value : ''));
    if (typeof showGlobalToast === 'function') {
      showGlobalToast(`Order created: ${j.orderId}`, 3200);
    }

    // Reset the order UI immediately. The list/material reloads run in the
    // background so the create button is not held by slow follow-up fetches.
    cart = [];
    if (orderJobNoteEl) orderJobNoteEl.value = '';
    if (completedCustomerId) clearDraft(completedCustomerId);
    setSelectedCustomerFromSubmission(null, { preserveCart: true });
    activeInvoice = null;
    if (orderInvoiceIdEl) orderInvoiceIdEl.value = '';
    if (submittedCustomerSelect) submittedCustomerSelect.value = '';
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
      manualTax = null;
      if (cartTaxValue) cartTaxValue.value = '';
      if (cartTaxMode) cartTaxMode.value = 'amount';
      if (cartTaxSummary) cartTaxSummary.style.display = 'none';
      if (clearCartTaxBtn) clearCartTaxBtn.style.display = 'none';
    } catch (e) {
      // ignore
    }

    renderCart();

    Promise.allSettled([
      loadSecretarySubmissions(),
      loadCartInvoices(cartInvoiceSearchInput ? cartInvoiceSearchInput.value : ''),
      refreshMaterialsIfStale(true)
    ]).catch(err => {
      console.warn('Post-order background refresh failed', err);
    });
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
    const invoiceId = getCurrentInvoiceId();
    if (!submissionId && !invoiceId) {
      showAlertModal('Select a submitted customer/walk-in or load a saved invoice before placing an order.');
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
        manualDiscount: window._isAdmin ? manualDiscount : null,
        manualTax: window._isAdmin ? manualTax : null,
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
      ordersExplorerMode = 'normal';
      if (outsourcedArtistBalanceFilter) outsourcedArtistBalanceFilter.value = 'all';
      updateOrdersExplorerModeButton();
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

  if (toggleOutsourcedOrdersBtn) {
    toggleOutsourcedOrdersBtn.addEventListener('click', function () {
      ordersExplorerMode = ordersExplorerMode === 'outsourced' ? 'normal' : 'outsourced';
      updateOrdersExplorerModeButton();
      renderOrdersList(lastOrdersList);
    });
  }
  if (outsourcedArtistBalanceFilter) {
    outsourcedArtistBalanceFilter.addEventListener('change', function () {
      if (ordersExplorerMode === 'outsourced') renderOrdersList(lastOrdersList);
    });
  }

  function updateOrdersExplorerModeButton() {
    if (!toggleOutsourcedOrdersBtn) return;
    const outsourced = ordersExplorerMode === 'outsourced';
    toggleOutsourcedOrdersBtn.textContent = outsourced ? 'Orders' : 'Outsourced';
    toggleOutsourcedOrdersBtn.classList.remove('btn-info');
    toggleOutsourcedOrdersBtn.classList.add('btn-outline-info');
    toggleOutsourcedOrdersBtn.style.display = '';
    toggleOutsourcedOrdersBtn.style.width = '106px';
    toggleOutsourcedOrdersBtn.style.whiteSpace = 'nowrap';
    toggleOutsourcedOrdersBtn.setAttribute('aria-pressed', outsourced ? 'true' : 'false');
    if (outsourcedArtistBalanceFilterWrap) outsourcedArtistBalanceFilterWrap.style.display = outsourced ? '' : 'none';
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
      lastOrdersList = j.orders;
      renderOrdersList(lastOrdersList);
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
  const sourceOrders = Array.isArray(orders) ? orders : [];
  outsourcedOrderDetailsByKey = Object.create(null);

  if (!sourceOrders.length) {
    tbody.innerHTML = '<tr><td class="text-muted" colspan="6">No orders in this range.</td></tr>';
    if (ordersCountEl) ordersCountEl.textContent = '0 results';
    return;
  }

  tbody.innerHTML = '';
  let groupIndex = 0;

  function hasOutsourcedSide(o) {
    return !!(o && (o.isOutsourced || Number(o.outsourcedTotal || 0) > 0));
  }

  function appendOrderRow(o, opts) {
    const options = opts || {};
    const orderId = o.orderId || o._id || '';
    const safeOrderId = escapeHtml(orderId);
    const name = escapeHtml(options.name || o.name || 'Walk-in');
    const jobNote = options.noteHtml !== undefined ? options.noteHtml : escapeHtml(o.jobNote || '-');
    const rowTotal = Number(options.totalOverride !== undefined ? options.totalOverride : (o.total || 0));
    const statusText = options.statusText !== undefined ? options.statusText : (o.status || '');
    const created = o.createdAt ? formatDateTimeForDisplay(o.createdAt) : (o.createdAt || '');
    const isOutsourcedRow = !!options.outsourcedKey;
    const viewHref = '/orders/view/' + encodeURIComponent(orderId);
    const artistId = String(options.artistId || o.artistId || '').trim();
    const accountAction = isOutsourcedRow && artistId && options.showAccount !== false
      ? `<a class="btn btn-sm btn-outline-info ms-1 outsourced-artist-account-link" href="/customers/${encodeURIComponent(artistId)}/account" data-ajax="true">Account</a>`
      : '';

    const tr = document.createElement('tr');
    if (options.groupId) {
      tr.className = `orders-group-row ${options.groupId}`;
      tr.style.display = 'none';
    }
    tr.dataset.orderId = orderId;
    tr.innerHTML = `
      <td>
        ${isOutsourcedRow
          ? `<span title="Order ID: ${safeOrderId}">${name}</span>`
          : `<a href="${viewHref}" class="orders-explorer-open-order" title="Order ID: ${safeOrderId}">${name}</a>`}
      </td>
      <td>${jobNote}</td>
      <td class="text-end">GH\u20b5 ${formatMoney(rowTotal)}</td>
      <td>${escapeHtml(statusText)}</td>
      <td>${escapeHtml(created)}</td>
      <td class="text-center">
        <button
          class="btn btn-sm btn-outline-secondary ${isOutsourcedRow ? 'view-outsourced-order-btn' : 'view-order-btn'}"
          data-order-id="${safeOrderId}"
          ${isOutsourcedRow ? `data-outsourced-key="${escapeHtml(options.outsourcedKey)}"` : ''}>
          View
        </button>
        ${accountAction}
      </td>
    `;
    tbody.appendChild(tr);
  }

  function appendGroupedRows(rows, opts) {
    const options = opts || {};
    const grouped = {};
    rows.forEach(o => {
      const key = String(o && o.name ? o.name : 'Walk-in');
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(o);
    });

    Object.entries(grouped).forEach(([nameRaw, items]) => {
      if (!items || items.length <= 1) {
        const only = items[0];
        appendOrderRow(only, {
          noteHtml: only && only.noteHtml,
          statusText: only && only.status,
          totalOverride: only && only.total,
          outsourcedKey: only && only.outsourcedKey,
          artistId: only && only.artistId
        });
        return;
      }

      const groupId = `orders-group-${groupIndex++}`;
      const safeName = escapeHtml(nameRaw || 'Walk-in');
      const groupTotal = items.reduce((s, it) => s + Number(it.total || 0), 0);
      const groupArtistId = String((items.find(it => it && it.artistId) || {}).artistId || '').trim();
      const groupAccountAction = groupArtistId
        ? `<a class="btn btn-sm btn-outline-info ms-2 outsourced-artist-account-link" href="/customers/${encodeURIComponent(groupArtistId)}/account" data-ajax="true">Account</a>`
        : '';
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
        <td class="text-end">GH\u20b5 ${formatMoney(groupTotal)}</td>
        <td>${options.statusText || 'Grouped'}</td>
        <td>${latestCreated ? escapeHtml(formatDateTimeForDisplay(latestCreated.toISOString())) : '-'}</td>
        <td class="text-center"><span class="text-muted">Expand</span>${groupAccountAction}</td>
      `;
      tbody.appendChild(groupTr);

      items.forEach(o => {
        appendOrderRow(o, {
          name: nameRaw || 'Walk-in',
          groupId,
          noteHtml: o.noteHtml,
          statusText: o.status,
          totalOverride: o.total,
          outsourcedKey: o.outsourcedKey,
          artistId: o.artistId,
          showAccount: false
        });
      });
    });
  }

  function buildOutsourcedEntries(source) {
    const entries = [];
    source.filter(hasOutsourcedSide).forEach(order => {
      const groupedByArtist = {};
      const details = Array.isArray(order.outsourcedDetails) ? order.outsourcedDetails : [];

      details.forEach(detail => {
        const artistName = String(detail.artistName || 'Out-Sourced Artist').trim() || 'Out-Sourced Artist';
        const artistId = String(detail.artistId || '').trim();
        const key = artistId || artistName;
        if (!groupedByArtist[key]) {
          groupedByArtist[key] = {
            artistId,
            artistName,
            artistAccountBalance: Number(detail.artistAccountBalance || 0),
            details: []
          };
        }
        groupedByArtist[key].details.push(detail);
      });

      if (!Object.keys(groupedByArtist).length && Number(order.outsourcedTotal || 0) > 0) {
        groupedByArtist['Out-Sourced Artist'] = {
          artistId: '',
          artistName: 'Out-Sourced Artist',
          artistAccountBalance: 0,
          details: [{
            artistName: 'Out-Sourced Artist',
            selectionLabel: 'Out-sourced work',
            qty: 0,
            amount: 0,
            total: Number(order.outsourcedTotal || 0)
          }]
        };
      }

      Object.values(groupedByArtist).forEach((artistGroup, index) => {
        const artistName = artistGroup.artistName || 'Out-Sourced Artist';
        const artistDetails = Array.isArray(artistGroup.details) ? artistGroup.details : [];
        const total = artistDetails.reduce((s, d) => s + Number(d.total || 0), 0);
        const key = `${String(order.orderId || order._id || '')}::${index}::${artistGroup.artistId || artistName}`;
        const cleanDetails = artistDetails.map(d => ({
          artistId: artistGroup.artistId || String(d.artistId || '').trim(),
          artistName,
          artistAccountBalance: Number(artistGroup.artistAccountBalance || d.artistAccountBalance || 0),
          selectionLabel: String(d.selectionLabel || '').trim(),
          qty: Number(d.qty || 0),
          amount: Number(d.amount || 0),
          total: Number(d.total || 0)
        }));

        const entry = {
          _id: order._id,
          orderId: order.orderId,
          name: artistName,
          artistId: artistGroup.artistId || '',
          artistAccountBalance: Number(artistGroup.artistAccountBalance || 0),
          originalCustomerName: order.name || 'Walk-in',
          jobNote: String(order.jobNote || '').trim(),
          total: Number(total.toFixed(2)),
          status: 'Creditor',
          createdAt: order.createdAt,
          outsourcedKey: key,
          outsourcedDetails: cleanDetails
        };
        outsourcedOrderDetailsByKey[key] = entry;
        entries.push(entry);
      });
    });
    return entries;
  }

  if (ordersExplorerMode === 'outsourced') {
    const balanceFilter = String(outsourcedArtistBalanceFilter ? outsourcedArtistBalanceFilter.value : 'all');
    const outsourcedRowsAll = buildOutsourcedEntries(sourceOrders);
    const outsourcedRows = outsourcedRowsAll.filter(row => {
      const bal = Number(row.artistAccountBalance || 0);
      if (balanceFilter === 'credit') return bal > 0;
      if (balanceFilter === 'no_credit') return bal <= 0;
      return true;
    });
    if (!outsourcedRows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="6">No outsourced orders match this filter.</td></tr>';
      if (ordersCountEl) ordersCountEl.textContent = '0 outsourced results';
      return;
    }
    appendGroupedRows(outsourcedRows, { statusText: 'Creditor' });
    if (ordersCountEl) {
      const suffix = outsourcedRowsAll.length !== outsourcedRows.length ? ` of ${outsourcedRowsAll.length}` : '';
      ordersCountEl.textContent = `${outsourcedRows.length}${suffix} outsourced result${outsourcedRows.length > 1 ? 's' : ''}`;
    }
    return;
  }

  appendGroupedRows(sourceOrders);
  if (ordersCountEl) {
    ordersCountEl.textContent = `${sourceOrders.length} result${sourceOrders.length > 1 ? 's' : ''}`;
  }
}
  // ---------- view order details (orders explorer / detail modal) ----------
  async function viewOrderDetails(orderId) {
    if (!orderId) return;
    setOrderDetailsActionsVisible(true);
    if (orderDetailsMeta) orderDetailsMeta.style.display = '';
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

      const metaText = `Order ID: ${o.orderId} - Total: GH\u20b5 ${formatMoney(o.total)} - Status: ${o.status} - Created: ${formatDateTimeForDisplay(o.createdAt)}${jobNote ? ` - Note / Job Type: ${jobNote}` : ''}`;
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

          // IMPORTANT: display the stored subtotal and pages — do not recompute based on pages only.
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

      const rawAdjustment = Number(o.discountAmount || 0);
      const hasAdjustment = Math.abs(rawAdjustment) > 0;
      const taxAmount = Number(o.taxAmount || 0);
      if (hasAdjustment || taxAmount > 0) {
        const isPremium = rawAdjustment < 0;
        const adjustmentAmount = Math.abs(rawAdjustment);
        const totalBeforeAdjustment = (typeof o.totalBeforeDiscount !== 'undefined' && o.totalBeforeDiscount !== null)
          ? Number(o.totalBeforeDiscount || 0)
          : Number((Number(o.total || 0) + Number(rawAdjustment || 0) - taxAmount).toFixed(2));
        const tb = (o.taxBreakdown && typeof o.taxBreakdown === 'object') ? o.taxBreakdown : {};
        const taxableAmount = (typeof tb.taxableAmount !== 'undefined' && tb.taxableAmount !== null)
          ? Number(tb.taxableAmount || 0)
          : Number(Math.max(0, Number(o.total || 0) - taxAmount).toFixed(2));

        html += '<div class="mt-3 text-end">';
        if (hasAdjustment) {
          html += `<div><span class="text-muted-light">Total before adjustment:</span> <strong>GH\u20B5 ${formatMoney(totalBeforeAdjustment)}</strong></div>`;
          html += `<div><span class="text-muted-light">${isPremium ? 'Premium:' : 'Discount:'}</span> <strong>${isPremium ? '+' : '-'} GH\u20B5 ${formatMoney(adjustmentAmount)}</strong></div>`;
        }
        if (taxAmount > 0) {
          html += `<div><span class="text-muted-light">VATable amount:</span> <strong>GH\u20B5 ${formatMoney(taxableAmount)}</strong></div>`;
          html += `<div><span class="text-muted-light">VAT:</span> <strong>+ GH\u20B5 ${formatMoney(taxAmount)}</strong></div>`;
        }
        html += `<div><span class="text-muted-light">Total:</span> <strong>GH\u20B5 ${formatMoney(o.total || 0)}</strong></div>`;
        html += '</div>';
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

  function viewOutsourcedOrderDetails(key) {
    const entry = outsourcedOrderDetailsByKey && outsourcedOrderDetailsByKey[key];
    if (!entry) return;
    setOrderDetailsActionsVisible(false);

    const total = Number(entry.total || 0);
    const created = entry.createdAt ? formatDateTimeForDisplay(entry.createdAt) : '';
    if (orderDetailsMeta) {
      orderDetailsMeta.textContent = '';
      orderDetailsMeta.style.display = 'none';
    }

    const rows = (entry.outsourcedDetails || []).map(detail => {
      const label = subUnitsOnlyFromLabel(detail.selectionLabel || '') || detail.selectionLabel || 'Out-sourced work';
      return `
        <tr>
          <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;">${escapeHtml(label)}</td>
          <td class="text-center">${escapeHtml(String(detail.qty || 0))}</td>
          <td class="text-end">GH₵ ${formatMoney(detail.amount || 0)}</td>
          <td class="text-end">GH₵ ${formatMoney(detail.total || 0)}</td>
        </tr>
      `;
    }).join('');

    const html = `
      <div class="table-responsive">
        <table class="table table-sm table-borderless mb-0">
          <thead>
            <tr>
              <th>Selection</th>
              <th class="text-center">QTY</th>
              <th class="text-end">Artist Amount</th>
              <th class="text-end">Total</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td class="text-muted" colspan="4">No outsourced details listed.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="mt-3" style="font-size:1rem;line-height:1.65;color:#111827;font-weight:500;">
        <div>Order ID: ${escapeHtml(entry.orderId || '')}</div>
        <div>Customer: ${escapeHtml(entry.name || 'Out-Sourced Artist')}</div>
        <div>Artist Credit Balance: GH\u20b5 ${formatMoney(entry.artistAccountBalance || 0)}</div>
        <div>Out-Sourced Cost: GH₵ ${formatMoney(total)}</div>
        ${entry.jobNote ? `<div>Note / Job Type: ${escapeHtml(entry.jobNote)}</div>` : ''}
        <div>Created: ${escapeHtml(created)}</div>
      </div>
    `;

    if (orderDetailsJson) orderDetailsJson.innerHTML = html;
    if (orderDetailsModal) orderDetailsModal.show();
  }

  // Orders table click delegation (view button)
  if (ordersTable) {
    ordersTable.addEventListener('click', function (ev) {
      const accountLink = ev.target.closest('.outsourced-artist-account-link');
      if (accountLink) return;

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
      const outBtn = ev.target.closest('.view-outsourced-order-btn');
      if (outBtn) {
        viewOutsourcedOrderDetails(outBtn.dataset.outsourcedKey || '');
        return;
      }
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
      const rawMeta = (orderDetailsMeta && orderDetailsMeta.textContent) ? orderDetailsMeta.textContent : '';
      const text = rawMeta.replace(/^Order ID:\s*/i, '').split(/\s+(?:-|\u2014)\s+/)[0].trim();
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
      const title = 'AHADPRINT';
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>@page{margin:0}body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:22px;color:#111}.brand{display:flex;align-items:center;gap:12px;margin-bottom:14px}.brand img{max-height:60px}.brand-name{font-size:22px;font-weight:800;letter-spacing:.08em}.order-meta{border:1px solid #ddd;border-radius:8px;padding:10px 12px;margin:0 0 14px}pre{white-space:pre-wrap;background:#f8f9fa;padding:12px;border-radius:6px}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #eee}</style>
        </head><body>
        <div class="brand"><img src="/images/AHAD%20LOGO3.jpeg" alt="AHADPRINT logo"><div class="brand-name">AHADPRINT</div></div>
        <p class="order-meta">${escapeHtml(meta || '')}</p>
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



