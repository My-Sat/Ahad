// public/javascripts/orders_pay.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const fetchForm = document.getElementById('fetchOrderForm');
  const fetchOrderIdInput = document.getElementById('fetchOrderId');
  const fetchOrderBtn = document.getElementById('fetchOrderBtn');
  const orderInfo = document.getElementById('orderInfo');
  const payNowBtn = document.getElementById('payNowBtn');

  const openCashiersBtn = document.getElementById('openCashiersBtn');
const cashiersModalEl = document.getElementById('cashiersModal');
const cashiersModal = (window.bootstrap && cashiersModalEl) ? new bootstrap.Modal(cashiersModalEl) : null;
const cashiersTable = document.getElementById('cashiersTable');
const cashiersStatusLoading = document.getElementById('cashiersStatusLoading');


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
  const fullPaymentModalEl = document.getElementById('fullPaymentConfirmModal');
  const fullPaymentModal = fullPaymentModalEl ? new bootstrap.Modal(fullPaymentModalEl) : null;

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

  // Helper: format money
  function fmt(n) {
    return Number(n).toFixed(2);
  }

  // Escape helper for safety
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
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
      currentOrderId = null;
      currentOrderTotal = 0;
      currentOrderStatus = null;
      return;
    }

    currentOrderId = order.orderId;
    currentOrderTotal = order.total;
    currentOrderStatus = order.status;

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
        const rawPages = Number(it.pages || 1);
        const displayQty = (typeof it.effectiveQty !== 'undefined' && it.effectiveQty !== null) ? Number(it.effectiveQty) : (isFb ? Math.ceil(rawPages / 2) : rawPages);
        const qty = Number(displayQty);
        const requiresPrinter = !!it.printer;        const qtyLabel = requiresPrinter ? 'Sheets' : 'QTY';
        const pages = requiresPrinter ? rawPages : null;


        const unit = Number(it.unitPrice || 0);

        // prefer server-subtotal; otherwise compute from displayQty
        const subtotal = Number((typeof it.subtotal === 'number' || !isNaN(Number(it.subtotal))) ? Number(it.subtotal) : (qty * unit));

        const serviceName = it.serviceName || 'Service';
        const factor = Number(it.factor || 1);

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
              <div>${qtyLabel}: ${escapeHtml(String(qty))}</div>
              ${ requiresPrinter ? `<div>Pages: ${escapeHtml(String(pages))}</div>` : '' }
              ${ factor > 1 ? `<div>QTY ×${factor}</div>` : '' }
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

        // build payments HTML (if any) to show payment history and cashier names
    let paymentsHtml = '';
    if (order.payments && order.payments.length) {
      paymentsHtml += `<div class="mt-3"><h6 class="mb-2">Payment History</h6><div class="list-group">`;
      order.payments.forEach(pay => {
        const dt = pay.createdAt ? new Date(pay.createdAt).toLocaleString() : '';
        const method = (pay.method || 'unknown').toUpperCase();
        const amount = Number(pay.amount || 0).toFixed(2);
        // determine recorded by display
        let recorder = '';
        if (pay.recordedBy && typeof pay.recordedBy === 'object') {
          recorder = pay.recordedBy.name || pay.recordedBy.username || '';
        } else if (pay.recordedByName) {
          recorder = pay.recordedByName;
        }
        paymentsHtml += `
          <div class="list-group-item d-flex justify-content-between align-items-center">
            <div>
              <div><strong>${escapeHtml(method)}</strong> — ${escapeHtml(dt)}</div>
              <div class="small text-muted">GH₵ ${escapeHtml(amount)}</div>
              ${ recorder ? `<div class="small text-muted">Recorded by: ${escapeHtml(recorder)}</div>` : '' }
            </div>
            <div class="text-end small text-muted">${escapeHtml(pay.note || '')}</div>
          </div>
        `;
      });
      paymentsHtml += `</div></div>`;
    }


    // compute outstanding: prefer server-supplied, otherwise compute from payments
    let outstanding = null;
    if (typeof order.outstanding !== 'undefined' && order.outstanding !== null) {
      outstanding = Number(order.outstanding);
    } else {
      // sum payments if present
      let paid = 0;
      if (order.payments && Array.isArray(order.payments)) {
        order.payments.forEach(p => { const a = Number(p.amount || 0); if (!isNaN(a)) paid += a; });
      }
      outstanding = Number((Number(order.total || 0) - paid).toFixed(2));
    }

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

    let discountHtml = '';
    if (hasDiscount) {
      const before = (typeof order.totalBeforeDiscount !== 'undefined' && order.totalBeforeDiscount !== null)
        ? Number(order.totalBeforeDiscount)
        : Number(order.total || 0) + Number(order.discountAmount || 0);

      const label = order.discountBreakdown && order.discountBreakdown.label ? String(order.discountBreakdown.label) : 'Discount';
      discountHtml = `
        <div class="mt-2">
          <p class="text-end mb-1"><span class="text-muted">Total before discount:</span> <strong>GH₵ ${fmt(before)}</strong></p>
          <p class="text-end mb-1"><span class="text-muted">${escapeHtml(label)}:</span> <strong class="text-success">- GH₵ ${fmt(order.discountAmount)}</strong></p>
        </div>
      `;
    }

    orderInfo.innerHTML = `
      ${ handlerDisplay ? `<p><strong>Handled by:</strong> ${escapeHtml(handlerDisplay)}</p>` : '' }
      ${ customerDisplay ? `<p><strong>Customer:</strong> ${escapeHtml(customerDisplay)}</p>` : '' }
      <p><strong>Order ID:</strong> ${escapeHtml(order.orderId)}</p>
      <p><strong>Status:</strong> ${statusLabel}</p>
      ${itemsHtml}
      ${discountHtml}
      <p class="text-end"><strong>Total to pay: GH₵ ${fmt(order.total)}</strong></p>
      ${ (outstanding !== null && outstanding > 0) ? `<p class="text-end"><strong>Remaining: GH₵ ${fmt(outstanding)}</strong></p>` : '' }
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
        // do not allow part payment larger than order total (basic guard)
        if (partAmount > Number(currentOrderTotal)) {
          showAlertModal('Part payment amount cannot exceed total', 'Invalid amount');
          return;
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
      const confirmMsg = isPart ? `Record a part payment of GH₵ ${fmt(partAmount)} for order ${escapeHtml(currentOrderId)}?` : `Mark order ${escapeHtml(currentOrderId)} as paid?`;
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
  // 5 visible columns in the table (Cashier, Today's Cash, Already Collected, Previous Balance, Actions)
  tbody.innerHTML = '<tr><td class="text-muted" colspan="5">Loading...</td></tr>';
  try {
    const url = '/cashiers/status' + (dateIso ? ('?date=' + encodeURIComponent(dateIso)) : '');
    const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
    if (!res.ok) {
      const j = await res.json().catch(()=>null);
      const msg = (j && j.error) ? j.error : `Failed to fetch cashiers (${res.status})`;
      tbody.innerHTML = `<tr><td class="text-muted" colspan="5">${escapeHtml(msg)}</td></tr>`;
      cashiersStatusLoading.textContent = '--';
      return;
    }

    const j = await res.json().catch(()=>null);
    if (!j || !Array.isArray(j.cashiers)) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="5">Invalid response</td></tr>';
      cashiersStatusLoading.textContent = '--';
      return;
    }

    const rows = j.cashiers;
    cashiersStatusLoading.textContent = `Date: ${new Date(j.date).toLocaleDateString()}`;

    tbody.innerHTML = rows.map(r => {
      const total = Number(r.totalCashRecordedToday || 0);
      const already = Number(r.alreadyCollectedToday || 0);
      // prefer server-supplied uncollectedToday if present; otherwise compute
      const uncollected = (typeof r.uncollectedToday !== 'undefined' && r.uncollectedToday !== null)
        ? Number(r.uncollectedToday || 0)
        : Number(Math.max(0, total - already).toFixed(2));

      const prevBal = Number(r.previousBalance || 0);

      return `<tr data-cashier-id="${escapeHtml(r.cashierId)}">
        <td>${escapeHtml(r.name)}</td>
        <!-- Today's Cash (green) shows total payments recorded for the day (cash+momo+cheque) -->
        <td class="text-end text-success">GH₵ ${Number(total).toFixed(2)}</td>
        <td class="text-end">GH₵ ${Number(already).toFixed(2)}</td>
        <!-- If you want the amount the accountant still needs to collect, show uncollected separately.
             For now we compute it client-side and you can display it if desired. -->
        <td class="text-end text-danger">GH₵ ${Number(prevBal).toFixed(2)}</td>
        <td class="text-center"><button class="btn btn-sm btn-primary cashier-receive-btn" type="button" data-cashier-id="${escapeHtml(r.cashierId)}" data-cashier-name="${escapeHtml(r.name)}">Receive</button></td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('fetchCashiersStatus err', err);
    const tbody = cashiersTable.querySelector('tbody');
    tbody.innerHTML = '<tr><td class="text-muted" colspan="5">Network error while fetching cashiers.</td></tr>';
    cashiersStatusLoading.textContent = '--';
  }
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

    // compute/choose uncollected: prefer server field, else compute from totals if provided
    const total = Number(j.totalCashRecordedToday || 0);
    const already = Number(j.alreadyCollectedToday || 0);
    const uncollected = (typeof j.uncollectedToday !== 'undefined' && j.uncollectedToday !== null)
      ? Number(j.uncollectedToday || 0)
      : Number(Math.max(0, total - already).toFixed(2));

    // Show the currently uncollected cash (will be 0.00 after collection)
    if (myCashTodayEl) myCashTodayEl.textContent = Number(uncollected).toFixed(2);
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
  // If you prefer I can patch the exact location for you — but placing the following small observer helps:
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
    accountantLedgerDate.textContent = `Date: ${new Date(j.date).toLocaleDateString()}`;
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
    fetchAccountantLedger();
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
    fetchCashiersStatus();
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
  async function fetchDebtorsList() {
    if (!debtorsTable || !debtorsCount) return;
    debtorsCount.textContent = 'Loading...';
    const tbody = debtorsTable.querySelector('tbody');
    if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">Loading...</td></tr>`;
    try {
      const res = await fetch('/orders/debtors', { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        const msg = (j && j.error) ? j.error : `Failed to fetch debtors (${res.status})`;
        if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">${escapeHtml(msg)}</td></tr>`;
        debtorsCount.textContent = '0 results';
        return;
      }
      const j = await res.json().catch(()=>null);
      if (!j || !Array.isArray(j.debtors)) {
        if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">No debtors found.</td></tr>`;
        debtorsCount.textContent = '0 results';
        return;
      }
      const rows = j.debtors;
      if (!rows.length) {
        if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">No debtors found.</td></tr>`;
        debtorsCount.textContent = '0 results';
        return;
      }
// -------- Group by debtor name --------
const grouped = {};
rows.forEach(d => {
  const key = d.debtorName || 'Unknown';
  if (!grouped[key]) grouped[key] = [];
  grouped[key].push(d);
});

let html = '';
let groupIndex = 0;

Object.entries(grouped).forEach(([debtorName, items]) => {
  // SINGLE record → keep existing logic exactly
  if (items.length === 1) {
    const d = items[0];
    const out = Number(d.outstanding || (d.amountDue - d.paidSoFar || 0)).toFixed(2);
    html += `
      <tr data-order-id="${escapeHtml(d.orderId || '')}">
        <td>${escapeHtml(d.orderId || '')}</td>
        <td>${escapeHtml(debtorName)}</td>
        <td class="text-end">GH₵ ${Number(d.amountDue || 0).toFixed(2)}</td>
        <td class="text-end">GH₵ ${Number(d.paidSoFar || 0).toFixed(2)}</td>
        <td class="text-end">GH₵ ${out}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-primary view-debtor-order"
            type="button"
            data-order-id="${escapeHtml(d.orderId || '')}">
            Update
          </button>
        </td>
      </tr>
    `;
    return;
  }

  // MULTIPLE records → expandable group
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
      <span class="me-2 debtor-toggle-icon">▶</span>
      <strong>${escapeHtml(debtorName)}</strong>
      <span class="text-muted ms-2">(${items.length} orders)</span>
    </td>
    <td class="text-end">GH₵ ${totalDue.toFixed(2)}</td>
    <td class="text-end">GH₵ ${totalPaid.toFixed(2)}</td>
    <td class="text-end fw-semibold">GH₵ ${totalOutstanding.toFixed(2)}</td>
    <td class="text-center">
      <button
        class="btn btn-sm btn-success pay-debtor-full"
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
        <td>${escapeHtml(d.orderId || '')}</td>
        <td>${escapeHtml(debtorName)}</td>
        <td class="text-end">GH₵ ${Number(d.amountDue || 0).toFixed(2)}</td>
        <td class="text-end">GH₵ ${Number(d.paidSoFar || 0).toFixed(2)}</td>
        <td class="text-end">GH₵ ${out}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-primary view-debtor-order"
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
    <td colspan="6">
      <div style="
        border-bottom: 5px solid #E6FFE6;
        margin: 6px 0 4px;
      "></div>
    </td>
  </tr>
`;


});

      if (tbody) tbody.innerHTML = html;
      debtorsCount.textContent = `${rows.length} result${rows.length > 1 ? 's' : ''}`;
    } catch (err) {
      console.error('fetch debtors err', err);
      if (tbody) tbody.innerHTML = `<tr><td class="text-muted" colspan="6">Network error while fetching debtors.</td></tr>`;
      debtorsCount.textContent = '0 results';
    }
  }

  if (openDebtorsBtn) {
    openDebtorsBtn.addEventListener('click', function () {
      if (debtorsModal) debtorsModal.show();
      fetchDebtorsList();
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
    if (icon) icon.textContent = expanded ? '▶' : '▼';
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


const customersModalEl = document.getElementById('customersModal');
const customersModal = customersModalEl ? new bootstrap.Modal(customersModalEl) : null;
const openCustomersBtn = document.getElementById('openCustomersBtn');

if (openCustomersBtn) {
  openCustomersBtn.addEventListener('click', async () => {
    if (customersModal) customersModal.show();
    await fetchCustomers();
  });
}

async function fetchCustomers() {
  const tbody = document.querySelector('#customersTable tbody');
  const countEl = document.getElementById('customersCount');

  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" class="text-muted">Loading...</td></tr>`;
  if (countEl) countEl.textContent = 'Loading...';

  try {
    const res = await fetch('/customers/api/list', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    }); 

    const j = await res.json().catch(() => null);
    if (!j || !j.ok || !Array.isArray(j.customers)) {
      throw new Error('Invalid response');
    }

    if (!j.customers.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-muted">No customers found.</td></tr>`;
      if (countEl) countEl.textContent = '0 customers';
      return;
    }

    tbody.innerHTML = '';

    j.customers.forEach(c => {
      const name =
        (c.category === 'artist' || c.category === 'organisation')
          ? (c.businessName || '-')
          : (c.firstName || '-');

      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(c.phone || '')}</td>
        <td>
          <span class="badge bg-secondary">
            ${escapeHtml(c.category || '')}
          </span>
        </td>
        <td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-'}</td>
        <td class="text-center">
          <button
            type="button"
            class="btn btn-sm btn-primary me-1 edit-customer-btn">
            Edit
          </button>
          <button
            type="button"
            class="btn btn-sm btn-danger delete-customer-btn">
            Delete
          </button>
        </td>
      `;

      // ---- EDIT HANDLER (clean + safe) ----
      const editBtn = tr.querySelector('.edit-customer-btn');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          if (typeof openEditCustomerModal === 'function') {
            openEditCustomerModal(c);
          } else {
            console.error('openEditCustomerModal is not defined');
          }
        });
      }

      tbody.appendChild(tr);

      // ---- DELETE HANDLER (safe + confirmed) ----
const deleteBtn = tr.querySelector('.delete-customer-btn');
if (deleteBtn) {
  deleteBtn.addEventListener('click', async () => {
    const nameLabel =
      (c.category === 'artist' || c.category === 'organisation')
        ? (c.businessName || c.phone)
        : (c.firstName || c.phone);

    const ok = confirm(
      `Delete customer "${nameLabel}"?\n\nThis cannot be undone.\nCustomers with orders cannot be deleted.`
    );
    if (!ok) return;

    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';

    try {
      const res = await fetch(`/customers/${encodeURIComponent(c._id)}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });

      const j = await res.json().catch(() => null);

      if (!res.ok) {
        alert((j && j.error) ? j.error : 'Delete failed');
        return;
      }

      // Refresh customers list
      await fetchCustomers();

    } catch (err) {
      console.error('delete customer error', err);
      alert('Network error while deleting customer');
    } finally {
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Delete';
    }
  });
}

    });

    if (countEl) countEl.textContent = `${j.customers.length} customers`;

  } catch (err) {
    console.error('fetchCustomers error', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-danger">
          Failed to load customers
        </td>
      </tr>
    `;
    if (countEl) countEl.textContent = 'Error';
  }
}

// Refresh customers list after edit
document.addEventListener('customer:updated', async () => {
  if (customersModalEl && customersModalEl.classList.contains('show')) {
    await fetchCustomers();
  }
});


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


});
