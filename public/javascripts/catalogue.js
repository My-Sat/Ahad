// public/javascripts/catalogue.js
function initCataloguePage() {
  'use strict';

  const createBtn = document.getElementById('createCatalogueBtn');
  if (!createBtn) return;
  if (createBtn.dataset.catalogueInit === '1') return;
  createBtn.dataset.catalogueInit = '1';

  const createSpinner = document.getElementById('createCatalogueSpinner');
  const nameEl = document.getElementById('cuName');
  const createCategoryEl = document.getElementById('cuCategory');
  const baseUnitNameEl = document.getElementById('baseUnitName');
  const stockUnitsTableBody = document.querySelector('#stockUnitsTable tbody');
  const addStockUnitRowBtn = document.getElementById('addStockUnitRowBtn');

  const unitConfigModal = document.getElementById('unitConfigModal');
  const unitMaterialId = document.getElementById('unitMaterialId');
  const unitMaterialNameInput = document.getElementById('unitMaterialNameInput');
  const unitMaterialCategory = document.getElementById('unitMaterialCategory');
  const unitBaseName = document.getElementById('unitBaseName');
  const unitConfigRows = document.getElementById('unitConfigRows');
  const addUnitConfigRowBtn = document.getElementById('addUnitConfigRowBtn');
  const saveUnitConfigBtn = document.getElementById('saveUnitConfigBtn');
  const saveUnitConfigSpinner = document.getElementById('saveUnitConfigSpinner');

  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  let pendingDeleteId = null;

  const categoryFilter = document.getElementById('catalogueCategoryFilter');
  const catalogueTableBody = document.getElementById('catalogueTableBody');
  const catalogueListSpinner = document.getElementById('catalogueListSpinner');
  const catalogueFilterStatus = document.getElementById('catalogueFilterStatus');
  const categoryModal = document.getElementById('catalogueCategoryModal');
  const manageCategoriesBtn = document.getElementById('manageCatalogueCategoriesBtn');
  const categoryManagerList = document.getElementById('catalogueCategoryManagerList');
  const newCategoryName = document.getElementById('newCatalogueCategoryName');
  const createCategoryBtn = document.getElementById('createCatalogueCategoryBtn');
  const createCategorySpinner = document.getElementById('createCatalogueCategorySpinner');
  const uncategorizedCategoryCount = document.getElementById('uncategorizedCategoryCount');
  let catalogueCategories = [];
  let catalogueRequestSerial = 0;

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
      const categoryId = btn.dataset.categoryId || 'uncategorized';
      const base = cleanUnitName(btn.dataset.baseUnit, 'piece');
      const units = parseJsonAttr(btn.dataset.units, [{ name: base, factor: 1, isBase: true }]);

      if (unitMaterialId) unitMaterialId.value = id;
      if (unitMaterialNameInput) unitMaterialNameInput.value = name;
      if (unitMaterialCategory) unitMaterialCategory.value = categoryId;
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

  function insertRow(mat, prepend = true) {
    const tbody = catalogueTableBody;
    if (!tbody) return;

    const labels = (mat.selections || []).map(s => {
      const u = s.unit && s.unit.name ? s.unit.name : String(s.unit || '');
      const su = s.subUnit && s.subUnit.name ? s.subUnit.name : String(s.subUnit || '');
      return (u && su) ? `${u}: ${su}` : '';
    }).filter(Boolean).join(' + ');

    const tr = document.createElement('tr');
    tr.setAttribute('data-id', mat._id);
    const categoryId = mat.category && mat.category._id ? String(mat.category._id) : 'uncategorized';
    tr.setAttribute('data-category-id', categoryId);
    const baseUnit = cleanUnitName(mat.baseUnitName, 'piece');
    const units = Array.isArray(mat.stockUnits) && mat.stockUnits.length
      ? mat.stockUnits
      : [{ name: baseUnit, factor: 1, isBase: true }];
    tr.innerHTML = `
      <td>
        <strong class="text-white catalogue-material-name">${escapeHtml(mat.name)}</strong>
        <br/><small class="text-muted-light">${labels ? escapeHtml(labels) : 'Standalone material'}</small>
      </td>
      <td>
        <small class="text-muted-light catalogue-unit-summary">${escapeHtml(unitSummary(baseUnit, units))}</small>
      </td>
      <td class="text-center">
        <div class="d-inline-flex gap-2 justify-content-center flex-wrap">
          <button class="btn btn-sm btn-outline-light-custom configure-units-btn" data-id="${mat._id}" data-name="${escapeHtml(mat.name)}" data-category-id="${escapeHtml(categoryId)}" data-base-unit="${escapeHtml(baseUnit)}" data-units="${escapeHtml(JSON.stringify(units))}" type="button">Edit</button>
          <button class="btn btn-sm btn-outline-danger delete-catalogue-btn" data-id="${mat._id}" type="button">Delete</button>
        </div>
      </td>
    `;
    if (prepend) tbody.insertBefore(tr, tbody.firstChild);
    else tbody.appendChild(tr);

    const delBtn = tr.querySelector('.delete-catalogue-btn');
    bindDeleteButton(delBtn);
    bindConfigureUnitsButton(tr.querySelector('.configure-units-btn'));
  }

  function renderCatalogueList(materials) {
    if (!catalogueTableBody) return;
    catalogueTableBody.innerHTML = '';
    const list = Array.isArray(materials) ? materials : [];
    if (!list.length) {
      catalogueTableBody.innerHTML = '<tr id="catalogueEmptyRow"><td class="text-muted" colspan="3">No catalogue items in this category.</td></tr>';
      return;
    }
    list.forEach(material => insertRow(material, false));
  }

  function categoryLabel(categoryId) {
    if (categoryId === 'uncategorized') return 'Uncategorized';
    const category = catalogueCategories.find(row => String(row._id) === String(categoryId));
    return category ? category.name : 'Selected category';
  }

  async function loadCatalogue(categoryId) {
    const selected = String(categoryId || categoryFilter?.value || 'uncategorized');
    const requestId = ++catalogueRequestSerial;
    if (catalogueListSpinner) catalogueListSpinner.style.display = 'inline-block';
    if (categoryFilter) categoryFilter.disabled = true;
    if (catalogueFilterStatus) catalogueFilterStatus.textContent = `Loading ${categoryLabel(selected)}...`;

    try {
      const res = await fetch(`/admin/materials?category=${encodeURIComponent(selected)}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
      });
      const data = await res.json().catch(() => null);
      if (requestId !== catalogueRequestSerial) return;
      if (!res.ok || !data || !data.ok) {
        throw new Error((data && data.error) || 'Failed to load catalogue items');
      }
      renderCatalogueList(data.materials);
      const count = Array.isArray(data.materials) ? data.materials.length : 0;
      if (catalogueFilterStatus) {
        catalogueFilterStatus.textContent = `${categoryLabel(selected)}: ${count} item${count === 1 ? '' : 's'}`;
      }
    } catch (err) {
      console.error(err);
      if (requestId === catalogueRequestSerial) {
        renderCatalogueList([]);
        if (catalogueFilterStatus) catalogueFilterStatus.textContent = err.message || 'Failed to load catalogue items';
      }
    } finally {
      if (requestId === catalogueRequestSerial) {
        if (catalogueListSpinner) catalogueListSpinner.style.display = 'none';
        if (categoryFilter) categoryFilter.disabled = false;
      }
    }
  }

  function replaceCategoryOptions(select, options) {
    if (!select) return;
    const current = String(options.selected || select.value || '');
    select.innerHTML = '';

    if (options.includeUncategorized) {
      const suffix = typeof options.uncategorizedCount === 'number'
        ? ` (${options.uncategorizedCount})`
        : '';
      select.add(new Option(`Uncategorized${suffix}`, 'uncategorized'));
    }

    catalogueCategories.forEach(category => {
      select.add(new Option(category.name, String(category._id)));
    });

    if (!catalogueCategories.length && !options.includeUncategorized) {
      select.add(new Option('Create a category first', ''));
      select.disabled = true;
      select.value = '';
      return;
    }

    select.disabled = false;
    const values = Array.from(select.options).map(option => option.value);
    select.value = values.includes(current)
      ? current
      : (values.includes(String(options.fallback || '')) ? String(options.fallback) : (values[0] || ''));
  }

  function renderCategoryManager() {
    if (!categoryManagerList) return;
    if (!catalogueCategories.length) {
      categoryManagerList.innerHTML = '<p class="text-muted-light mb-0" id="noCatalogueCategoriesMessage">No categories created yet.</p>';
      return;
    }

    categoryManagerList.innerHTML = catalogueCategories.map(category => {
      const count = Number(category.materialCount || 0);
      return `
        <div class="catalogue-category-manager-row border rounded p-2" data-category-id="${escapeHtml(category._id)}">
          <div class="row g-2 align-items-center">
            <div class="col-12 col-md">
              <input class="form-control form-control-sm catalogue-category-name" type="text" maxlength="100" value="${escapeHtml(category.name)}">
            </div>
            <div class="col-auto">
              <span class="badge bg-info text-dark catalogue-category-count">${count} item${count === 1 ? '' : 's'}</span>
            </div>
            <div class="col-auto">
              <button class="btn btn-sm btn-outline-light-custom save-catalogue-category-btn" type="button">Save</button>
            </div>
            <div class="col-auto">
              <button class="btn btn-sm btn-outline-danger delete-catalogue-category-btn" type="button">Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function refreshCategories(options = {}) {
    const filterValue = String(options.filterValue || categoryFilter?.value || 'uncategorized');
    const createValue = String(options.createValue || createCategoryEl?.value || '');
    const editValue = String(unitMaterialCategory?.value || 'uncategorized');
    const res = await fetch('/admin/catalogue-categories', {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.error) || 'Failed to load catalogue categories');
    }

    catalogueCategories = Array.isArray(data.categories) ? data.categories : [];
    const fallback = catalogueCategories.length ? String(catalogueCategories[0]._id) : 'uncategorized';
    replaceCategoryOptions(categoryFilter, {
      includeUncategorized: true,
      uncategorizedCount: Number(data.uncategorizedCount || 0),
      selected: filterValue,
      fallback
    });
    replaceCategoryOptions(createCategoryEl, {
      includeUncategorized: false,
      selected: createValue,
      fallback: filterValue !== 'uncategorized' ? filterValue : fallback
    });
    replaceCategoryOptions(unitMaterialCategory, {
      includeUncategorized: true,
      selected: editValue,
      fallback: 'uncategorized'
    });
    if (createBtn) createBtn.disabled = catalogueCategories.length === 0;
    if (uncategorizedCategoryCount) {
      const count = Number(data.uncategorizedCount || 0);
      uncategorizedCategoryCount.textContent = `${count} uncategorized`;
    }
    renderCategoryManager();
    return data;
  }

  if (categoryFilter && categoryFilter.dataset.bound !== '1') {
    categoryFilter.dataset.bound = '1';
    categoryFilter.addEventListener('change', function () {
      loadCatalogue(categoryFilter.value);
    });
  }

  if (manageCategoriesBtn && manageCategoriesBtn.dataset.bound !== '1') {
    manageCategoriesBtn.dataset.bound = '1';
    manageCategoriesBtn.addEventListener('click', function () {
      if (categoryModal) bootstrap.Modal.getOrCreateInstance(categoryModal).show();
      refreshCategories().catch(err => {
        console.error(err);
        alert(err.message || 'Failed to load catalogue categories');
      });
    });
  }

  async function createCatalogueCategory() {
    const name = String(newCategoryName?.value || '').trim();
    if (!name) return alert('Provide a category name.');
    if (createCategoryBtn) createCategoryBtn.disabled = true;
    if (createCategorySpinner) createCategorySpinner.style.display = 'inline-block';

    try {
      const body = new URLSearchParams({ name });
      const res = await fetch('/admin/catalogue-categories', {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: body.toString()
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.category) {
        throw new Error((data && data.error) || 'Failed to create catalogue category');
      }
      if (newCategoryName) newCategoryName.value = '';
      const id = String(data.category._id);
      await refreshCategories({ filterValue: id, createValue: id });
      if (categoryFilter) categoryFilter.value = id;
      if (createCategoryEl) createCategoryEl.value = id;
      await loadCatalogue(id);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to create catalogue category');
    } finally {
      if (createCategoryBtn) createCategoryBtn.disabled = false;
      if (createCategorySpinner) createCategorySpinner.style.display = 'none';
    }
  }

  if (createCategoryBtn && createCategoryBtn.dataset.bound !== '1') {
    createCategoryBtn.dataset.bound = '1';
    createCategoryBtn.addEventListener('click', createCatalogueCategory);
  }
  if (newCategoryName && newCategoryName.dataset.bound !== '1') {
    newCategoryName.dataset.bound = '1';
    newCategoryName.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      createCatalogueCategory();
    });
  }

  if (categoryManagerList && categoryManagerList.dataset.bound !== '1') {
    categoryManagerList.dataset.bound = '1';
    categoryManagerList.addEventListener('click', async function (event) {
      const row = event.target.closest('.catalogue-category-manager-row');
      if (!row) return;
      const id = String(row.dataset.categoryId || '');
      const saveBtn = event.target.closest('.save-catalogue-category-btn');
      const deleteBtn = event.target.closest('.delete-catalogue-category-btn');
      if (!saveBtn && !deleteBtn) return;

      if (saveBtn) {
        const name = String(row.querySelector('.catalogue-category-name')?.value || '').trim();
        if (!name) return alert('Provide a category name.');
        saveBtn.disabled = true;
        try {
          const res = await fetch(`/admin/catalogue-categories/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: new URLSearchParams({ name }).toString()
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error((data && data.error) || 'Failed to update category');
          await refreshCategories({ filterValue: categoryFilter?.value || id });
          if (catalogueFilterStatus) {
            const current = String(categoryFilter?.value || '');
            catalogueFilterStatus.textContent = `${categoryLabel(current)} catalogue items`;
          }
        } catch (err) {
          console.error(err);
          alert(err.message || 'Failed to update category');
          saveBtn.disabled = false;
        }
        return;
      }

      const category = catalogueCategories.find(item => String(item._id) === id);
      if (!confirm(`Delete ${category ? category.name : 'this category'}?`)) return;
      deleteBtn.disabled = true;
      try {
        const res = await fetch(`/admin/catalogue-categories/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || 'Failed to delete category');
        const nextFilter = String(categoryFilter?.value || '') === id ? '' : String(categoryFilter?.value || '');
        await refreshCategories({ filterValue: nextFilter });
        await loadCatalogue(categoryFilter?.value || 'uncategorized');
      } catch (err) {
        console.error(err);
        alert(err.message || 'Failed to delete category');
        deleteBtn.disabled = false;
      }
    });
  }

  // Create
  if (createBtn) {
    createBtn.addEventListener('click', async function (ev) {
      ev.preventDefault();

      const name = String(nameEl?.value || '').trim();
      if (!name) return alert('Provide a name for the catalogue item.');
      const categoryId = String(createCategoryEl?.value || '').trim();
      if (!categoryId) return alert('Create and select a catalogue category first.');

      const selections = gatherSelections();

      createBtn.disabled = true;
      if (createSpinner) createSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('name', name);
        body.append('categoryId', categoryId);
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
          nameEl.value = '';
          if (baseUnitNameEl) baseUnitNameEl.value = 'piece';
          if (stockUnitsTableBody) {
            stockUnitsTableBody.innerHTML = '';
            stockUnitsTableBody.dataset.seeded = '';
            seedDefaultUnitRows();
          }
          document.querySelectorAll(`${unitCheckboxSelector}:checked`).forEach(cb => cb.checked = false);
          await refreshCategories({ filterValue: categoryId, createValue: categoryId });
          if (categoryFilter) categoryFilter.value = categoryId;
          await loadCatalogue(categoryId);
        } else if (res.status === 409) {
          alert((j && j.error) ? j.error : 'Duplicate catalogue');
        } else {
          alert((j && j.error) ? j.error : 'Failed to create catalogue');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to create catalogue');
      } finally {
        createBtn.disabled = catalogueCategories.length === 0;
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
      const name = String(unitMaterialNameInput?.value || '').trim();
      const categoryId = String(unitMaterialCategory?.value || 'uncategorized');
      const baseUnit = cleanUnitName(unitBaseName?.value || 'piece', 'piece');
      if (!id) return;
      if (!name) return alert('Provide a name for the catalogue item.');

      saveUnitConfigBtn.disabled = true;
      if (saveUnitConfigSpinner) saveUnitConfigSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('name', name);
        body.append('categoryId', categoryId);
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
          bootstrap.Modal.getInstance(unitConfigModal)?.hide();
          const currentFilter = String(categoryFilter?.value || 'uncategorized');
          await refreshCategories({ filterValue: currentFilter, createValue: createCategoryEl?.value || '' });
          await loadCatalogue(currentFilter);
        } else {
          alert((j && j.error) ? j.error : 'Failed to save catalogue item');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to save catalogue item');
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
        const currentFilter = String(categoryFilter?.value || 'uncategorized');
        await refreshCategories({ filterValue: currentFilter });
        await loadCatalogue(currentFilter);
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

  refreshCategories().then(() => {
    const current = String(categoryFilter?.value || 'uncategorized');
    const count = catalogueTableBody
      ? catalogueTableBody.querySelectorAll('tr[data-id]').length
      : 0;
    if (catalogueFilterStatus) {
      catalogueFilterStatus.textContent = `${categoryLabel(current)}: ${count} item${count === 1 ? '' : 's'}`;
    }
  }).catch(err => {
    console.error('Failed to initialize catalogue categories', err);
  });
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
