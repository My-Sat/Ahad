// File: public/javascripts/stock.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  // Prevent native form submit (Enter) — defensive
  const createForm = document.getElementById('create-count-unit');
  if (createForm) {
    createForm.addEventListener('submit', function (e) {
      e.preventDefault();
      return false;
    }, { passive: false });
  }

  // Utility: gather one selection per unit
  function gatherSelections(root = document) {
    const checked = root.querySelectorAll('.unit-sub-checkbox:checked');
    const map = {};
    checked.forEach(cb => {
      const unit = cb.dataset.unit;
      const subUnit = cb.dataset.subunit;
      if (!unit || !subUnit) return;
      map[unit] = subUnit;
    });
    return Object.keys(map).map(u => ({ unit: u, subUnit: map[u] }));
  }

  // Ensure a global one-shot guard exists
  if (typeof window.__creatingCountUnit === 'undefined') window.__creatingCountUnit = false;

  // Defensive binding: replace the button node with a clone to remove any pre-existing handlers
  let createBtn = document.getElementById('createCountBtn');
  if (createBtn) {
    // replace node to remove duplicate handlers that may have been bound earlier
    const clone = createBtn.cloneNode(true);
    createBtn.parentNode.replaceChild(clone, createBtn);
    createBtn = clone;
  }

  if (createBtn) {
    createBtn.addEventListener('click', async function (ev) {
      // Defensive: stop propagation to avoid other handlers in the bubble chain
      try { ev.preventDefault(); ev.stopPropagation(); } catch (e) { /* ignore */ }

      if (window.__creatingCountUnit) {
        console.warn('Create already in progress, ignoring duplicate click.');
        return;
      }

      const nameEl = document.getElementById('cuName');
      const stockEl = document.getElementById('cuStock');

      if (!nameEl || !nameEl.value.trim()) {
        alert('Provide a name for the count unit.');
        return;
      }

      const selections = gatherSelections(document);
      if (!selections.length) {
        alert('Select at least one sub-unit (one per unit).');
        return;
      }

      let stock = 0;
      if (stockEl && stockEl.value !== '') {
        const v = Number(stockEl.value);
        stock = isNaN(v) ? 0 : Math.floor(v);
      }

      // one-shot guard + UI lock
      window.__creatingCountUnit = true;
      createBtn.disabled = true;
      const origText = createBtn.textContent;
      createBtn.textContent = 'Saving...';

      try {
        const payload = new URLSearchParams();
        payload.append('name', String(nameEl.value).trim());
        payload.append('selections', JSON.stringify(selections));
        payload.append('stock', String(stock));

        console.debug('POST /admin/materials', { name: nameEl.value.trim(), selections, stock });

        const res = await fetch('/admin/materials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: payload.toString()
        });

        // If created, reload to display the new row
        if (res.status === 201) {
          // small delay for UX (optional)
          window.location.reload();
          return;
        }

        // If duplicate, server returns 409 with { existing }
        if (res.status === 409) {
          let j = null;
          try { j = await res.json(); } catch (e) { /* ignore */ }
          console.warn('Create returned 409 (duplicate)', j);
          // Reload so the UI shows the existing unit
          window.location.reload();
          return;
        }

        // Other failures: show message (attempt to show JSON error)
        let j = null;
        try { j = await res.json(); } catch (e) { /* ignore */ }
        const errMsg = (j && j.error) ? j.error : `Failed to create count unit (status ${res.status})`;
        alert(errMsg);
      } catch (err) {
        console.error('create count unit error', err);
        alert('Failed to create count unit (network or server error)');
      } finally {
        window.__creatingCountUnit = false;
        createBtn.disabled = false;
        createBtn.textContent = origText;
      }
    }, { passive: false });
  }

  // Table actions (adjust, delete)
  const table = document.querySelector('table');
  if (!table) return;

  table.addEventListener('click', async function (e) {
    // Adjust
    const adj = e.target.closest('.adjust-stock-btn');
    if (adj) {
      const id = adj.dataset.id;
      const current = adj.closest('tr').querySelector('td:nth-child(2)').textContent.trim();
      let newVal = prompt('Set new stocked quantity (integer). Leave blank to cancel.', current);
      if (newVal === null) return;
      newVal = newVal.trim();
      if (newVal === '') return;
      const n = parseInt(newVal, 10);
      if (isNaN(n)) { alert('Invalid number'); return; }

      try {
        const res = await fetch(`/admin/materials/${encodeURIComponent(id)}/stock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ stock: n })
        });
        if (!res.ok) {
          const j = await res.json().catch(()=>null);
          alert(j && j.error ? j.error : 'Failed to update stock');
          return;
        }
        window.location.reload();
      } catch (err) {
        console.error('adjust stock err', err);
        alert('Failed to update stock');
      }
      return;
    }

    // Delete
    const del = e.target.closest('.delete-material-btn');
    if (del) {
      const id = del.dataset.id;
      if (!confirm('Delete this count unit? This will remove the tracked unit definition but NOT adjust aggregates.')) return;
      try {
        const res = await fetch(`/admin/materials/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!res.ok) {
          const j = await res.json().catch(()=>null);
          alert(j && j.error ? j.error : 'Failed to delete');
          return;
        }
        window.location.reload();
      } catch (err) {
        console.error('delete material err', err);
        alert('Failed to delete');
      }
      return;
    }
  });

});
