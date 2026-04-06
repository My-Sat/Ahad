// public/javascripts/orders_pay.js
function initOrdersPay() {
  'use strict';

  const fetchForm = document.getElementById('fetchOrderForm');
  if (!fetchForm) return;
  if (fetchForm.dataset.ordersPayInit === '1') return;
  fetchForm.dataset.ordersPayInit = '1';
  const fetchOrderIdInput = document.getElementById('fetchOrderId');
  const fetchOrderBtn = document.getElementById('fetchOrderBtn');
  const dailyOrdersSelect = document.getElementById('dailyOrdersSelect');
  const dailyTotalsContainer = document.getElementById('dailyTotalsContainer');
  const dailyOrdersTotalAmountEl = document.getElementById('dailyOrdersTotalAmount');
  const dailyPaidOrdersTotalAmountEl = document.getElementById('dailyPaidOrdersTotalAmount');
  const dailyTotalsToggleBtn = document.getElementById('dailyTotalsToggleBtn');
  const orderInfo = document.getElementById('orderInfo');
  const payNowBtn = document.getElementById('payNowBtn');
  const payManualDiscountCard = document.getElementById('payManualDiscountCard');
  const payManualDiscountMode = document.getElementById('payManualDiscountMode');
  const payManualDiscountValue = document.getElementById('payManualDiscountValue');
  const applyManualDiscountBtn = document.getElementById('applyManualDiscountBtn');

  const openCashiersBtn = document.getElementById('openCashiersBtn');
const cashiersModalEl = document.getElementById('cashiersModal');
const cashiersModal = (window.bootstrap && cashiersModalEl) ? new bootstrap.Modal(cashiersModalEl) : null;
const cashiersTable = document.getElementById('cashiersTable');
const cashiersStatusLoading = document.getElementById('cashiersStatusLoading');
const cashiersStatusNote = document.getElementById('cashiersStatusNote');
const cashiersShowAllBtn = document.getElementById('cashiersShowAllBtn');


  // new UI elements
  const paymentControls = document.getElementById('paymentControls');
  const paymentMethodSel = document.getElementById('paymentMethod');
  const momoFields = document.getElementById('paymentMomoFields');
  const momoNumberInput = document.getElementById('momoNumber');
  const momoTxInput = document.getElementById('momoTxId');
  const chequeField = document.getElementById('paymentChequeField');
  const chequeNumberInput = document.getElementById('chequeNumber');
  const partToggle = document.getElementById('partPaymentToggle');
  const partWrapper = document.getElementById('partPaymentAmountWrapper');
  const partAmountInput = document.getElementById('partPaymentAmount');

  const openDebtorsBtn = document.getElementById('openDebtorsBtn');
  const debtorsModalEl = document.getElementById('debtorsModal');
  const debtorsModal = (window.bootstrap && debtorsModalEl) ? new bootstrap.Modal(debtorsModalEl) : null;
  const debtorsTable = document.getElementById('debtorsTable');
  const debtorsCount = document.getElementById('debtorsCount');
  const debtorsTotalDueEl = document.getElementById('debtorsTotalDue');
  const debtorsTotalPaidEl = document.getElementById('debtorsTotalPaid');
  const debtorsTotalOutstandingEl = document.getElementById('debtorsTotalOutstanding');
  const fullPaymentModalEl = document.getElementById('fullPaymentConfirmModal');
  const fullPaymentModal = fullPaymentModalEl ? new bootstrap.Modal(fullPaymentModalEl) : null;
  const debtorsSearchInput = document.getElementById('debtorsSearchInput');
  const debtorsSearchClearBtn = document.getElementById('debtorsSearchClearBtn');

  let debtorsSearchTimer = null;
  const DEBTORS_SEARCH_DEBOUNCE = 220;

  // cache last fetched debtors so we can filter locally too
  let _debtorsCache = [];
  let _debtorsLastQuery = '';

  function setDebtorsSummary(totalDue, totalPaid, totalOutstanding) {
    if (debtorsTotalDueEl) debtorsTotalDueEl.textContent = formatCedi(totalDue || 0);
    if (debtorsTotalPaidEl) debtorsTotalPaidEl.textContent = formatCedi(totalPaid || 0);
    if (debtorsTotalOutstandingEl) debtorsTotalOutstandingEl.textContent = formatCedi(totalOutstanding || 0);
  }


  const fullPaymentConfirmText = document.getElementById('fullPaymentConfirmText');
  const fullPaymentMethod = document.getElementById('fullPaymentMethod');
  const fullPaymentMomoFields = document.getElementById('fullPaymentMomoFields');
  const fullPaymentChequeField = document.getElementById('fullPaymentChequeField');
  const fullPaymentMomoNumber = document.getElementById('fullPaymentMomoNumber');
  const fullPaymentMomoTx = document.getElementById('fullPaymentMomoTx');
  const fullPaymentCheque = document.getElementById('fullPaymentCheque');
  const confirmFullPaymentBtn = document.getElementById('confirmFullPaymentBtn');

  let pendingFullPayment = null; // holds orderIds + total

  if (fullPaymentMethod) {
  fullPaymentMethod.addEventListener('change', function () {
    const v = this.value;
    fullPaymentMomoFields.style.display = v === 'momo' ? '' : 'none';
    fullPaymentChequeField.style.display = v === 'cheque' ? '' : 'none';
  });
}



  let currentOrderId = null;
  let currentOrderTotal = 0;
  let currentOrderStatus = null;

  // --- NEW: customer account context for fetched order ---
  let currentHasCustomer = false;
  let currentCustomerId = null;
  let currentCustomerBalance = 0;
  let currentOutstanding = 0;
  let currentHasDiscount = false;
  const isAdminUser = (typeof window._isAdmin !== 'undefined')
    ? (window._isAdmin === true || window._isAdmin === 'true')
    : false;

  // Helper: format money
  function fmt(n) {
    return Number(n).toFixed(2);
  }

  function formatCedi(n) {
    return `GH\u20B5 ${fmt(n)}`;
  }

  let dailyTotalsLoading = false;
  let dailyTotalsLoaded = false;
  let dailyTotalsLastDate = '';

  function setDailyTotalsAmounts(totalOrders, totalPaid) {
    if (!dailyOrdersTotalAmountEl || !dailyPaidOrdersTotalAmountEl) return;

    dailyOrdersTotalAmountEl.dataset.amount = String(Number(totalOrders || 0));
    dailyPaidOrdersTotalAmountEl.dataset.amount = String(Number(totalPaid || 0));

    const hidden = dailyTotalsContainer && dailyTotalsContainer.dataset.hidden === '1';
    if (!hidden) {
      dailyOrdersTotalAmountEl.textContent = formatCedi(totalOrders || 0);
      dailyPaidOrdersTotalAmountEl.textContent = formatCedi(totalPaid || 0);
    }
  }

  function setDailyTotalsError() {
    if (!dailyOrdersTotalAmountEl || !dailyPaidOrdersTotalAmountEl) return;
    dailyOrdersTotalAmountEl.dataset.amount = '';
    dailyPaidOrdersTotalAmountEl.dataset.amount = '';
    dailyOrdersTotalAmountEl.textContent = '-';
    dailyPaidOrdersTotalAmountEl.textContent = '-';
  }

  function applyDailyTotalsVisibility(hidden) {
    if (!dailyOrdersTotalAmountEl || !dailyPaidOrdersTotalAmountEl || !dailyTotalsToggleBtn) return;

    if (dailyTotalsContainer) {
      dailyTotalsContainer.dataset.hidden = hidden ? '1' : '0';
    }

    if (hidden) {
      dailyOrdersTotalAmountEl.textContent = '****';
      dailyPaidOrdersTotalAmountEl.textContent = '****';
      dailyTotalsToggleBtn.innerHTML = '<i class="bi bi-eye me-1"></i> Show amount';
      dailyTotalsToggleBtn.setAttribute('aria-pressed', 'true');
    } else {
      const ordersAmt = Number(dailyOrdersTotalAmountEl.dataset.amount || 0);
      const paidAmt = Number(dailyPaidOrdersTotalAmountEl.dataset.amount || 0);
      dailyOrdersTotalAmountEl.textContent = formatCedi(ordersAmt);
      dailyPaidOrdersTotalAmountEl.textContent = formatCedi(paidAmt);
      dailyTotalsToggleBtn.innerHTML = '<i class="bi bi-eye-slash me-1"></i> Hide amount';
      dailyTotalsToggleBtn.setAttribute('aria-pressed', 'false');
    }
  }
  function setPayManualDiscountVisibility(show) {
    if (!payManualDiscountCard) return;
    payManualDiscountCard.style.display = show ? '' : 'none';
    if (!show) {
      if (payManualDiscountValue) payManualDiscountValue.value = '';
      if (payManualDiscountMode) payManualDiscountMode.value = 'amount';
    }
  }

  function isoDate(d) {
    const dt = d ? new Date(d) : new Date();
    const yr = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yr}-${mm}-${dd}`;
  }

  async function loadDailyOrdersDropdown(opts = {}) {
    if (!dailyOrdersSelect) return;
    if (dailyTotalsLoading) return;

    const today = isoDate(new Date());
    if (!opts.force && dailyTotalsLoaded && dailyTotalsLastDate === today) return;

    dailyTotalsLoading = true;
    dailyTotalsLastDate = today;
    if (dailyTotalsContainer) dailyTotalsContainer.dataset.totalsLoading = '1';

    dailyOrdersSelect.innerHTML = '<option value="">Loading today\'s orders...</option>';

    try {
      const url = `/orders/list?from=${encodeURIComponent(today)}&to=${encodeURIComponent(today)}&scope=pay`;
      const res = await fetch(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const j = await res.json().catch(() => null);

      if (!res.ok || !j || !Array.isArray(j.orders)) {
        throw new Error('Invalid response');
      }

      if (!j.orders.length) {
        dailyOrdersSelect.innerHTML = '<option value="">No orders today</option>';
        setDailyTotalsAmounts(0, 0);
        dailyTotalsLoaded = true;
        if (dailyTotalsContainer) dailyTotalsContainer.dataset.totalsLoaded = '1';
        return;
      }

      let totalOrders = 0;
      let totalPaidOrders = 0;
      j.orders.forEach(o => {
        const amt = Number(o.total || 0);
        totalOrders += amt;
        const paidInRange = Number(o.paidInRange);
        if (!isNaN(paidInRange)) {
          totalPaidOrders += paidInRange;
        } else if (String(o.status || '').toLowerCase() === 'paid') {
          totalPaidOrders += amt;
        }
      });
      setDailyTotalsAmounts(
        Number(totalOrders.toFixed(2)),
        Number(totalPaidOrders.toFixed(2))
      );

      const options = ['<option value="">Select today\'s orders...</option>'];
      j.orders.forEach(o => {
        const id = String(o.orderId || '').trim();
        if (!id) return;
        const name = String(o.name || '').trim();
        const showName = name && name.toLowerCase() !== 'walk-in';
        const label = showName ? `${name} ${id}` : id;
        options.push(`<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`);
      });

      dailyOrdersSelect.innerHTML = options.join('');
      dailyTotalsLoaded = true;
      if (dailyTotalsContainer) dailyTotalsContainer.dataset.totalsLoaded = '1';
    } catch (err) {
      console.error('loadDailyOrdersDropdown error', err);
      dailyOrdersSelect.innerHTML = '<option value="">Failed to load today\'s orders</option>';
      setDailyTotalsError();
      dailyTotalsLoaded = false;
    }
    finally {
      dailyTotalsLoading = false;
      if (dailyTotalsContainer) dailyTotalsContainer.dataset.totalsLoading = '0';
    }
  }

  function startDailyOrdersAutoRefresh() {
    if (!dailyOrdersSelect) return;
    if (dailyOrdersSelect.dataset.autoRefresh === '1') return;
    dailyOrdersSelect.dataset.autoRefresh = '1';

    const refreshMs = 15000;
    setInterval(() => {
      try {
        // avoid unnecessary work if the tab is hidden
        if (document.hidden) return;
        loadDailyOrdersDropdown({ force: true });
      } catch (e) {}
    }, refreshMs);
  }

    function computeOutstanding(order) {
    if (!order) return 0;

    if (typeof order.outstanding !== 'undefined' && order.outstanding !== null) {
      const o = Number(order.outstanding);
      return isNaN(o) ? 0 : Number(o.toFixed(2));
    }

    let paid = 0;
    if (order.payments && Array.isArray(order.payments)) {
      order.payments.forEach(p => {
        const a = Number(p.amount || 0);
        if (!isNaN(a)) paid += a;
      });
    }

    const out = Number((Number(order.total || 0) - paid).toFixed(2));
    return isNaN(out) ? 0 : out;
  }


  // Escape helper for safety
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

  function titleCaseFromKey(s) {
  if (!s) return '';
  return String(s)
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function discountAppliedLabel(order) {
  const db = (order && order.discountBreakdown && typeof order.discountBreakdown === 'object')
    ? order.discountBreakdown
    : {};

  // If backend already provides a friendly label, prefer it
  if (db.appliedLabel) return String(db.appliedLabel);
  if (db.appliedName) return String(db.appliedName);

  const scope = String(db.scope || '').trim();

  // CUSTOMER TYPE: regular / one_time / organisation / artist
  if (scope === 'customer_type') {
    const raw =
      db.customerType ||
      db.target ||
      (Array.isArray(db.targets) ? db.targets[0] : null) ||
      db.key ||
      db.label || '';

    const map = {
      regular: 'Regular',
      one_time: 'One-Time',
      organisation: 'Organisation',
      artist: 'Artist'
    };
    const key = String(raw || '').toLowerCase().trim();
    return map[key] || titleCaseFromKey(raw);
  }

  // SERVICE / CATEGORY: show actual name if provided
  if (scope === 'service' || scope === 'service_category') {
    const raw =
      db.serviceName ||
      db.categoryName ||
      db.targetName ||
      db.name ||
      db.label || '';
    return String(raw || '').trim();
  }

  // GENERAL / unknown: fallback
  return String(db.label || 'Discount').trim();
}


  // Extract sub-unit names from a selectionLabel like "Unit: Sub + Unit2: Sub2"
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

  // -------------------------
  // Modal helpers (create lazily)
  // -------------------------
  function _createModalFromHtml(html) {
    const container = document.createElement('div');
    container.innerHTML = html.trim();
    document.body.appendChild(container.firstElementChild);
    return document.body.lastElementChild;
  }
  

  function showAlertModal(message, title = 'Notice') {
    let modalEl = document.getElementById('ordersPayAlertModal');
    if (!modalEl) {
      const html = `
<div class="modal fade" id="ordersPayAlertModal" tabindex="-1" aria-labelledby="ordersPayAlertModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="ordersPayAlertModalLabel"></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body" id="ordersPayAlertModalBody"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-light-custom" data-bs-dismiss="modal">OK</button>
      </div>
    </div>
  </div>
</div>`;
      modalEl = _createModalFromHtml(html);
    }
    try {
      const titleEl = modalEl.querySelector('#ordersPayAlertModalLabel');
      const bodyEl = modalEl.querySelector('#ordersPayAlertModalBody');
      if (titleEl) titleEl.textContent = title || 'Notice';
      if (bodyEl) bodyEl.innerHTML = escapeHtml(String(message || ''));
      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      inst.show();
    } catch (err) {
      try { alert(message); } catch (e) { console.error('Alert fallback failed', e); }
    }
  }

  async function showConfirmModal(message, title = 'Confirm') {
    return new Promise((resolve) => {
      let modalEl = document.getElementById('ordersPayConfirmModal');
      if (!modalEl) {
        const html = `
<div class="modal fade" id="ordersPayConfirmModal" tabindex="-1" aria-labelledby="ordersPayConfirmModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="ordersPayConfirmModalLabel"></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body" id="ordersPayConfirmModalBody"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-light-custom" data-action="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="confirm">Yes</button>
      </div>
    </div>
  </div>
</div>`;
        modalEl = _createModalFromHtml(html);
      }

      const titleEl = modalEl.querySelector('#ordersPayConfirmModalLabel');
      const bodyEl = modalEl.querySelector('#ordersPayConfirmModalBody');
      const btnConfirm = modalEl.querySelector('button[data-action="confirm"]');
      const btnCancel = modalEl.querySelector('button[data-action="cancel"]');

      if (titleEl) titleEl.textContent = title || 'Confirm';
      if (bodyEl) bodyEl.innerHTML = escapeHtml(String(message || ''));

      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

      function cleanup() {
        try {
          btnConfirm.removeEventListener('click', onConfirm);
          btnCancel.removeEventListener('click', onCancel);
          modalEl.removeEventListener('hidden.bs.modal', onHidden);
        } catch (e) {}
      }

      function onConfirm() {
        cleanup();
        inst.hide();
        resolve(true);
      }
      function onCancel() {
        cleanup();
        inst.hide();
        resolve(false);
      }
      function onHidden() {
        cleanup();
        resolve(false);
      }

      btnConfirm.addEventListener('click', onConfirm);
      btnCancel.addEventListener('click', onCancel);
      modalEl.addEventListener('hidden.bs.modal', onHidden);

      inst.show();
    });
  }

  // Render a single order's details into the #orderInfo element.
  // Shows only sub-unit names (comma separated). Single-line selection (no wrapping).
  // Hides Pay button if order.status === 'paid'
  // -------------------------
  function renderOrderDetails(order) {
    if (!order) {
      orderInfo.innerHTML = '<p class="text-muted">No order loaded.</p>';
      if (paymentControls) paymentControls.style.display = 'none';
      payNowBtn.style.display = 'none';
      payNowBtn.disabled = true;
      setPayManualDiscountVisibility(false);
      currentOrderId = null;
      currentOrderTotal = 0;
      currentOrderStatus = null;
      currentHasDiscount = false;
      return;
    }

    currentOrderId = order.orderId;
    currentOrderTotal = order.total;
    currentOrderStatus = order.status;

        // reset customer/account state
    currentHasCustomer = false;
    currentCustomerId = null;
    currentCustomerBalance = 0;
    currentOutstanding = 0;


    let itemsHtml = '';
    if (order.items && order.items.length) {
      itemsHtml += `<div class="list-group mb-2">`;
      order.items.forEach(it => {
        const rawLabel = it.selectionLabel || '';
        let selLabel = subUnitsOnlyFromLabel(rawLabel);
        if (!selLabel && it.selections && it.selections.length) {
          selLabel = it.selections.map(s => {
            if (s.subUnit && typeof s.subUnit === 'object' && s.subUnit.name) return s.subUnit.name;
            if (s.subUnit && typeof s.subUnit === 'string') return s.subUnit;
            return '';
          }).filter(Boolean).join(', ');
        }
        if (!selLabel) selLabel = '(no label)';
        const isFb = (it.fb === true) || (typeof rawLabel === 'string' && rawLabel.includes('(F/B)'));
        const fbBadge = isFb ? ' <span class="badge bg-secondary ms-2">F/B</span>' : '';
        // prefer server-stored effectiveQty if available
        // prefer server-stored effectiveQty if available (this is "effective sheets" BEFORE factor)
        const rawPages = Number(it.pages || 1);
        const baseSheets =
          (typeof it.effectiveQty !== 'undefined' && it.effectiveQty !== null)
            ? Number(it.effectiveQty)
            : (isFb ? Math.ceil(rawPages / 2) : rawPages);

        const requiresPrinter = !!it.printer;
        const factor = Math.max(1, Math.floor(Number(it.factor || 1)));

        // DISPLAY FIX:
        // - non-printing: QTY = baseSheets
        // - printing: Sheets = baseSheets Ã— factor
        const displayQty = requiresPrinter ? (baseSheets * factor) : baseSheets;

        const qtyLabel = requiresPrinter ? 'Sheets' : 'QTY';
        const pages = requiresPrinter ? rawPages : null;

        const unit = Number(it.unitPrice || 0);

        // prefer server-subtotal; otherwise compute from DISPLAY qty for consistency
        const subtotal = Number(
          (typeof it.subtotal === 'number' || !isNaN(Number(it.subtotal)))
            ? Number(it.subtotal)
            : (displayQty * unit)
        );

        const serviceName = it.serviceName || 'Service';

        itemsHtml += `
          <div class="list-group-item d-flex align-items-start justify-content-between" style="padding:0.5rem 0.75rem;">
            <div style="flex:1;min-width:0;">
              <div class="fw-semibold">
                ${escapeHtml(serviceName)}
              </div>

              <span style="display:inline-block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px;">
                ${escapeHtml(selLabel)}
              </span>
            </div>

            <div class="text-end ms-3" style="min-width:200px;">
            <div>${qtyLabel}: ${escapeHtml(String(displayQty))}</div>
            ${ requiresPrinter ? `<div>Pages: ${escapeHtml(String(pages))}</div>` : '' }
            ${ (requiresPrinter && factor > 1) ? `<div>QTY Ã—${factor}</div>` : '' }
              <div>Unit: GH₵ ${escapeHtml(fmt(unit))}</div>
              <div>Subtotal: GH₵ ${escapeHtml(fmt(subtotal))}</div>
            </div>
          </div>
        `;
      });
      itemsHtml += `</div>`;
    } else {
      itemsHtml = '<p class="text-muted">No items in this order.</p>';
    }

    const statusLabel = order.status ? escapeHtml(order.status) : 'unknown';

    const outstanding = computeOutstanding(order);
    currentOutstanding = outstanding;

    // --- NEW: compute customer display text similar to views/orders/view.pug ---
    let customerDisplay = '';
    if (order.customer) {
      // order.customer may be an object (from apiGetOrderById) or a simple string
      if (typeof order.customer === 'string') {
        customerDisplay = order.customer;
      } else {
        const c = order.customer;
        if (c.category === 'artist') {
          customerDisplay = c.businessName || c.phone || '';
        } else {
          customerDisplay = c.firstName || c.businessName || c.phone || '';
        }
      }
    }
    // -----------------------------------------------------------------------

        // --- NEW: customerId + balance (if customer object is populated) ---
    let customerObj = null;
    if (order.customer && typeof order.customer === 'object') {
      customerObj = order.customer;
    }

    const orderDateDisplay = (() => {
      if (!order.createdAt) return '';
      const d = new Date(order.createdAt);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString();
    })();

    const customerPhone = (() => {
      if (customerObj && customerObj.phone) return String(customerObj.phone);
      if (order.customerPhone) return String(order.customerPhone);
      return '';
    })();

    if (customerObj && customerObj._id) {
      currentHasCustomer = true;
      currentCustomerId = String(customerObj._id);
      if (typeof customerObj.accountBalance !== 'undefined' && customerObj.accountBalance !== null) {
        const b = Number(customerObj.accountBalance || 0);
        currentCustomerBalance = isNaN(b) ? 0 : Number(b.toFixed(2));
      }
    } else if (order.customer && typeof order.customer === 'string') {
      // if API returns only customer id (string)
      currentHasCustomer = true;
      currentCustomerId = String(order.customer);
      // balance unknown unless backend includes it; UI will show 0.00
      currentCustomerBalance = 0;
    }


    // --- NEW: compute handler display (Handled By) if present ---
    let handlerDisplay = '';
    if (order.handledBy) {
      if (typeof order.handledBy === 'string') {
        handlerDisplay = order.handledBy;
      } else {
        const h = order.handledBy;
        handlerDisplay = (h.name || h.username || h._id) || '';
      }
    }
    // ------------------------------------------------------------

    const hasDiscount = Number(order.discountAmount || 0) > 0;
    currentHasDiscount = hasDiscount;
    const showManualDiscount = isAdminUser && !hasDiscount && order.status !== 'paid';
    setPayManualDiscountVisibility(showManualDiscount);

    let discountHtml = '';
    if (hasDiscount) {
      const before = (typeof order.totalBeforeDiscount !== 'undefined' && order.totalBeforeDiscount !== null)
        ? Number(order.totalBeforeDiscount)
        : Number(order.total || 0) + Number(order.discountAmount || 0);

      const applied = discountAppliedLabel(order);

      discountHtml = `
    <div class="mt-2">
      <p class="text-end mb-1">
        <span class="text-muted">Discount Applied:</span>
        <strong>${escapeHtml(applied || 'Discount')}</strong>
      </p>
      <p class="text-end mb-1">
        <span class="text-muted">Total before discount:</span>
        <strong>GH₵ ${fmt(before)}</strong>
      </p>
      <p class="text-end mb-1">
        <span class="text-muted">Discount:</span>
        <strong class="text-white">- GH₵ ${fmt(order.discountAmount)}</strong>
      </p>
    </div>
  `;
    }

    const netBal = Number(
      (customerObj && typeof customerObj.accountNetBalance !== 'undefined' && customerObj.accountNetBalance !== null)
        ? customerObj.accountNetBalance
        : currentCustomerBalance
    );
    const balType = netBal > 0 ? 'Credit Balance' : (netBal < 0 ? 'Debit Balance' : 'Settled');
    const balAbs = Math.abs(netBal);
    const accountHtml = currentHasCustomer ? `
      <div class="mt-3 p-2 rounded dark-surface" style="border:1px solid rgba(255,255,255,.12);">
        <div class="small text-muted-light">Customer Account</div>
        <div class="text-white">
          <strong>${escapeHtml(balType)}:</strong>
          <span class="ms-1">${escapeHtml(`GH₵ ${fmt(balAbs)}`)}</span>
        </div>
      </div>
    ` : '';


    orderInfo.innerHTML = `
      ${ handlerDisplay ? `<p><strong>Handled by:</strong> ${escapeHtml(handlerDisplay)}</p>` : '' }
      ${ customerDisplay ? `<p><strong>Customer:</strong> ${escapeHtml(customerDisplay)}</p>` : '' }
      ${ customerPhone ? `<p><strong>Customer Phone:</strong> ${escapeHtml(customerPhone)}</p>` : '' }
      <p><strong>Order ID:</strong> ${escapeHtml(order.orderId)}</p>
      ${ orderDateDisplay ? `<p><strong>Order Date:</strong> ${escapeHtml(orderDateDisplay)}</p>` : '' }
      <p><strong>Status:</strong> ${statusLabel}</p>
      ${itemsHtml}
      ${discountHtml}
      <p class="text-end"><strong>Total to pay: GH₵ ${fmt(order.total)}</strong></p>
      ${ (outstanding > 0) ? `<p class="text-end"><strong>Remaining: GH₵ ${fmt(outstanding)}</strong></p>` : '' }
      ${accountHtml}
    `;

    // show payment controls only if not paid
    if (order.status === 'paid') {
      if (paymentControls) paymentControls.style.display = 'none';
      payNowBtn.style.display = 'none';
      payNowBtn.disabled = true;
    } else {
      if (paymentControls) paymentControls.style.display = '';
      payNowBtn.style.display = '';
      payNowBtn.disabled = false;

      // default payment method -> cash
      if (paymentMethodSel) {
        paymentMethodSel.value = 'cash';
        momoFields && (momoFields.style.display = 'none');
        chequeField && (chequeField.style.display = 'none');
      }

      // clear momo/cheque/part fields
      momoNumberInput && (momoNumberInput.value = '');
      momoTxInput && (momoTxInput.value = '');
      chequeNumberInput && (chequeNumberInput.value = '');
      partToggle && (partToggle.checked = false);
      partWrapper && (partWrapper.style.display = 'none');
      partAmountInput && (partAmountInput.value = '');
    }
  }

  async function applyManualDiscountToOrder(orderId, mode, value) {
    try {
      const res = await fetch(`/orders/${encodeURIComponent(orderId)}/discount`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ mode, value })
      });

      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (j && j.error) ? j.error : 'Failed to apply discount';
        showAlertModal(msg, 'Discount error');
        return;
      }

      showAlertModal('Manual discount applied.', 'Discount');
      await fetchOrderById(orderId);
    } catch (err) {
      console.error('applyManualDiscountToOrder err', err);
      showAlertModal('Network error while applying discount', 'Network error');
    }
  }


  // Fetch order by id and render
  async function fetchOrderById(id) {
    if (!id) {
      showAlertModal('Enter an order id', 'Missing Order ID');
      renderOrderDetails(null);
      return null;
    }
    try {
      const res = await fetch(`/orders/${encodeURIComponent(id)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (j && j.error) ? j.error : 'Order fetch failed';
        showAlertModal(msg, 'Fetch failed');
        renderOrderDetails(null);
        return null;
      }
      renderOrderDetails(j.order);
      return j.order;
    } catch (err) {
      console.error('fetch order err', err);
      showAlertModal('Failed to fetch order (network error)', 'Network error');
      renderOrderDetails(null);
      return null;
    }
  }

  // form submit: fetch order
  if (fetchForm) {
    fetchForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const id = fetchOrderIdInput.value && fetchOrderIdInput.value.trim();
      if (!id) {
        showAlertModal('Enter an order id', 'Missing Order ID');
        return;
      }
      fetchOrderBtn.disabled = true;
      fetchOrderBtn.textContent = 'Fetching...';
      try {
        await fetchOrderById(id);
      } finally {
        fetchOrderBtn.disabled = false;
        fetchOrderBtn.textContent = 'Fetch';
        if (window.__FormSpinner && typeof window.__FormSpinner.hide === 'function') {
          window.__FormSpinner.hide(fetchOrderBtn);
        } else if (fetchOrderBtn) {
          fetchOrderBtn.classList.remove('loading');
          fetchOrderBtn.removeAttribute('data-spinner-active');
        }
      }
    });
  }

  // PAYMENT UI wiring -----------------------------------------------------

  if (paymentMethodSel) {
    paymentMethodSel.addEventListener('change', function () {
      const v = this.value;
      if (v === 'momo') {
        momoFields.style.display = '';
        chequeField.style.display = 'none';
      } else if (v === 'cheque') {
        chequeField.style.display = '';
        momoFields.style.display = 'none';
      } else {
        momoFields.style.display = 'none';
        chequeField.style.display = 'none';
      }
    });
  }

  if (partToggle) {
    partToggle.addEventListener('change', function () {
      if (this.checked) {
        partWrapper.style.display = '';
        // prefill with order total by default (user can change)
        if (partAmountInput && currentOrderTotal) partAmountInput.value = Number(currentOrderTotal).toFixed(2);
      } else {
        partWrapper.style.display = 'none';
        if (partAmountInput) partAmountInput.value = '';
      }
    });
  }

  // pay now: confirm with modal, server authoritatively marks paid, then re-fetch order to show updated state
  if (payNowBtn) {
    payNowBtn.addEventListener('click', async function () {
      if (!currentOrderId) {
        showAlertModal('No order loaded to pay', 'No Order');
        return;
      }

      // validate fields depending on method & part payment
      const method = paymentMethodSel ? paymentMethodSel.value : 'cash';
      const isPart = partToggle ? !!partToggle.checked : false;
      let partAmount = null;

      if (isPart) {
        if (!partAmountInput || !partAmountInput.value) {
          showAlertModal('Enter the part payment amount', 'Missing amount');
          return;
        }
        partAmount = Number(partAmountInput.value);
        if (isNaN(partAmount) || partAmount <= 0) {
          showAlertModal('Enter a valid part payment amount (> 0)', 'Invalid amount');
          return;
        }
        // Overpayment is allowed ONLY when order has a customer (excess will be credited server-side)
        if (!currentHasCustomer) {
          if (partAmount > Number(currentOutstanding || currentOrderTotal || 0)) {
            showAlertModal('Part payment amount cannot exceed the outstanding amount for walk-in orders.', 'Invalid amount');
            return;
          }
        }
      }

      if (method === 'momo') {
        const num = momoNumberInput ? (momoNumberInput.value || '').trim() : '';
        const tx = momoTxInput ? (momoTxInput.value || '').trim() : '';
        if (!num || !tx) {
          showAlertModal('Enter MoMo number and transaction id', 'Missing MoMo details');
          return;
        }
      } else if (method === 'cheque') {
        const cnum = chequeNumberInput ? (chequeNumberInput.value || '').trim() : '';
        if (!cnum) {
          showAlertModal('Enter cheque number', 'Missing cheque number');
          return;
        }
      }

      // Confirm using modal
      let confirmMsg = isPart
        ? `Record a payment of GH₵ ${fmt(partAmount)} for order ${escapeHtml(currentOrderId)}?`
        : `Mark order ${escapeHtml(currentOrderId)} as paid?`;

      if (isPart && currentHasCustomer && Number(partAmount) > Number(currentOutstanding || 0)) {
        const excess = Number((Number(partAmount) - Number(currentOutstanding || 0)).toFixed(2));
        confirmMsg += `\n\nExcess (GH₵ ${fmt(excess)}) will be credited to the customer's account.`;
      }
      const ok = await showConfirmModal(confirmMsg, 'Confirm payment');
      if (!ok) return;

      payNowBtn.disabled = true;
      const origText = payNowBtn.textContent;
      payNowBtn.textContent = 'Processing...';
      try {
        // Build payload - server currently ignores metadata, but this is prepared for backend support
        const payload = {
          paymentMethod: method,
          momoNumber: (momoNumberInput && momoNumberInput.value) ? momoNumberInput.value.trim() : null,
          momoTxId: (momoTxInput && momoTxInput.value) ? momoTxInput.value.trim() : null,
          chequeNumber: (chequeNumberInput && chequeNumberInput.value) ? chequeNumberInput.value.trim() : null,
          partPayment: isPart,
          partPaymentAmount: isPart ? Number(partAmount) : null
        };

        // send as JSON; existing server action will still mark paid as before.
        const res = await fetch(`/orders/${encodeURIComponent(currentOrderId)}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify(payload)
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) {
          showAlertModal((j && j.error) ? j.error : 'Pay failed', 'Payment error');
          return;
        }

        showAlertModal('Payment recorded', 'Success');

        // re-fetch order to display updated status and data
        await fetchOrderById(currentOrderId);
        try { await loadDailyOrdersDropdown({ force: true }); } catch (e) {}

        // clear input & hide pay button if now paid
        fetchOrderIdInput.value = '';
      } catch (err) {
        console.error('pay err', err);
        showAlertModal('Payment failed (network error)', 'Payment error');
      } finally {
        payNowBtn.disabled = false;
        payNowBtn.textContent = origText;
      }
    });
  }

  // fetch & render cashiers list for given date (YYYY-MM-DD)
// fetch & render cashiers list for given date (YYYY-MM-DD)
async function fetchCashiersStatus(dateIso) {
  if (!cashiersTable || !cashiersStatusLoading) return;
  cashiersStatusLoading.textContent = 'Loading...';
  const tbody = cashiersTable.querySelector('tbody');
  // 4 visible columns in the table (Cashier, Today's Payments, Previous Balance, Actions)
  tbody.innerHTML = '<tr><td class="text-muted" colspan="4">Loading...</td></tr>';
  try {
    const url = '/cashiers/status' + (dateIso ? ('?date=' + encodeURIComponent(dateIso)) : '');
    const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
    if (!res.ok) {
      const j = await res.json().catch(()=>null);
      const msg = (j && j.error) ? j.error : `Failed to fetch cashiers (${res.status})`;
      tbody.innerHTML = `<tr><td class="text-muted" colspan="4">${escapeHtml(msg)}</td></tr>`;
      cashiersStatusLoading.textContent = '--';
      return;
    }

    const j = await res.json().catch(()=>null);
    if (!j || !Array.isArray(j.cashiers)) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="4">Invalid response</td></tr>';
      cashiersStatusLoading.textContent = '--';
      return;
    }

    const rows = j.cashiers;
    cashiersStatusLoading.textContent = `Date: ${new Date(j.date).toLocaleDateString()}`;

    renderCashiersStatus(rows);
  } catch (err) {
    console.error('fetchCashiersStatus err', err);
    const tbody = cashiersTable.querySelector('tbody');
    tbody.innerHTML = '<tr><td class="text-muted" colspan="4">Network error while fetching cashiers.</td></tr>';
    cashiersStatusLoading.textContent = '--';
    if (cashiersStatusNote) cashiersStatusNote.textContent = '';
  }
}

let cashiersShowAll = false;
let cashiersStatusCache = null;

function renderCashiersStatus(rows) {
  if (!cashiersTable) return;
  const tbody = cashiersTable.querySelector('tbody');
  const data = Array.isArray(rows) ? rows : [];
  cashiersStatusCache = data;

  const due = data.filter(r => {
    const total = Number(r.totalCashRecordedToday || 0);
    const prev = Number(r.previousBalance || 0);
    return total > 0 || prev > 0;
  });
  const rest = data.filter(r => {
    const total = Number(r.totalCashRecordedToday || 0);
    const prev = Number(r.previousBalance || 0);
    return total <= 0 && prev <= 0;
  });

  if (cashiersShowAllBtn) {
    if (rest.length) {
      cashiersShowAllBtn.style.display = '';
      cashiersShowAllBtn.textContent = cashiersShowAll ? 'Hide idle cashiers' : 'Show all cashiers';
    } else {
      cashiersShowAllBtn.style.display = 'none';
    }
  }

  if (cashiersStatusNote) {
    if (!due.length && rest.length) {
      cashiersStatusNote.textContent = 'No cash to collect right now.';
    } else if (due.length) {
      cashiersStatusNote.textContent = `Showing ${due.length} cashier${due.length > 1 ? 's' : ''} with collections.`;
    } else {
      cashiersStatusNote.textContent = 'No cashier data available.';
    }
  }

  if (!due.length && !rest.length) {
    tbody.innerHTML = '<tr><td class="text-muted" colspan="4">No cashiers found.</td></tr>';
    return;
  }

  const rowsToRender = due.slice();
  if (cashiersShowAll && rest.length) {
    rowsToRender.push({ __divider: true });
    rowsToRender.push(...rest);
  }

  tbody.innerHTML = rowsToRender.map(r => {
    if (r.__divider) {
      return `<tr><td class="text-muted" colspan="4">Other cashiers</td></tr>`;
    }
      const total = Number(r.totalCashRecordedToday || 0);
      const prevBal = Number(r.previousBalance || 0);

      return `<tr data-cashier-id="${escapeHtml(r.cashierId)}">
        <td>${escapeHtml(r.name)}</td>
        <!-- Today's Cash (green) shows payments recorded since last collection (cash+momo+cheque) -->
        <td class="text-end text-success">GH₵ ${Number(total).toFixed(2)}</td>
        <td class="text-end text-danger">GH₵ ${Number(prevBal).toFixed(2)}</td>
        <td class="text-center"><button class="btn btn-sm btn-primary cashier-receive-btn" type="button" data-cashier-id="${escapeHtml(r.cashierId)}" data-cashier-name="${escapeHtml(r.name)}">Receive</button></td>
      </tr>`;
    }).join('');
}

  // -------------------------
  // Cashier self-status UI (for logged-in cashiers)
  // - fetches /cashiers/my-status and updates #myCashierStatusContainer
  // - automatically refreshed after accepting a payment (we call it after fetchOrderById/pay)
  // -------------------------
  const myCashierStatusContainer = document.getElementById('myCashierStatusContainer');
  const myCashTodayEl = document.getElementById('myCashToday');
  const myPrevBalanceEl = document.getElementById('myPrevBalance');
  const myCashierNameEl = document.getElementById('myCashierName');

// -------------------------
// Cashier self-status UI (for logged-in cashiers)
// - fetches /cashiers/my-status and updates #myCashierStatusContainer
// - automatically refreshed after accepting a payment (we call it after fetchOrderById/pay)
// -------------------------
async function fetchMyCashierStatus() {
  if (!myCashierStatusContainer) return;
  try {
    const res = await fetch('/cashiers/my-status', { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
    if (!res.ok) {
      // if not a cashier or not authenticated, hide the widget
      myCashierStatusContainer.style.display = 'none';
      return null;
    }
    const j = await res.json().catch(()=>null);
    if (!j || !j.ok) { myCashierStatusContainer.style.display = 'none'; return null; }

    // show and populate
    myCashierStatusContainer.style.display = '';

    if (myCashierNameEl && (j.name || j.cashierId)) myCashierNameEl.textContent = j.name || ('Cashier: ' + (j.cashierId || ''));

    const todayPayments = Number(j.totalCashRecordedToday || 0);

    // Show the currently uncollected cash (resets to 0.00 after collection)
    if (myCashTodayEl) myCashTodayEl.textContent = Number(todayPayments).toFixed(2);
    if (myPrevBalanceEl) myPrevBalanceEl.textContent = Number(j.previousBalance || 0).toFixed(2);
    return j;
  } catch (err) {
    console.error('fetchMyCashierStatus err', err);
    try { myCashierStatusContainer.style.display = 'none'; } catch (e) {}
    return null;
  }
}

  // call this on page load (after initial render)
  (function initMyCashierStatus() {
    // don't crash if endpoint doesn't exist
    try {
      fetchMyCashierStatus();
      // Optional: poll every 30s to reflect incoming payments by other tabs/users
      // const pollInterval = setInterval(fetchMyCashierStatus, 30000);
      // store poll handle if you want to clear later
    } catch (e) {}
  })();

  // ensure we refresh cashier status after successful payment
  // wrap existing fetchOrderById() resolution and payNowBtn flow to call fetchMyCashierStatus()
  // You already call fetchOrderById after pay; additionally, call fetchMyCashierStatus here:
  // Add this line after successful payment recording (inside payNowBtn click try block, after await fetchOrderById(...))
  // For robustness, we call it whenever payments are recorded:
  async function _refreshAfterPayment() {
    try { await fetchMyCashierStatus(); } catch (e) {}
  }

  // Hook into existing payment success flow:
  // After the code that calls fetchOrderById(currentOrderId) (which you already do after a successful pay),
  // add: _refreshAfterPayment();
  // If you prefer I can patch the exact location for you â€” but placing the following small observer helps:
  (function hookPaymentRefresh() {
    // We monkey-patch fetchOrderById to call original and then refresh cashier status
    if (typeof fetchOrderById === 'function') {
      const _origFetchOrder = fetchOrderById;
      fetchOrderById = async function (id) {
        const res = await _origFetchOrder(id);
        try { await _refreshAfterPayment(); } catch (e) {}
        return res;
      };
    }
  })();

  // accountant modal wiring
const openAccountantBtn = document.getElementById('openAccountantBtn');
const accountantModalEl = document.getElementById('accountantModal');
const accountantModal = (window.bootstrap && accountantModalEl) ? new bootstrap.Modal(accountantModalEl) : null;
const accountantLedgerTable = document.getElementById('accountantLedgerTable');
const accountantLedgerDate = document.getElementById('accountantLedgerDate');
const accountantLedgerDateInput = document.getElementById('accountantLedgerDateInput');
const accountantLedgerRefreshBtn = document.getElementById('accountantLedgerRefreshBtn');

async function fetchAccountantLedger(dateIso) {
  if (!accountantLedgerTable || !accountantLedgerDate) return;
  accountantLedgerDate.textContent = 'Loading...';
  const tbody = accountantLedgerTable.querySelector('tbody');
  tbody.innerHTML = '<tr><td class="text-muted" colspan="3">Loading...</td></tr>';
  try {
    const url = '/accountant/ledger' + (dateIso ? ('?date=' + encodeURIComponent(dateIso)) : '');
    const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
    if (!res.ok) {
      const j = await res.json().catch(()=>null);
      tbody.innerHTML = `<tr><td class="text-muted" colspan="3">${escapeHtml((j && j.error) ? j.error : 'Failed to load ledger')}</td></tr>`;
      accountantLedgerDate.textContent = '--';
      return;
    }
    const j = await res.json().catch(()=>null);
    if (!j || !Array.isArray(j.ledger)) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="3">No data</td></tr>';
      accountantLedgerDate.textContent = '--';
      return;
    }
    const showTotal = Number(j.totalCollected || 0);
    accountantLedgerDate.innerHTML = `Date: ${new Date(j.date).toLocaleDateString()} - Total: <strong>GH₵ ${showTotal.toFixed(2)}</strong>`;
    if (!j.ledger.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="3">No collections for this date.</td></tr>';
      return;
    }
    tbody.innerHTML = j.ledger.map(r => `<tr>
      <td>${escapeHtml(r.name || '')}</td>
      <td class="text-end">GH₵ ${Number(r.totalCollected || 0).toFixed(2)}</td>
      <td class="text-center"></td>
    </tr>`).join('');
  } catch (err) {
    console.error('fetchAccountantLedger err', err);
    accountantLedgerTable.querySelector('tbody').innerHTML = '<tr><td class="text-muted" colspan="3">Network error</td></tr>';
    accountantLedgerDate.textContent = '--';
  }
}

if (openAccountantBtn) {
  openAccountantBtn.addEventListener('click', function () {
    if (accountantModal) accountantModal.show();
    if (accountantLedgerDateInput) {
      const t = new Date();
      const mm = String(t.getMonth() + 1).padStart(2, '0');
      const dd = String(t.getDate()).padStart(2, '0');
      accountantLedgerDateInput.value = `${t.getFullYear()}-${mm}-${dd}`;
    }
    fetchAccountantLedger(accountantLedgerDateInput ? accountantLedgerDateInput.value : '');
  });
}

if (accountantLedgerRefreshBtn) {
  accountantLedgerRefreshBtn.addEventListener('click', function () {
    const v = accountantLedgerDateInput ? accountantLedgerDateInput.value : '';
    fetchAccountantLedger(v);
  });
}



// show receive modal for a cashier
function showReceiveModal(cashierId, cashierName) {
  // build modal if not exist
  let modalEl = document.getElementById('cashierReceiveModal');
  if (!modalEl) {
    const html = `
<div class="modal fade" id="cashierReceiveModal" tabindex="-1" aria-labelledby="cashierReceiveModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-sm modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="cashierReceiveModalLabel">Receive cash from cashier</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body">
        <div class="mb-2"><strong id="cashierReceiveName"></strong></div>
        <div class="mb-2 small text-muted">Enter the physical cash amount received from this cashier for today (GH₵)</div>
        <div class="mb-3">
          <label class="form-label small mb-1">Amount</label>
          <input type="number" min="0" step="0.01" class="form-control form-control-sm" id="cashierReceiveAmount" />
        </div>
        <div class="mb-2">
          <label class="form-label small mb-1">Note (optional)</label>
          <input class="form-control form-control-sm" id="cashierReceiveNote" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline-light-custom btn-sm" data-bs-dismiss="modal" type="button">Cancel</button>
        <button class="btn btn-primary btn-sm" id="confirmCashierReceiveBtn" type="button">Receive payment</button>
      </div>
    </div>
  </div>
</div>`;
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
    modalEl = document.getElementById('cashierReceiveModal');
  }

  const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
  const nameEl = modalEl.querySelector('#cashierReceiveName');
  const amtEl = modalEl.querySelector('#cashierReceiveAmount');
  const noteEl = modalEl.querySelector('#cashierReceiveNote');
  const confirmBtn = modalEl.querySelector('#confirmCashierReceiveBtn');

  if (nameEl) nameEl.textContent = cashierName || cashierId;
  if (amtEl) amtEl.value = '';
  if (noteEl) noteEl.value = '';

  async function onConfirm() {
    const amount = Number(amtEl.value || 0);
    if (isNaN(amount) || amount < 0) {
      showAlertModal('Enter a valid amount');
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Processing...';
    try {
      const payload = { amount: amount, note: (noteEl.value || '') };
      const res = await fetch(`/cashiers/${encodeURIComponent(cashierId)}/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload)
      });
      const j = await res.json().catch(()=>null);
      if (!res.ok) {
        showAlertModal((j && j.error) ? j.error : 'Collection failed');
      } else {
        showAlertModal('Collection recorded', 'Success');
        // refresh list
        fetchCashiersStatus();
      }
    } catch (err) {
      console.error('collect err', err);
      showAlertModal('Network error while recording collection');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Receive payment';
      try { inst.hide(); } catch (e) {}
    }
  }

  if (!confirmBtn._bound) {
    confirmBtn._bound = true;
    confirmBtn.addEventListener('click', onConfirm);
  }

  inst.show();
}

// bind openCashiersBtn
if (openCashiersBtn) {
  openCashiersBtn.addEventListener('click', function () {
    if (cashiersModal) cashiersModal.show();
    cashiersShowAll = false;
    fetchCashiersStatus();
  });
}

if (cashiersShowAllBtn) {
  cashiersShowAllBtn.addEventListener('click', function () {
    cashiersShowAll = !cashiersShowAll;
    renderCashiersStatus(cashiersStatusCache || []);
  });
}

// delegate receive click
if (cashiersTable) {
  cashiersTable.addEventListener('click', function (ev) {
    const btn = ev.target.closest('.cashier-receive-btn');
    if (!btn) return;
    const id = btn.dataset.cashierId;
    const name = btn.dataset.cashierName || '';
    if (id) showReceiveModal(id, name);
  });
}

  // -------------------------
  // Debtors modal: fetch list of debtors/part payments
  // NOTE: backend endpoint /api/debtors is expected to return { ok: true, debtors: [ ... ] }
  // each debtor row ideally: { orderId, debtorName, amountDue, paidSoFar, outstanding }
  // If you don't have this endpoint yet, the client will show a message. Implement server side to populate.
  // -------------------------
  async function fetchDebtorsList(q = '') {
    if (!debtorsTable || !debtorsCount) return;
    debtorsCount.textContent = 'Loading...';
    setDebtorsSummary(0, 0, 0);
    const tbody = debtorsTable.querySelector('tbody');
    if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">Loading...</td></tr>`;
    try {
        const query = (q || '').toString().trim();
        const url = '/orders/debtors' + (query ? ('?q=' + encodeURIComponent(query)) : '');
        const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        const msg = (j && j.error) ? j.error : `Failed to fetch debtors (${res.status})`;
        if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">${escapeHtml(msg)}</td></tr>`;
        debtorsCount.textContent = '0 results';
        setDebtorsSummary(0, 0, 0);
        return;
      }
      const j = await res.json().catch(()=>null);
      if (!j || !Array.isArray(j.debtors)) {
        if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">No debtors found.</td></tr>`;
        debtorsCount.textContent = '0 results';
        setDebtorsSummary(0, 0, 0);
        return;
      }
      const rows = j.debtors;
      // cache for client-side filtering as fallback
      _debtorsCache = Array.isArray(rows) ? rows.slice() : [];

      // If backend doesn't support ?q=, still filter locally.
      // We filter by debtorName, orderId, and any phone-like fields if present.
      const qNorm = (query || '').toLowerCase().trim();
      let filtered = rows;

      if (qNorm) {
        filtered = (rows || []).filter(d => {
          const hay = [
            d.debtorName,
            d.orderId,
            d.customerPhone,
            d.phone,
            d.customer && d.customer.phone,
            d.customer && d.customer.firstName,
            d.customer && d.customer.businessName
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return hay.includes(qNorm);
        });
      }

      if (!filtered.length) {
        if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">No debtors found.</td></tr>`;
        debtorsCount.textContent = '0 results';
        setDebtorsSummary(0, 0, 0);
        return;
      }
const summaryTotalDue = filtered.reduce((s, i) => s + Number(i.amountDue || 0), 0);
const summaryTotalPaid = filtered.reduce((s, i) => s + Number(i.paidSoFar || 0), 0);
const summaryTotalOutstanding = filtered.reduce(
  (s, i) => s + Number(i.outstanding || (i.amountDue - i.paidSoFar || 0)),
  0
);
setDebtorsSummary(
  Number(summaryTotalDue.toFixed(2)),
  Number(summaryTotalPaid.toFixed(2)),
  Number(summaryTotalOutstanding.toFixed(2))
);
// -------- Group by debtor name --------
const grouped = {};
filtered.forEach(d => {
  const key = d.debtorName || 'Unknown';
  if (!grouped[key]) grouped[key] = [];
  grouped[key].push(d);
});

let html = '';
let groupIndex = 0;

Object.entries(grouped).forEach(([debtorName, items]) => {
  // SINGLE record â†’ keep existing logic exactly
  if (items.length === 1) {
    const d = items[0];
    const out = Number(d.outstanding || (d.amountDue - d.paidSoFar || 0)).toFixed(2);
    html += `
      <tr data-order-id="${escapeHtml(d.orderId || '')}">
        <td><span class="badge bg-secondary" style="color:#fff !important;">${escapeHtml(d.orderId || '')}</span></td>
        <td>${escapeHtml(debtorName)}</td>
        <td class="text-end">GH₵ ${Number(d.amountDue || 0).toFixed(2)}</td>
        <td class="text-end">GH₵ ${Number(d.paidSoFar || 0).toFixed(2)}</td>
        <td class="text-end"><span class="fw-semibold">${'GH₵ ' + out}</span></td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-primary view-debtor-order"
            type="button"
            data-order-id="${escapeHtml(d.orderId || '')}">
            Update
          </button>
        </td>
      </tr>
    `;
    return;
  }

  // MULTIPLE records â†’ expandable group
  const groupId = `debtor-group-${groupIndex++}`;

const totalDue = items.reduce((s, i) => s + Number(i.amountDue || 0), 0);
const totalPaid = items.reduce((s, i) => s + Number(i.paidSoFar || 0), 0);
const totalOutstanding = items.reduce(
  (s, i) => s + Number(i.outstanding || (i.amountDue - i.paidSoFar || 0)),
  0
);

html += `
  <tr class="table-active debtor-group-toggle align-middle"
      data-target="${groupId}"
      aria-expanded="false"
      data-debtor-name="${escapeHtml(debtorName)}"
      style="cursor:pointer;">
    <td colspan="2">
      <span class="me-2 debtor-toggle-icon"><i class="bi bi-chevron-right"></i></span>
      <strong>${escapeHtml(debtorName)}</strong>
      <span class="text-muted ms-2">(${items.length} orders)</span>
    </td>
    <td class="text-end">GH₵ ${totalDue.toFixed(2)}</td>
    <td class="text-end">GH₵ ${totalPaid.toFixed(2)}</td>
    <td class="text-end fw-semibold">GH₵ ${totalOutstanding.toFixed(2)}</td>
    <td class="text-center">
      <button
        class="btn btn-sm btn-outline-success pay-debtor-full"
        type="button"
        data-order-ids='${JSON.stringify(items.map(i => i.orderId))}'
        data-total="${totalOutstanding.toFixed(2)}">
        Full Payment
      </button>
    </td>
  </tr>
`;

  items.forEach(d => {
    const out = Number(d.outstanding || (d.amountDue - d.paidSoFar || 0)).toFixed(2);
    html += `
      <tr class="debtor-group-row ${groupId}" style="display:none;">
        <td><span class="badge bg-secondary" style="color:#fff !important;">${escapeHtml(d.orderId || '')}</span></td>
        <td>${escapeHtml(debtorName)}</td>
        <td class="text-end">GH₵ ${Number(d.amountDue || 0).toFixed(2)}</td>
        <td class="text-end">GH₵ ${Number(d.paidSoFar || 0).toFixed(2)}</td>
        <td class="text-end"><span class="fw-semibold">${'GH₵ ' + out}</span></td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-primary view-debtor-order"
            type="button"
            data-order-id="${escapeHtml(d.orderId || '')}">
            Update
          </button>
        </td>
      </tr>
    `;
  });

html += `
  <tr class="debtor-group-end ${groupId}" style="display:none;">
    <td colspan="6"><div class="my-1 border-bottom border-secondary-subtle"></div></td>
  </tr>
`;


});

      if (tbody) tbody.innerHTML = html;
      debtorsCount.textContent = `${filtered.length} result${filtered.length > 1 ? 's' : ''}`;
    } catch (err) {
      console.error('fetch debtors err', err);
      if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">Network error while fetching debtors.</td></tr>`;
      debtorsCount.textContent = '0 results';
      setDebtorsSummary(0, 0, 0);
    }
  }

  function scheduleDebtorsSearch() {
  if (!debtorsSearchInput) return;

  const q = debtorsSearchInput.value || '';
  _debtorsLastQuery = q;

  if (debtorsSearchTimer) clearTimeout(debtorsSearchTimer);
  debtorsSearchTimer = setTimeout(() => {
    fetchDebtorsList(q);
  }, DEBTORS_SEARCH_DEBOUNCE);
}

if (debtorsSearchInput) {
  debtorsSearchInput.addEventListener('input', scheduleDebtorsSearch);

  // ESC clears
  debtorsSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      debtorsSearchInput.value = '';
      _debtorsLastQuery = '';
      fetchDebtorsList('');
    }
  });
}

if (debtorsSearchClearBtn) {
  debtorsSearchClearBtn.addEventListener('click', () => {
    if (debtorsSearchInput) debtorsSearchInput.value = '';
    _debtorsLastQuery = '';
    fetchDebtorsList('');
    try { debtorsSearchInput && debtorsSearchInput.focus(); } catch(e){}
  });
}


if (openDebtorsBtn) {
  openDebtorsBtn.addEventListener('click', function () {
    if (debtorsModal) debtorsModal.show();

    // reset search each time modal opens
    if (debtorsSearchInput) debtorsSearchInput.value = '';
    _debtorsLastQuery = '';

    fetchDebtorsList('');

    // focus for quick typing
    setTimeout(() => { try { debtorsSearchInput && debtorsSearchInput.focus(); } catch(e){} }, 80);
  });
}

// delegate click in debtors table - view order (open that order in the pay page)
if (debtorsTable) {
  debtorsTable.addEventListener('click', async function (ev) {

    // ===============================
    // FULL PAYMENT (GROUPED DEBTORS)
    // ===============================
    const fullPayBtn = ev.target.closest('.pay-debtor-full');
    if (fullPayBtn) {
      ev.stopPropagation();

      const orderIds = JSON.parse(fullPayBtn.dataset.orderIds || '[]');
      const total = Number(fullPayBtn.dataset.total || 0);

      // store pending bulk payment
      pendingFullPayment = { orderIds, total };

      // prepare modal UI
      if (fullPaymentConfirmText) {
        fullPaymentConfirmText.textContent =
          `Apply FULL payment of GH₵ ${fmt(total)} to ALL selected outstanding orders?`;
      }

      if (fullPaymentMethod) {
        fullPaymentMethod.value = 'cash';
      }

      // reset fields
      if (fullPaymentMomoNumber) fullPaymentMomoNumber.value = '';
      if (fullPaymentMomoTx) fullPaymentMomoTx.value = '';
      if (fullPaymentCheque) fullPaymentCheque.value = '';

      if (fullPaymentMomoFields) fullPaymentMomoFields.style.display = 'none';
      if (fullPaymentChequeField) fullPaymentChequeField.style.display = 'none';

      if (fullPaymentModal) fullPaymentModal.show();
      return;
    }

    // ===============================
    // UPDATE SINGLE ORDER
    // ===============================
    const updateBtn = ev.target.closest('.view-debtor-order');
    if (updateBtn) {
      ev.stopPropagation();
      const id = updateBtn.dataset.orderId;
      if (id) {
        if (debtorsModal) debtorsModal.hide();
        fetchOrderIdInput.value = id;
        fetchOrderById(id);
      }
      return;
    }

    // ===============================
    // EXPAND / COLLAPSE GROUP
    // ===============================
    const toggleRow = ev.target.closest('.debtor-group-toggle');
    if (!toggleRow) return;

    const target = toggleRow.dataset.target;
    const expanded = toggleRow.getAttribute('aria-expanded') === 'true';

    const rows = debtorsTable.querySelectorAll(`.${target}`);
    rows.forEach(r => {
      r.style.display = expanded ? 'none' : '';
    });

    toggleRow.setAttribute('aria-expanded', expanded ? 'false' : 'true');

    const icon = toggleRow.querySelector('.debtor-toggle-icon');
    if (icon) {
      icon.innerHTML = expanded
        ? '<i class="bi bi-chevron-right"></i>'
        : '<i class="bi bi-chevron-down"></i>';
    }
  });
}

// =====================================================
// CONFIRM FULL PAYMENT (bulk debtor payment)
// =====================================================
if (confirmFullPaymentBtn) {
  confirmFullPaymentBtn.addEventListener('click', async function () {
    if (!pendingFullPayment) {
      showAlertModal('No pending payment found.', 'Error');
      return;
    }

    const { orderIds, total } = pendingFullPayment;
    const method = fullPaymentMethod ? fullPaymentMethod.value : 'cash';

    // --------------------
    // Validate inputs
    // --------------------
    if (method === 'momo') {
      if (!fullPaymentMomoNumber.value || !fullPaymentMomoTx.value) {
        showAlertModal('Enter MoMo number and transaction ID', 'Missing details');
        return;
      }
    }

    if (method === 'cheque') {
      if (!fullPaymentCheque.value) {
        showAlertModal('Enter cheque number', 'Missing details');
        return;
      }
    }

    confirmFullPaymentBtn.disabled = true;
    const originalText = confirmFullPaymentBtn.textContent;
    confirmFullPaymentBtn.textContent = 'Processing...';

    try {
      const payload = {
        orderIds,
        paymentMethod: method,
        momoNumber: method === 'momo' ? fullPaymentMomoNumber.value.trim() : null,
        momoTxId: method === 'momo' ? fullPaymentMomoTx.value.trim() : null,
        chequeNumber: method === 'cheque' ? fullPaymentCheque.value.trim() : null
      };

      const res = await fetch('/orders/pay-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(payload)
      });

      const j = await res.json().catch(() => null);
      if (!res.ok) {
        showAlertModal(j?.error || 'Bulk payment failed', 'Error');
        return;
      }

      // --------------------
      // SUCCESS
      // --------------------
      if (fullPaymentModal) fullPaymentModal.hide();
      pendingFullPayment = null;

      showAlertModal('Full payment applied successfully', 'Success');
      fetchDebtorsList();
      try { await loadDailyOrdersDropdown({ force: true }); } catch (e) {}

    } catch (err) {
      console.error('bulk pay error', err);
      showAlertModal('Network error during bulk payment', 'Error');
    } finally {
      confirmFullPaymentBtn.disabled = false;
      confirmFullPaymentBtn.textContent = originalText;
    }
  });
}


  // Initial state
  renderOrderDetails(null);
  loadDailyOrdersDropdown({ force: true });
  startDailyOrdersAutoRefresh();
  let dailyTotalsAutoHideTimer = null;
  if (dailyTotalsToggleBtn) {
    dailyTotalsToggleBtn.addEventListener('click', async function () {
      const isHidden = dailyTotalsContainer && dailyTotalsContainer.dataset.hidden === '1';
      if (isHidden && !dailyTotalsLoaded) {
        try { await loadDailyOrdersDropdown({ force: true }); } catch (e) {}
      }
      applyDailyTotalsVisibility(!isHidden);

      if (dailyTotalsAutoHideTimer) {
        clearTimeout(dailyTotalsAutoHideTimer);
        dailyTotalsAutoHideTimer = null;
      }

      if (isHidden) {
        dailyTotalsAutoHideTimer = setTimeout(() => {
          applyDailyTotalsVisibility(true);
        }, 15000);
      }
    });
  }
  if (dailyTotalsContainer) {
    applyDailyTotalsVisibility(true);
  }

if (dailyOrdersSelect) {
  dailyOrdersSelect.addEventListener('change', async function () {
    const v = (this.value || '').trim();
    if (!v) return;

    if (fetchOrderIdInput) fetchOrderIdInput.value = v;

    // optional: avoid refetching the same order that is already loaded
    if (currentOrderId && String(currentOrderId).trim() === v) return;

    // mimic the Fetch button UX
    if (fetchOrderBtn) {
      fetchOrderBtn.disabled = true;
      fetchOrderBtn.textContent = 'Fetching...';
    }

    try {
      await fetchOrderById(v);
    } finally {
      if (fetchOrderBtn) {
        fetchOrderBtn.disabled = false;
        fetchOrderBtn.textContent = 'Fetch';
      }

      // keep your spinner cleanup consistent with submit handler
      if (window.__FormSpinner && typeof window.__FormSpinner.hide === 'function' && fetchOrderBtn) {
        window.__FormSpinner.hide(fetchOrderBtn);
      } else if (fetchOrderBtn) {
        fetchOrderBtn.classList.remove('loading');
        fetchOrderBtn.removeAttribute('data-spinner-active');
      }
    }
  });
}

  if (applyManualDiscountBtn) {
    applyManualDiscountBtn.addEventListener('click', async function () {
      if (!isAdminUser) return;
      if (!currentOrderId) {
        showAlertModal('Fetch an order before applying discount.', 'Missing order');
        return;
      }
      if (currentHasDiscount) {
        showAlertModal('This order already has a discount applied.', 'Discount');
        return;
      }

      const mode = payManualDiscountMode ? payManualDiscountMode.value : 'amount';
      const raw = payManualDiscountValue ? payManualDiscountValue.value : '';
      const value = Number(raw);

      if (!isFinite(value) || value <= 0) {
        showAlertModal('Enter a valid discount value (> 0).', 'Discount');
        return;
      }
      if (mode === 'percent' && value > 100) {
        showAlertModal('Percentage discount cannot exceed 100%.', 'Discount');
        return;
      }

      applyManualDiscountBtn.disabled = true;
      const originalText = applyManualDiscountBtn.textContent;
      applyManualDiscountBtn.textContent = 'Applying...';
      try {
        await applyManualDiscountToOrder(currentOrderId, mode, value);
      } finally {
        applyManualDiscountBtn.disabled = false;
        applyManualDiscountBtn.textContent = originalText;
      }
    });
  }

  // at the end of orders_pay.js (after initial render)
(function prefillFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('orderId');
    if (id && fetchOrderIdInput) {
      fetchOrderIdInput.value = id;
      // automatically fetch (but do not submit form)
      fetchOrderById(id);
    }
  } catch (e) { /* ignore */ }
})();


  // -------------------------
  // Orders Explorer for Pay page (re-uses server /api/orders)
  // - openOrdersExplorerBtn opens modal and auto-loads today's orders
  // - clicking Order ID link or the View button navigates to server-rendered /orders/view/:orderId
  // -------------------------
  (function ordersExplorerForPay() {
    const openBtn = document.getElementById('openOrdersExplorerBtn');
    const modalEl = document.getElementById('ordersExplorerModal');
    const modal = (window.bootstrap && modalEl) ? new bootstrap.Modal(modalEl) : null;
    const ordersFrom = document.getElementById('ordersFrom');
    const ordersTo = document.getElementById('ordersTo');
    const fetchBtn = document.getElementById('ordersFetchBtn');
    const presetToday = document.getElementById('ordersPresetToday');
    const presetYesterday = document.getElementById('ordersPresetYesterday');
    const presetThisWeek = document.getElementById('ordersPresetThisWeek');
    const table = document.getElementById('ordersModalTable');
    const countEl = document.getElementById('ordersCount');

    if (!openBtn || !modalEl || !ordersFrom || !ordersTo || !table) return;

    function isoDate(d) {
      const dt = d ? new Date(d) : new Date();
      const yr = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${yr}-${mm}-${dd}`;
    }

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

    function setDefaultRangeToToday() {
      const t = new Date();
      ordersFrom.value = isoDate(t);
      ordersTo.value = isoDate(t);
      setActivePreset(presetToday);
    }

    function setActivePreset(activeBtn) {
      [presetToday, presetYesterday, presetThisWeek].forEach(btn => {
        if (!btn) return;
        if (btn === activeBtn) {
          btn.classList.remove('btn-outline-secondary');
          btn.classList.add('btn-primary');
          btn.setAttribute('aria-pressed','true');
        } else {
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-outline-secondary');
          btn.setAttribute('aria-pressed','false');
        }
      });
    }

    async function fetchOrdersList(from, to) {
      if (!from || !to) return renderOrdersListError('Invalid date range');
      table.querySelector('tbody').innerHTML = `<tr><td class="text-muted" colspan="5">Loading...</td></tr>`;
      try {
        const url = `/orders/list?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
        if (!res.ok) {
          const j = await res.json().catch(()=>null);
          const msg = (j && j.error) ? j.error : `Failed to fetch orders (${res.status})`;
          return renderOrdersListError(msg);
        }
        const j = await res.json().catch(()=>null);
        if (!j || !Array.isArray(j.orders)) return renderOrdersListError('Invalid response from server.');
        renderOrdersList(j.orders);
      } catch (err) {
        console.error('fetchOrdersList err', err);
        renderOrdersListError('Network error while fetching orders.');
      }
    }

    function renderOrdersListError(msg) {
      table.querySelector('tbody').innerHTML = `<tr><td class="text-muted" colspan="5">${msg}</td></tr>`;
      if (countEl) countEl.textContent = '0 results';
    }

    function escapeHtml(s) {
      if (!s) return '';
      return String(s).replace(/[&<>"'`=\/]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
    }

function renderOrdersList(orders) {
  const tbody = table.querySelector('tbody');

  if (!orders || !orders.length) {
    tbody.innerHTML = '<tr><td class="text-muted" colspan="5">No orders in this range.</td></tr>';
    if (countEl) countEl.textContent = '0 results';
    return;
  }

  tbody.innerHTML = '';

  orders.forEach(o => {
    const oid = escapeHtml(o.orderId || o._id || '');
    const name = escapeHtml(o.name || 'Walk-in');
    const created = o.createdAt ? formatDateTimeForDisplay(o.createdAt) : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <a href="/orders/view/${encodeURIComponent(o.orderId || o._id || '')}"
           class="orders-explorer-link"
           title="Order ID: ${oid}">
          ${name}
        </a>
      </td>
      <td class="text-end">GH₵ ${Number(o.total || 0).toFixed(2)}</td>
      <td>${escapeHtml(o.status || '')}</td>
      <td>${escapeHtml(created)}</td>
      <td class="text-center">
        <button
          class="btn btn-sm btn-primary orders-explorer-view-btn"
          data-order-id="${oid}">
          View
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (countEl) {
    countEl.textContent = `${orders.length} result${orders.length > 1 ? 's' : ''}`;
  }
}

    // open modal and auto-fetch
    openBtn.addEventListener('click', function () {
      setDefaultRangeToToday();
      if (modal) modal.show();
      // immediate fetch for today
      const from = ordersFrom.value || isoDate(new Date());
      const to = ordersTo.value || isoDate(new Date());
      fetchOrdersList(from, to);
    });

    // preset handlers
    presetToday && presetToday.addEventListener('click', function () {
      setDefaultRangeToToday();
    });
    presetYesterday && presetYesterday.addEventListener('click', function () {
      const d = new Date(); d.setDate(d.getDate() - 1);
      ordersFrom.value = isoDate(d);
      ordersTo.value = isoDate(d);
      setActivePreset(presetYesterday);
    });
    presetThisWeek && presetThisWeek.addEventListener('click', function () {
      const now = new Date();
      const day = now.getDay();
      const diffToMonday = (day + 6) % 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - diffToMonday);
      ordersFrom.value = isoDate(monday);
      ordersTo.value = isoDate(now);
      setActivePreset(presetThisWeek);
    });

    // refresh button
    fetchBtn && fetchBtn.addEventListener('click', function () {
      const from = ordersFrom.value || isoDate(new Date());
      const to = ordersTo.value || isoDate(new Date());
      if (new Date(from) > new Date(to)) {
        alert('From date cannot be after To date');
        return;
      }
      fetchOrdersList(from, to);
    });

    // delegate clicks inside table: anchor -> native navigation; view button -> navigate programmatically
    table.addEventListener('click', function (ev) {
      const a = ev.target.closest('.orders-explorer-link');
      if (a) {
        // let native navigation happen
        return;
      }
      const vb = ev.target.closest('.orders-explorer-view-btn');
      if (vb) {
        const id = vb.dataset.orderId;
        if (id) {
          // navigate to server-rendered order view
          window.location.href = '/orders/view/' + encodeURIComponent(id);
        }
      }
    });

    // set initial defaults (do not auto-fetch)
    setDefaultRangeToToday();
  })();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOrdersPay, { once: true });
} else {
  initOrdersPay();
}

document.addEventListener('ajax:page:loaded', function () {
  initOrdersPay();
});



