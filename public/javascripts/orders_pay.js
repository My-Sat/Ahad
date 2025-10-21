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

    // Build items list
    const itemsHtml = (order.items && order.items.length)
      ? `<ul class="mb-2">${order.items.map(it => {
        const label = it.selectionLabel || '(item)';
        // detect fb either by explicit flag or by label suffix
        const isFb = (it.fb === true) || (typeof label === 'string' && label.includes('(F/B)'));
        const cleanLabel = (isFb) ? label.replace(/\s*\(F\/B\)\s*$/i, '').trim() : label;
        const qty = Number(it.pages || 1);
        const unit = Number(it.unitPrice || 0);
        const subtotal = Number(it.subtotal || (qty * unit));
        const fbBadge = isFb ? ' <span class="badge bg-secondary ms-2">F/B</span>' : '';
        return `<li>${escapeHtml(cleanLabel)}${fbBadge} — ${qty} × GH₵ ${fmt(unit)} = GH₵ ${fmt(subtotal)}</li>`;
      }).join('')}</ul>`
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
