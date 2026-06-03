function initCashBooksPage() {
  'use strict';

  const root = document.getElementById('cashBooksPage');
  if (!root) return;
  if (root.dataset.cashBooksInit === '1') return;
  root.dataset.cashBooksInit = '1';

  const form = document.getElementById('cashBookForm');
  const idEl = document.getElementById('cashBookId');
  const nameEl = document.getElementById('cashBookName');
  const kindEl = document.getElementById('cashBookKind');
  const openingEl = document.getElementById('cashBookOpeningBalance');
  const openingWrap = document.getElementById('openingBalanceWrap');
  const activeEl = document.getElementById('cashBookActive');
  const saveBtn = document.getElementById('saveCashBookBtn');
  const resetBtn = document.getElementById('resetCashBookBtn');
  const reloadBtn = document.getElementById('reloadCashBooksBtn');
  const statusEl = document.getElementById('cashBookStatus');
  const titleEl = document.getElementById('cashBookFormTitle');
  const table = document.getElementById('cashBooksTable');
  const ledgerModalEl = document.getElementById('cashBookLedgerModal');
  const ledgerModal = (window.bootstrap && ledgerModalEl) ? bootstrap.Modal.getOrCreateInstance(ledgerModalEl) : null;
  const ledgerTitle = document.getElementById('cashBookLedgerTitle');
  const ledgerMeta = document.getElementById('cashBookLedgerMeta');
  const ledgerTbody = document.getElementById('cashBookLedgerTbody');
  const ledgerPrevBtn = document.getElementById('cashBookLedgerPrevBtn');
  const ledgerNextBtn = document.getElementById('cashBookLedgerNextBtn');
  let ledgerCashBookId = '';
  let ledgerPage = 1;
  const ledgerLimit = 100;

  if (form) form.dataset.disableSpinner = 'true';

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"'`=\/]/g, c => '&#' + c.charCodeAt(0) + ';');
  }

  function fmtMoney(n) {
    return `GH\u20B5 ${Number(n || 0).toFixed(2)}`;
  }

  function kindLabel(kind) {
    const k = String(kind || '').toLowerCase();
    if (k === 'bank') return 'Bank';
    if (k === 'momo') return 'MoMo';
    return 'Normal';
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('text-danger', !!isError);
    statusEl.classList.toggle('text-success', !!msg && !isError);
  }

  function restoreSaveButton(label) {
    if (!saveBtn) return;
    try {
      if (window.__FormSpinner && typeof window.__FormSpinner.hide === 'function') {
        window.__FormSpinner.hide(saveBtn);
      }
    } catch (e) {}
    saveBtn.disabled = false;
    saveBtn.classList.remove('loading');
    saveBtn.removeAttribute('data-spinner-active');
    saveBtn.removeAttribute('data-last-clicked');
    saveBtn.textContent = label || 'Create';
  }

  function resetForm() {
    if (idEl) idEl.value = '';
    if (nameEl) nameEl.value = '';
    if (kindEl) kindEl.value = 'cash';
    if (openingEl) openingEl.value = '0';
    if (activeEl) activeEl.checked = true;
    if (titleEl) titleEl.textContent = 'New Cash Book';
    restoreSaveButton('Create');
    if (openingWrap) openingWrap.style.display = '';
    setStatus('');
  }

  function renderRows(rows) {
    const tbody = table ? table.querySelector('tbody') : null;
    if (!tbody) return;

    if (!Array.isArray(rows) || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="5">No cash books yet.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(book => {
      const active = book.active !== false;
      return `
        <tr data-cash-book-id="${escapeHtml(book._id)}" data-name="${escapeHtml(book.name)}" data-kind="${escapeHtml(book.kind || 'cash')}" data-active="${active ? '1' : '0'}">
          <td class="fw-semibold text-white">${escapeHtml(book.name)}</td>
          <td>${escapeHtml(kindLabel(book.kind))}</td>
          <td class="text-end">${escapeHtml(fmtMoney(book.balance))}</td>
          <td>${active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">Inactive</span>'}</td>
          <td class="text-end">
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-info ledger-cash-book" type="button">Ledger</button>
              <button class="btn btn-outline-light-custom edit-cash-book" type="button">Edit</button>
              <button class="btn ${active ? 'btn-outline-warning' : 'btn-outline-success'} toggle-cash-book" type="button" data-action="${active ? 'archive' : 'restore'}">
                ${active ? 'Archive' : 'Restore'}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
  }

  function renderLedger(data) {
    const rows = Array.isArray(data && data.entries) ? data.entries : [];
    const cashBook = data && data.cashBook ? data.cashBook : null;
    const totals = data && data.totals ? data.totals : {};

    if (ledgerTitle) ledgerTitle.textContent = cashBook ? `${cashBook.name} Ledger` : 'Cash Book Ledger';
    if (ledgerMeta) {
      const from = Number(data && data.from ? data.from : 0);
      const to = Number(data && data.to ? data.to : 0);
      const count = Number(data && data.count ? data.count : 0);
      const range = rows.length ? `Showing ${from}-${to} of ${count}` : 'Showing 0 records';
      ledgerMeta.textContent = `${range} | Debits: ${fmtMoney(totals.debit || 0)} | Credits: ${fmtMoney(totals.credit || 0)} | Balance: ${fmtMoney(totals.currentBalance || 0)}`;
    }
    if (ledgerPrevBtn) ledgerPrevBtn.disabled = !(data && data.hasPrev);
    if (ledgerNextBtn) ledgerNextBtn.disabled = !(data && data.hasMore);

    if (!ledgerTbody) return;
    if (!rows.length) {
      ledgerTbody.innerHTML = '<tr><td class="text-muted" colspan="7">No transactions yet.</td></tr>';
      return;
    }

    ledgerTbody.innerHTML = rows.map(entry => {
      const source = [entry.sourceType, entry.sourceRef].filter(Boolean).join(' / ') || '-';
      const debit = Number(entry.debit || 0);
      const credit = Number(entry.credit || 0);
      return `
        <tr>
          <td class="text-muted-light text-nowrap">${escapeHtml(formatDateTime(entry.createdAt))}</td>
          <td class="text-white">${escapeHtml(entry.entry || '-')}</td>
          <td class="text-muted-light">${escapeHtml(source)}</td>
          <td class="text-end text-success">${debit > 0 ? escapeHtml(fmtMoney(debit)) : '-'}</td>
          <td class="text-end text-danger">${credit > 0 ? escapeHtml(fmtMoney(credit)) : '-'}</td>
          <td class="text-end text-white">${escapeHtml(fmtMoney(entry.runningBalance || 0))}</td>
          <td class="text-muted-light">${escapeHtml(entry.recordedByName || '')}</td>
        </tr>
      `;
    }).join('');
  }

  async function loadLedger(page) {
    if (!ledgerCashBookId) return;
    ledgerPage = Math.max(1, Math.floor(Number(page || ledgerPage || 1)));
    if (ledgerTbody) ledgerTbody.innerHTML = '<tr><td class="text-muted" colspan="7">Loading...</td></tr>';
    if (ledgerMeta) ledgerMeta.textContent = 'Loading cash book ledger...';
    if (ledgerPrevBtn) ledgerPrevBtn.disabled = true;
    if (ledgerNextBtn) ledgerNextBtn.disabled = true;

    try {
      const res = await fetch(`/admin/cash-books/${encodeURIComponent(ledgerCashBookId)}/ledger?page=${encodeURIComponent(ledgerPage)}&limit=${ledgerLimit}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) throw new Error(j?.error || 'Failed to load ledger');
      ledgerPage = Number(j.page || ledgerPage);
      renderLedger(j);
    } catch (err) {
      if (ledgerMeta) ledgerMeta.textContent = err.message || 'Failed to load ledger';
      if (ledgerTbody) ledgerTbody.innerHTML = '<tr><td class="text-danger" colspan="7">Failed to load cash book ledger.</td></tr>';
    }
  }

  async function loadCashBooks() {
    if (reloadBtn) reloadBtn.disabled = true;
    try {
      const res = await fetch('/admin/cash-books/api?all=1', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) throw new Error(j?.error || 'Failed to load cash books');
      renderRows(j.cashBooks || []);
    } catch (err) {
      setStatus(err.message || 'Failed to load cash books', true);
    } finally {
      if (reloadBtn) reloadBtn.disabled = false;
    }
  }

  if (form) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const id = idEl ? String(idEl.value || '').trim() : '';
      const payload = {
        name: nameEl ? String(nameEl.value || '').trim() : '',
        kind: kindEl ? String(kindEl.value || 'cash') : 'cash',
        active: activeEl ? !!activeEl.checked : true
      };

      if (!id) {
        payload.openingBalance = Number(openingEl ? openingEl.value || 0 : 0);
      }

      if (!payload.name) {
        setStatus('Cash book name is required', true);
        return;
      }

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = id ? 'Saving...' : 'Creating...';
      }
      setStatus('');

      try {
        const res = await fetch(id ? `/admin/cash-books/${encodeURIComponent(id)}` : '/admin/cash-books', {
          method: id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) throw new Error(j?.error || 'Save failed');
        restoreSaveButton('Create');
        resetForm();
        setStatus('Cash book saved', false);
        loadCashBooks();
      } catch (err) {
        setStatus(err.message || 'Save failed', true);
      } finally {
        restoreSaveButton(idEl && idEl.value ? 'Save' : 'Create');
      }
    });
  }

  if (resetBtn) resetBtn.addEventListener('click', resetForm);
  if (reloadBtn) reloadBtn.addEventListener('click', loadCashBooks);

  if (table) {
    table.addEventListener('click', async (ev) => {
      const ledgerBtn = ev.target.closest('.ledger-cash-book');
      const btn = ev.target.closest('.edit-cash-book');
      const toggleBtn = ev.target.closest('.toggle-cash-book');
      if (!ledgerBtn && !btn && !toggleBtn) return;
      if (ledgerBtn) {
        const ledgerRow = ledgerBtn.closest('tr');
        ledgerCashBookId = ledgerRow ? String(ledgerRow.dataset.cashBookId || '').trim() : '';
        ledgerPage = 1;
        if (ledgerModal) ledgerModal.show();
        await loadLedger(1);
        return;
      }

      const row = btn ? btn.closest('tr') : null;
      const toggleRow = toggleBtn ? toggleBtn.closest('tr') : null;

      if (toggleBtn) {
        const targetRow = toggleRow;
        if (!targetRow) return;
        const id = targetRow.dataset.cashBookId || '';
        const action = String(toggleBtn.dataset.action || '').toLowerCase() === 'restore' ? 'restore' : 'archive';
        const name = targetRow.dataset.name || 'this cash book';
        const ok = window.confirm(action === 'archive'
          ? `Archive ${name}? It will stop showing in payment selections, but existing records will remain intact.`
          : `Restore ${name}? It will become available in payment selections again.`);
        if (!ok) return;

        const originalText = toggleBtn.textContent;
        toggleBtn.disabled = true;
        toggleBtn.textContent = action === 'archive' ? 'Archiving...' : 'Restoring...';
        setStatus('');

        try {
          const res = await fetch(`/admin/cash-books/${encodeURIComponent(id)}/${action}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin'
          });
          const j = await res.json().catch(() => null);
          if (!res.ok || !j || !j.ok) throw new Error(j?.error || `${action} failed`);
          resetForm();
          setStatus(action === 'archive' ? 'Cash book archived' : 'Cash book restored', false);
          await loadCashBooks();
        } catch (err) {
          setStatus(err.message || `${action} failed`, true);
          toggleBtn.disabled = false;
          toggleBtn.textContent = originalText;
        }
        return;
      }

      if (!row) return;
      if (idEl) idEl.value = row.dataset.cashBookId || '';
      if (nameEl) nameEl.value = row.dataset.name || '';
      if (kindEl) kindEl.value = row.dataset.kind || 'cash';
      if (activeEl) activeEl.checked = row.dataset.active !== '0';
      if (openingWrap) openingWrap.style.display = 'none';
      if (titleEl) titleEl.textContent = 'Edit Cash Book';
      restoreSaveButton('Save');
      setStatus('');
      try { nameEl && nameEl.focus(); } catch (e) {}
    });
  }

  if (ledgerPrevBtn) {
    ledgerPrevBtn.addEventListener('click', () => loadLedger(Math.max(1, ledgerPage - 1)));
  }
  if (ledgerNextBtn) {
    ledgerNextBtn.addEventListener('click', () => loadLedger(ledgerPage + 1));
  }

  loadCashBooks();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCashBooksPage, { once: true });
} else {
  initCashBooksPage();
}

document.addEventListener('ajax:page:loaded', initCashBooksPage);

