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

  // Render a single order's details into the #orderInfo element.
  // Surfaces F/B if item.fb === true OR if selectionLabel includes "(F/B)".
  function renderOrderDetails(order) {
    if (!order) {
      orderInfo.innerHTML = '<p class="text-muted">No order loaded.</p>';
      payNowBtn.disabled = true;
      currentOrderId = null;
      currentOrderTotal = 0;
      return;
    }

    currentOrderId = order.orderId;
    currentOrderTotal = order.total;

    // helper: extract sub-units-only from selectionLabel "Unit: Sub + Unit2: Sub2" -> "Sub, Sub2"
    function subUnitsOnlyFromLabel(selectionLabel) {
      if (!selectionLabel) return '';
      const parts = selectionLabel.split(/\s*\+\s*/);
      const subs = parts.map(part => {
        const idx = part.indexOf(':');
        if (idx >= 0) return part.slice(idx + 1).trim();
        return part.trim();
      }).filter(Boolean);
      return subs.join(', ');
    }

    // Build items list (inline selection per item; printer name shown)
    const itemsHtml = (order.items && order.items.length)
      ? `<div class="mb-2"><div class="list-group">` + order.items.map(it => {
        const rawLabel = it.selectionLabel || '(item)';
        const isFb = (it.fb === true) || (typeof rawLabel === 'string' && rawLabel.includes('(F/B)'));
        const cleanLabel = isFb ? subUnitsOnlyFromLabel(rawLabel).replace(/\s*\(F\/B\)\s*$/i, '').trim() : subUnitsOnlyFromLabel(rawLabel) || rawLabel;
        const qty = Number(it.pages || 1);
        const unit = Number(it.unitPrice || 0);
        const subtotal = Number(it.subtotal || (qty * unit));
        const fbBadge = isFb ? ' <span class="badge bg-secondary ms-2">F/B</span>' : '';
        // printer: server should send name; fallback to id/string
        const printerName = it.printer ? escapeHtml(String(it.printer)) : '-';
        return `<div class="list-group-item d-flex justify-content-between align-items-center">
            <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px;">
              ${escapeHtml(cleanLabel)}${fbBadge}
            </div>
            <div class="text-end small text-muted">
              <div>${qty} × GH₵ ${fmt(unit)}</div>
              <div>Printer: ${printerName}</div>
            </div>
            <div class="ms-3"><strong>GH₵ ${fmt(subtotal)}</strong></div>
          </div>`;
      }).join('') + `</div></div>`
      : '<p class="text-muted">No items in this order.</p>';

    const statusLabel = order.status ? escapeHtml(order.status) : 'unknown';

    orderInfo.innerHTML = `
      <p><strong>Order ID:</strong> ${escapeHtml(order.orderId)}</p>
      <p><strong>Status:</strong> ${statusLabel}</p>
      ${itemsHtml}
      <p class="text-end"><strong>Total: GH₵ ${fmt(order.total)}</strong></p>
    `;

    // Enable or disable Pay button based on status
    payNowBtn.disabled = order.status === 'paid';
  }

  // Escape helper for safety
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

  // Fetch order by id and render
  async function fetchOrderById(id) {
    if (!id) return;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        alert((j && j.error) ? j.error : 'Order fetch failed');
        renderOrderDetails(null);
        return null;
      }
      renderOrderDetails(j.order);
      return j.order;
    } catch (err) {
      console.error('fetch order err', err);
      alert('Failed to fetch order');
      renderOrderDetails(null);
      return null;
    }
  }

  // form submit: fetch order
  fetchForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = fetchOrderIdInput.value && fetchOrderIdInput.value.trim();
    if (!id) return alert('Enter an order id');
    fetchOrderBtn.disabled = true;
    fetchOrderBtn.textContent = 'Fetching...';
    try {
      await fetchOrderById(id);
    } finally {
      fetchOrderBtn.disabled = false;
      fetchOrderBtn.textContent = 'Fetch';
    }
  });

  // pay now: server authoritatively marks paid, then re-fetch order to show updated state
  payNowBtn.addEventListener('click', async function () {
    if (!currentOrderId) return;
    if (!confirm('Mark this order as paid?')) return;
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
        alert((j && j.error) ? j.error : 'Pay failed');
        return;
      }
      if (typeof showGlobalToast === 'function') showGlobalToast('Payment recorded', 2000);

      // re-fetch order to display updated status and data
      await fetchOrderById(currentOrderId);

      // clear input & disable pay button if now paid
      fetchOrderIdInput.value = '';
    } catch (err) {
      console.error('pay err', err);
      alert('Payment failed');
    } finally {
      payNowBtn.disabled = false;
      payNowBtn.textContent = origText;
    }
  });

  // Initial state
  renderOrderDetails(null);
});
