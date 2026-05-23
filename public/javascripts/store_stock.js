// public/javascripts/store_stock.js
// Store stock dashboard client (stores + stock items + activity + operational confirm)
// Includes: create store, set operational (confirm), add stock, adjust, transfer, view activity, remove stock item
// NOTE: Edit/Delete store actions are wired if the related elements exist in the page (manageStoreModal etc).

function initStoreStockPage() {
  'use strict';

  // ----------------------------
  // Base elements
  // ----------------------------
  const storeSelect = document.getElementById('storeSelect');
  if (!storeSelect) return;
  if (storeSelect.dataset.storeStockInit === '1') return;
  storeSelect.dataset.storeStockInit = '1';
  const setOperationalBtn = document.getElementById('setOperationalBtn');

  const openCreateStoreBtn = document.getElementById('openCreateStoreBtn');
  const createStoreModalEl = document.getElementById('createStoreModal');
  const newStoreName = document.getElementById('newStoreName');
  const createStoreBtn = document.getElementById('createStoreBtn');
  const createStoreSpinner = document.getElementById('createStoreSpinner');

  const addForm = document.getElementById('add-to-store-form');
  const catalogueSelect = document.getElementById('catalogueSelect');
  const initialStockInput = document.getElementById('initialStockInput');
  const addToStoreBtn = document.getElementById('addToStoreBtn');
  const addToStoreSpinner = document.getElementById('addToStoreSpinner');

  // ----------------------------
  // Supplier purchase
  // ----------------------------
  const purchaseForm = document.getElementById('purchase-stock-form');
  const purchaseSupplierSelect = document.getElementById('purchaseSupplierSelect');
  const purchaseCatalogueSelect = document.getElementById('purchaseCatalogueSelect');
  const purchaseUnitSelect = document.getElementById('purchaseUnitSelect');
  const purchaseQty = document.getElementById('purchaseQty');
  const purchaseUnitCost = document.getElementById('purchaseUnitCost');
  const purchaseBaseUnitHint = document.getElementById('purchaseBaseUnitHint');
  const purchasePaymentType = document.getElementById('purchasePaymentType');
  const purchaseCashBookWrap = document.getElementById('purchaseCashBookWrap');
  const purchaseCashBook = document.getElementById('purchaseCashBook');
  const purchaseMomoFields = document.getElementById('purchaseMomoFields');
  const purchaseMomoNumber = document.getElementById('purchaseMomoNumber');
  const purchaseMomoTxId = document.getElementById('purchaseMomoTxId');
  const purchaseBankFields = document.getElementById('purchaseBankFields');
  const purchaseChequeNumber = document.getElementById('purchaseChequeNumber');
  const purchaseDepositDetails = document.getElementById('purchaseDepositDetails');
  const purchaseNote = document.getElementById('purchaseNote');
  const purchaseTotal = document.getElementById('purchaseTotal');
  const recordPurchaseBtn = document.getElementById('recordPurchaseBtn');
  const recordPurchaseSpinner = document.getElementById('recordPurchaseSpinner');

  // ----------------------------
  // Suppliers modal
  // ----------------------------
  const openSuppliersBtn = document.getElementById('openSuppliersBtn');
  const openSuppliersBtnInline = document.getElementById('openSuppliersBtnInline');
  const suppliersModalEl = document.getElementById('suppliersModal');
  const supplierFormModalEl = document.getElementById('supplierFormModal');
  const openSupplierFormBtn = document.getElementById('openSupplierFormBtn');
  const refreshSuppliersBtn = document.getElementById('refreshSuppliersBtn');
  const supplierId = document.getElementById('supplierId');
  const supplierName = document.getElementById('supplierName');
  const supplierPhone = document.getElementById('supplierPhone');
  const supplierEmail = document.getElementById('supplierEmail');
  const supplierAddress = document.getElementById('supplierAddress');
  const supplierNotes = document.getElementById('supplierNotes');
  const supplierActive = document.getElementById('supplierActive');
  const supplierFormTitle = document.getElementById('supplierFormTitle');
  const saveSupplierBtn = document.getElementById('saveSupplierBtn');
  const resetSupplierBtn = document.getElementById('resetSupplierBtn');
  const supplierStatus = document.getElementById('supplierStatus');
  const suppliersTable = document.getElementById('suppliersTable');
  let activeCashBooks = [];
  let suppliersCache = [];

  // ----------------------------
  // Adjust
  // ----------------------------
  const adjustModalEl = document.getElementById('adjustStockModal');
  const adjustStockId = document.getElementById('adjustStockId');
  const adjustCurrentStock = document.getElementById('adjustCurrentStock');
  const adjustStockInput = document.getElementById('adjustStockInput');
  const saveAdjustBtn = document.getElementById('saveAdjustStockBtn');
  const saveAdjustSpinner = document.getElementById('saveAdjustSpinner');
  const saveAdjustLabel = document.getElementById('saveAdjustLabel');

  // ----------------------------
  // Transfer
  // ----------------------------
  const transferModalEl = document.getElementById('transferModal');
  const transferStockId = document.getElementById('transferStockId');
  const transferToStore = document.getElementById('transferToStore');
  const transferQty = document.getElementById('transferQty');
  const confirmTransferBtn = document.getElementById('confirmTransferBtn');
  const transferSpinner = document.getElementById('transferSpinner');

  // ----------------------------
  // Activity
  // ----------------------------
  const activityModalEl = document.getElementById('activityModal');
  const activityMeta = document.getElementById('activityMeta');
  const activityTbody = document.getElementById('activityTbody');

  // ----------------------------
  // Operational confirm
  // ----------------------------
  const operationalConfirmModalEl = document.getElementById('operationalConfirmModal');
  const operationalConfirmMessage = document.getElementById('operationalConfirmMessage');
  const confirmSetOperationalBtn = document.getElementById('confirmSetOperationalBtn');
  let pendingOperationalStoreId = null;

  // ----------------------------
  // Remove stock item confirm
  // ----------------------------
  const deleteConfirmModalEl = document.getElementById('deleteConfirmModal');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  let pendingRemoveStockId = null;

  // ----------------------------
  // Optional: Manage Store (edit/delete) — only if UI elements exist
  // ----------------------------
  const openManageStoreBtn = document.getElementById('openManageStoreBtn');
  const manageStoreModalEl = document.getElementById('manageStoreModal');
  const editStoreId = document.getElementById('editStoreId');
  const editStoreName = document.getElementById('editStoreName');
  const saveStoreBtn = document.getElementById('saveStoreBtn');
  const saveStoreSpinner = document.getElementById('saveStoreSpinner');
  const openDeleteStoreBtn = document.getElementById('openDeleteStoreBtn');
  const deleteStoreConfirmModalEl = document.getElementById('deleteStoreConfirmModal');
  const deleteStoreConfirmMessage = document.getElementById('deleteStoreConfirmMessage');
  const confirmDeleteStoreBtn = document.getElementById('confirmDeleteStoreBtn');
  let pendingDeleteStoreId = null;

  // ----------------------------
  // Helpers
  // ----------------------------
  const selectedStoreId = () => (
    (addForm ? addForm.dataset.storeId : '') ||
    (purchaseForm ? purchaseForm.dataset.storeId : '') ||
    ''
  );

  function showToast(msg, delay = 1500) {
    if (window.showGlobalToast) return window.showGlobalToast(msg, delay);
    try { console.log('Toast:', msg); } catch (e) {}
  }

  function safeText(el, txt) {
    if (!el) return;
    el.textContent = String(txt ?? '');
  }

  function bsShow(modalEl) {
    if (!modalEl) return null;
    return bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  function bsHide(modalEl) {
    if (!modalEl) return;
    try { bootstrap.Modal.getInstance(modalEl)?.hide(); } catch (e) {}
  }

  function numOr(val, fallback = 0) {
    const n = Number(val);
    return isFinite(n) ? n : fallback;
  }

  function fmtMoney(n) {
    return `GH₵ ${Number(n || 0).toFixed(2)}`;
  }

  function setSupplierStatus(msg, isError) {
    if (!supplierStatus) return;
    supplierStatus.textContent = msg || '';
    supplierStatus.classList.toggle('text-danger', !!isError);
    supplierStatus.classList.toggle('text-success', !!msg && !isError);
  }

  function kindLabel(kind) {
    const k = String(kind || '').toLowerCase();
    if (k === 'bank') return 'Bank';
    if (k === 'momo') return 'MoMo';
    return 'Cash';
  }

  function selectedCashBookKind() {
    const opt = purchaseCashBook?.selectedOptions?.[0];
    return String(opt?.dataset?.kind || 'cash').toLowerCase();
  }

  function updatePurchaseTotal() {
    if (!purchaseTotal) return;
    const qty = Math.max(0, Math.floor(numOr(purchaseQty ? purchaseQty.value : 0, 0)));
    const unitCost = Math.max(0, numOr(purchaseUnitCost ? purchaseUnitCost.value : 0, 0));
    purchaseTotal.value = Number((qty * unitCost).toFixed(2)).toFixed(2);
  }

  function parseJsonAttr(raw, fallback) {
    try { return JSON.parse(raw || ''); } catch (e) { return fallback; }
  }

  function selectedPurchaseUnit() {
    const opt = purchaseUnitSelect?.selectedOptions?.[0];
    return {
      name: String(opt?.value || opt?.textContent || 'piece').trim() || 'piece',
      factor: Math.max(1, numOr(opt?.dataset?.factor || 1, 1))
    };
  }

  function populatePurchaseUnits() {
    if (!purchaseCatalogueSelect || !purchaseUnitSelect) return;
    const opt = purchaseCatalogueSelect.selectedOptions && purchaseCatalogueSelect.selectedOptions[0];
    const baseUnit = String(opt?.dataset?.baseUnit || 'piece').trim() || 'piece';
    const units = parseJsonAttr(opt?.dataset?.units, [{ name: baseUnit, factor: 1, isBase: true }]);
    const current = purchaseUnitSelect.value;

    purchaseUnitSelect.innerHTML = '';
    (Array.isArray(units) && units.length ? units : [{ name: baseUnit, factor: 1 }])
      .sort((a, b) => Number(a.factor || 0) - Number(b.factor || 0))
      .forEach(unit => {
        const name = String(unit.name || baseUnit).trim() || baseUnit;
        const factor = Math.max(1, numOr(unit.factor || 1, 1));
        const item = document.createElement('option');
        item.value = name;
        item.dataset.factor = String(factor);
        item.textContent = factor === 1 ? `${name} (base)` : `${name} = ${factor} ${baseUnit}`;
        purchaseUnitSelect.appendChild(item);
      });

    if (current && Array.from(purchaseUnitSelect.options).some(o => o.value === current)) {
      purchaseUnitSelect.value = current;
    }

    const selected = selectedPurchaseUnit();
    if (purchaseBaseUnitHint) {
      purchaseBaseUnitHint.textContent = selected.factor > 1
        ? `Cost per ${baseUnit}: unit cost / ${selected.factor}`
        : `Cost is per ${baseUnit}`;
    }
    updatePurchaseTotal();
  }

  function togglePurchaseCashBook() {
    const type = String(purchasePaymentType ? purchasePaymentType.value : 'cash').toLowerCase();
    const isCredit = type === 'credit';
    if (purchaseCashBookWrap) purchaseCashBookWrap.style.display = isCredit ? 'none' : '';
    const kind = isCredit ? '' : selectedCashBookKind();
    if (purchaseMomoFields) purchaseMomoFields.style.display = kind === 'momo' ? '' : 'none';
    if (purchaseBankFields) purchaseBankFields.style.display = kind === 'bank' ? '' : 'none';
  }

  function populatePurchaseCashBooks() {
    if (!purchaseCashBook) return;
    const current = purchaseCashBook.value;
    purchaseCashBook.innerHTML = '';

    if (!activeCashBooks.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No active cash books configured';
      purchaseCashBook.appendChild(opt);
      purchaseCashBook.disabled = true;
      togglePurchaseCashBook();
      return;
    }

    activeCashBooks.forEach(book => {
      const opt = document.createElement('option');
      opt.value = book._id;
      opt.dataset.kind = String(book.kind || 'cash').toLowerCase();
      opt.textContent = `${book.name} (${kindLabel(book.kind)})`;
      purchaseCashBook.appendChild(opt);
    });
    purchaseCashBook.disabled = false;
    if (current && activeCashBooks.some(b => String(b._id) === String(current))) purchaseCashBook.value = current;
    togglePurchaseCashBook();
  }

  async function loadCashBooksForPurchase() {
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
      console.error('loadCashBooksForPurchase error', err);
      activeCashBooks = [];
    }
    populatePurchaseCashBooks();
  }

  function resetSupplierForm() {
    if (supplierId) supplierId.value = '';
    if (supplierName) supplierName.value = '';
    if (supplierPhone) supplierPhone.value = '';
    if (supplierEmail) supplierEmail.value = '';
    if (supplierAddress) supplierAddress.value = '';
    if (supplierNotes) supplierNotes.value = '';
    if (supplierActive) supplierActive.checked = true;
    if (supplierFormTitle) supplierFormTitle.textContent = 'New supplier';
    if (saveSupplierBtn) {
      saveSupplierBtn.disabled = false;
      saveSupplierBtn.textContent = 'Save supplier';
    }
    setSupplierStatus('');
  }

  function renderSupplierRows(rows) {
    const tbody = suppliersTable ? suppliersTable.querySelector('tbody') : null;
    if (!tbody) return;
    if (!Array.isArray(rows) || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="5">No suppliers yet.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(s => {
      const active = s.active !== false;
      return `
        <tr data-supplier-id="${escapeHtml(s._id)}" data-name="${escapeHtml(s.name)}" data-phone="${escapeHtml(s.phone || '')}" data-email="${escapeHtml(s.email || '')}" data-address="${escapeHtml(s.address || '')}" data-notes="${escapeHtml(s.notes || '')}" data-active="${active ? '1' : '0'}" data-balance="${Number(s.balance || 0)}">
          <td class="fw-semibold text-white">${escapeHtml(s.name)}</td>
          <td class="text-muted-light">${escapeHtml(s.phone || '-')}</td>
          <td class="text-end">${escapeHtml(fmtMoney(s.balance || 0))}</td>
          <td>${active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">Inactive</span>'}</td>
          <td class="text-end">
            <div class="btn-group btn-group-sm">
              <a class="btn btn-outline-info supplier-account-link" href="/admin/suppliers/${encodeURIComponent(s._id)}/account" data-ajax="true">Account</a>
              <button class="btn btn-outline-light-custom edit-supplier" type="button">Edit</button>
              <button class="btn ${active ? 'btn-outline-warning' : 'btn-outline-success'} toggle-supplier" type="button" data-action="${active ? 'archive' : 'restore'}">${active ? 'Archive' : 'Restore'}</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderSupplierSelect(rows) {
    if (!purchaseSupplierSelect) return;
    const current = purchaseSupplierSelect.value;
    const activeRows = (rows || []).filter(s => s.active !== false);
    purchaseSupplierSelect.innerHTML = '';
    if (!activeRows.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No active suppliers';
      purchaseSupplierSelect.appendChild(opt);
      return;
    }
    activeRows.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s._id;
      opt.textContent = s.name;
      purchaseSupplierSelect.appendChild(opt);
    });
    if (current && activeRows.some(s => String(s._id) === String(current))) purchaseSupplierSelect.value = current;
  }

  async function loadSuppliers() {
    try {
      const res = await fetch('/admin/suppliers/api?all=1', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) throw new Error(j?.error || 'Failed to load suppliers');
      suppliersCache = Array.isArray(j.suppliers) ? j.suppliers : [];
      renderSupplierRows(suppliersCache);
      renderSupplierSelect(suppliersCache);
    } catch (err) {
      console.error('loadSuppliers error', err);
      setSupplierStatus(err.message || 'Failed to load suppliers', true);
    }
  }

  populatePurchaseUnits();
  updatePurchaseTotal();
  togglePurchaseCashBook();
  loadCashBooksForPurchase();
  loadSuppliers();

  if (purchaseCatalogueSelect && purchaseCatalogueSelect.dataset.unitsBound !== '1') {
    purchaseCatalogueSelect.dataset.unitsBound = '1';
    purchaseCatalogueSelect.addEventListener('change', populatePurchaseUnits);
  }

  if (purchaseUnitSelect && purchaseUnitSelect.dataset.bound !== '1') {
    purchaseUnitSelect.dataset.bound = '1';
    purchaseUnitSelect.addEventListener('change', populatePurchaseUnits);
  }

  if (purchaseQty && purchaseQty.dataset.bound !== '1') {
    purchaseQty.dataset.bound = '1';
    purchaseQty.addEventListener('input', updatePurchaseTotal);
  }

  if (purchaseUnitCost && purchaseUnitCost.dataset.bound !== '1') {
    purchaseUnitCost.dataset.bound = '1';
    purchaseUnitCost.addEventListener('input', updatePurchaseTotal);
  }

  if (purchasePaymentType && purchasePaymentType.dataset.bound !== '1') {
    purchasePaymentType.dataset.bound = '1';
    purchasePaymentType.addEventListener('change', togglePurchaseCashBook);
  }

  if (purchaseCashBook && purchaseCashBook.dataset.bound !== '1') {
    purchaseCashBook.dataset.bound = '1';
    purchaseCashBook.addEventListener('change', togglePurchaseCashBook);
  }

  if (recordPurchaseBtn && recordPurchaseBtn.dataset.bound !== '1') {
    recordPurchaseBtn.dataset.bound = '1';

    recordPurchaseBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const storeId = selectedStoreId();
      const supplierIdVal = String(purchaseSupplierSelect?.value || '').trim();
      const materialId = String(purchaseCatalogueSelect?.value || '').trim();
      const quantity = Math.floor(numOr(purchaseQty ? purchaseQty.value : 0, 0));
      const unitCost = numOr(purchaseUnitCost ? purchaseUnitCost.value : 0, 0);
      const purchaseUnit = selectedPurchaseUnit();
      const paymentType = String(purchasePaymentType?.value || 'cash').toLowerCase() === 'credit' ? 'credit' : 'cash';
      const cashBookId = String(purchaseCashBook?.value || '').trim();

      if (!storeId) return alert('Select a store first');
      if (!supplierIdVal) return alert('Select a supplier');
      if (!materialId) return alert('Select a catalogue item');
      if (!isFinite(quantity) || quantity <= 0) return alert('Quantity must be greater than zero');
      if (!isFinite(unitCost) || unitCost <= 0) return alert('Unit cost must be greater than zero');
      if (paymentType === 'cash' && !cashBookId) return alert('Select the cash book used for this purchase');

      recordPurchaseBtn.disabled = true;
      if (recordPurchaseSpinner) recordPurchaseSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('supplierId', supplierIdVal);
        body.append('materialId', materialId);
        body.append('quantity', String(quantity));
        body.append('unitCost', String(unitCost));
        body.append('purchaseUnitName', purchaseUnit.name);
        body.append('purchaseUnitFactor', String(purchaseUnit.factor));
        body.append('paymentType', paymentType);
        body.append('note', String(purchaseNote?.value || '').trim());
        if (paymentType === 'cash') {
          body.append('cashBookId', cashBookId);
          body.append('momoNumber', String(purchaseMomoNumber?.value || '').trim());
          body.append('momoTxId', String(purchaseMomoTxId?.value || '').trim());
          body.append('chequeNumber', String(purchaseChequeNumber?.value || '').trim());
          body.append('depositDetails', String(purchaseDepositDetails?.value || '').trim());
        }

        const res = await fetch(`/admin/stores/${encodeURIComponent(storeId)}/stocks/purchase`, {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        const j = await res.json().catch(() => null);
        if (res.status === 201 && j && j.ok) {
          showToast('Stock purchase recorded', 1200);
          window.location.reload();
        } else {
          alert((j && j.error) ? j.error : 'Failed to record stock purchase');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to record stock purchase');
      } finally {
        recordPurchaseBtn.disabled = false;
        if (recordPurchaseSpinner) recordPurchaseSpinner.style.display = 'none';
      }
    });
  }

  function openSuppliersModal() {
    loadSuppliers();
    bsShow(suppliersModalEl);
  }

  function openSupplierFormModal(row) {
    resetSupplierForm();
    if (row) {
      const id = String(row.dataset.supplierId || '').trim();
      if (supplierId) supplierId.value = id;
      if (supplierName) supplierName.value = row.dataset.name || '';
      if (supplierPhone) supplierPhone.value = row.dataset.phone || '';
      if (supplierEmail) supplierEmail.value = row.dataset.email || '';
      if (supplierAddress) supplierAddress.value = row.dataset.address || '';
      if (supplierNotes) supplierNotes.value = row.dataset.notes || '';
      if (supplierActive) supplierActive.checked = row.dataset.active !== '0';
      if (supplierFormTitle) supplierFormTitle.textContent = 'Edit supplier';
      if (saveSupplierBtn) saveSupplierBtn.textContent = 'Update supplier';
    }
    bsShow(supplierFormModalEl);
    setTimeout(() => supplierName?.focus(), 150);
  }

  [openSuppliersBtn, openSuppliersBtnInline].forEach(btn => {
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function (ev) {
      ev && ev.preventDefault && ev.preventDefault();
      openSuppliersModal();
    });
  });

  if (openSupplierFormBtn && openSupplierFormBtn.dataset.bound !== '1') {
    openSupplierFormBtn.dataset.bound = '1';
    openSupplierFormBtn.addEventListener('click', function (ev) {
      ev && ev.preventDefault && ev.preventDefault();
      openSupplierFormModal(null);
    });
  }

  if (refreshSuppliersBtn && refreshSuppliersBtn.dataset.bound !== '1') {
    refreshSuppliersBtn.dataset.bound = '1';
    refreshSuppliersBtn.addEventListener('click', function (ev) {
      ev && ev.preventDefault && ev.preventDefault();
      loadSuppliers();
    });
  }

  if (resetSupplierBtn && resetSupplierBtn.dataset.bound !== '1') {
    resetSupplierBtn.dataset.bound = '1';
    resetSupplierBtn.addEventListener('click', function (ev) {
      ev && ev.preventDefault && ev.preventDefault();
      bsHide(supplierFormModalEl);
      resetSupplierForm();
    });
  }

  if (supplierFormModalEl && supplierFormModalEl.dataset.bound !== '1') {
    supplierFormModalEl.dataset.bound = '1';
    supplierFormModalEl.addEventListener('hidden.bs.modal', function () {
      resetSupplierForm();
      if (suppliersModalEl && suppliersModalEl.classList.contains('show')) {
        document.body.classList.add('modal-open');
      }
    });
  }

  if (saveSupplierBtn && saveSupplierBtn.dataset.bound !== '1') {
    saveSupplierBtn.dataset.bound = '1';

    saveSupplierBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const id = String(supplierId?.value || '').trim();
      const name = String(supplierName?.value || '').trim();
      if (!name) {
        setSupplierStatus('Supplier name required', true);
        return;
      }

      saveSupplierBtn.disabled = true;
      const originalText = saveSupplierBtn.textContent;
      let saved = false;
      saveSupplierBtn.textContent = id ? 'Updating...' : 'Saving...';
      setSupplierStatus('');

      try {
        const payload = {
          name,
          phone: String(supplierPhone?.value || '').trim(),
          email: String(supplierEmail?.value || '').trim(),
          address: String(supplierAddress?.value || '').trim(),
          notes: String(supplierNotes?.value || '').trim(),
          active: supplierActive ? supplierActive.checked : true
        };

        const res = await fetch(id ? `/admin/suppliers/${encodeURIComponent(id)}` : '/admin/suppliers', {
          method: id ? 'PUT' : 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });

        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) throw new Error(j?.error || 'Failed to save supplier');

        showToast(id ? 'Supplier updated' : 'Supplier created', 1200);
        saved = true;
        bsHide(supplierFormModalEl);
        resetSupplierForm();
        await loadSuppliers();
      } catch (err) {
        console.error('save supplier error', err);
        setSupplierStatus(err.message || 'Failed to save supplier', true);
      } finally {
        saveSupplierBtn.disabled = false;
        if (!saved) saveSupplierBtn.textContent = originalText || 'Save supplier';
      }
    });
  }

  if (suppliersTable && suppliersTable.dataset.bound !== '1') {
    suppliersTable.dataset.bound = '1';
    suppliersTable.addEventListener('click', async function (ev) {
      const accountLink = ev.target.closest && ev.target.closest('.supplier-account-link');
      if (accountLink) {
        bsHide(supplierFormModalEl);
        bsHide(suppliersModalEl);
        return;
      }

      const editBtn = ev.target.closest && ev.target.closest('.edit-supplier');
      const toggleBtn = ev.target.closest && ev.target.closest('.toggle-supplier');
      if (!editBtn && !toggleBtn) return;

      ev.preventDefault();
      const row = ev.target.closest('tr');
      if (!row) return;

      const id = String(row.dataset.supplierId || '').trim();
      if (!id) return;

      if (editBtn) {
        openSupplierFormModal(row);
        return;
      }

      const action = String(toggleBtn.dataset.action || '').toLowerCase() === 'restore' ? 'restore' : 'archive';
      const name = row.dataset.name || 'this supplier';
      if (!confirm(action === 'archive' ? `Archive ${name}?` : `Restore ${name}?`)) return;

      toggleBtn.disabled = true;
      try {
        const res = await fetch(`/admin/suppliers/${encodeURIComponent(id)}/${action}`, {
          method: 'PATCH',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'same-origin'
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) throw new Error(j?.error || `Failed to ${action} supplier`);
        showToast(action === 'archive' ? 'Supplier archived' : 'Supplier restored', 1200);
        if (supplierId && String(supplierId.value) === id) {
          bsHide(supplierFormModalEl);
          resetSupplierForm();
        }
        await loadSuppliers();
      } catch (err) {
        console.error('toggle supplier error', err);
        setSupplierStatus(err.message || `Failed to ${action} supplier`, true);
      } finally {
        toggleBtn.disabled = false;
      }
    });
  }

  // ----------------------------
  // Store selector -> reload page with storeId
  // ----------------------------
  if (storeSelect && storeSelect.dataset.bound !== '1') {
    storeSelect.dataset.bound = '1';
    storeSelect.addEventListener('change', function () {
      const sid = storeSelect.value;
      if (!sid) return;
      window.location.href = `/admin/stock?storeId=${encodeURIComponent(sid)}`;
    });
  }

  // ----------------------------
  // Set operational (requires confirmation)
  // ----------------------------
  if (setOperationalBtn && setOperationalBtn.dataset.bound !== '1') {
    setOperationalBtn.dataset.bound = '1';

    setOperationalBtn.addEventListener('click', function () {
      const sid = storeSelect ? storeSelect.value : '';
      if (!sid) return;

      // If modal missing, fallback to confirm()
      if (!operationalConfirmModalEl) {
        if (confirm('Set this store as the operational store? Orders will consume stock from it.')) {
          // directly call server
          (async () => {
            try {
              setOperationalBtn.disabled = true;
              const res = await fetch(`/admin/stores/${encodeURIComponent(sid)}/operational`, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
              });
              const j = await res.json().catch(() => null);
              if (res.ok) {
                showToast('Operational store updated', 1200);
                window.location.reload();
              } else {
                alert((j && j.error) ? j.error : 'Failed to set operational store');
              }
            } catch (err) {
              console.error(err);
              alert('Failed to set operational store');
            } finally {
              setOperationalBtn.disabled = false;
            }
          })();
        }
        return;
      }

      pendingOperationalStoreId = sid;

      const storeName = storeSelect?.selectedOptions?.[0]?.textContent?.trim() || 'this store';
      if (operationalConfirmMessage) {
        operationalConfirmMessage.textContent =
          `Set "${storeName}" as the operational store? Orders will consume stock from it.`;
      }

      bsShow(operationalConfirmModalEl);
    });
  }

  // Confirm set operational
  if (confirmSetOperationalBtn && confirmSetOperationalBtn.dataset.bound !== '1') {
    confirmSetOperationalBtn.dataset.bound = '1';

    confirmSetOperationalBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const sid = pendingOperationalStoreId;
      if (!sid) return;

      confirmSetOperationalBtn.disabled = true;

      try {
        const res = await fetch(`/admin/stores/${encodeURIComponent(sid)}/operational`, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const j = await res.json().catch(() => null);

        if (res.ok) {
          bsHide(operationalConfirmModalEl);
          showToast('Operational store updated', 1200);
          window.location.reload();
        } else {
          alert((j && j.error) ? j.error : 'Failed to set operational store');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to set operational store');
      } finally {
        confirmSetOperationalBtn.disabled = false;
        pendingOperationalStoreId = null;
      }
    });
  }

  // ----------------------------
  // Create store modal open
  // ----------------------------
  if (openCreateStoreBtn && createStoreModalEl && openCreateStoreBtn.dataset.bound !== '1') {
    openCreateStoreBtn.dataset.bound = '1';

    openCreateStoreBtn.addEventListener('click', function () {
      if (newStoreName) newStoreName.value = '';
      bsShow(createStoreModalEl);
    });
  }

  // Create store
  if (createStoreBtn && createStoreBtn.dataset.bound !== '1') {
    createStoreBtn.dataset.bound = '1';

    createStoreBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const name = String(newStoreName?.value || '').trim();
      if (!name) return alert('Store name required');

      createStoreBtn.disabled = true;
      if (createStoreSpinner) createStoreSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('name', name);

        const res = await fetch('/admin/stores', {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        const j = await res.json().catch(() => null);
        if (res.status === 201 && j && j.store) {
          bsHide(createStoreModalEl);
          showToast('Store created', 1200);
          window.location.href = `/admin/stock?storeId=${encodeURIComponent(j.store._id)}`;
        } else {
          alert((j && j.error) ? j.error : 'Failed to create store');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to create store');
      } finally {
        createStoreBtn.disabled = false;
        if (createStoreSpinner) createStoreSpinner.style.display = 'none';
      }
    });
  }

  // ----------------------------
  // Add catalogue to store
  // ----------------------------
  if (addToStoreBtn && addToStoreBtn.dataset.bound !== '1') {
    addToStoreBtn.dataset.bound = '1';

    addToStoreBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const storeId = selectedStoreId();
      if (!storeId) return alert('No store selected');

      const materialId = catalogueSelect ? catalogueSelect.value : '';
      if (!materialId) return alert('Select a catalogue item');

      let stockInitial = numOr(initialStockInput ? initialStockInput.value : 0, 0);
      stockInitial = Math.floor(Math.max(0, stockInitial));

      addToStoreBtn.disabled = true;
      if (addToStoreSpinner) addToStoreSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('materialId', materialId);
        body.append('stockInitial', String(stockInitial));

        const res = await fetch(`/admin/stores/${encodeURIComponent(storeId)}/stocks`, {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        const j = await res.json().catch(() => null);
        if (res.status === 201) {
          showToast('Added to store', 1200);
          window.location.reload();
        } else {
          alert((j && j.error) ? j.error : 'Failed to add to store');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to add to store');
      } finally {
        addToStoreBtn.disabled = false;
        if (addToStoreSpinner) addToStoreSpinner.style.display = 'none';
      }
    });
  }

  // ----------------------------
  // Delegated click handlers (dropdown-safe)
  // ----------------------------
  // Reset delegated handlers so we don't stack listeners across AJAX loads
  if (window.__storeStockHandlers) {
    const h = window.__storeStockHandlers;
    try { document.removeEventListener('click', h.onAdjustClick); } catch (e) {}
    try { document.removeEventListener('click', h.onTransferClick); } catch (e) {}
    try { document.removeEventListener('click', h.onViewActivityClick); } catch (e) {}
    try { document.removeEventListener('click', h.onRemoveStockClick); } catch (e) {}
    try { document.removeEventListener('click', h.onLotBreakdownClick); } catch (e) {}
  }

  function closeLotBreakdowns(exceptWrap) {
    document.querySelectorAll('.stock-lot-wrap.is-open').forEach(function (wrap) {
      if (exceptWrap && wrap === exceptWrap) return;
      wrap.classList.remove('is-open');
      const trigger = wrap.querySelector('.stock-lot-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  const onLotBreakdownClick = function (e) {
    const trigger = e.target.closest && e.target.closest('.stock-lot-trigger');
    if (!trigger) {
      if (!(e.target.closest && e.target.closest('.stock-lot-wrap'))) closeLotBreakdowns(null);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const wrap = trigger.closest('.stock-lot-wrap');
    if (!wrap) return;
    const shouldOpen = !wrap.classList.contains('is-open');
    closeLotBreakdowns(wrap);
    wrap.classList.toggle('is-open', shouldOpen);
    trigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  };

  // Open adjust modal
  const onAdjustClick = function (e) {
    const btn = e.target.closest && e.target.closest('.adjust-stock-btn');
    if (!btn) return;

    e.preventDefault(); // important if used inside dropdown <a>

    if (!adjustModalEl || !adjustStockId || !adjustCurrentStock || !adjustStockInput) {
      alert('Adjust modal not available');
      return;
    }

    const stockId = btn.dataset.stockId;
    const stocked = numOr(btn.dataset.stocked, 0);

    adjustStockId.value = stockId;
    adjustCurrentStock.value = String(stocked);
    adjustStockInput.value = '';

    const deltaRadio = document.getElementById('adjustModeDelta');
    if (deltaRadio) deltaRadio.checked = true;

    bsShow(adjustModalEl);
  };

  // Save adjust
  if (saveAdjustBtn && saveAdjustBtn.dataset.bound !== '1') {
    saveAdjustBtn.dataset.bound = '1';

    saveAdjustBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const storeId = selectedStoreId();
      const stockId = adjustStockId ? adjustStockId.value : '';
      if (!storeId || !stockId) return;

      const mode = document.querySelector('input[name="adjustMode"]:checked')?.value || 'delta';
      const rawVal = String(adjustStockInput ? adjustStockInput.value : '').trim();

      const valNum = Number(rawVal);
      if (!isFinite(valNum)) return alert('Enter a valid number');

      saveAdjustBtn.disabled = true;
      if (saveAdjustSpinner) saveAdjustSpinner.style.display = 'inline-block';
      if (saveAdjustLabel) saveAdjustLabel.textContent = 'Saving…';

      try {
        const body = new URLSearchParams();
        body.append('mode', mode);
        body.append('stock', String(valNum));

        const res = await fetch(
          `/admin/stores/${encodeURIComponent(storeId)}/stocks/${encodeURIComponent(stockId)}/adjust`,
          {
            method: 'POST',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: body.toString()
          }
        );

        const j = await res.json().catch(() => null);
        if (res.ok && j && j.stock) {
          bsHide(adjustModalEl);
          showToast('Stock updated', 1200);
          window.location.reload();
        } else {
          alert((j && j.error) ? j.error : 'Failed to update stock');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to update stock');
      } finally {
        saveAdjustBtn.disabled = false;
        if (saveAdjustSpinner) saveAdjustSpinner.style.display = 'none';
        if (saveAdjustLabel) saveAdjustLabel.textContent = 'Save';
      }
    });
  }

  // Open transfer modal
  const onTransferClick = function (e) {
    const btn = e.target.closest && e.target.closest('.transfer-stock-btn');
    if (!btn) return;

    e.preventDefault();

    if (!transferModalEl || !transferStockId || !transferQty) {
      alert('Transfer modal not available');
      return;
    }

    const stockId = btn.dataset.stockId;
    transferStockId.value = stockId;
    transferQty.value = '1';

    bsShow(transferModalEl);
  };

  // Confirm transfer
  if (confirmTransferBtn && confirmTransferBtn.dataset.bound !== '1') {
    confirmTransferBtn.dataset.bound = '1';

    confirmTransferBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const storeId = selectedStoreId();
      const stockId = transferStockId ? transferStockId.value : '';
      const toStoreId = transferToStore ? transferToStore.value : '';
      let qty = numOr(transferQty ? transferQty.value : 0, 0);

      qty = Math.floor(qty);
      if (!storeId || !stockId || !toStoreId) return alert('Select destination store');
      if (!isFinite(qty) || qty <= 0) return alert('Quantity must be > 0');

      confirmTransferBtn.disabled = true;
      if (transferSpinner) transferSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('toStoreId', toStoreId);
        body.append('qty', String(qty));

        const res = await fetch(
          `/admin/stores/${encodeURIComponent(storeId)}/stocks/${encodeURIComponent(stockId)}/transfer`,
          {
            method: 'POST',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: body.toString()
          }
        );

        const j = await res.json().catch(() => null);
        if (res.ok) {
          bsHide(transferModalEl);
          showToast('Transferred', 1200);
          window.location.reload();
        } else {
          alert((j && j.error) ? j.error : 'Transfer failed');
        }
      } catch (err) {
        console.error(err);
        alert('Transfer failed');
      } finally {
        confirmTransferBtn.disabled = false;
        if (transferSpinner) transferSpinner.style.display = 'none';
      }
    });
  }

  // View activity
  const onViewActivityClick = async function (e) {
    const btn = e.target.closest && e.target.closest('.view-activity-btn');
    if (!btn) return;

    e.preventDefault();

    const storeId = selectedStoreId();
    const stockId = btn.dataset.stockId;
    if (!storeId || !stockId) return;

    if (activityMeta) activityMeta.textContent = 'Loading...';
    if (activityTbody) activityTbody.innerHTML = `<tr><td class="text-muted" colspan="5">Loading...</td></tr>`;

    bsShow(activityModalEl);

    try {
      const res = await fetch(
        `/admin/stores/${encodeURIComponent(storeId)}/stocks/${encodeURIComponent(stockId)}/activity`,
        { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
      );

      const j = await res.json().catch(() => null);
      if (!res.ok) {
        safeText(activityMeta, (j && j.error) ? j.error : 'Failed to load activity');
        return;
      }

      const events = Array.isArray(j.events) ? j.events : [];
      const current = j.current || null;

      if (activityMeta) {
        const storeName = j.store?.name || '';
        const matName = j.material?.name || '';
        const rem = (current && typeof current.remaining === 'number') ? current.remaining : '';
        activityMeta.textContent = `${matName} — ${storeName}${rem !== '' ? ` | Current remaining: ${rem}` : ''}`;
      }

      if (!events.length) {
        activityTbody.innerHTML = `<tr><td class="text-muted" colspan="5">No activity yet.</td></tr>`;
        return;
      }

      const rows = events.map(ev => {
        const d = ev.createdAt ? new Date(ev.createdAt) : null;
        const ds = d ? d.toLocaleString() : '';
        const type = String(ev.type || '');
        const delta = (ev.delta === null || ev.delta === undefined) ? '' : ev.delta;
        const bal = (ev.balance === null || ev.balance === undefined) ? '' : ev.balance;
        const detail = String(ev.details || '');

        return `<tr>
          <td class="text-muted-light">${escapeHtml(ds)}</td>
          <td class="text-muted-light">${escapeHtml(type)}</td>
          <td class="text-muted-light">${escapeHtml(String(delta))}</td>
          <td class="text-muted-light">${escapeHtml(String(bal))}</td>
          <td class="text-muted-light">${escapeHtml(detail)}</td>
        </tr>`;
      }).join('');

      activityTbody.innerHTML = rows;
    } catch (err) {
      console.error(err);
      safeText(activityMeta, 'Failed to load activity');
    }
  };

  // Remove stock item
  const onRemoveStockClick = function (e) {
    const btn = e.target.closest && e.target.closest('.remove-stock-btn');
    if (!btn) return;

    e.preventDefault();

    pendingRemoveStockId = btn.dataset.stockId;
    bsShow(deleteConfirmModalEl);
  };

  window.__storeStockHandlers = {
    onAdjustClick,
    onTransferClick,
    onViewActivityClick,
    onRemoveStockClick,
    onLotBreakdownClick
  };

  document.addEventListener('click', onLotBreakdownClick);
  document.addEventListener('click', onAdjustClick);
  document.addEventListener('click', onTransferClick);
  document.addEventListener('click', onViewActivityClick);
  document.addEventListener('click', onRemoveStockClick);

  if (confirmDeleteBtn && confirmDeleteBtn.dataset.bound !== '1') {
    confirmDeleteBtn.dataset.bound = '1';

    confirmDeleteBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const storeId = selectedStoreId();
      const stockId = pendingRemoveStockId;
      if (!storeId || !stockId) return;

      confirmDeleteBtn.disabled = true;
      try {
        const res = await fetch(`/admin/stores/${encodeURIComponent(storeId)}/stocks/${encodeURIComponent(stockId)}`, {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const j = await res.json().catch(() => null);

        if (res.ok) {
          bsHide(deleteConfirmModalEl);
          showToast('Removed', 1200);
          window.location.reload();
        } else {
          alert((j && j.error) ? j.error : 'Failed to remove');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to remove');
      } finally {
        confirmDeleteBtn.disabled = false;
        pendingRemoveStockId = null;
      }
    });
  }

  // ----------------------------
  // OPTIONAL: Manage Store (edit/delete) wiring
  // ----------------------------
  if (openManageStoreBtn && manageStoreModalEl && openManageStoreBtn.dataset.bound !== '1') {
    openManageStoreBtn.dataset.bound = '1';

    openManageStoreBtn.addEventListener('click', function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const sid = storeSelect ? storeSelect.value : '';
      if (!sid) return;

      const currentName = storeSelect?.selectedOptions?.[0]?.textContent?.trim() || '';
      if (editStoreId) editStoreId.value = sid;
      if (editStoreName) editStoreName.value = currentName;

      bsShow(manageStoreModalEl);
    });
  }

  if (saveStoreBtn && saveStoreBtn.dataset.bound !== '1') {
    saveStoreBtn.dataset.bound = '1';

    saveStoreBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const sid = String(editStoreId?.value || '').trim();
      const name = String(editStoreName?.value || '').trim();
      if (!sid) return;
      if (!name) return alert('Store name required');

      saveStoreBtn.disabled = true;
      if (saveStoreSpinner) saveStoreSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('name', name);

        const res = await fetch(`/admin/stores/${encodeURIComponent(sid)}`, {
          method: 'PUT',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        const j = await res.json().catch(() => null);
        if (res.ok) {
          bsHide(manageStoreModalEl);
          showToast('Store updated', 1200);
          window.location.reload();
        } else {
          alert((j && j.error) ? j.error : 'Failed to update store');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to update store');
      } finally {
        saveStoreBtn.disabled = false;
        if (saveStoreSpinner) saveStoreSpinner.style.display = 'none';
      }
    });
  }

  if (openDeleteStoreBtn && deleteStoreConfirmModalEl && openDeleteStoreBtn.dataset.bound !== '1') {
    openDeleteStoreBtn.dataset.bound = '1';

    openDeleteStoreBtn.addEventListener('click', function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const sid = String(editStoreId?.value || '').trim();
      if (!sid) return;

      pendingDeleteStoreId = sid;

      const nm = String(editStoreName?.value || '').trim() || 'this store';
      if (deleteStoreConfirmMessage) deleteStoreConfirmMessage.textContent = `Delete "${nm}" store?`;

      bsShow(deleteStoreConfirmModalEl);
    });
  }

  if (confirmDeleteStoreBtn && confirmDeleteStoreBtn.dataset.bound !== '1') {
    confirmDeleteStoreBtn.dataset.bound = '1';

    confirmDeleteStoreBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      const sid = pendingDeleteStoreId;
      if (!sid) return;

      confirmDeleteStoreBtn.disabled = true;

      try {
        const res = await fetch(`/admin/stores/${encodeURIComponent(sid)}`, {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });

        const j = await res.json().catch(() => null);
        if (res.ok) {
          bsHide(deleteStoreConfirmModalEl);
          bsHide(manageStoreModalEl);
          showToast('Store deleted', 1200);
          window.location.href = '/admin/stock';
        } else {
          alert((j && j.error) ? j.error : 'Failed to delete store');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to delete store');
      } finally {
        confirmDeleteStoreBtn.disabled = false;
        pendingDeleteStoreId = null;
      }
    });
  }

  // ----------------------------
  // Small HTML escape (used for activity rendering safety)
  // ----------------------------
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initStoreStockPage();
  }, { once: true });
} else {
  initStoreStockPage();
}

document.addEventListener('ajax:page:loaded', function () {
  initStoreStockPage();
});
