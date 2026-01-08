// public/javascripts/stock.js
// Robust stock page client with duplicate-response dedupe using selection keys.

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  // Elements
  const createForm = document.getElementById('create-count-unit');
  const createBtn = document.getElementById('createCountBtn');
  const createSpinner = document.getElementById('createCountSpinner');
  const nameEl = document.getElementById('cuName');
  const stockEl = document.getElementById('cuStock');
  const unitCheckboxSelector = '.unit-sub-checkbox';
  const adjustModalEl = document.getElementById('adjustStockModal');
  const adjustStockInput = document.getElementById('adjustStockInput');
  const adjustMaterialId = document.getElementById('adjustMaterialId');
  const saveAdjustBtn = document.getElementById('saveAdjustStockBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const adjustCurrentStock = document.getElementById('adjustCurrentStock');
  const saveAdjustSpinner = document.getElementById('saveAdjustSpinner');
  const saveAdjustLabel = document.getElementById('saveAdjustLabel');



  // Guards and dedupe sets
  let creatingPending = false;
  let pendingDeleteId = null;
  const pendingKeys = new Set(); // keys currently in-flight
  const createdKeys = new Set(); // keys created by this client recently

  // Small helpers
  const showToast = (msg, delay = 1600) => {
    if (window.showGlobalToast) return window.showGlobalToast(msg, delay);
    try { console.log('Toast:', msg); } catch (e) {}
  };

  // Prevent native form submit (Enter) for this form
  if (createForm && createForm.dataset.bound !== '1') {
    createForm.dataset.bound = '1';
    createForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      return false;
    }, true);
  }

  // Single-selection per unit: when a checkbox checked, uncheck others in same unit.
  document.addEventListener('change', function (e) {
    const cb = e.target;
    if (!cb || !cb.classList || !cb.classList.contains('unit-sub-checkbox')) return;
    if (cb.checked) {
      const unitId = cb.dataset.unit;
      const others = document.querySelectorAll(`${unitCheckboxSelector}[data-unit="${unitId}"]`);
      others.forEach(o => { if (o !== cb) o.checked = false; });
    }
  }, true);

  // Gather selections & compute stable key
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
  function computeKeyFromSelections(selections) {
    const parts = (selections || []).map(s => `${s.unit}:${s.subUnit}`);
    parts.sort();
    return parts.join('|');
  }

  // --- Create Count Unit (single AJAX POST, defensive + dedupe) ---
  if (createBtn && createBtn.dataset.bound !== '1') {
    createBtn.dataset.bound = '1';
    createBtn.addEventListener('click', async function (ev) {
      ev && ev.preventDefault && ev.preventDefault();

      if (creatingPending) return;
      creatingPending = true;
      createBtn.disabled = true;
      if (createSpinner) createSpinner.style.display = 'inline-block';

      try {
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

        // compute stable key (same algorithm server uses)
        const key = computeKeyFromSelections(selections);

        // If this exact key is already being created by this client, ignore second click
        if (pendingKeys.has(key)) {
          showToast('Creation in progress…', 1000);
          return;
        }

        // Mark pending
        pendingKeys.add(key);

        const body = new URLSearchParams();
        body.append('name', name);
        body.append('selections', JSON.stringify(selections));
        // Use 'stock' field (server expects req.body.stock)
        body.append('stock', String(Math.floor(Number(stocked) || 0)));

        const res = await fetch('/admin/materials', {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        const j = await res.json().catch(()=>null);

        if (res.status === 201) {
          // CREATED: success (prefer success message)
          pendingKeys.delete(key);
          createdKeys.add(key);
          showToast('Count unit added successfully', 1200);
          const mat = j && j.material ? j.material : null;
          if (mat) {
            insertMaterialRow(mat);
            clearCreateForm();
          } else {
            // fallback: reload to ensure consistency
            window.location.reload();
          }

          // remove created key after a short grace period — enough to cover raced 409
          setTimeout(() => createdKeys.delete(key), 5000);
        } else if (res.status === 409) {
          // Duplicate — decide user-visible message based on whether we created it
          const existing = j && (j.existing || j.existing) ? (j.existing || j.existing) : null;

          // If we just created it (createdKeys) or it was pending (pendingKeys), treat as success
          if (createdKeys.has(key) || pendingKeys.has(key)) {
            // This likely arrived after our successful 201 — show success and ensure row present
            pendingKeys.delete(key);
            createdKeys.add(key);
            showToast('Count unit added successfully', 1200);
            if (existing && existing._id) {
              if (!document.querySelector(`tr[data-id="${existing._id}"]`)) insertMaterialRow(existing);
            } else {
              // fallback: reload if we can't reconcile DOM
              // but try to avoid reload unless necessary
              setTimeout(() => {
                if (!document.querySelector('table tbody tr')) window.location.reload();
              }, 800);
            }
            clearCreateForm();
            setTimeout(() => createdKeys.delete(key), 5000);
          } else {
            // Not created by us — show non-blocking existing notice and insert existing doc if provided
            pendingKeys.delete(key);
            if (existing && existing._id) {
              if (!document.querySelector(`tr[data-id="${existing._id}"]`)) {
                insertMaterialRow(existing);
              }
              showToast('Count unit already exists', 1200);
            } else {
              // best-effort DOM match using selections label; fallback to toast
              try {
                const label = selections.map(s => {
                  const cb = document.querySelector(`.unit-sub-checkbox[data-unit="${s.unit}"][data-subunit="${s.subUnit}"]`);
                  const unitName = cb ? (cb.closest('.accordion-item')?.querySelector('.accordion-button')?.textContent || '') : '';
                  return unitName ? unitName.trim() : '';
                }).filter(Boolean).join(' + ');
                const found = Array.from(document.querySelectorAll('table tbody tr')).find(tr => {
                  return tr.textContent && label && tr.textContent.includes(label);
                });
                if (found) {
                  showToast('Count unit already exists', 1200);
                } else {
                  showToast((j && j.error) ? j.error : 'Count unit already exists', 1600);
                }
              } catch (ex) {
                showToast((j && j.error) ? j.error : 'Count unit already exists', 1600);
              }
            }
          }
        } else {
          pendingKeys.delete(key);
          const msg = (j && j.error) ? j.error : `Failed to create (status ${res.status})`;
          alert(msg);
        }
      } catch (err) {
        console.error('create count err', err);
        alert('Failed to create count unit');
      } finally {
        creatingPending = false;
        createBtn.disabled = false;
        if (createSpinner) createSpinner.style.display = 'none';
      }
    });
  }

  // clear form helper
  function clearCreateForm() {
    try {
      if (nameEl) nameEl.value = '';
      if (stockEl) stockEl.value = '0';
      document.querySelectorAll(`${unitCheckboxSelector}:checked`).forEach(cb => cb.checked = false);
    } catch (e) { /* noop */ }
  }

  // --- Insert material row (used after create or when server returns material) ---
  function insertMaterialRow(mat) {
    try {
      const tbody = document.querySelector('table tbody');
      if (!tbody) return;
      const stocked = (typeof mat.stock === 'number') ? mat.stock : 0;

      // compute used and remaining from aggregates if present on mat, otherwise attempt DOM/0
      const used = (typeof mat.used === 'number') ? mat.used : 0;
      const remaining = (typeof mat.remaining === 'number') ? mat.remaining : (stocked - used);

      const labels = (mat.selections || []).map(s => {
      const stocked =
        (typeof mat.stocked === 'number') ? mat.stocked :
        ((typeof mat.stock === 'number') ? mat.stock : 0);
        const subName = s.subUnit && s.subUnit.name ? s.subUnit.name : (s.subUnit ? String(s.subUnit) : '');
        return `${unitName}: ${subName}`;
      }).join(' + ');

      const tr = document.createElement('tr');
      tr.setAttribute('data-id', mat._id);

      tr.innerHTML = `
        <td>
          <strong class="text-white">${escapeHtml(mat.name)}</strong>
          ${ labels ? `<br/><small class="text-muted-light">${escapeHtml(labels)}</small>` : '' }
        </td>
        <td class="text-center stocked-cell">${stocked}</td>
        <td class="text-center used-cell">${used}</td>
        <td class="text-center remaining-cell">${remaining < 0 ? `<span class="text-danger">${remaining}</span>` : `<span>${remaining}</span>`}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-primary adjust-stock-btn" data-id="${mat._id}" data-stocked="${stocked}" type="button">Adjust</button>
          <button class="btn btn-sm btn-outline-danger ms-1 delete-material-btn" data-id="${mat._id}" type="button">Delete</button>
        </td>
      `;
      tbody.insertBefore(tr, tbody.firstChild);
    } catch (err) {
      console.error('insertMaterialRow error', err);
      window.location.reload();
    }
  }

  // small html escape
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }

  // --- Adjust & Delete handlers (same as before) ---
function openAdjustModal(id, stocked) {
  if (!adjustModalEl) {
    alert('Adjust modal not available');
    return;
  }

  const current = Number(stocked || 0);

  adjustMaterialId.value = id;
  adjustCurrentStock.value = current;
  adjustStockInput.value = '';

  // Default to delta mode
  const deltaRadio = document.getElementById('adjustModeDelta');
  if (deltaRadio) deltaRadio.checked = true;

  const md = bootstrap.Modal.getOrCreateInstance(adjustModalEl);
  md.show();
}

  document.addEventListener('click', function (e) {
    const a = e.target.closest && e.target.closest('.adjust-stock-btn');
    if (!a) return;
    const id = a.dataset.id;
    const stocked = a.dataset.stocked;
    openAdjustModal(id, stocked);
  });

  if (saveAdjustBtn && saveAdjustBtn.dataset.bound !== '1') {
    saveAdjustBtn.dataset.bound = '1';
saveAdjustBtn.addEventListener('click', async function (ev) {
  ev && ev.preventDefault && ev.preventDefault();

  // ---- helpers for button state ----
  function setSavingState(isSaving) {
    saveAdjustBtn.disabled = isSaving;
    if (saveAdjustSpinner) {
      saveAdjustSpinner.style.display = isSaving ? 'inline-block' : 'none';
    }
    if (saveAdjustLabel) {
      saveAdjustLabel.textContent = isSaving ? 'Saving…' : 'Save';
    }
  }

  const id = adjustMaterialId.value;
  if (!id) return;

  const mode = document.querySelector('input[name="adjustMode"]:checked')?.value || 'delta';
  const rawVal = String(adjustStockInput.value || '').trim();
  const currentStock = Number(adjustCurrentStock.value || 0);

  let finalStock;

  // ---- validation & computation ----
  if (mode === 'delta') {
    const delta = Number(rawVal);
    if (isNaN(delta)) {
      alert('Provide a valid delta value (e.g. +5 or -3).');
      setSavingState(false);
      return;
    }
    finalStock = currentStock + delta;
  } else {
    const abs = Number(rawVal);
    if (isNaN(abs)) {
      alert('Provide a valid absolute stock value.');
      setSavingState(false);
      return;
    }
    finalStock = abs;
  }

  if (finalStock < 0) {
    alert('Resulting stock cannot be negative.');
    setSavingState(false);
    return;
  }

  // ---- enter saving state ----
  setSavingState(true);

  try {
    const body = new URLSearchParams();
    body.append('stock', String(Math.floor(finalStock)));
    body.append('mode', mode); // NEW: tell server whether absolute reset is intended

    const res = await fetch(`/admin/materials/${encodeURIComponent(id)}/stock`, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: body.toString()
    });

    const j = await res.json().catch(() => null);

    if (res.ok) {
      const tr = document.querySelector(`tr[data-id="${id}"]`);

      if (tr) {
        const stockedCell = tr.querySelector('.stocked-cell');
        const usedCell = tr.querySelector('.used-cell');
        const remainingCell = tr.querySelector('.remaining-cell');

        // ---- Prefer server material if provided ----
        if (j && j.material) {
          const mat = j.material;

          const newStocked =
            (typeof mat.stocked === 'number') ? mat.stocked :
            ((typeof mat.stock === 'number') ? mat.stock : finalStock);

          if (stockedCell) stockedCell.textContent = newStocked;

          if (usedCell && typeof mat.used === 'number') {
            usedCell.textContent = mat.used;
          }

          if (remainingCell) {
            const rem = (typeof mat.remaining === 'number')
              ? mat.remaining
              : (newStocked - (Number(mat.used || 0)));

            remainingCell.innerHTML = rem < 0
              ? `<span class="text-danger">${rem}</span>`
              : `<span>${rem}</span>`;
          }

          const adjBtn = tr.querySelector('.adjust-stock-btn');
          if (adjBtn) adjBtn.dataset.stocked = newStocked;

        } else {
          // ---- Client-side fallback ----
          const used = Number(usedCell?.textContent || 0);
          const remaining = finalStock - used;

          if (stockedCell) stockedCell.textContent = finalStock;

          if (remainingCell) {
            remainingCell.innerHTML = remaining < 0
              ? `<span class="text-danger">${remaining}</span>`
              : `<span>${remaining}</span>`;
          }

          const adjBtn = tr.querySelector('.adjust-stock-btn');
          if (adjBtn) adjBtn.dataset.stocked = finalStock;
        }
      }

      bootstrap.Modal.getInstance(adjustModalEl)?.hide();
      showToast('Stock updated', 1200);

      // Keep hidden "current stock" in sync so subsequent delta math is correct
      adjustCurrentStock.value = String(
        (j && j.material && typeof j.material.stocked === 'number')
          ? j.material.stocked
          : Math.floor(finalStock)
      );
    } else {
      const msg = (j && j.error) ? j.error : 'Failed to update stock';
      alert(msg);
    }

  } catch (err) {
    console.error('adjust stock err', err);
    alert('Failed to update stock');
  } finally {
    // ---- always restore button ----
    setSavingState(false);
  }
});
  }

  document.addEventListener('click', function (e) {
    const delBtn = e.target.closest && e.target.closest('.delete-material-btn');
    if (!delBtn) return;
    const id = delBtn.dataset.id;
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
      const j = await res.json().catch(()=>null);
      if (res.ok) {
        const tr = document.querySelector(`tr[data-id="${id}"]`);
        if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
        showToast('Deleted', 1200);
      } else {
        alert((j && j.error) ? j.error : 'Failed to delete');
      }
    } catch (err) {
      console.error('delete err', err);
      alert('Failed to delete');
    }
  }

  if (confirmDeleteBtn && confirmDeleteBtn.dataset.bound !== '1') {
    confirmDeleteBtn.dataset.bound = '1';
    confirmDeleteBtn.addEventListener('click', function () {
      if (!pendingDeleteId) return;
      doDelete(pendingDeleteId);
      pendingDeleteId = null;
      const dlg = document.getElementById('deleteConfirmModal');
      bootstrap.Modal.getInstance(dlg)?.hide();
    });
  }
});
