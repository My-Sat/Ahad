function initCashBooksPage() {
  'use strict';

  const root = document.getElementById('cashBooksPage');
  if (!root) return;
  if (root.dataset.cashBooksInit === '1') return;
  root.dataset.cashBooksInit = '1';

  const form = document.getElementById('cashBookForm');
  const formCollapseEl = document.getElementById('cashBookFormCollapse');
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
  const transferForm = document.getElementById('cashBookTransferForm');
  const transferFromEl = document.getElementById('transferFromCashBook');
  const transferToEl = document.getElementById('transferToCashBook');
  const transferAmountEl = document.getElementById('cashBookTransferAmount');
  const transferNoteEl = document.getElementById('cashBookTransferNote');
  const transferBtn = document.getElementById('cashBookTransferBtn');
  const transferStatusEl = document.getElementById('cashBookTransferStatus');
  const transferFromBalanceEl = document.getElementById('transferFromBalance');
  const transferToBalanceEl = document.getElementById('transferToBalance');
  const ledgerModalEl = document.getElementById('cashBookLedgerModal');
  const ledgerModal = (window.bootstrap && ledgerModalEl) ? bootstrap.Modal.getOrCreateInstance(ledgerModalEl) : null;
  const ledgerTitle = document.getElementById('cashBookLedgerTitle');
  const ledgerMeta = document.getElementById('cashBookLedgerMeta');
  const ledgerTbody = document.getElementById('cashBookLedgerTbody');
  const ledgerPrevBtn = document.getElementById('cashBookLedgerPrevBtn');
  const ledgerNextBtn = document.getElementById('cashBookLedgerNextBtn');
  let ledgerCashBookId = '';
  let ledgerPage = 1;
  let cashBooksState = [];
  const ledgerLimit = 100;

  if (form) form.dataset.disableSpinner = 'true';
  if (transferForm) transferForm.dataset.disableSpinner = 'true';

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

  function setTransferStatus(msg, isError) {
    if (!transferStatusEl) return;
    transferStatusEl.textContent = msg || '';
    transferStatusEl.classList.toggle('text-danger', !!isError);
    transferStatusEl.classList.toggle('text-success', !!msg && !isError);
  }

  function showTransferConfirmModal(amount, fromBook, toBook) {
    return new Promise(resolve => {
      if (!window.bootstrap || !window.bootstrap.Modal) {
        setTransferStatus('The confirmation dialog is unavailable. Reload the page and try again.', true);
        resolve(false);
        return;
      }

      let modalEl = document.getElementById('cashBookTransferConfirmModal');
      if (!modalEl) {
        const container = document.createElement('div');
        container.innerHTML = `
          <div class="modal fade" id="cashBookTransferConfirmModal" tabindex="-1" aria-labelledby="cashBookTransferConfirmTitle" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content dark-surface">
                <div class="modal-header border-secondary">
                  <div>
                    <h5 class="modal-title text-white" id="cashBookTransferConfirmTitle">Confirm Cash Transfer</h5>
                    <p class="small text-muted-light mb-0">Review the movement before it is recorded.</p>
                  </div>
                  <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body dark-card-body">
                  <div class="text-center mb-3">
                    <div class="small text-muted-light text-uppercase">Amount to transfer</div>
                    <div class="h4 text-white mb-0" data-transfer-confirm-amount></div>
                  </div>
                  <div class="rounded-3 p-3 border border-secondary-subtle">
                    <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
                      <span class="text-muted-light">From</span>
                      <strong class="text-white text-end" data-transfer-confirm-from></strong>
                    </div>
                    <div class="d-flex justify-content-center text-info mb-3" aria-hidden="true">
                      <i class="bi bi-arrow-down-circle fs-4"></i>
                    </div>
                    <div class="d-flex justify-content-between align-items-start gap-3">
                      <span class="text-muted-light">To</span>
                      <strong class="text-white text-end" data-transfer-confirm-to></strong>
                    </div>
                  </div>
                  <p class="small text-muted-light mt-3 mb-0">The source book will be credited and the destination book will be debited.</p>
                </div>
                <div class="modal-footer border-secondary">
                  <button type="button" class="btn btn-outline-light-custom" data-transfer-confirm-cancel>Cancel</button>
                  <button type="button" class="btn btn-primary" data-transfer-confirm-submit>
                    <i class="bi bi-arrow-left-right me-1"></i>
                    Transfer Funds
                  </button>
                </div>
              </div>
            </div>
          </div>`;
        modalEl = container.firstElementChild;
        document.body.appendChild(modalEl);
      }

      const amountEl = modalEl.querySelector('[data-transfer-confirm-amount]');
      const fromEl = modalEl.querySelector('[data-transfer-confirm-from]');
      const toEl = modalEl.querySelector('[data-transfer-confirm-to]');
      const confirmBtn = modalEl.querySelector('[data-transfer-confirm-submit]');
      const cancelBtn = modalEl.querySelector('[data-transfer-confirm-cancel]');
      if (amountEl) amountEl.textContent = fmtMoney(amount);
      if (fromEl) fromEl.textContent = `${fromBook.name} (${fmtMoney(fromBook.balance)})`;
      if (toEl) toEl.textContent = `${toBook.name} (${fmtMoney(toBook.balance)})`;

      const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
      let settled = false;

      function cleanup() {
        if (confirmBtn) confirmBtn.removeEventListener('click', onConfirm);
        if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
      }

      function finish(value, hide) {
        if (settled) return;
        settled = true;
        cleanup();
        if (hide) modal.hide();
        resolve(value);
      }

      function onConfirm() { finish(true, true); }
      function onCancel() { finish(false, true); }
      function onHidden() { finish(false, false); }

      if (confirmBtn) confirmBtn.addEventListener('click', onConfirm);
      if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
      modalEl.addEventListener('hidden.bs.modal', onHidden);
      modal.show();
    });
  }

  function activeCashBooks() {
    return cashBooksState.filter(book => book && book.active !== false);
  }

  function cashBookById(id) {
    const wanted = String(id || '');
    return cashBooksState.find(book => String(book && book._id || '') === wanted) || null;
  }

  function transferOption(book) {
    return `<option value="${escapeHtml(book._id)}">${escapeHtml(book.name)} (${escapeHtml(kindLabel(book.kind))}) - ${escapeHtml(fmtMoney(book.balance))}</option>`;
  }

  function updateTransferBalances() {
    const fromBook = cashBookById(transferFromEl ? transferFromEl.value : '');
    const toBook = cashBookById(transferToEl ? transferToEl.value : '');
    if (transferFromBalanceEl) {
      transferFromBalanceEl.textContent = fromBook
        ? `Available balance: ${fmtMoney(fromBook.balance)}`
        : 'Available balance: -';
    }
    if (transferToBalanceEl) {
      transferToBalanceEl.textContent = toBook
        ? `Current balance: ${fmtMoney(toBook.balance)}`
        : 'Current balance: -';
    }
  }

  function populateTransferDestination(preferredValue) {
    if (!transferToEl) return;
    const sourceId = transferFromEl ? String(transferFromEl.value || '') : '';
    const previous = String(preferredValue !== undefined ? preferredValue : transferToEl.value || '');
    const available = activeCashBooks().filter(book => String(book._id) !== sourceId);
    transferToEl.innerHTML = '<option value="">Select destination cash book</option>'
      + available.map(transferOption).join('');
    if (previous && available.some(book => String(book._id) === previous)) {
      transferToEl.value = previous;
    }
    updateTransferBalances();
  }

  function populateTransferBooks() {
    if (!transferFromEl || !transferToEl) return;
    const previousFrom = String(transferFromEl.value || '');
    const previousTo = String(transferToEl.value || '');
    const available = activeCashBooks();

    transferFromEl.innerHTML = '<option value="">Select source cash book</option>'
      + available.map(transferOption).join('');
    if (previousFrom && available.some(book => String(book._id) === previousFrom)) {
      transferFromEl.value = previousFrom;
    }
    populateTransferDestination(previousTo);

    if (transferBtn && transferBtn.dataset.busy !== '1') {
      transferBtn.disabled = available.length < 2;
    }
    if (available.length < 2) {
      setTransferStatus('At least two active cash books are required for a transfer.', true);
    } else if (transferStatusEl && /At least two active/.test(transferStatusEl.textContent || '')) {
      setTransferStatus('');
    }
  }

  function showCashBookForm() {
    if (!formCollapseEl || !window.bootstrap || !window.bootstrap.Collapse) return;
    try {
      const inst = window.bootstrap.Collapse.getInstance(formCollapseEl)
        || new window.bootstrap.Collapse(formCollapseEl, { toggle: false });
      inst.show();
    } catch (e) {}
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
      cashBooksState = Array.isArray(j.cashBooks) ? j.cashBooks : [];
      renderRows(cashBooksState);
      populateTransferBooks();
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

  if (transferFromEl) {
    transferFromEl.addEventListener('change', () => {
      const previousTo = transferToEl ? transferToEl.value : '';
      populateTransferDestination(previousTo);
    });
  }
  if (transferToEl) transferToEl.addEventListener('change', updateTransferBalances);

  if (transferForm) {
    transferForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fromCashBookId = transferFromEl ? String(transferFromEl.value || '').trim() : '';
      const toCashBookId = transferToEl ? String(transferToEl.value || '').trim() : '';
      const amount = Number(transferAmountEl ? transferAmountEl.value || 0 : 0);
      const note = transferNoteEl ? String(transferNoteEl.value || '').trim() : '';
      const fromBook = cashBookById(fromCashBookId);
      const toBook = cashBookById(toCashBookId);

      if (!fromBook || !toBook) {
        setTransferStatus('Select both source and destination cash books.', true);
        return;
      }
      if (fromCashBookId === toCashBookId) {
        setTransferStatus('Source and destination cash books must be different.', true);
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setTransferStatus('Enter a transfer amount greater than zero.', true);
        return;
      }
      if (amount > Number(fromBook.balance || 0)) {
        setTransferStatus(`Insufficient balance in ${fromBook.name}. Available: ${fmtMoney(fromBook.balance)}.`, true);
        return;
      }

      const confirmed = await showTransferConfirmModal(amount, fromBook, toBook);
      if (!confirmed) return;

      if (transferBtn) {
        transferBtn.dataset.busy = '1';
        transferBtn.disabled = true;
        transferBtn.textContent = 'Transferring...';
      }
      setTransferStatus('');

      try {
        const res = await fetch('/admin/cash-books/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'same-origin',
          body: JSON.stringify({ fromCashBookId, toCashBookId, amount, note })
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) throw new Error(j?.error || 'Transfer failed');

        if (transferAmountEl) transferAmountEl.value = '';
        if (transferNoteEl) transferNoteEl.value = '';
        setTransferStatus(`Transfer completed. Reference: ${j.transfer?.reference || '-'}`, false);
        await loadCashBooks();
      } catch (err) {
        setTransferStatus(err.message || 'Transfer failed', true);
      } finally {
        if (transferBtn) {
          delete transferBtn.dataset.busy;
          transferBtn.textContent = 'Transfer Funds';
          transferBtn.disabled = activeCashBooks().length < 2;
        }
      }
    });
  }

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
      showCashBookForm();
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

