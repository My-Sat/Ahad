// public/javascripts/stock.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const createBtn = document.getElementById('createCountBtn');
  const createSpinner = document.getElementById('createCountSpinner');
  const nameEl = document.getElementById('cuName');
  const stockEl = document.getElementById('cuStock');
  const unitCheckboxSelector = '.unit-sub-checkbox';
  let creatingPending = false;

  function qsFrom(obj) {
    const u = new URLSearchParams();
    Object.keys(obj).forEach(k => u.append(k, obj[k]));
    return u.toString();
  }

  function showToast(msg, delay = 2000) {
    if (window.showGlobalToast) return window.showGlobalToast(msg, delay);
    // fallback: small non-blocking toast
    try { alert(msg); } catch (e) { console.log(msg); }
  }

  // gather one selection per unit
  function gatherSelections() {
    const checked = document.querySelectorAll(`${unitCheckboxSelector}:checked`);
    const map = {};
    checked.forEach(cb => {
      const unit = cb.dataset.unit;
      const subUnit = cb.dataset.subunit;
      if (!unit || !subUnit) return;
      map[unit] = subUnit;
    });
    return Object.keys(map).map(u => ({ unit: u, subUnit: map[u] }));
  }

  // Create Count Unit
  if (createBtn) {
    createBtn.addEventListener('click', async function () {
      if (creatingPending) return;
      const name = nameEl ? String(nameEl.value || '').trim() : '';
      let stocked = stockEl ? stockEl.value : '';
      stocked = stocked === '' ? 0 : Number(stocked);
      if (!name) {
        alert('Provide a name for the count unit.');
        return;
      }
      const selections = gatherSelections();
      if (!selections.length) {
        alert('Select one sub-unit per unit to form the count unit selection set.');
        return;
      }

      creatingPending = true;
      if (createSpinner) createSpinner.style.display = 'inline-block';
      createBtn.disabled = true;

      try {
        const body = new URLSearchParams();
        body.append('name', name);
        body.append('selections', JSON.stringify(selections));
        body.append('stocked', String(Math.floor(Number(stocked) || 0)));

        const res = await fetch('/admin/materials', {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        const j = await res.json().catch(()=>null);
        if (res.ok) {
          showToast('Count unit created', 1800);
          // refresh the stock page to get server-calculated used/remaining
          window.location.reload();
        } else {
          if (res.status === 409) {
            alert((j && j.error) ? j.error : 'Duplicate count unit');
          } else {
            alert((j && j.error) ? j.error : 'Failed to create count unit');
          }
        }
      } catch (err) {
        console.error('create count err', err);
        alert('Failed to create count unit');
      } finally {
        creatingPending = false;
        if (createSpinner) createSpinner.style.display = 'none';
        createBtn.disabled = false;
      }
    });
  }

  // Adjust stock modal wiring
  const adjustModalEl = document.getElementById('adjustStockModal');
  const adjustStockForm = document.getElementById('adjustStockForm');
  const adjustStockInput = document.getElementById('adjustStockInput');
  const adjustMaterialId = document.getElementById('adjustMaterialId');
  const saveAdjustBtn = document.getElementById('saveAdjustStockBtn');

  function openAdjustModal(id, stocked) {
    if (!adjustModalEl) return;
    adjustMaterialId.value = id;
    adjustStockInput.value = Number(stocked || 0);
    const mdl = bootstrap.Modal.getOrCreateInstance(adjustModalEl);
    mdl.show();
  }

  // delegate Adjust button clicks
  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('.adjust-stock-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    const stocked = btn.dataset.stocked;
    openAdjustModal(id, stocked);
  });

  // Save adjusted stock
  if (saveAdjustBtn) {
    saveAdjustBtn.addEventListener('click', async function () {
      const id = adjustMaterialId.value;
      if (!id) return;
      let newVal = adjustStockInput.value;
      newVal = newVal === '' ? 0 : Number(newVal);
      if (isNaN(newVal) || newVal < 0) {
        alert('Provide a valid non-negative integer for stocked quantity.');
        return;
      }
      saveAdjustBtn.disabled = true;
      try {
        const body = new URLSearchParams();
        body.append('stock', String(Math.floor(newVal)));
        const res = await fetch(`/admin/materials/${encodeURIComponent(id)}/stock`, {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });
        const j = await res.json().catch(()=>null);
        if (res.ok) {
          // update UI row optimistically (stocked/remaining/used)
          // safer: reload the page region — we'll reload the whole page for consistency
          showToast('Stock updated', 1200);
          window.location.reload();
        } else {
          alert((j && j.error) ? j.error : 'Failed to update stock');
        }
      } catch (err) {
        console.error('adjust stock err', err);
        alert('Failed to update stock');
      } finally {
        saveAdjustBtn.disabled = false;
      }
    });
  }

  // Delete flow: reuse shared modal
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  let pendingDeleteId = null;

  document.addEventListener('click', function (e) {
    const del = e.target.closest && e.target.closest('.delete-material-btn');
    if (!del) return;
    const id = del.dataset.id;
    pendingDeleteId = id;
    const dlg = document.getElementById('deleteConfirmModal');
    if (dlg) {
      const bs = bootstrap.Modal.getOrCreateInstance(dlg);
      const msgEl = document.getElementById('deleteConfirmMessage');
      if (msgEl) msgEl.textContent = 'Delete this count unit? This cannot be undone.';
      bs.show();
    } else {
      if (confirm('Delete this count unit?')) {
        doDelete(id);
      }
    }
  });

  async function doDelete(id) {
    try {
      const res = await fetch(`/admin/materials/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (res.ok) {
        showToast('Deleted', 1200);
        // remove row or reload
        window.location.reload();
      } else {
        const j = await res.json().catch(()=>null);
        alert((j && j.error) ? j.error : 'Failed to delete');
      }
    } catch (err) {
      console.error('delete err', err);
      alert('Failed to delete');
    }
  }

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', function () {
      if (!pendingDeleteId) return;
      doDelete(pendingDeleteId);
      pendingDeleteId = null;
      // hide modal
      const dlg = document.getElementById('deleteConfirmModal');
      bootstrap.Modal.getInstance(dlg)?.hide();
    });
  }

});
