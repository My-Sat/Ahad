// public/javascripts/catalogue.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const createBtn = document.getElementById('createCatalogueBtn');
  const createSpinner = document.getElementById('createCatalogueSpinner');
  const nameEl = document.getElementById('cuName');

  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  let pendingDeleteId = null;

  const unitCheckboxSelector = '.unit-sub-checkbox';

  // Single-selection per unit
  document.addEventListener('change', function (e) {
    const cb = e.target;
    if (!cb || !cb.classList || !cb.classList.contains('unit-sub-checkbox')) return;
    if (cb.checked) {
      const unitId = cb.dataset.unit;
      const others = document.querySelectorAll(`${unitCheckboxSelector}[data-unit="${unitId}"]`);
      others.forEach(o => { if (o !== cb) o.checked = false; });
    }
  }, true);

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

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, c => '&#' + c.charCodeAt(0) + ';');
  }

  function insertRow(mat) {
    const tbody = document.querySelector('table tbody');
    if (!tbody) return;

    const labels = (mat.selections || []).map(s => {
      const u = s.unit && s.unit.name ? s.unit.name : String(s.unit || '');
      const su = s.subUnit && s.subUnit.name ? s.subUnit.name : String(s.subUnit || '');
      return (u && su) ? `${u}: ${su}` : '';
    }).filter(Boolean).join(' + ');

    const tr = document.createElement('tr');
    tr.setAttribute('data-id', mat._id);
    tr.innerHTML = `
      <td>
        <strong class="text-white">${escapeHtml(mat.name)}</strong>
        ${labels ? `<br/><small class="text-muted-light">${escapeHtml(labels)}</small>` : ''}
      </td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-danger delete-catalogue-btn" data-id="${mat._id}" type="button">Delete</button>
      </td>
    `;
    tbody.insertBefore(tr, tbody.firstChild);
  }

  // Create
  if (createBtn) {
    createBtn.addEventListener('click', async function (ev) {
      ev.preventDefault();

      const name = String(nameEl?.value || '').trim();
      if (!name) return alert('Provide a name for the catalogue item.');

      const selections = gatherSelections();
      if (!selections.length) return alert('Select one sub-unit per unit.');

      createBtn.disabled = true;
      if (createSpinner) createSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('name', name);
        body.append('selections', JSON.stringify(selections));

        const res = await fetch('/admin/materials', {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        const j = await res.json().catch(() => null);

        if (res.status === 201 && j && j.material) {
          insertRow(j.material);
          nameEl.value = '';
          document.querySelectorAll(`${unitCheckboxSelector}:checked`).forEach(cb => cb.checked = false);
        } else if (res.status === 409) {
          alert((j && j.error) ? j.error : 'Duplicate catalogue');
        } else {
          alert((j && j.error) ? j.error : 'Failed to create catalogue');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to create catalogue');
      } finally {
        createBtn.disabled = false;
        if (createSpinner) createSpinner.style.display = 'none';
      }
    });
  }

  // Delete button click
  document.addEventListener('click', function (e) {
    const del = e.target.closest && e.target.closest('.delete-catalogue-btn');
    if (!del) return;
    pendingDeleteId = del.dataset.id;

    const dlg = document.getElementById('deleteConfirmModal');
    if (dlg) {
      const bs = bootstrap.Modal.getOrCreateInstance(dlg);
      const msg = document.getElementById('deleteConfirmMessage');
      if (msg) msg.textContent = 'Delete this catalogue item? This cannot be undone.';
      bs.show();
    } else {
      if (confirm('Delete this catalogue item?')) doDelete(pendingDeleteId);
    }
  });

  async function doDelete(id) {
    try {
      const res = await fetch(`/admin/materials/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const j = await res.json().catch(() => null);
      if (res.ok) {
        const tr = document.querySelector(`tr[data-id="${id}"]`);
        tr?.parentNode?.removeChild(tr);
      } else {
        alert((j && j.error) ? j.error : 'Failed to delete');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to delete');
    }
  }

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', function () {
      if (!pendingDeleteId) return;
      doDelete(pendingDeleteId);
      pendingDeleteId = null;
      bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal'))?.hide();
    });
  }
});
