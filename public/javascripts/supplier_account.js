function initSupplierAccountPage() {
  const supplierId = window.__SUPPLIER_ID__;
  if (!supplierId) return;

  const debitBtn = document.getElementById('supplierDebitBtn');
  if (!debitBtn) return;
  if (debitBtn.dataset.supplierAccountInit === '1') return;
  debitBtn.dataset.supplierAccountInit = '1';

  const txnBody = document.getElementById('supplierTxnBody');
  const balanceTypeEl = document.getElementById('supplierBalanceType');
  const balanceValueEl = document.getElementById('supplierBalanceValue');

  const creditBtn = document.getElementById('supplierCreditBtn');
  const creditAmount = document.getElementById('supplierCreditAmount');
  const creditNote = document.getElementById('supplierCreditNote');
  const creditCashBook = document.getElementById('supplierCreditCashBook');
  const creditCashDirection = document.getElementById('supplierCreditCashDirection');
  const creditMomoFields = document.getElementById('supplierCreditMomoFields');
  const creditBankFields = document.getElementById('supplierCreditBankFields');
  const creditMomoNumber = document.getElementById('supplierCreditMomoNumber');
  const creditMomoTxId = document.getElementById('supplierCreditMomoTxId');
  const creditChequeNumber = document.getElementById('supplierCreditChequeNumber');
  const creditDepositDetails = document.getElementById('supplierCreditDepositDetails');

  const debitAmount = document.getElementById('supplierDebitAmount');
  const debitNote = document.getElementById('supplierDebitNote');
  const debitCashBook = document.getElementById('supplierDebitCashBook');
  const debitCashDirection = document.getElementById('supplierDebitCashDirection');
  const debitMomoFields = document.getElementById('supplierDebitMomoFields');
  const debitBankFields = document.getElementById('supplierDebitBankFields');
  const debitMomoNumber = document.getElementById('supplierDebitMomoNumber');
  const debitMomoTxId = document.getElementById('supplierDebitMomoTxId');
  const debitChequeNumber = document.getElementById('supplierDebitChequeNumber');
  const debitDepositDetails = document.getElementById('supplierDebitDepositDetails');

  let activeCashBooks = [];

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"'`=\/]/g, c => '&#' + c.charCodeAt(0) + ';');
  }

  function fmtMoney(n) {
    return `GH₵ ${Number(n || 0).toFixed(2)}`;
  }

  function formatDateTime(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    return isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  function cashBookKindFromSelect(selectEl) {
    if (!selectEl) return 'cash';
    const opt = selectEl.options && selectEl.selectedIndex >= 0 ? selectEl.options[selectEl.selectedIndex] : null;
    return String((opt && opt.dataset && opt.dataset.kind) || 'cash').toLowerCase();
  }

  function selectedCashBookId(selectEl) {
    return String(selectEl ? selectEl.value || '' : '').trim();
  }

  function updateCashBookFields(selectEl, directionEl, momoEl, bankEl) {
    const direction = String(directionEl ? directionEl.value || 'none' : 'none');
    const kind = cashBookKindFromSelect(selectEl);
    const show = direction !== 'none';
    if (momoEl) momoEl.style.display = show && kind === 'momo' ? '' : 'none';
    if (bankEl) bankEl.style.display = show && kind === 'bank' ? '' : 'none';
  }

  function updateCreditCashBookFields() {
    updateCashBookFields(creditCashBook, creditCashDirection, creditMomoFields, creditBankFields);
  }

  function updateDebitCashBookFields() {
    updateCashBookFields(debitCashBook, debitCashDirection, debitMomoFields, debitBankFields);
  }

  function populateOneCashBookSelect(selectEl) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';

    if (!activeCashBooks.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.dataset.kind = 'cash';
      opt.textContent = 'No active cash books configured';
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
      console.error('supplier account cash books error', err);
      activeCashBooks = [];
    }
    populateCashBookSelects();
  }

  function setBalanceSummary(net) {
    if (!balanceTypeEl || !balanceValueEl) return;
    const n = Number(net || 0);

    if (n > 0) {
      balanceTypeEl.textContent = 'Credit Balance';
      balanceValueEl.textContent = `${fmtMoney(n)} owed to supplier`;
      balanceTypeEl.className = 'ms-2 fw-semibold text-warning';
    } else if (n < 0) {
      balanceTypeEl.textContent = 'Debit Balance';
      balanceValueEl.textContent = `${fmtMoney(Math.abs(n))} supplier owes us`;
      balanceTypeEl.className = 'ms-2 fw-semibold text-success';
    } else {
      balanceTypeEl.textContent = 'Settled';
      balanceValueEl.textContent = fmtMoney(0);
      balanceTypeEl.className = 'ms-2 fw-semibold text-muted-light';
    }
  }

  function renderLedger(rows) {
    if (!txnBody) return;

    if (!Array.isArray(rows) || !rows.length) {
      txnBody.innerHTML = '<tr><td class="text-muted" colspan="7">No transactions yet.</td></tr>';
      setBalanceSummary(0);
      return;
    }

    const ordered = rows.slice().sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      if (ta !== tb) return ta - tb;
      return String(a._id || '').localeCompare(String(b._id || ''));
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
      const cashBookName = String(t.cashBookName || '').trim();
      const cashDirection = String(t.cashDirection || '').trim();
      const sourceRef = String(t.sourceRef || '').trim();
      const note = String(t.note || sourceRef || type.toUpperCase());
      const cashBookLabel = cashBookName
        ? ` (${cashBookName}${cashDirection ? ` ${cashDirection}` : ''})`
        : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="text-nowrap" style="min-width:170px;">${escapeHtml(formatDateTime(t.createdAt))}</td>
        <td style="min-width:280px;">${escapeHtml(note + cashBookLabel)}</td>
        <td class="text-end">${credit > 0 ? escapeHtml(fmtMoney(credit)) : '-'}</td>
        <td class="text-end pe-4" style="min-width:120px;">${debit > 0 ? escapeHtml(fmtMoney(debit)) : '-'}</td>
        <td class="ps-3 text-nowrap" style="min-width:130px;">${runningType}</td>
        <td class="text-end pe-4" style="min-width:150px;">${escapeHtml(fmtMoney(runningAbs))}</td>
        <td class="ps-3 text-nowrap" style="min-width:150px;">${escapeHtml(t.recordedByName || '')}</td>
      `;
      txnBody.appendChild(tr);
    });

    setBalanceSummary(Number((totalCredits - totalDebits).toFixed(2)));
  }

  async function fetchAccountAndRender() {
    if (txnBody) txnBody.innerHTML = '<tr><td class="text-muted" colspan="7">Loading...</td></tr>';
    try {
      const res = await fetch(`/admin/suppliers/${encodeURIComponent(supplierId)}/account/api`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok || !Array.isArray(j.txns)) throw new Error(j?.error || 'Failed to load supplier account');
      renderLedger(j.txns);
    } catch (err) {
      console.error('supplier account load error', err);
      if (txnBody) txnBody.innerHTML = '<tr><td class="text-danger" colspan="7">Failed to load supplier account.</td></tr>';
      setBalanceSummary(0);
    }
  }

  async function adjust(type, amount, note, extra) {
    const res = await fetch(`/admin/suppliers/${encodeURIComponent(supplierId)}/account/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
      body: JSON.stringify(Object.assign({ type, amount, note }, extra || {}))
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) throw new Error(j?.error || 'Request failed');
    return j;
  }

  function validateMovement(directionEl, cashBookEl, kind, momoNumberEl, momoTxEl) {
    const cashDirection = directionEl ? String(directionEl.value || 'none') : 'none';
    const cashBookId = selectedCashBookId(cashBookEl);
    if (cashDirection !== 'none' && cashBookEl && !cashBookId) {
      throw new Error('Select an active cash book or choose "No cash movement".');
    }
    if (cashDirection !== 'none' && kind === 'momo') {
      const num = momoNumberEl ? momoNumberEl.value.trim() : '';
      const tx = momoTxEl ? momoTxEl.value.trim() : '';
      if (!num || !tx) throw new Error('Enter MoMo number and transaction ID');
    }
    return { cashDirection, cashBookId };
  }

  async function handleAdjust(type) {
    const isCredit = type === 'credit';
    const btn = isCredit ? creditBtn : debitBtn;
    const amountEl = isCredit ? creditAmount : debitAmount;
    const noteEl = isCredit ? creditNote : debitNote;
    const cashBookEl = isCredit ? creditCashBook : debitCashBook;
    const directionEl = isCredit ? creditCashDirection : debitCashDirection;
    const momoNumberEl = isCredit ? creditMomoNumber : debitMomoNumber;
    const momoTxEl = isCredit ? creditMomoTxId : debitMomoTxId;
    const chequeEl = isCredit ? creditChequeNumber : debitChequeNumber;
    const depositEl = isCredit ? creditDepositDetails : debitDepositDetails;

    const amount = Number(amountEl ? amountEl.value || 0 : 0);
    const note = String(noteEl ? noteEl.value || '' : '').trim();
    if (!amount || isNaN(amount) || amount <= 0) return alert('Enter a valid amount');

    const paymentKind = cashBookKindFromSelect(cashBookEl);
    let movement;
    try {
      movement = validateMovement(directionEl, cashBookEl, paymentKind, momoNumberEl, momoTxEl);
    } catch (err) {
      return alert(err.message);
    }

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Processing...';
      }

      await adjust(type, amount, note, {
        cashBookId: movement.cashDirection === 'none' ? null : movement.cashBookId,
        cashDirection: movement.cashDirection,
        paymentMethod: paymentKind,
        momoNumber: momoNumberEl ? momoNumberEl.value.trim() : null,
        momoTxId: momoTxEl ? momoTxEl.value.trim() : null,
        chequeNumber: chequeEl ? chequeEl.value.trim() : null,
        depositDetails: depositEl ? depositEl.value.trim() : null
      });

      if (amountEl) amountEl.value = '';
      if (noteEl) noteEl.value = '';
      if (momoNumberEl) momoNumberEl.value = '';
      if (momoTxEl) momoTxEl.value = '';
      if (chequeEl) chequeEl.value = '';
      if (depositEl) depositEl.value = '';
      await fetchAccountAndRender();
    } catch (err) {
      alert(err.message || 'Failed to update supplier account');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = isCredit ? 'Credit' : 'Debit';
      }
    }
  }

  creditBtn?.addEventListener('click', () => handleAdjust('credit'));
  debitBtn?.addEventListener('click', () => handleAdjust('debit'));
  creditCashBook?.addEventListener('change', updateCreditCashBookFields);
  creditCashDirection?.addEventListener('change', updateCreditCashBookFields);
  debitCashBook?.addEventListener('change', updateDebitCashBookFields);
  debitCashDirection?.addEventListener('change', updateDebitCashBookFields);

  loadCashBooks();
  fetchAccountAndRender();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initSupplierAccountPage();
  }, { once: true });
} else {
  initSupplierAccountPage();
}

document.addEventListener('ajax:page:loaded', function () {
  initSupplierAccountPage();
});
