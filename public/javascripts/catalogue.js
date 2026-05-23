// public/javascripts/catalogue.js
function initCataloguePage() {
  'use strict';

  const createBtn = document.getElementById('createCatalogueBtn');
  if (!createBtn) return;
  if (createBtn.dataset.catalogueInit === '1') return;
  createBtn.dataset.catalogueInit = '1';

  const createSpinner = document.getElementById('createCatalogueSpinner');
  const nameEl = document.getElementById('cuName');
  const baseUnitNameEl = document.getElementById('baseUnitName');
  const stockUnitsTableBody = document.querySelector('#stockUnitsTable tbody');
  const addStockUnitRowBtn = document.getElementById('addStockUnitRowBtn');

  const unitConfigModal = document.getElementById('unitConfigModal');
  const unitMaterialId = document.getElementById('unitMaterialId');
  const unitMaterialName = document.getElementById('unitMaterialName');
  const unitBaseName = document.getElementById('unitBaseName');
  const unitConfigRows = document.getElementById('unitConfigRows');
  const addUnitConfigRowBtn = document.getElementById('addUnitConfigRowBtn');
  const saveUnitConfigBtn = document.getElementById('saveUnitConfigBtn');
  const saveUnitConfigSpinner = document.getElementById('saveUnitConfigSpinner');

  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  let pendingDeleteId = null;

  const unitCheckboxSelector = '.unit-sub-checkbox';

  function parseJsonAttr(raw, fallback) {
    try { return JSON.parse(raw || ''); } catch (e) { return fallback; }
  }

  function cleanUnitName(value, fallback) {
    const out = String(value || '').trim();
    return out || fallback || 'piece';
  }

  function unitSummary(baseUnit, units) {
    const base = cleanUnitName(baseUnit, 'piece');
    const list = Array.isArray(units) && units.length ? units : [{ name: base, factor: 1, isBase: true }];
    return list.map(u => {
      const name = cleanUnitName(u.name, base);
      const factor = Number(u.factor || 1);
      return factor === 1 ? `${name} (base)` : `${name} = ${factor} ${base}`;
    }).join(' | ');
  }

  function addUnitRow(tbody, unit) {
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'stock-unit-row';
    tr.innerHTML = `
      <td>
        <input class="form-control form-control-sm stock-unit-name" type="text" placeholder="e.g. ream" value="${escapeHtml(unit && unit.name ? unit.name : '')}">
      </td>
      <td>
        <input class="form-control form-control-sm stock-unit-factor" type="number" min="1.000001" step="0.000001" placeholder="e.g. 500" value="${escapeHtml(unit && unit.factor ? unit.factor : '')}">
      </td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-danger remove-stock-unit-row" type="button">Remove</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  function gatherStockUnits(tbody, baseUnitValue) {
    const base = cleanUnitName(baseUnitValue, 'piece');
    const out = [{ name: base, factor: 1, isBase: true }];
    const seen = new Set([base.toLowerCase()]);
    (tbody ? tbody.querySelectorAll('.stock-unit-row') : []).forEach(row => {
      const name = cleanUnitName(row.querySelector('.stock-unit-name')?.value || '', '');
      const factor = Number(row.querySelector('.stock-unit-factor')?.value || 0);
      if (!name || !isFinite(factor) || factor <= 1) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, factor, isBase: false });
    });
    return out.sort((a, b) => Number(a.factor || 0) - Number(b.factor || 0));
  }

  function bindUnitRowRemoval(scope) {
    (scope || document).querySelectorAll('.remove-stock-unit-row').forEach(btn => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        btn.closest('tr')?.remove();
      });
    });
  }

  function seedDefaultUnitRows() {
    if (!stockUnitsTableBody || stockUnitsTableBody.dataset.seeded === '1') return;
    stockUnitsTableBody.dataset.seeded = '1';
    addUnitRow(stockUnitsTableBody, { name: 'ream', factor: 500 });
    addUnitRow(stockUnitsTableBody, { name: 'box/carton', factor: 2500 });
    bindUnitRowRemoval(stockUnitsTableBody);
  }

  // Single-selection per unit (bind per checkbox to avoid duplicate global handlers)
  document.querySelectorAll(unitCheckboxSelector).forEach(cb => {
    if (cb.dataset.bound === '1') return;
    cb.dataset.bound = '1';
    cb.addEventListener('change', function () {
      if (this.checked) {
        const unitId = this.dataset.unit;
        const others = document.querySelectorAll(`${unitCheckboxSelector}[data-unit="${unitId}"]`);
        others.forEach(o => { if (o !== this) o.checked = false; });
      }
    });
  });

  seedDefaultUnitRows();
  if (addStockUnitRowBtn && addStockUnitRowBtn.dataset.bound !== '1') {
    addStockUnitRowBtn.dataset.bound = '1';
    addStockUnitRowBtn.addEventListener('click', function () {
      addUnitRow(stockUnitsTableBody, {});
      bindUnitRowRemoval(stockUnitsTableBody);
    });
  }

  if (addUnitConfigRowBtn && addUnitConfigRowBtn.dataset.bound !== '1') {
    addUnitConfigRowBtn.dataset.bound = '1';
    addUnitConfigRowBtn.addEventListener('click', function () {
      addUnitRow(unitConfigRows, {});
      bindUnitRowRemoval(unitConfigRows);
    });
  }

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

  function bindDeleteButton(btn) {
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      pendingDeleteId = btn.dataset.id;

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
  }

  function bindConfigureUnitsButton(btn) {
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      const id = btn.dataset.id || '';
      const name = btn.dataset.name || 'Catalogue item';
      const base = cleanUnitName(btn.dataset.baseUnit, 'piece');
      const units = parseJsonAttr(btn.dataset.units, [{ name: base, factor: 1, isBase: true }]);

      if (unitMaterialId) unitMaterialId.value = id;
      if (unitMaterialName) unitMaterialName.textContent = name;
      if (unitBaseName) unitBaseName.value = base;
      if (unitConfigRows) {
        unitConfigRows.innerHTML = '';
        (Array.isArray(units) ? units : [])
          .filter(u => Number(u.factor || 1) > 1)
          .forEach(u => addUnitRow(unitConfigRows, u));
        bindUnitRowRemoval(unitConfigRows);
      }

      if (unitConfigModal) bootstrap.Modal.getOrCreateInstance(unitConfigModal).show();
    });
  }

  function updateCatalogueRowUnits(id, material) {
    const tr = document.querySelector(`tr[data-id="${id}"]`);
    if (!tr || !material) return;
    const base = cleanUnitName(material.baseUnitName, 'piece');
    const units = Array.isArray(material.stockUnits) && material.stockUnits.length
      ? material.stockUnits
      : [{ name: base, factor: 1, isBase: true }];
    const summary = tr.querySelector('.catalogue-unit-summary');
    if (summary) summary.textContent = unitSummary(base, units);
    const btn = tr.querySelector('.configure-units-btn');
    if (btn) {
      btn.dataset.baseUnit = base;
      btn.dataset.units = JSON.stringify(units);
    }
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
    const baseUnit = cleanUnitName(mat.baseUnitName, 'piece');
    const units = Array.isArray(mat.stockUnits) && mat.stockUnits.length
      ? mat.stockUnits
      : [{ name: baseUnit, factor: 1, isBase: true }];
    tr.innerHTML = `
      <td>
        <strong class="text-white">${escapeHtml(mat.name)}</strong>
        ${labels ? `<br/><small class="text-muted-light">${escapeHtml(labels)}</small>` : ''}
      </td>
      <td>
        <small class="text-muted-light catalogue-unit-summary">${escapeHtml(unitSummary(baseUnit, units))}</small>
      </td>
      <td class="text-center">
        <div class="d-inline-flex gap-2 justify-content-center flex-wrap">
          <button class="btn btn-sm btn-outline-light-custom configure-units-btn" data-id="${mat._id}" data-name="${escapeHtml(mat.name)}" data-base-unit="${escapeHtml(baseUnit)}" data-units="${escapeHtml(JSON.stringify(units))}" type="button">Units</button>
          <button class="btn btn-sm btn-outline-danger delete-catalogue-btn" data-id="${mat._id}" type="button">Delete</button>
        </div>
      </td>
    `;
    tbody.insertBefore(tr, tbody.firstChild);

    const delBtn = tr.querySelector('.delete-catalogue-btn');
    bindDeleteButton(delBtn);
    bindConfigureUnitsButton(tr.querySelector('.configure-units-btn'));
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
        const baseUnit = cleanUnitName(baseUnitNameEl?.value || 'piece', 'piece');
        body.append('baseUnitName', baseUnit);
        body.append('stockUnits', JSON.stringify(gatherStockUnits(stockUnitsTableBody, baseUnit)));

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
          if (baseUnitNameEl) baseUnitNameEl.value = 'piece';
          if (stockUnitsTableBody) {
            stockUnitsTableBody.innerHTML = '';
            stockUnitsTableBody.dataset.seeded = '';
            seedDefaultUnitRows();
          }
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

  // Bind delete buttons for existing rows
  document.querySelectorAll('.delete-catalogue-btn').forEach(btn => bindDeleteButton(btn));
  document.querySelectorAll('.configure-units-btn').forEach(btn => bindConfigureUnitsButton(btn));

  if (saveUnitConfigBtn && saveUnitConfigBtn.dataset.bound !== '1') {
    saveUnitConfigBtn.dataset.bound = '1';
    saveUnitConfigBtn.addEventListener('click', async function (ev) {
      ev.preventDefault();
      const id = String(unitMaterialId?.value || '').trim();
      const baseUnit = cleanUnitName(unitBaseName?.value || 'piece', 'piece');
      if (!id) return;

      saveUnitConfigBtn.disabled = true;
      if (saveUnitConfigSpinner) saveUnitConfigSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('baseUnitName', baseUnit);
        body.append('stockUnits', JSON.stringify(gatherStockUnits(unitConfigRows, baseUnit)));

        const res = await fetch(`/admin/materials/${encodeURIComponent(id)}/units`, {
          method: 'PUT',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });
        const j = await res.json().catch(() => null);
        if (res.ok && j && j.material) {
          updateCatalogueRowUnits(id, j.material);
          bootstrap.Modal.getInstance(unitConfigModal)?.hide();
        } else {
          alert((j && j.error) ? j.error : 'Failed to save units');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to save units');
      } finally {
        saveUnitConfigBtn.disabled = false;
        if (saveUnitConfigSpinner) saveUnitConfigSpinner.style.display = 'none';
      }
    });
  }

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

  if (confirmDeleteBtn && confirmDeleteBtn.dataset.bound !== '1') {
    confirmDeleteBtn.dataset.bound = '1';
    confirmDeleteBtn.addEventListener('click', function () {
      if (!pendingDeleteId) return;
      doDelete(pendingDeleteId);
      pendingDeleteId = null;
      bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal'))?.hide();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initCataloguePage();
  }, { once: true });
} else {
  initCataloguePage();
}

document.addEventListener('ajax:page:loaded', function () {
  initCataloguePage();
});
