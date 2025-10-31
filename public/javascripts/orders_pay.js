// public/javascripts/orders_pay.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const fetchForm = document.getElementById('fetchOrderForm');
  const fetchOrderIdInput = document.getElementById('fetchOrderId');
  const fetchOrderBtn = document.getElementById('fetchOrderBtn');
  const orderInfo = document.getElementById('orderInfo');
  const payNowBtn = document.getElementById('payNowBtn');

  let currentOrderId = null;
  let currentOrderTotal = 0;

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
  // Returns "Sub, Sub2" (comma-separated). If selectionLabel falsy returns ''.
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

  // Alert modal: informational/error messages
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

  // Confirm modal: returns Promise<boolean>
  function showConfirmModal(message, title = 'Confirm') {
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
      payNowBtn.style.display = 'none';
      payNowBtn.disabled = true;
      currentOrderId = null;
      currentOrderTotal = 0;
      return;
    }

    currentOrderId = order.orderId;
    currentOrderTotal = order.total;

    // Build item rows using flex so there are no bullets and alignment is consistent
    let itemsHtml = '';
    if (order.items && order.items.length) {
      itemsHtml += `<div class="list-group mb-2">`;
      order.items.forEach(it => {
        // Get only sub-unit names, comma-separated, single-line
        const rawLabel = it.selectionLabel || '';
        let selLabel = subUnitsOnlyFromLabel(rawLabel);
        if (!selLabel && it.selections && it.selections.length) {
          // fallback: if selections include populated subUnit.name use that
          selLabel = it.selections.map(s => {
            if (s.subUnit && typeof s.subUnit === 'object' && s.subUnit.name) return s.subUnit.name;
            if (s.subUnit && typeof s.subUnit === 'string') return s.subUnit;
            return '';
          }).filter(Boolean).join(', ');
        }
        if (!selLabel) selLabel = '(no label)';

        // detect fb either by explicit flag or by raw label suffix
        const isFb = (it.fb === true) || (typeof rawLabel === 'string' && rawLabel.includes('(F/B)'));
        const fbBadge = isFb ? ' <span class="badge bg-secondary ms-2">F/B</span>' : '';

        const qty = Number(it.pages || 1);
        const unit = Number(it.unitPrice || 0);
        const subtotal = Number(it.subtotal || (qty * unit));

        // single row, left = selection (single-line), right = qty/unit/subtotal
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

    orderInfo.innerHTML = `
      <p><strong>Order ID:</strong> ${escapeHtml(order.orderId)}</p>
      <p><strong>Status:</strong> ${statusLabel}</p>
      ${itemsHtml}
      <p class="text-end"><strong>Total: GH₵ ${fmt(order.total)}</strong></p>
    `;

    // Hide Pay button completely if already paid; otherwise show it and enable if not paid
    if (order.status === 'paid') {
      payNowBtn.style.display = 'none';
      payNowBtn.disabled = true;
    } else {
      payNowBtn.style.display = '';
      payNowBtn.disabled = false;
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
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
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

  // pay now: confirm with modal, server authoritatively marks paid, then re-fetch order to show updated state
  if (payNowBtn) {
    payNowBtn.addEventListener('click', async function () {
      if (!currentOrderId) {
        showAlertModal('No order loaded to pay', 'No Order');
        return;
      }

      // Confirm using modal
      const ok = await showConfirmModal('Mark this order as paid?', 'Confirm payment');
      if (!ok) return;

      payNowBtn.disabled = true;
      const origText = payNowBtn.textContent;
      payNowBtn.textContent = 'Processing...';
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(currentOrderId)}/pay`, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
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

  // Initial state
  renderOrderDetails(null);
});
