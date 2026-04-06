// public/javascripts/customers_index.js
function initCustomersIndex() {
  'use strict';

  const pageRoot = document.getElementById('customersPageRoot');
  if (!pageRoot) return;
  if (pageRoot.dataset.customersIndexInit === '1') return;
  pageRoot.dataset.customersIndexInit = '1';

  const tableBody = document.querySelector('#customersTable tbody');
  const countEl = document.getElementById('customersCount');
  const totalCountEl = document.getElementById('customersTotalCount');
  const activeCountEl = document.getElementById('customersActiveCount');
  const searchInput = document.getElementById('customersSearchInput');
  const searchClearBtn = document.getElementById('customersSearchClearBtn');
  const pageSizeSelect = document.getElementById('customersPageSize');
  const nextBtn = document.getElementById('customersNextBtn');

  if (!tableBody) return;

  let searchTimer = null;
  const SEARCH_DEBOUNCE = 220;
  let currentPage = 1;
  let hasMore = false;

  function getPageSize() {
    const n = Number(pageSizeSelect ? pageSizeSelect.value : 50);
    return (n === 100) ? 100 : 50;
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

  async function fetchStats() {
    try {
      const res = await fetch('/customers/api/stats', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) throw new Error('Invalid response');

      if (totalCountEl) totalCountEl.textContent = String(Number(j.totalCustomers || 0));
      if (activeCountEl) activeCountEl.textContent = String(Number(j.activeCustomers || 0));
    } catch (err) {
      console.error('fetchStats error', err);
      if (totalCountEl) totalCountEl.textContent = '-';
      if (activeCountEl) activeCountEl.textContent = '-';
    }
  }

  function updatePagerUi() {
    if (!nextBtn) return;
    nextBtn.disabled = !hasMore;
  }

  async function fetchCustomers(q) {
    const query = (q || '').toString().trim();
    const pageSize = getPageSize();
    tableBody.innerHTML = '<tr><td colspan="5" class="text-muted">Loading...</td></tr>';
    if (countEl) countEl.textContent = 'Loading...';
    if (nextBtn) nextBtn.disabled = true;

    try {
      const url =
        `/customers/api/list?limit=${encodeURIComponent(pageSize)}&page=${encodeURIComponent(currentPage)}`
        + (query ? `&q=${encodeURIComponent(query)}` : '');

      const res = await fetch(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok || !Array.isArray(j.customers)) {
        throw new Error('Invalid response');
      }
      hasMore = !!j.hasMore;
      updatePagerUi();

      if (!j.customers.length) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-muted">No customers found.</td></tr>';
        if (countEl) countEl.textContent = query ? 'Matches: 0' : '0 customers';
        return;
      }

      tableBody.innerHTML = '';
      j.customers.forEach(c => {
        const name =
          (c.category === 'artist' || c.category === 'organisation')
            ? (c.businessName || '-')
            : (c.firstName || '-');
        const accountUrl = `/customers/${encodeURIComponent(c._id)}/account`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <a class="text-white text-decoration-underline"
               href="${accountUrl}"
               data-ajax="true"
               title="Open customer account">
              ${escapeHtml(name)}
            </a>
          </td>
          <td>${escapeHtml(c.phone || '')}</td>
          <td><span class="badge bg-secondary">${escapeHtml(c.category || '')}</span></td>
          <td>${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-'}</td>
          <td class="text-center">
            <button type="button" class="btn btn-sm btn-primary me-1 edit-customer-btn">Edit</button>
            <button type="button" class="btn btn-sm btn-outline-danger delete-customer-btn">Delete</button>
          </td>
        `;

        const editBtn = tr.querySelector('.edit-customer-btn');
        if (editBtn) {
          editBtn.addEventListener('click', () => {
            if (typeof window.openEditCustomerModal === 'function') {
              window.openEditCustomerModal(c);
            }
          });
        }

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
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin'
              });
              const j = await res.json().catch(() => null);
              if (!res.ok) {
                alert((j && j.error) ? j.error : 'Delete failed');
                return;
              }
              await fetchCustomers(searchInput ? searchInput.value : '');
              await fetchStats();
            } catch (err) {
              console.error('delete customer error', err);
              alert('Network error while deleting customer');
            } finally {
              deleteBtn.disabled = false;
              deleteBtn.textContent = 'Delete';
            }
          });
        }

        tableBody.appendChild(tr);
      });

      if (countEl) {
        const start = ((currentPage - 1) * pageSize) + 1;
        const end = start + j.customers.length - 1;
        const prefix = query ? `Matches ${start}-${end}` : `Showing ${start}-${end}`;
        countEl.textContent = `${prefix} (${j.customers.length} customers on this page)`;
      }
    } catch (err) {
      console.error('fetchCustomers error', err);
      tableBody.innerHTML = '<tr><td colspan="5" class="text-danger">Failed to load customers</td></tr>';
      if (countEl) countEl.textContent = 'Error';
      hasMore = false;
      updatePagerUi();
    }
  }

  function scheduleSearch() {
    if (!searchInput) return;
    const q = searchInput.value || '';
    currentPage = 1;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      fetchCustomers(q);
    }, SEARCH_DEBOUNCE);
  }

  if (searchInput) {
    searchInput.addEventListener('input', scheduleSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        currentPage = 1;
        fetchCustomers('');
      }
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      currentPage = 1;
      fetchCustomers('');
      try { searchInput && searchInput.focus(); } catch (e) {}
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      currentPage = 1;
      fetchCustomers(searchInput ? searchInput.value : '');
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (!hasMore) return;
      currentPage += 1;
      fetchCustomers(searchInput ? searchInput.value : '');
    });
  }

  window.__refreshCustomersIndex = async function () {
    if (!document.getElementById('customersPageRoot')) return;
    if (currentPage <= 0) currentPage = 1;
    await fetchCustomers(searchInput ? searchInput.value : '');
    await fetchStats();
  };

  if (!document.__customersIndexUpdatedBound) {
    document.__customersIndexUpdatedBound = '1';
    document.addEventListener('customer:updated', async function () {
      if (typeof window.__refreshCustomersIndex === 'function') {
        await window.__refreshCustomersIndex();
      }
    });
  }

  fetchStats();
  fetchCustomers('');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCustomersIndex, { once: true });
} else {
  initCustomersIndex();
}

document.addEventListener('ajax:page:loaded', function () {
  initCustomersIndex();
});
