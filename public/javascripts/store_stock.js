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
  const selectedStoreId = () => (addForm ? addForm.dataset.storeId : '') || '';

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
  }

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
    onRemoveStockClick
  };

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
