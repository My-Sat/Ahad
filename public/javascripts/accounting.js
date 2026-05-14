(function () {
  function initAccountingPage() {
    const root = document.getElementById('accountingPage');
    if (!root) return;
    if (root.dataset.accountingInit === '1') return;
    root.dataset.accountingInit = '1';

    const fmt = n => `GH₵ ${Number(n || 0).toFixed(2)}`;
    const escapeHtml = s => String(s ?? '').replace(/[&<>"'`=\/]/g, c => '&#' + c.charCodeAt(0) + ';');
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    function setButtonLoading(btn, loadingText) {
      if (!btn) return '';
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = loadingText;
      return original;
    }
    function restoreButton(btn, originalText) {
      if (!btn) return;
      btn.disabled = false;
      if (originalText) btn.textContent = originalText;
    }

    async function fetchJson(url, opts) {
      const res = await fetch(url, Object.assign({
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
      }, opts || {}));
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || j.ok === false) throw new Error(j?.error || `Request failed (${res.status})`);
      return j;
    }

    function query() {
      const from = document.getElementById('accountingFrom')?.value || '';
      const to = document.getElementById('accountingTo')?.value || '';
      const sp = new URLSearchParams();
      if (from) sp.set('from', from);
      if (to) sp.set('to', to);
      return sp.toString() ? `?${sp}` : '';
    }

    function renderRows(tableId, rows) {
      const tbody = document.querySelector(`#${tableId} tbody`);
      if (!tbody) return;
      if (!rows || !rows.length) {
        tbody.innerHTML = '<tr><td class="text-muted">No entries.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${escapeHtml(r.code)} ${escapeHtml(r.name)}</td>
          <td class="text-end">${fmt(r.amount)}</td>
        </tr>
      `).join('');
    }

    function formatDate(value) {
      if (!value) return '';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
    }

    function formatDateTime(value) {
      if (!value) return '';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
    }

    function prependTableRow(tableId, rowHtml) {
      const tbody = document.querySelector(`#${tableId} tbody`);
      if (!tbody) return;
      const emptyCell = tbody.querySelector('td[colspan]');
      if (emptyCell) tbody.innerHTML = '';
      tbody.insertAdjacentHTML('afterbegin', rowHtml);
    }

    function prependManualExpense(expense) {
      if (!expense) return;
      prependTableRow('manualExpensesTable', `
        <tr>
          <td>${formatDate(expense.date)}</td>
          <td>${escapeHtml(expense.description || '')}</td>
          <td>${escapeHtml(expense.categoryName || '')}</td>
          <td>${escapeHtml(expense.treatment || '')}</td>
          <td class="text-end">${fmt(expense.amount)}</td>
        </tr>
      `);
    }

    function fixedAssetPostingBadge(asset) {
      return String(asset?.depreciationMethod || '') === 'straight_line'
        ? '<span class="badge bg-info text-dark">Auto monthly</span>'
        : '<span class="badge bg-secondary">Auto per usage</span>';
    }

    function prependFixedAsset(asset, fallbackPrinterName) {
      if (!asset) return;
      const printerName = asset.printer && typeof asset.printer === 'object'
        ? asset.printer.name
        : fallbackPrinterName;
      prependTableRow('fixedAssetsTable', `
        <tr>
          <td>${escapeHtml(asset.name || '')}</td>
          <td>${escapeHtml(printerName || '-')}</td>
          <td>${escapeHtml(asset.depreciationMethod || '')}</td>
          <td class="text-end">${fmt(asset.purchaseCost)}</td>
          <td class="text-end">${fmt(asset.accumulatedDepreciation)}</td>
          <td class="text-end">${fixedAssetPostingBadge(asset)}</td>
        </tr>
      `);
    }

    function renderPrepaids(prepaids) {
      const select = document.getElementById('prepaidExpenseSelect');
      const tableBody = document.querySelector('#prepaidExpensesTable tbody');
      const currentSelected = select?.value || '';

      if (select) {
        select.innerHTML = '<option value="">Select prepaid expense</option>';
        (prepaids || []).forEach(p => {
          const remaining = Number(p.remainingAmount || 0);
          if (remaining <= 0) return;
          const option = document.createElement('option');
          option.value = p._id;
          option.dataset.remaining = remaining.toFixed(2);
          option.textContent = `${p.description || 'Prepaid expense'} - remaining ${fmt(remaining)}`;
          select.appendChild(option);
        });
        if (currentSelected && Array.from(select.options).some(opt => opt.value === currentSelected)) {
          select.value = currentSelected;
        }
      }

      if (!tableBody) return;
      if (!prepaids || !prepaids.length) {
        tableBody.innerHTML = '<tr><td class="text-muted" colspan="8">No prepaid expenses yet.</td></tr>';
        return;
      }

      tableBody.innerHTML = prepaids.map(p => {
        const remaining = Number(p.remainingAmount || 0);
        const releaseMode = p.autoReleaseEnabled
          ? `<span class="badge bg-info text-dark">Auto ${Number(p.releaseMonths || 0)} mo.</span>`
          : '<span class="badge bg-secondary">Manual</span>';
        const action = remaining > 0
          ? `<button class="btn btn-outline-light-custom btn-sm use-prepaid-release-btn" type="button" data-prepaid-id="${escapeHtml(p._id)}" data-remaining="${remaining.toFixed(2)}" data-description="${escapeHtml(p.description || '')}">Release</button>`
          : '<span class="badge bg-success">Fully released</span>';
        return `
          <tr>
            <td>${formatDate(p.date)}</td>
            <td>${escapeHtml(p.description || '')}</td>
            <td>${escapeHtml(p.categoryName || '')}</td>
            <td class="text-end">${fmt(p.amount)}</td>
            <td class="text-end">${fmt(p.releasedAmount)}</td>
            <td class="text-end">${fmt(remaining)}</td>
            <td>${releaseMode}</td>
            <td class="text-end">${action}</td>
          </tr>
        `;
      }).join('');
    }

    function renderPrepaidReleases(releases) {
      const tableBody = document.querySelector('#prepaidReleasesTable tbody');
      if (!tableBody) return;
      if (!releases || !releases.length) {
        tableBody.innerHTML = '<tr><td class="text-muted" colspan="5">No prepaid releases yet.</td></tr>';
        return;
      }

      tableBody.innerHTML = releases.map(r => `
        <tr>
          <td>${formatDate(r.date)}</td>
          <td>${escapeHtml(r.description || '')}</td>
          <td>${escapeHtml(r.categoryName || '')}</td>
          <td>${escapeHtml(r.note || '')}</td>
          <td class="text-end">${fmt(r.amount)}</td>
        </tr>
      `).join('');
    }

    async function loadPrepaids() {
      const j = await fetchJson('/admin/accounting/api/prepaid-expenses');
      renderPrepaids(j.prepaids || []);
      renderPrepaidReleases(j.releases || []);
    }

    function renderAccruedExpenses(accruedExpenses) {
      const select = document.getElementById('accruedExpenseSelect');
      const tableBody = document.querySelector('#accruedExpensesTable tbody');
      const currentSelected = select?.value || '';

      if (select) {
        select.innerHTML = '<option value="">Select accrued expense</option>';
        (accruedExpenses || []).forEach(a => {
          const remaining = Number(a.remainingAmount || 0);
          if (remaining <= 0) return;
          const option = document.createElement('option');
          option.value = a._id;
          option.dataset.remaining = remaining.toFixed(2);
          option.textContent = `${a.description || 'Accrued expense'} - remaining ${fmt(remaining)}`;
          select.appendChild(option);
        });
        if (currentSelected && Array.from(select.options).some(opt => opt.value === currentSelected)) {
          select.value = currentSelected;
        }
      }

      if (!tableBody) return;
      if (!accruedExpenses || !accruedExpenses.length) {
        tableBody.innerHTML = '<tr><td class="text-muted" colspan="7">No accrued expenses yet.</td></tr>';
        return;
      }

      tableBody.innerHTML = accruedExpenses.map(a => {
        const remaining = Number(a.remainingAmount || 0);
        const action = remaining > 0
          ? `<button class="btn btn-outline-light-custom btn-sm use-accrued-payment-btn" type="button" data-accrued-id="${escapeHtml(a._id)}" data-remaining="${remaining.toFixed(2)}" data-description="${escapeHtml(a.description || '')}">Pay</button>`
          : '<span class="badge bg-success">Paid</span>';
        return `
          <tr>
            <td>${formatDate(a.date)}</td>
            <td>${escapeHtml(a.description || '')}</td>
            <td>${escapeHtml(a.categoryName || '')}</td>
            <td class="text-end">${fmt(a.amount)}</td>
            <td class="text-end">${fmt(a.paidAmount)}</td>
            <td class="text-end">${fmt(remaining)}</td>
            <td class="text-end">${action}</td>
          </tr>
        `;
      }).join('');
    }

    function renderAccruedPayments(payments) {
      const tableBody = document.querySelector('#accruedPaymentsTable tbody');
      if (!tableBody) return;
      if (!payments || !payments.length) {
        tableBody.innerHTML = '<tr><td class="text-muted" colspan="6">No accrued payments yet.</td></tr>';
        return;
      }

      tableBody.innerHTML = payments.map(p => `
        <tr>
          <td>${formatDate(p.date)}</td>
          <td>${escapeHtml(p.description || '')}</td>
          <td>${escapeHtml(p.categoryName || '')}</td>
          <td>${escapeHtml(p.cashBookName || '')}</td>
          <td>${escapeHtml(p.note || '')}</td>
          <td class="text-end">${fmt(p.amount)}</td>
        </tr>
      `).join('');
    }

    async function loadAccruedExpenses() {
      const j = await fetchJson('/admin/accounting/api/accrued-expenses');
      renderAccruedExpenses(j.accruedExpenses || []);
      renderAccruedPayments(j.payments || []);
    }

    function renderJournalEntries(entries) {
      const tbody = document.querySelector('#journalEntriesTable tbody');
      if (!tbody) return;
      if (!entries || !entries.length) {
        tbody.innerHTML = '<tr><td class="text-muted" colspan="4">No journal entries yet.</td></tr>';
        return;
      }

      tbody.innerHTML = entries.map(j => {
        const lines = (j.lines || []).map(line => `
          <div class="small">
            ${escapeHtml(line.accountCode || '')} ${escapeHtml(line.accountName || '')}: Dr ${Number(line.debit || 0).toFixed(2)} / Cr ${Number(line.credit || 0).toFixed(2)}
          </div>
        `).join('');
        return `
          <tr>
            <td>${formatDateTime(j.date)}</td>
            <td>${escapeHtml(j.sourceType || '')}</td>
            <td>${escapeHtml(j.memo || '')}</td>
            <td>${lines}</td>
          </tr>
        `;
      }).join('');
    }

    async function loadJournalEntries() {
      const j = await fetchJson('/admin/accounting/api/journal-entries');
      renderJournalEntries(j.entries || []);
    }

    async function loadProfitLoss() {
      const j = await fetchJson(`/admin/accounting/api/profit-loss${query()}`);
      const t = j.totals || {};
      setText('plRevenue', fmt(t.revenueTotal));
      setText('plCogs', fmt(t.cogsTotal));
      setText('plGross', fmt(t.grossProfit));
      setText('plOperating', fmt(t.operatingExpensesTotal));
      setText('plNet', fmt(t.netProfit));
      renderRows('plRevenueTable', j.revenue || []);
      renderRows('plCogsTable', j.cogs || []);
      renderRows('plOperatingTable', j.operatingExpenses || []);
    }

    function toggleManualExpenseCashBook() {
      const treatment = document.getElementById('manualExpenseTreatment')?.value || 'expense';
      const wrap = document.getElementById('manualExpenseCashBookWrap');
      const autoReleaseWrap = document.getElementById('manualExpenseAutoReleaseWrap');
      if (wrap) wrap.style.display = treatment === 'accrued' ? 'none' : '';
      if (autoReleaseWrap) autoReleaseWrap.classList.toggle('d-none', treatment !== 'prepaid');
      toggleCashBookDetails('manualExpenseCashBook', 'manualExpenseMomoWrap', 'manualExpenseBankWrap', treatment === 'accrued');
    }

    function toggleCashBookDetails(selectId, momoWrapId, bankWrapId, forceHidden) {
      const select = document.getElementById(selectId);
      const selected = select?.selectedOptions?.[0];
      const kind = String(selected?.dataset?.kind || '').toLowerCase();
      const momoWrap = document.getElementById(momoWrapId);
      const bankWrap = document.getElementById(bankWrapId);
      if (momoWrap) momoWrap.classList.toggle('d-none', !!forceHidden || kind !== 'momo');
      if (bankWrap) bankWrap.classList.toggle('d-none', !!forceHidden || kind !== 'bank');
    }

    function toggleFixedAssetLifeFields() {
      const method = document.getElementById('fixedAssetMethod')?.value || 'usage';
      const unitsWrap = document.getElementById('fixedAssetUnitsWrap');
      const monthsWrap = document.getElementById('fixedAssetMonthsWrap');
      if (unitsWrap) unitsWrap.classList.toggle('d-none', method === 'straight_line');
      if (monthsWrap) monthsWrap.classList.toggle('d-none', method !== 'straight_line');
    }

    document.getElementById('loadProfitLossBtn')?.addEventListener('click', () => {
      loadProfitLoss().catch(err => alert(err.message));
    });

    document.getElementById('manualExpenseTreatment')?.addEventListener('change', toggleManualExpenseCashBook);
    document.getElementById('manualExpenseCashBook')?.addEventListener('change', toggleManualExpenseCashBook);
    document.getElementById('fixedAssetCashBook')?.addEventListener('change', () => {
      toggleCashBookDetails('fixedAssetCashBook', 'fixedAssetMomoWrap', 'fixedAssetBankWrap', false);
    });
    document.getElementById('fixedAssetMethod')?.addEventListener('change', toggleFixedAssetLifeFields);
    document.getElementById('accruedPaymentCashBook')?.addEventListener('change', () => {
      toggleCashBookDetails('accruedPaymentCashBook', 'accruedPaymentMomoWrap', 'accruedPaymentBankWrap', false);
    });
    toggleManualExpenseCashBook();
    toggleFixedAssetLifeFields();
    toggleCashBookDetails('fixedAssetCashBook', 'fixedAssetMomoWrap', 'fixedAssetBankWrap', false);
    toggleCashBookDetails('accruedPaymentCashBook', 'accruedPaymentMomoWrap', 'accruedPaymentBankWrap', false);

    document.getElementById('manualExpenseForm')?.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const status = document.getElementById('manualExpenseStatus');
      const btn = document.getElementById('saveManualExpenseBtn');
      if (status) status.textContent = '';
      const originalBtnText = setButtonLoading(btn, 'Saving...');
      try {
        const body = {
          description: document.getElementById('manualExpenseDescription')?.value || '',
          categoryId: document.getElementById('manualExpenseCategory')?.value || '',
          amount: document.getElementById('manualExpenseAmount')?.value || '',
          date: document.getElementById('manualExpenseDate')?.value || '',
          treatment: document.getElementById('manualExpenseTreatment')?.value || 'expense',
          autoReleaseEnabled: document.getElementById('manualExpenseAutoRelease')?.checked ? 'true' : '',
          releaseMonths: document.getElementById('manualExpenseReleaseMonths')?.value || '',
          cashBookId: document.getElementById('manualExpenseCashBook')?.value || '',
          momoNumber: document.getElementById('manualExpenseMomoNumber')?.value || '',
          momoTxId: document.getElementById('manualExpenseMomoTxId')?.value || '',
          chequeNumber: document.getElementById('manualExpenseChequeNumber')?.value || '',
          depositDetails: document.getElementById('manualExpenseDepositDetails')?.value || ''
        };
        const j = await fetchJson('/admin/accounting/manual-expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify(body)
        });
        prependManualExpense(j.expense);
        if (status) status.textContent = 'Expense recorded.';
        this.reset();
        toggleManualExpenseCashBook();
        await loadPrepaids();
        await loadAccruedExpenses();
        await loadProfitLoss();
        await loadJournalEntries();
      } catch (err) {
        if (status) status.textContent = err.message;
        else alert(err.message);
      } finally {
        restoreButton(btn, originalBtnText);
      }
    });

    document.getElementById('accruedExpensesTable')?.addEventListener('click', function (ev) {
      const btn = ev.target.closest && ev.target.closest('.use-accrued-payment-btn');
      if (!btn) return;
      ev.preventDefault();
      const select = document.getElementById('accruedExpenseSelect');
      const amount = document.getElementById('accruedPaymentAmount');
      const note = document.getElementById('accruedPaymentNote');
      if (select) select.value = btn.dataset.accruedId || '';
      if (amount) amount.value = btn.dataset.remaining || '';
      if (note && !note.value) note.value = btn.dataset.description ? `Pay ${btn.dataset.description}` : '';
    });

    document.getElementById('accruedPaymentForm')?.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const status = document.getElementById('accruedPaymentStatus');
      const btn = document.getElementById('accruedPaymentBtn');
      const accruedId = document.getElementById('accruedExpenseSelect')?.value || '';
      if (status) status.textContent = '';
      if (!accruedId) {
        if (status) status.textContent = 'Select an accrued expense.';
        return;
      }
      const originalBtnText = setButtonLoading(btn, 'Paying...');
      try {
        const body = {
          amount: document.getElementById('accruedPaymentAmount')?.value || '',
          date: document.getElementById('accruedPaymentDate')?.value || '',
          cashBookId: document.getElementById('accruedPaymentCashBook')?.value || '',
          momoNumber: document.getElementById('accruedPaymentMomoNumber')?.value || '',
          momoTxId: document.getElementById('accruedPaymentMomoTxId')?.value || '',
          chequeNumber: document.getElementById('accruedPaymentChequeNumber')?.value || '',
          depositDetails: document.getElementById('accruedPaymentDepositDetails')?.value || '',
          note: document.getElementById('accruedPaymentNote')?.value || ''
        };
        await fetchJson(`/admin/accounting/accrued-expenses/${encodeURIComponent(accruedId)}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify(body)
        });
        if (status) status.textContent = 'Accrued expense paid.';
        this.reset();
        toggleCashBookDetails('accruedPaymentCashBook', 'accruedPaymentMomoWrap', 'accruedPaymentBankWrap', false);
        await loadAccruedExpenses();
        await loadProfitLoss();
        await loadJournalEntries();
      } catch (err) {
        if (status) status.textContent = err.message;
        else alert(err.message);
      } finally {
        restoreButton(btn, originalBtnText);
      }
    });

    document.getElementById('prepaidExpensesTable')?.addEventListener('click', function (ev) {
      const btn = ev.target.closest && ev.target.closest('.use-prepaid-release-btn');
      if (!btn) return;
      ev.preventDefault();
      const select = document.getElementById('prepaidExpenseSelect');
      const amount = document.getElementById('prepaidReleaseAmount');
      const note = document.getElementById('prepaidReleaseNote');
      if (select) select.value = btn.dataset.prepaidId || '';
      if (amount) amount.value = btn.dataset.remaining || '';
      if (note && !note.value) note.value = btn.dataset.description ? `Release ${btn.dataset.description}` : '';
    });

    document.getElementById('prepaidReleaseForm')?.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const status = document.getElementById('prepaidReleaseStatus');
      const btn = document.getElementById('savePrepaidReleaseBtn');
      const prepaidId = document.getElementById('prepaidExpenseSelect')?.value || '';
      if (status) status.textContent = '';
      if (!prepaidId) {
        if (status) status.textContent = 'Select a prepaid expense.';
        return;
      }
      const originalBtnText = setButtonLoading(btn, 'Releasing...');
      try {
        const body = {
          amount: document.getElementById('prepaidReleaseAmount')?.value || '',
          date: document.getElementById('prepaidReleaseDate')?.value || '',
          note: document.getElementById('prepaidReleaseNote')?.value || ''
        };
        await fetchJson(`/admin/accounting/prepaid-expenses/${encodeURIComponent(prepaidId)}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify(body)
        });
        if (status) status.textContent = 'Prepaid expense released to P&L.';
        this.reset();
        await loadPrepaids();
        await loadProfitLoss();
        await loadJournalEntries();
      } catch (err) {
        if (status) status.textContent = err.message;
        else alert(err.message);
      } finally {
        restoreButton(btn, originalBtnText);
      }
    });

    document.getElementById('fixedAssetForm')?.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const status = document.getElementById('fixedAssetStatus');
      const btn = document.getElementById('saveFixedAssetBtn');
      if (status) status.textContent = '';
      const originalBtnText = setButtonLoading(btn, 'Saving...');
      try {
        const printerSelect = document.getElementById('fixedAssetPrinter');
        const fallbackPrinterName = printerSelect && printerSelect.value
          ? (printerSelect.selectedOptions?.[0]?.textContent || '')
          : '-';
        const body = {
          name: document.getElementById('fixedAssetName')?.value || '',
          printerId: document.getElementById('fixedAssetPrinter')?.value || '',
          purchaseCost: document.getElementById('fixedAssetCost')?.value || '',
          residualValue: document.getElementById('fixedAssetResidual')?.value || 0,
          depreciationMethod: document.getElementById('fixedAssetMethod')?.value || 'usage',
          purchaseDate: document.getElementById('fixedAssetDate')?.value || '',
          usefulLifeUnits: document.getElementById('fixedAssetUnits')?.value || 0,
          usefulLifeMonths: document.getElementById('fixedAssetMonths')?.value || 0,
          cashBookId: document.getElementById('fixedAssetCashBook')?.value || '',
          momoNumber: document.getElementById('fixedAssetMomoNumber')?.value || '',
          momoTxId: document.getElementById('fixedAssetMomoTxId')?.value || '',
          chequeNumber: document.getElementById('fixedAssetChequeNumber')?.value || '',
          depositDetails: document.getElementById('fixedAssetDepositDetails')?.value || '',
          note: document.getElementById('fixedAssetNote')?.value || ''
        };
        const j = await fetchJson('/admin/accounting/fixed-assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify(body)
        });
        prependFixedAsset(j.asset, fallbackPrinterName);
        if (status) status.textContent = 'Fixed asset recorded.';
        this.reset();
        toggleFixedAssetLifeFields();
        toggleCashBookDetails('fixedAssetCashBook', 'fixedAssetMomoWrap', 'fixedAssetBankWrap', false);
      } catch (err) {
        if (status) status.textContent = err.message;
        else alert(err.message);
      } finally {
        restoreButton(btn, originalBtnText);
      }
    });

    loadProfitLoss().catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAccountingPage, { once: true });
  } else {
    initAccountingPage();
  }

  document.addEventListener('ajax:page:loaded', initAccountingPage);
})();
