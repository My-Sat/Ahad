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

  function renderOrderDetails(order) {
    if (!order) {
      orderInfo.innerHTML = '<p class="text-muted">No order loaded.</p>';
      payNowBtn.disabled = true;
      return;
    }
    currentOrderId = order.orderId;
    currentOrderTotal = order.total;

    const rows = order.items.map(it => `<li>${it.selectionLabel} — ${it.pages} × GH₵ ${Number(it.unitPrice).toFixed(2)} = GH₵ ${Number(it.subtotal).toFixed(2)}</li>`).join('');
    orderInfo.innerHTML = `
      <p><strong>Order ID:</strong> ${order.orderId}</p>
      <p><strong>Status:</strong> ${order.status}</p>
      <ul>${rows}</ul>
      <p class="text-end"><strong>Total: GH₵ ${Number(order.total).toFixed(2)}</strong></p>
    `;
    payNowBtn.disabled = order.status === 'paid';
  }

  fetchForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const id = fetchOrderIdInput.value && fetchOrderIdInput.value.trim();
    if (!id) return alert('Enter an order id');
    fetchOrderBtn.disabled = true;
    fetchOrderBtn.textContent = 'Fetching...';
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      const j = await res.json();
      if (!res.ok) {
        alert(j.error || 'Order fetch failed');
        renderOrderDetails(null);
        return;
      }
      renderOrderDetails(j.order);
    } catch (err) {
      console.error('fetch order err', err);
      alert('Failed to fetch order');
    } finally {
      fetchOrderBtn.disabled = false;
      fetchOrderBtn.textContent = 'Fetch';
    }
  });

  payNowBtn.addEventListener('click', async function () {
    if (!currentOrderId) return;
    payNowBtn.disabled = true;
    payNowBtn.textContent = 'Processing...';
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(currentOrderId)}/pay`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const j = await res.json();
      if (!res.ok) {
        alert(j.error || 'Pay failed');
        return;
      }
      showGlobalToast && showGlobalToast('Payment recorded', 2000);
      renderOrderDetails({ ...j.order, orderId: currentOrderId, total: currentOrderTotal, status: 'paid', items: [] });
      // after success you may disable the input
      fetchOrderIdInput.value = '';
      payNowBtn.disabled = true;
      alert('Payment successful — order marked as paid.');
    } catch (err) {
      console.error('pay err', err);
      alert('Payment failed');
    } finally {
      payNowBtn.disabled = false;
      payNowBtn.textContent = 'Pay Now';
    }
  });

});
