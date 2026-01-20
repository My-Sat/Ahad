// public/javascripts/store_stock.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const storeSelect = document.getElementById('storeSelect');
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

  // Adjust
  const adjustModalEl = document.getElementById('adjustStockModal');
  const adjustStockId = document.getElementById('adjustStockId');
  const adjustCurrentStock = document.getElementById('adjustCurrentStock');
  const adjustStockInput = document.getElementById('adjustStockInput');
  const saveAdjustBtn = document.getElementById('saveAdjustStockBtn');
  const saveAdjustSpinner = document.getElementById('saveAdjustSpinner');
  const saveAdjustLabel = document.getElementById('saveAdjustLabel');

  // Transfer
  const transferModalEl = document.getElementById('transferModal');
  const transferStockId = document.getElementById('transferStockId');
  const transferToStore = document.getElementById('transferToStore');
  const transferQty = document.getElementById('transferQty');
  const confirmTransferBtn = document.getElementById('confirmTransferBtn');
  const transferSpinner = document.getElementById('transferSpinner');

  // Activity
  const activityModalEl = document.getElementById('activityModal');
  const activityMeta = document.getElementById('activityMeta');
  const activityTbody = document.getElementById('activityTbody');

  // Remove confirm
  const deleteConfirmModalEl = document.getElementById('deleteConfirmModal');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  let pendingRemoveStockId = null;

  const selectedStoreId = () => (addForm ? addForm.dataset.storeId : '') || '';

  function showToast(msg, delay = 1500) {
    if (window.showGlobalToast) return window.showGlobalToast(msg, delay);
    try { console.log('Toast:', msg); } catch (e) {}
  }

  // store selector -> reload page with storeId
  if (storeSelect) {
    storeSelect.addEventListener('change', function () {
      const sid = storeSelect.value;
      if (!sid) return;
      window.location.href = `/admin/stock?storeId=${encodeURIComponent(sid)}`;
    });
  }

  // Set operational
  if (setOperationalBtn) {
    setOperationalBtn.addEventListener('click', async function () {
      const sid = storeSelect ? storeSelect.value : '';
      if (!sid) return;

      setOperationalBtn.disabled = true;
      try {
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
    });
  }

  // Create store modal open
  if (openCreateStoreBtn && createStoreModalEl) {
    openCreateStoreBtn.addEventListener('click', function () {
      newStoreName.value = '';
      bootstrap.Modal.getOrCreateInstance(createStoreModalEl).show();
    });
  }

  // Create store
  if (createStoreBtn) {
    createStoreBtn.addEventListener('click', async function () {
      const name = String(newStoreName.value || '').trim();
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
          bootstrap.Modal.getInstance(createStoreModalEl)?.hide();
          showToast('Store created', 1200);
          // go to new store
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

  // Add catalogue to store
  if (addToStoreBtn) {
    addToStoreBtn.addEventListener('click', async function (ev) {
      ev.preventDefault();

      const storeId = selectedStoreId();
      if (!storeId) return alert('No store selected');

      const materialId = catalogueSelect ? catalogueSelect.value : '';
      if (!materialId) return alert('Select a catalogue item');

      let stockInitial = Number(initialStockInput ? initialStockInput.value : 0);
      if (isNaN(stockInitial) || stockInitial < 0) stockInitial = 0;

      addToStoreBtn.disabled = true;
      if (addToStoreSpinner) addToStoreSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('materialId', materialId);
        body.append('stockInitial', String(Math.floor(stockInitial)));

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

  // Open adjust modal
  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('.adjust-stock-btn');
    if (!btn) return;

    const stockId = btn.dataset.stockId;
    const stocked = Number(btn.dataset.stocked || 0);

    adjustStockId.value = stockId;
    adjustCurrentStock.value = String(stocked);
    adjustStockInput.value = '';

    document.getElementById('adjustModeDelta').checked = true;

    bootstrap.Modal.getOrCreateInstance(adjustModalEl).show();
  });

  // Save adjust
  if (saveAdjustBtn) {
    saveAdjustBtn.addEventListener('click', async function (ev) {
      ev.preventDefault();

      const storeId = selectedStoreId();
      const stockId = adjustStockId.value;
      if (!storeId || !stockId) return;

      const mode = document.querySelector('input[name="adjustMode"]:checked')?.value || 'delta';
      const rawVal = String(adjustStockInput.value || '').trim();
      const current = Number(adjustCurrentStock.value || 0);

      let valNum = Number(rawVal);
      if (isNaN(valNum)) return alert('Enter a valid number');

      // In delta mode: send delta, in absolute: send absolute
      // server handles calculation
      saveAdjustBtn.disabled = true;
      if (saveAdjustSpinner) saveAdjustSpinner.style.display = 'inline-block';
      if (saveAdjustLabel) saveAdjustLabel.textContent = 'Saving…';

      try {
        const body = new URLSearchParams();
        body.append('mode', mode);
        body.append('stock', String(valNum));

        const res = await fetch(`/admin/stores/${encodeURIComponent(storeId)}/stocks/${encodeURIComponent(stockId)}/adjust`, {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        const j = await res.json().catch(() => null);
        if (res.ok && j && j.stock) {
          bootstrap.Modal.getInstance(adjustModalEl)?.hide();
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
  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('.transfer-stock-btn');
    if (!btn) return;

    const stockId = btn.dataset.stockId;
    transferStockId.value = stockId;
    transferQty.value = '1';

    bootstrap.Modal.getOrCreateInstance(transferModalEl).show();
  });

  // Confirm transfer
  if (confirmTransferBtn) {
    confirmTransferBtn.addEventListener('click', async function () {
      const storeId = selectedStoreId();
      const stockId = transferStockId.value;
      const toStoreId = transferToStore ? transferToStore.value : '';
      let qty = Number(transferQty ? transferQty.value : 0);

      qty = Math.floor(qty);
      if (!storeId || !stockId || !toStoreId) return alert('Select destination store');
      if (!isFinite(qty) || qty <= 0) return alert('Quantity must be > 0');

      confirmTransferBtn.disabled = true;
      if (transferSpinner) transferSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('toStoreId', toStoreId);
        body.append('qty', String(qty));

        const res = await fetch(`/admin/stores/${encodeURIComponent(storeId)}/stocks/${encodeURIComponent(stockId)}/transfer`, {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        const j = await res.json().catch(() => null);
        if (res.ok) {
          bootstrap.Modal.getInstance(transferModalEl)?.hide();
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
  document.addEventListener('click', async function (e) {
    const btn = e.target.closest && e.target.closest('.view-activity-btn');
    if (!btn) return;

    const storeId = selectedStoreId();
    const stockId = btn.dataset.stockId;
    if (!storeId || !stockId) return;

    if (activityMeta) activityMeta.textContent = 'Loading...';
    if (activityTbody) activityTbody.innerHTML = `<tr><td class="text-muted" colspan="4">Loading...</td></tr>`;

    bootstrap.Modal.getOrCreateInstance(activityModalEl).show();

    try {
      const res = await fetch(`/admin/stores/${encodeURIComponent(storeId)}/stocks/${encodeURIComponent(stockId)}/activity`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });

      const j = await res.json().catch(() => null);
      if (!res.ok) {
        activityMeta.textContent = (j && j.error) ? j.error : 'Failed to load activity';
        return;
      }

      const storeName = j.store?.name || '';
      const matName = j.material?.name || '';
      if (activityMeta) activityMeta.textContent = `${matName} — ${storeName}`;

      const events = Array.isArray(j.events) ? j.events : [];
      if (!events.length) {
        activityTbody.innerHTML = `<tr><td class="text-muted" colspan="4">No activity yet.</td></tr>`;
        return;
      }

      const rows = events.map(ev => {
        const d = ev.createdAt ? new Date(ev.createdAt) : null;
        const ds = d ? d.toLocaleString() : '';
        const type = ev.type || '';
        const qty = (ev.qty !== undefined && ev.qty !== null) ? ev.qty : '';
        let detail = ev.note || '';

        if (type === 'usage') {
          detail = `Order: ${ev.orderId || ''}`;
        } else if (type === 'transfer-in' || type === 'transfer-out') {
          detail = `${ev.from || ''} → ${ev.to || ''}`;
        }

        return `<tr>
          <td class="text-muted-light">${ds}</td>
          <td class="text-muted-light">${type}</td>
          <td class="text-muted-light">${qty}</td>
          <td class="text-muted-light">${detail}</td>
        </tr>`;
      }).join('');

      activityTbody.innerHTML = rows;
    } catch (err) {
      console.error(err);
      if (activityMeta) activityMeta.textContent = 'Failed to load activity';
    }
  });

  // Remove stock item
  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('.remove-stock-btn');
    if (!btn) return;

    pendingRemoveStockId = btn.dataset.stockId;
    bootstrap.Modal.getOrCreateInstance(deleteConfirmModalEl).show();
  });

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async function () {
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
          bootstrap.Modal.getInstance(deleteConfirmModalEl)?.hide();
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
});
