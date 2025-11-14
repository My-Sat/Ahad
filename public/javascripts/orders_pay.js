// public/javascripts/orders_pay.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const fetchForm = document.getElementById('fetchOrderForm');
  const fetchOrderIdInput = document.getElementById('fetchOrderId');
  const fetchOrderBtn = document.getElementById('fetchOrderBtn');
  const orderInfo = document.getElementById('orderInfo');
  const payNowBtn = document.getElementById('payNowBtn');

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
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="ordersPayAlertModalLabel"></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body" id="ordersPayAlertModalBody"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
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
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="ordersPayConfirmModalLabel"></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body" id="ordersPayConfirmModalBody"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
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

  // -------------------------
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
        const qty = Number(it.pages || 1);
        const unit = Number(it.unitPrice || 0);
        const subtotal = Number(it.subtotal || (qty * unit));

        itemsHtml += `
          <div class="list-group-item d-flex align-items-center justify-content-between" style="padding:0.5rem 0.75rem;">
            <div style="flex:1;min-width:0;">
              <span style="display:inline-block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px;">
                ${escapeHtml(selLabel)}
              </span>
              ${fbBadge}
            </div>
            <div class="text-end ms-3" style="min-width:180px;">
              <div>QTY: ${escapeHtml(String(qty))}</div>
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

    orderInfo.innerHTML = `
      <p><strong>Order ID:</strong> ${escapeHtml(order.orderId)}</p>
      <p><strong>Status:</strong> ${statusLabel}</p>
      ${itemsHtml}
      <p class="text-end"><strong>Total: GH₵ ${fmt(order.total)}</strong></p>
      ${ (outstanding !== null && outstanding > 0) ? `<p class="text-end text-danger"><strong>Remaining: GH₵ ${fmt(outstanding)}</strong></p>` : '' }
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
      const res = await fetch('/debtors', { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
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
      // populate table
      const html = rows.map(d => {
        const out = Number(d.outstanding || (d.amountDue - d.paidSoFar || 0)).toFixed(2);
        return `<tr data-order-id="${escapeHtml(d.orderId || '')}">
          <td>${escapeHtml(d.orderId || '')}</td>
          <td>${escapeHtml(d.debtorName || '-')}</td>
          <td class="text-end">GH₵ ${escapeHtml(Number(d.amountDue || 0).toFixed(2))}</td>
          <td class="text-end">GH₵ ${escapeHtml(Number(d.paidSoFar || 0).toFixed(2))}</td>
          <td class="text-end">GH₵ ${escapeHtml(out)}</td>
          <td class="text-center"><button class="btn btn-sm btn-outline-primary view-debtor-order" type="button" data-order-id="${escapeHtml(d.orderId || '')}">Update</button></td>
        </tr>`;
      }).join('');
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
    debtorsTable.addEventListener('click', function (ev) {
      const btn = ev.target.closest('.view-debtor-order');
      if (btn) {
        const id = btn.dataset.orderId;
        if (id) {
          // close modal and load order on page
          if (debtorsModal) debtorsModal.hide();
          fetchOrderIdInput.value = id;
          fetchOrderById(id);
        }
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
        const url = `/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
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
        const created = o.createdAt ? formatDateTimeForDisplay(o.createdAt) : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><a href="/admin/orders/view/${encodeURIComponent(o.orderId || o._id || '')}" class="orders-explorer-link">${oid}</a></td>
          <td class="text-end">GH₵ ${Number(o.total || 0).toFixed(2)}</td>
          <td>${escapeHtml(o.status || '')}</td>
          <td>${escapeHtml(created)}</td>
          <td class="text-center"><button class="btn btn-sm btn-outline-secondary orders-explorer-view-btn" data-order-id="${escapeHtml(o.orderId || o._id || '')}">View</button></td>
        `;
        tbody.appendChild(tr);
      });
      if (countEl) countEl.textContent = `${orders.length} result${orders.length > 1 ? 's' : ''}`;
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
