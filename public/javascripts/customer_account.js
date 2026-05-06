// public/javascripts/customer_account.js
function initCustomerAccountPage() {
  const customerId = window.__CUSTOMER_ID__;
  if (!customerId) return;

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
  const txnBody = document.getElementById('txnBody');
  const accountBalanceTypeEl = document.getElementById('accountBalanceType');
  const accountBalanceValueEl = document.getElementById('accountBalanceValue');
  const creditCashBook = document.getElementById('creditCashBook');
  const creditCashDirection = document.getElementById('creditCashDirection');
  const creditMomoFields = document.getElementById('creditMomoFields');
  const creditBankFields = document.getElementById('creditBankFields');
  const creditMomoNumber = document.getElementById('creditMomoNumber');
  const creditMomoTxId = document.getElementById('creditMomoTxId');
  const creditChequeNumber = document.getElementById('creditChequeNumber');
  const creditDepositDetails = document.getElementById('creditDepositDetails');
  const debitCashBook = document.getElementById('debitCashBook');
  const debitCashDirection = document.getElementById('debitCashDirection');
  const debitMomoFields = document.getElementById('debitMomoFields');
  const debitBankFields = document.getElementById('debitBankFields');
  const debitMomoNumber = document.getElementById('debitMomoNumber');
  const debitMomoTxId = document.getElementById('debitMomoTxId');
  const debitChequeNumber = document.getElementById('debitChequeNumber');
  const debitDepositDetails = document.getElementById('debitDepositDetails');
  let activeCashBooks = [];

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

  function fmtMoney(n) {
    return `GH₵ ${Number(n || 0).toFixed(2)}`;
  }

  function cashBookKindFromSelect(selectEl) {
    if (!selectEl) return 'cash';
    const opt = selectEl.options && selectEl.selectedIndex >= 0 ? selectEl.options[selectEl.selectedIndex] : null;
    return String((opt && opt.dataset && opt.dataset.kind) || selectEl.value || 'cash').toLowerCase();
  }

  function selectedCashBookId(selectEl) {
    if (!selectEl) return '';
    return String(selectEl.value || '').trim();
  }

  function updateCreditCashBookFields() {
    const direction = creditCashDirection ? String(creditCashDirection.value || 'inflow') : 'inflow';
    const kind = cashBookKindFromSelect(creditCashBook);
    const show = direction !== 'none';
    if (creditMomoFields) creditMomoFields.style.display = show && kind === 'momo' ? '' : 'none';
    if (creditBankFields) creditBankFields.style.display = show && kind === 'bank' ? '' : 'none';
  }

  function updateDebitCashBookFields() {
    const direction = debitCashDirection ? String(debitCashDirection.value || 'none') : 'none';
    const kind = cashBookKindFromSelect(debitCashBook);
    const show = direction !== 'none';
    if (debitMomoFields) debitMomoFields.style.display = show && kind === 'momo' ? '' : 'none';
    if (debitBankFields) debitBankFields.style.display = show && kind === 'bank' ? '' : 'none';
  }

  function populateOneCashBookSelect(selectEl) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';

    if (!activeCashBooks.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No active cash books configured';
      opt.dataset.kind = 'cash';
      selectEl.appendChild(opt);
      selectEl.disabled = true;
      return;
    }

    activeCashBooks.forEach(book => {
      const opt = document.createElement('option');
      opt.value = book._id;
      opt.dataset.kind = String(book.kind || 'cash').toLowerCase();
      opt.textContent = `${book.name} (${book.kind === 'momo' ? 'MoMo' : (book.kind === 'bank' ? 'Bank' : 'Cash')})`;
      selectEl.appendChild(opt);
    });

    selectEl.disabled = false;
    if (current && activeCashBooks.some(b => String(b._id) === String(current))) selectEl.value = current;
  }

  function populateCashBookSelects() {
    populateOneCashBookSelect(creditCashBook);
    populateOneCashBookSelect(debitCashBook);
    updateCreditCashBookFields();
    updateDebitCashBookFields();
  }

  async function loadCashBooks() {
    try {
      const res = await fetch('/admin/cash-books/api', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) throw new Error(j?.error || 'Failed to load cash books');
      activeCashBooks = Array.isArray(j.cashBooks) ? j.cashBooks : [];
    } catch (err) {
      console.error('load cash books error', err);
      activeCashBooks = [];
    }
    populateCashBookSelects();
  }

  function setBalanceSummary(net) {
    if (!accountBalanceTypeEl || !accountBalanceValueEl) return;

    const n = Number(net || 0);
    if (n > 0) {
      accountBalanceTypeEl.textContent = 'Credit Balance';
      accountBalanceValueEl.textContent = fmtMoney(n);
      accountBalanceTypeEl.className = 'ms-2 fw-semibold text-success';
    } else if (n < 0) {
      accountBalanceTypeEl.textContent = 'Debit Balance';
      accountBalanceValueEl.textContent = fmtMoney(Math.abs(n));
      accountBalanceTypeEl.className = 'ms-2 fw-semibold text-danger';
    } else {
      accountBalanceTypeEl.textContent = 'Settled';
      accountBalanceValueEl.textContent = fmtMoney(0);
      accountBalanceTypeEl.className = 'ms-2 fw-semibold text-muted-light';
    }
  }

  function renderLedger(rows, explicitSettledOrderIds) {
    if (!txnBody) return;

    if (!Array.isArray(rows) || !rows.length) {
      txnBody.innerHTML = '<tr><td class="text-muted" colspan="7">No transactions yet.</td></tr>';
      setBalanceSummary(0);
      return;
    }

    const ordered = rows
      .slice()
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (ta !== tb) return ta - tb;
        return String(a._id || '').localeCompare(String(b._id || ''));
      });

    const accountSettledOrderIds = new Set(Array.isArray(explicitSettledOrderIds) ? explicitSettledOrderIds : []);
    ordered.forEach(t => {
      const note = String(t && t.note ? t.note : '');
      let m = note.match(/^Paid from account\s+([A-Za-z0-9_-]+)/i);
      if (!m) m = note.match(/^Auto payment from account for order\s+([A-Za-z0-9_-]+)/i);
      if (m && m[1]) accountSettledOrderIds.add(String(m[1]));
    });

    let totalCredits = 0;
    let totalDebits = 0;

    txnBody.innerHTML = '';
    ordered.forEach(t => {
      const type = String(t.type || '').toLowerCase();
      const amount = Number(t.amount || 0);
      const credit = type === 'credit' ? amount : 0;
      const debit = type === 'debit' ? amount : 0;

      totalCredits = Number((totalCredits + credit).toFixed(2));
      totalDebits = Number((totalDebits + debit).toFixed(2));

      const runningNet = Number((totalCredits - totalDebits).toFixed(2));
      const runningType = runningNet >= 0 ? 'Credit' : 'Debit';
      const runningAbs = Math.abs(runningNet);

      let entryNote = String(t.note || type.toUpperCase());
      const orderPlacedMatch = entryNote.match(/^Order placed\s+([A-Za-z0-9_-]+)/i);
      if (orderPlacedMatch && orderPlacedMatch[1]) {
        const oid = String(orderPlacedMatch[1]);
        const alreadyTagged = /\(A\/C\)/i.test(entryNote);
        if (!alreadyTagged && accountSettledOrderIds.has(oid)) {
          entryNote = `${entryNote} (A/C)`;
        }
      }
      const cashBookName = String(t.cashBookName || '').trim();
      const cashDirection = String(t.cashDirection || '').toLowerCase();
      const cashBookLabel = cashBookName
        ? ` (${cashBookName}${cashDirection ? ` ${cashDirection}` : ''})`
        : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-nowrap" style="min-width:170px;">${escapeHtml(formatDateTime(t.createdAt))}</td>
        <td style="min-width:260px;">${escapeHtml(entryNote + cashBookLabel)}</td>
        <td class="text-end">${credit > 0 ? escapeHtml(fmtMoney(credit)) : '-'}</td>
        <td class="text-end pe-4" style="min-width:120px;">${debit > 0 ? escapeHtml(fmtMoney(debit)) : '-'}</td>
        <td class="ps-3 text-nowrap" style="min-width:130px;">${runningType}</td>
        <td class="text-end pe-4" style="min-width:150px;">${escapeHtml(fmtMoney(runningAbs))}</td>
        <td class="ps-3 text-nowrap" style="min-width:150px;">${escapeHtml(t.recordedByName || '')}</td>
      `;
      txnBody.appendChild(tr);
    });

    const finalNet = Number((totalCredits - totalDebits).toFixed(2));
    setBalanceSummary(finalNet);
  }

  async function fetchAccountAndRender() {
    if (!txnBody) return;
    txnBody.innerHTML = '<tr><td class="text-muted" colspan="7">Loading...</td></tr>';

    try {
      const res = await fetch(`/customers/${encodeURIComponent(customerId)}/account/api`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok || !Array.isArray(j.txns)) {
        throw new Error(j?.error || 'Failed to load account');
      }
      renderLedger(j.txns, j.accountSettledOrderIds || []);
    } catch (err) {
      console.error('fetchAccountAndRender error', err);
      txnBody.innerHTML = '<tr><td class="text-danger" colspan="7">Failed to load account ledger.</td></tr>';
      setBalanceSummary(0);
    }
  }

  async function fetchCustomerOrders() {
    if (!customerOrdersTable || !customerOrdersStatus) return;
    const tbody = customerOrdersTable.querySelector('tbody');
    if (!tbody) return;

    customerOrdersStatus.textContent = 'Loading...';
    tbody.innerHTML = '<tr><td class="text-muted" colspan="2">Loading...</td></tr>';

    try {
      const res = await fetch(`/customers/${encodeURIComponent(customerId)}/orders`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !Array.isArray(j.orders)) {
        throw new Error(j?.error || 'Failed to load orders');
      }

      if (!j.orders.length) {
        customerOrdersStatus.textContent = 'No orders found.';
        tbody.innerHTML = '<tr><td class="text-muted" colspan="2">No orders yet.</td></tr>';
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
            <a class="text-white text-decoration-underline" href="${orderUrl}" data-ajax="true">
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
          tbody.innerHTML = '<tr><td class="text-danger" colspan="2">Failed to load orders.</td></tr>';
        }
      }
    }
  }

  async function adjust(type, amount, note, extra) {
    const res = await fetch(`/customers/${encodeURIComponent(customerId)}/account/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(Object.assign({ type, amount, note }, extra || {})),
      credentials: 'same-origin'
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error || 'Request failed');
    return j;
  }

  document.getElementById('creditBtn')?.addEventListener('click', async () => {
    const creditBtn = document.getElementById('creditBtn');
    const amt = Number(document.getElementById('creditAmount')?.value || 0);
    const note = (document.getElementById('creditNote')?.value || '').trim();
    if (!amt || isNaN(amt) || amt <= 0) return alert('Enter a valid amount');
    const cashDirection = creditCashDirection ? String(creditCashDirection.value || 'inflow') : 'inflow';
    const cashBookId = selectedCashBookId(creditCashBook);
    if (cashDirection !== 'none' && creditCashBook && !cashBookId) {
      return alert('Select an active cash book or choose "No cash movement".');
    }
    const paymentKind = cashBookKindFromSelect(creditCashBook);
    if (cashDirection !== 'none' && paymentKind === 'momo') {
      const num = creditMomoNumber ? creditMomoNumber.value.trim() : '';
      const tx = creditMomoTxId ? creditMomoTxId.value.trim() : '';
      if (!num || !tx) return alert('Enter MoMo number and transaction ID');
    }

    try {
      if (creditBtn) {
        creditBtn.disabled = true;
        creditBtn.textContent = 'Processing...';
      }
      await adjust('credit', amt, note, {
        cashBookId: cashDirection === 'none' ? null : cashBookId,
        cashDirection,
        paymentMethod: paymentKind,
        momoNumber: creditMomoNumber ? creditMomoNumber.value.trim() : null,
        momoTxId: creditMomoTxId ? creditMomoTxId.value.trim() : null,
        chequeNumber: creditChequeNumber ? creditChequeNumber.value.trim() : null,
        depositDetails: creditDepositDetails ? creditDepositDetails.value.trim() : null
      });
      if (document.getElementById('creditAmount')) document.getElementById('creditAmount').value = '';
      if (document.getElementById('creditNote')) document.getElementById('creditNote').value = '';
      if (creditMomoNumber) creditMomoNumber.value = '';
      if (creditMomoTxId) creditMomoTxId.value = '';
      if (creditChequeNumber) creditChequeNumber.value = '';
      if (creditDepositDetails) creditDepositDetails.value = '';
      await fetchAccountAndRender();
    } catch (e) {
      alert(e.message);
    } finally {
      if (creditBtn) {
        creditBtn.disabled = false;
        creditBtn.textContent = 'Credit';
      }
    }
  });

  document.getElementById('debitBtn')?.addEventListener('click', async () => {
    const debitBtn = document.getElementById('debitBtn');
    const amt = Number(document.getElementById('debitAmount')?.value || 0);
    const note = (document.getElementById('debitNote')?.value || '').trim();
    if (!amt || isNaN(amt) || amt <= 0) return alert('Enter a valid amount');
    const cashDirection = debitCashDirection ? String(debitCashDirection.value || 'none') : 'none';
    const cashBookId = selectedCashBookId(debitCashBook);
    if (cashDirection !== 'none' && debitCashBook && !cashBookId) {
      return alert('Select an active cash book or choose "No cash movement".');
    }
    const paymentKind = cashBookKindFromSelect(debitCashBook);
    if (cashDirection !== 'none' && paymentKind === 'momo') {
      const num = debitMomoNumber ? debitMomoNumber.value.trim() : '';
      const tx = debitMomoTxId ? debitMomoTxId.value.trim() : '';
      if (!num || !tx) return alert('Enter MoMo number and transaction ID');
    }

    try {
      if (debitBtn) {
        debitBtn.disabled = true;
        debitBtn.textContent = 'Processing...';
      }
      await adjust('debit', amt, note, {
        cashBookId: cashDirection === 'none' ? null : cashBookId,
        cashDirection,
        paymentMethod: paymentKind,
        momoNumber: debitMomoNumber ? debitMomoNumber.value.trim() : null,
        momoTxId: debitMomoTxId ? debitMomoTxId.value.trim() : null,
        chequeNumber: debitChequeNumber ? debitChequeNumber.value.trim() : null,
        depositDetails: debitDepositDetails ? debitDepositDetails.value.trim() : null
      });
      if (document.getElementById('debitAmount')) document.getElementById('debitAmount').value = '';
      if (document.getElementById('debitNote')) document.getElementById('debitNote').value = '';
      if (debitMomoNumber) debitMomoNumber.value = '';
      if (debitMomoTxId) debitMomoTxId.value = '';
      if (debitChequeNumber) debitChequeNumber.value = '';
      if (debitDepositDetails) debitDepositDetails.value = '';
      await fetchAccountAndRender();
    } catch (e) {
      alert(e.message);
    } finally {
      if (debitBtn) {
        debitBtn.disabled = false;
        debitBtn.textContent = 'Debit';
      }
    }
  });

  if (openCustomerOrdersBtn) {
    openCustomerOrdersBtn.addEventListener('click', async () => {
      if (customerOrdersModal) customerOrdersModal.show();
      await fetchCustomerOrders();
    });
  }

  if (creditCashBook) creditCashBook.addEventListener('change', updateCreditCashBookFields);
  if (creditCashDirection) creditCashDirection.addEventListener('change', updateCreditCashBookFields);
  if (debitCashBook) debitCashBook.addEventListener('change', updateDebitCashBookFields);
  if (debitCashDirection) debitCashDirection.addEventListener('change', updateDebitCashBookFields);
  loadCashBooks();
  fetchAccountAndRender();
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
