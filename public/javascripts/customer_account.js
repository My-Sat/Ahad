// public/javascripts/customer_account.js
function initCustomerAccountPage() {
  const customerId = window.__CUSTOMER_ID__;
  const balanceEl = document.getElementById('acctBalance');
  const openCustomerOrdersBtn = document.getElementById('openCustomerOrdersBtn');
  if (!openCustomerOrdersBtn) return;
  if (openCustomerOrdersBtn.dataset.customerAccountInit === '1') return;
  openCustomerOrdersBtn.dataset.customerAccountInit = '1';

  const customerOrdersModalEl = document.getElementById('customerOrdersModal');
  const customerOrdersModal = (window.bootstrap && customerOrdersModalEl)
    ? new bootstrap.Modal(customerOrdersModalEl)
    : null;
  const customerOrdersStatus = document.getElementById('customerOrdersStatus');
  const customerOrdersTable = document.getElementById('customerOrdersTable');

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, c => '&#' + c.charCodeAt(0) + ';');
  }

  function formatDateTime(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }

  async function fetchCustomerOrders() {
    if (!customerOrdersTable || !customerOrdersStatus) return;
    const tbody = customerOrdersTable.querySelector('tbody');
    if (!tbody) return;

    customerOrdersStatus.textContent = 'Loading...';
    tbody.innerHTML = `<tr><td class="text-muted" colspan="2">Loading...</td></tr>`;

    try {
      const res = await fetch(`/customers/${encodeURIComponent(customerId)}/orders`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !Array.isArray(j.orders)) {
        throw new Error(j?.error || 'Failed to load orders');
      }

      if (!j.orders.length) {
        customerOrdersStatus.textContent = 'No orders found.';
        tbody.innerHTML = `<tr><td class="text-muted" colspan="2">No orders yet.</td></tr>`;
        return;
      }

      customerOrdersStatus.textContent = `${j.orders.length} order${j.orders.length > 1 ? 's' : ''}`;
      tbody.innerHTML = '';

      j.orders.forEach(o => {
        const oid = String(o.orderId || '').trim();
        if (!oid) return;
        const tr = document.createElement('tr');
        const orderUrl = `/orders/view/${encodeURIComponent(oid)}`;
        tr.innerHTML = `
          <td>
            <a class="text-white text-decoration-underline" href="${orderUrl}">
              ${escapeHtml(oid)}
            </a>
          </td>
          <td>${escapeHtml(formatDateTime(o.createdAt))}</td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('fetchCustomerOrders error', err);
      customerOrdersStatus.textContent = 'Error loading orders.';
      if (customerOrdersTable) {
        const tbody = customerOrdersTable.querySelector('tbody');
        if (tbody) {
          tbody.innerHTML = `<tr><td class="text-danger" colspan="2">Failed to load orders.</td></tr>`;
        }
      }
    }
  }

  async function adjust(type, amount, note) {
    const res = await fetch(`/customers/${encodeURIComponent(customerId)}/account/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ type, amount, note })
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error || 'Request failed');
    return j;
  }

  document.getElementById('creditBtn')?.addEventListener('click', async () => {
    const amt = Number(document.getElementById('creditAmount').value || 0);
    const note = (document.getElementById('creditNote').value || '').trim();
    if (!amt || isNaN(amt) || amt <= 0) return alert('Enter a valid amount');
    try {
      const j = await adjust('credit', amt, note);
      if (balanceEl) balanceEl.textContent = Number(j.balance || 0).toFixed(2);
      location.reload(); // simplest: refresh table + balance
    } catch (e) { alert(e.message); }
  });

  document.getElementById('debitBtn')?.addEventListener('click', async () => {
    const amt = Number(document.getElementById('debitAmount').value || 0);
    const note = (document.getElementById('debitNote').value || '').trim();
    if (!amt || isNaN(amt) || amt <= 0) return alert('Enter a valid amount');
    try {
      const j = await adjust('debit', amt, note);
      if (balanceEl) balanceEl.textContent = Number(j.balance || 0).toFixed(2);
      location.reload();
    } catch (e) { alert(e.message); }
  });

  if (openCustomerOrdersBtn) {
    openCustomerOrdersBtn.addEventListener('click', async () => {
      if (customerOrdersModal) customerOrdersModal.show();
      await fetchCustomerOrders();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initCustomerAccountPage();
  }, { once: true });
} else {
  initCustomerAccountPage();
}

document.addEventListener('ajax:page:loaded', function () {
  initCustomerAccountPage();
});
