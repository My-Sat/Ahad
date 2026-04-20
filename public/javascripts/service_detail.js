// public/javascripts/service_detail.js
// Handles Assign Price (AJAX), single-check-per-unit, Edit/Delete price rules with modal and action dropdowns.

function initServiceDetailPage() {
  'use strict';

  const root = document.getElementById('assign-price');
  if (!root) return;
  if (root.dataset.serviceDetailInit === '1') return;
  root.dataset.serviceDetailInit = '1';

  // ————— Robust capturing edit handler (creates modal if missing) —————
  (function installRobustEditHandler() {
    const createModalIfMissing = () => {
      let modalEl = document.getElementById('editPriceModal');
      if (modalEl) return modalEl;

      const html = `
<div class="modal fade" id="editPriceModal" tabindex="-1" aria-labelledby="editPriceModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <!-- add dark-surface to modal-content so your CSS targets it -->
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="editPriceModalLabel">Edit Price Rule</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <!-- wrap body content in dark-card-body so inputs inherit dark styles -->
      <div class="modal-body">
        <div class="dark-card-body">
          <form id="editPriceForm">
            <input type="hidden" id="editPriceId" name="priceId" />
            <div class="mb-3">
              <label class="form-label" for="editPriceTarget">Price Target</label>
              <select class="form-select form-select-dark" id="editPriceTarget" name="priceTarget">
                <option value="customer" selected>Customers</option>
                <option value="artist">Artist</option>
                <option value="organisation">Organisation</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label" for="editPriceInput">Price (GH₵)</label>
              <input class="form-control form-control-dark" type="number" step="0.01" id="editPriceInput" name="price" required />
              <div class="invalid-feedback">Please provide a valid price.</div>
            </div>
            <div class="mb-3">
              <label class="form-label" for="editPrice2Input">F/B Price (optional)</label>
              <input class="form-control form-control-dark" type="number" step="0.01" id="editPrice2Input" name="price2" />
            </div>
            <div class="mb-3">
              <label class="form-label" for="editCustomLabelInput">Optional Rule Name</label>
              <input class="form-control form-control-dark" type="text" id="editCustomLabelInput" name="customLabel" placeholder="Short display name" />
            </div>
            <div class="mb-2">
              <small class="text-muted" id="editSelectionLabel"></small>
            </div>
          </form>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-outline-light-custom" type="button" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary" type="button" id="saveEditPriceBtn">Save</button>
      </div>
    </div>
  </div>
</div>`.trim();

      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      return document.getElementById('editPriceModal');
    };

    async function wireSaveHandlerOnce() {
      const saveBtn = document.getElementById('saveEditPriceBtn');
      if (!saveBtn) return;
      if (saveBtn.dataset.bound === '1') return;
      saveBtn.dataset.bound = '1';

      saveBtn.addEventListener('click', async function () {
        const assignForm = document.getElementById('assign-price');
        const serviceId = assignForm ? (assignForm.getAttribute('action') || '').match(/\/admin\/services\/([^\/]+)\/prices/)?.[1] : null;
        const priceId = document.getElementById('editPriceId')?.value;
        const target = (document.getElementById('editPriceTarget')?.value || 'customer').toLowerCase();
        const newVal = document.getElementById('editPriceInput')?.value;
        const newP2 = document.getElementById('editPrice2Input')?.value;
        const newCustomLabel = document.getElementById('editCustomLabelInput')?.value || '';
        if (!serviceId || !priceId) { alert('Missing service or price id'); return; }
        if (!newVal || isNaN(newVal) || Number(newVal) < 0) { document.getElementById('editPriceInput').classList.add('is-invalid'); return; }

        try {
          saveBtn.disabled = true;
          const body = new URLSearchParams();
          body.append('price', String(Number(newVal)));
          if (newP2 !== undefined && newP2 !== null && String(newP2).trim() !== '') body.append('price2', String(Number(newP2)));
          else body.append('price2', '');
          body.append('customLabel', String(newCustomLabel).trim());
          body.append('priceTarget', target);

          const res = await fetch(`/admin/services/${serviceId}/prices/${priceId}`, {
            method: 'PUT',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: body.toString()
          });

          if (!res.ok) {
            const j = await res.json().catch(()=>null);
            alert((j && j.error) ? j.error : 'Update failed');
            return;
          }

          // hide modal (if present) and refresh prices fragment
          const modalEl = document.getElementById('editPriceModal');
          bootstrap.Modal.getInstance(modalEl)?.hide();

          // refresh '#pricesSection' via fetch and frag-replace
          const r = await fetch(`/admin/services/${serviceId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
          if (r.ok) {
            const txt = await r.text();
            const doc = new DOMParser().parseFromString(txt, 'text/html');
            const newSection = doc.querySelector('#pricesSection');
            const oldSection = document.querySelector('#pricesSection');
            if (newSection && oldSection && oldSection.parentNode) oldSection.parentNode.replaceChild(newSection, oldSection);
            else window.location.reload();
          } else {
            window.location.reload();
          }
        } catch (err) {
          console.error('save edit error', err);
          alert('Failed to save');
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    // capture-phase handler: create modal if missing, populate and show
    document.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('.edit-price-btn') : null;
      if (!btn) return;
      try { e.preventDefault(); e.stopPropagation(); } catch(_) {}
      const ds = btn.dataset || {};
      const modalEl = createModalIfMissing();
      // populate modal inputs
      const idEl = document.getElementById('editPriceId'); if (idEl) idEl.value = ds.priceId || '';
      const targetEl = document.getElementById('editPriceTarget');
      const pEl = document.getElementById('editPriceInput');
      const p2El = document.getElementById('editPrice2Input');
      function valuesForTarget(t) {
        const target = String(t || 'customer').toLowerCase();
        if (target === 'artist') return { p: ds.artistPrice || '', p2: ds.artistPrice2 || '' };
        if (target === 'organisation') return { p: ds.organisationPrice || '', p2: ds.organisationPrice2 || '' };
        return { p: ds.customerPrice || '', p2: ds.customerPrice2 || '' };
      }
      const initTarget = 'customer';
      const initial = valuesForTarget(initTarget);
      if (pEl) pEl.value = initial.p || '';
      if (p2El) p2El.value = initial.p2 || '';
      if (targetEl && targetEl.dataset.bound !== '1') {
        targetEl.dataset.bound = '1';
        targetEl.addEventListener('change', function () {
          const nextVals = valuesForTarget(this.value);
          if (pEl) pEl.value = nextVals.p || '';
          if (p2El) p2El.value = nextVals.p2 || '';
        });
      }
      if (targetEl) targetEl.value = initTarget;
      const cEl = document.getElementById('editCustomLabelInput'); if (cEl) cEl.value = ds.customLabel || '';
      const labelEl = document.getElementById('editSelectionLabel'); if (labelEl) labelEl.textContent = ds.selectionLabel || '';
      wireSaveHandlerOnce();
      try {
        const md = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        md.show();
      } catch (err) {
        console.error('failed to show modal', err);
      }
    }, true);
  })();

  // ————— core helpers & elements —————
  const assignForm = document.getElementById('assign-price');
  const assignBtn = document.getElementById('assignBtn');
  const assignSpinner = document.getElementById('assignSpinner');
  const priceInput = document.getElementById('priceInput');
  const price2Input = document.getElementById('price2Input');
  const priceTargetInput = document.getElementById('priceTargetInput');
  const customLabelInput = document.getElementById('customLabelInput');
  const pricesSectionSelector = '#pricesSection';
  const stagedPricesByTarget = {
    customer: { price: '', price2: '' },
    artist: { price: '', price2: '' },
    organisation: { price: '', price2: '' }
  };
  let activeStageTarget = 'customer';

  const serviceId = (function () {
    if (!assignForm) return null;
    const action = assignForm.getAttribute('action') || '';
    const m = action.match(/\/admin\/services\/([^\/]+)\/prices/);
    return m ? m[1] : null;
  })();

  function showToast(msg, delay = 2500) {
    if (window.showGlobalToast) return window.showGlobalToast(msg, delay);
    const toastEl = document.getElementById('assignToast');
    const toastBody = document.getElementById('assignToastBody');
    if (toastBody) toastBody.textContent = msg;
    if (toastEl && window.bootstrap && window.bootstrap.Toast) {
      const t = new bootstrap.Toast(toastEl, { delay });
      t.show();
    } else try { console.log('Toast:', msg); } catch(e) {}
  }

  function showError(msg) {
    if (window.showGlobalToast) {
      try {
        const container = document.getElementById('globalToastContainer') || (function () {
          const c = document.createElement('div');
          c.id = 'globalToastContainer';
          c.className = 'position-fixed';
          c.style.bottom = '1rem';
          c.style.right = '1rem';
          c.style.zIndex = '1080';
          document.body.appendChild(c);
          return c;
        })();

        const el = document.createElement('div');
        el.className = 'toast align-items-center text-bg-danger border-0';
        el.setAttribute('role','status');
        el.setAttribute('aria-live','polite');
        el.setAttribute('aria-atomic','true');

        const body = document.createElement('div');
        body.className = 'd-flex';
        const msgEl = document.createElement('div');
        msgEl.className = 'toast-body';
        msgEl.textContent = msg || 'Error';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-close btn-close-white me-2 m-auto';
        btn.setAttribute('data-bs-dismiss','toast');
        btn.setAttribute('aria-label','Close');

        body.appendChild(msgEl);
        body.appendChild(btn);
        el.appendChild(body);
        container.appendChild(el);

        if (window.bootstrap && window.bootstrap.Toast) {
          const t = new bootstrap.Toast(el, { delay: 4000 });
          t.show();
          el.addEventListener('hidden.bs.toast', function () { try { el.parentNode && el.parentNode.removeChild(el); } catch(e){} });
          return;
        }
      } catch (e) {
        console.error('showError toast failed', e);
      }
    }
    try { alert(msg || 'Error'); } catch (e) { console.error(msg); }
  }

  // Single selection per unit: when a checkbox checked, uncheck others within same unit
  document.addEventListener('change', function (e) {
    const cb = e.target;
    if (!cb || !cb.classList || !cb.classList.contains('unit-sub-checkbox')) return;
    if (cb.checked) {
      const unitId = cb.dataset.unit;
      const others = document.querySelectorAll(`.unit-sub-checkbox[data-unit="${unitId}"]`);
      others.forEach(o => { if (o !== cb) o.checked = false; });
    }
  }, true);

  function gatherSelections() {
    const checked = document.querySelectorAll('.unit-sub-checkbox:checked');
    const map = {};
    checked.forEach(cb => {
      const unit = cb.dataset.unit;
      const subUnit = cb.dataset.subunit;
      if (!unit || !subUnit) return;
      map[unit] = subUnit;
    });
    return Object.keys(map).map(u => ({ unit: u, subUnit: map[u] }));
  }

  function setAssignLoading(loading) {
    if (!assignBtn) return;
    assignBtn.disabled = !!loading;
    if (assignSpinner) assignSpinner.style.display = loading ? 'inline-block' : 'none';
  }

  function normalizeTarget(v) {
    const t = String(v || 'customer').toLowerCase();
    if (t === 'artist' || t === 'organisation') return t;
    return 'customer';
  }

  function targetHasStagedValue(targetRaw) {
    const t = normalizeTarget(targetRaw);
    const row = stagedPricesByTarget[t] || { price: '', price2: '' };
    const p = String(row.price || '').trim();
    const p2 = String(row.price2 || '').trim();
    return p !== '' || p2 !== '';
  }

  function refreshPriceTargetOptionBadges() {
    if (!priceTargetInput) return;
    const labels = {
      customer: 'Customers',
      artist: 'Artist',
      organisation: 'Organisation'
    };
    Array.from(priceTargetInput.options || []).forEach(opt => {
      const t = normalizeTarget(opt.value);
      const base = labels[t] || opt.textContent || '';
      opt.textContent = targetHasStagedValue(t) ? `${base} (Set)` : base;
    });
  }

  function stageCurrentTargetInputs() {
    const target = normalizeTarget(activeStageTarget);
    stagedPricesByTarget[target] = stagedPricesByTarget[target] || { price: '', price2: '' };
    stagedPricesByTarget[target].price = priceInput ? String(priceInput.value || '').trim() : '';
    stagedPricesByTarget[target].price2 = price2Input ? String(price2Input.value || '').trim() : '';
    refreshPriceTargetOptionBadges();
  }

  function loadInputsFromTarget(targetRaw) {
    const target = normalizeTarget(targetRaw);
    const vals = stagedPricesByTarget[target] || { price: '', price2: '' };
    if (priceInput) priceInput.value = vals.price || '';
    if (price2Input) price2Input.value = vals.price2 || '';
    activeStageTarget = target;
    if (priceTargetInput) priceTargetInput.value = target;
    refreshPriceTargetOptionBadges();
  }

  if (priceTargetInput && priceTargetInput.dataset.boundStage !== '1') {
    priceTargetInput.dataset.boundStage = '1';
    priceTargetInput.addEventListener('change', function () {
      stageCurrentTargetInputs();
      loadInputsFromTarget(this.value);
    });
  }
  if (priceInput && priceInput.dataset.boundStage !== '1') {
    priceInput.dataset.boundStage = '1';
    priceInput.addEventListener('input', stageCurrentTargetInputs);
  }
  if (price2Input && price2Input.dataset.boundStage !== '1') {
    price2Input.dataset.boundStage = '1';
    price2Input.addEventListener('input', stageCurrentTargetInputs);
  }
  loadInputsFromTarget('customer');

  function moveAccordionItem(item, direction) {
    if (!item || !item.parentElement) return;
    if (direction === 'up') {
      const prev = item.previousElementSibling;
      if (prev) item.parentElement.insertBefore(item, prev);
      return;
    }
    const next = item.nextElementSibling;
    if (next) item.parentElement.insertBefore(next, item);
  }

  if (!document.body.dataset.serviceDetailMoveUnitBound) {
    document.body.dataset.serviceDetailMoveUnitBound = '1';
    document.addEventListener('click', async function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('.move-unit-btn-detail') : null;
      if (!btn) return;
      e.preventDefault();

      const unitId = btn.dataset.unitId;
      const direction = btn.dataset.direction;
      if (!unitId || !direction) return;

      const item = btn.closest('.accordion-item');
      const prevHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
      try {
        const res = await fetch(`/admin/units/${encodeURIComponent(unitId)}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams({ direction }).toString()
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) {
          showError((j && j.error) ? j.error : 'Failed to reorder unit');
          return;
        }
        if (j.moved !== false) {
          moveAccordionItem(item, direction);
          showToast('Unit order updated', 1600);
        }
      } catch (err) {
        console.error('move unit failed', err);
        showError('Failed to reorder unit');
      } finally {
        btn.disabled = false;
        btn.innerHTML = prevHtml;
      }
    }, true);
  }

  async function refreshPricesSection() {
    if (!serviceId) return false;
    try {
      const res = await fetch(`/admin/services/${serviceId}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error('Failed to reload prices');
      const text = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const newSection = doc.querySelector(pricesSectionSelector);
      const oldSection = document.querySelector(pricesSectionSelector);
      if (newSection && oldSection && oldSection.parentNode) {
        oldSection.parentNode.replaceChild(newSection, oldSection);
        return true;
      }
      return false;
    } catch (err) {
      console.error('refreshPricesSection error', err);
      return false;
    }
  }

  // Add material (double-submit guard)
  (function initAddMaterialHandler() {
    const addMaterialForm = document.getElementById('add-material');
    if (!addMaterialForm) return;
    if (addMaterialForm.dataset.addMaterialBound === '1') return;
    addMaterialForm.dataset.addMaterialBound = '1';
    if (typeof window.__addMaterialPending === 'undefined') window.__addMaterialPending = false;
    const addMaterialBtn = document.getElementById('addMaterialBtn');

    addMaterialForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const selections = gatherSelections();
      if (!selections.length) {
        showError('Please select at least one sub-unit to define the material.');
        return;
      }

      const nameEl = document.getElementById('materialName');
      if (!nameEl || !nameEl.value.trim()) {
        showError('Provide a name for the material.');
        return;
      }

      const stockEl = document.getElementById('materialStock');
      let stockVal = 0;
      if (stockEl && stockEl.value !== '') {
        const v = Number(stockEl.value);
        stockVal = isNaN(v) ? 0 : v;
      }

      if (window.__addMaterialPending) return;
      window.__addMaterialPending = true;
      if (addMaterialBtn) { addMaterialBtn.disabled = true; addMaterialBtn.setAttribute('aria-disabled', 'true'); }

      try {
        const payload = new URLSearchParams();
        payload.append('name', String(nameEl.value).trim());
        payload.append('selections', JSON.stringify(selections));
        if (serviceId) payload.append('serviceId', serviceId);
        payload.append('stock', String(Math.floor(stockVal)));

        const res = await fetch('/admin/materials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: payload.toString()
        });

        if (!res.ok) {
          if (res.status === 409) {
            let json = null;
            try { json = await res.json(); } catch (e) {}
            const msg = json && json.error ? json.error : 'Material already defined';
            showError(msg);
            return;
          }
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json().catch(() => null);
            showError(j && j.error ? j.error : 'Failed to save material');
            return;
          }
          showError(`Failed to save material (status ${res.status})`);
          return;
        }

        try { await res.json().catch(()=>null); } catch(e){}
        if (nameEl) nameEl.value = '';
        if (stockEl) stockEl.value = '0';
        document.querySelectorAll('.unit-sub-checkbox:checked').forEach(cb => cb.checked = false);
        showToast('Material saved', 2500);
      } catch (err) {
        console.error('save material err', err);
        showError('Failed to save material');
      } finally {
        window.__addMaterialPending = false;
        if (addMaterialBtn) { addMaterialBtn.disabled = false; addMaterialBtn.removeAttribute('aria-disabled'); }
      }
    });
  })();

  async function handleAssignPriceSubmit(e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      const selections = gatherSelections();
      if (!selections.length) {
        if (priceInput) priceInput.classList.add('is-invalid');
        return;
      }
      stageCurrentTargetInputs();
      const customerPriceVal = String(stagedPricesByTarget.customer && stagedPricesByTarget.customer.price ? stagedPricesByTarget.customer.price : '').trim();
      if (!customerPriceVal || isNaN(customerPriceVal) || Number(customerPriceVal) < 0) {
        if (priceTargetInput) priceTargetInput.value = 'customer';
        loadInputsFromTarget('customer');
        if (priceInput) priceInput.classList.add('is-invalid');
        showError('Set a valid Customers price before assigning.');
        return;
      }
      const customLabelVal = customLabelInput && customLabelInput.value ? customLabelInput.value : '';
      const payload = new URLSearchParams();
      payload.append('selections', JSON.stringify(selections));
      payload.append('customerPrice', String(Number(customerPriceVal)));
      const customerPrice2Val = String(stagedPricesByTarget.customer && stagedPricesByTarget.customer.price2 ? stagedPricesByTarget.customer.price2 : '').trim();
      if (customerPrice2Val !== '' && !isNaN(customerPrice2Val) && Number(customerPrice2Val) >= 0) payload.append('customerPrice2', String(Number(customerPrice2Val)));

      const artistPriceVal = String(stagedPricesByTarget.artist && stagedPricesByTarget.artist.price ? stagedPricesByTarget.artist.price : '').trim();
      const artistPrice2Val = String(stagedPricesByTarget.artist && stagedPricesByTarget.artist.price2 ? stagedPricesByTarget.artist.price2 : '').trim();
      if (artistPriceVal !== '' && !isNaN(artistPriceVal) && Number(artistPriceVal) >= 0) payload.append('artistPrice', String(Number(artistPriceVal)));
      if (artistPrice2Val !== '' && !isNaN(artistPrice2Val) && Number(artistPrice2Val) >= 0) payload.append('artistPrice2', String(Number(artistPrice2Val)));

      const organisationPriceVal = String(stagedPricesByTarget.organisation && stagedPricesByTarget.organisation.price ? stagedPricesByTarget.organisation.price : '').trim();
      const organisationPrice2Val = String(stagedPricesByTarget.organisation && stagedPricesByTarget.organisation.price2 ? stagedPricesByTarget.organisation.price2 : '').trim();
      if (organisationPriceVal !== '' && !isNaN(organisationPriceVal) && Number(organisationPriceVal) >= 0) payload.append('organisationPrice', String(Number(organisationPriceVal)));
      if (organisationPrice2Val !== '' && !isNaN(organisationPrice2Val) && Number(organisationPrice2Val) >= 0) payload.append('organisationPrice2', String(Number(organisationPrice2Val)));

      payload.append('customLabel', String(customLabelVal).trim());
      try {
        setAssignLoading(true);
        const res = await fetch(assignForm.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: payload.toString()
        });
        if (res.ok) {
          await refreshPricesSection();
          // Keep selected sub-units intact so admins can quickly assign
          // Artist/Organisation prices for the same rule without reselecting.
          stagedPricesByTarget.customer = { price: '', price2: '' };
          stagedPricesByTarget.artist = { price: '', price2: '' };
          stagedPricesByTarget.organisation = { price: '', price2: '' };
          loadInputsFromTarget('customer');
          refreshPriceTargetOptionBadges();
          if (customLabelInput) customLabelInput.value = '';
          showToast('Price rule assigned', 2500);
        } else {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json().catch(() => null);
            showError((j && j.error) ? j.error : 'Assign failed');
          } else {
            const t = await res.text().catch(() => '');
            showError(t || 'Assign failed');
          }
        }
      } catch (err) {
        console.error('assign error', err);
        showError('Failed to assign price');
      } finally {
        setAssignLoading(false);
      }
  }

  // Assign price handler
  if (assignForm) {
    assignForm.addEventListener('submit', handleAssignPriceSubmit);
  }

  // Delete handling only (edit handled by capturing handler)
  // ----------------------
  // Robust Delete (modal-driven, creates modal if missing)
  // ----------------------
  (function installDeleteModalHandler() {
    // Create modal HTML if missing and return element
    function createDeleteModalIfMissing() {
      let dlg = document.getElementById('deleteConfirmModal');
      if (dlg) return dlg;

      const html = `
<div class="modal fade" id="deleteConfirmModal" tabindex="-1" aria-labelledby="deleteConfirmModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="deleteConfirmModalLabel">Confirm delete</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body">
        <div class="dark-card-body">
          <p id="deleteConfirmMessage">Delete this item?</p>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary btn-outline-light-custom" data-bs-dismiss="modal">Cancel</button>
        <button type="button" id="confirmDeleteBtn" class="btn btn-outline-danger">Delete</button>
      </div>
    </div>
  </div>
</div>`.trim();

      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      return document.getElementById('deleteConfirmModal');
    }

    // Bind confirm button action only once
    async function wireConfirmDeleteOnce() {
      const dlg = createDeleteModalIfMissing();
      const confirmBtn = document.getElementById('confirmDeleteBtn');
      if (!confirmBtn) return;
      if (confirmBtn.dataset.bound === '1') return;
      confirmBtn.dataset.bound = '1';

      confirmBtn.addEventListener('click', async function () {
        const priceId = confirmBtn._pendingPriceId;
        if (!priceId) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Deleting...';

        try {
          const res = await fetch(`/admin/services/${serviceId}/prices/${priceId}`, {
            method: 'DELETE',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });

          const dlgEl = document.getElementById('deleteConfirmModal');
          bootstrap.Modal.getInstance(dlgEl)?.hide();

          if (res.ok) {
            try {
              await refreshPricesSection();
              showToast('Price rule deleted', 1800);
            } catch (e) {
              console.error('refresh after delete failed', e);
              window.location.reload();
            }
          } else {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              const j = await res.json().catch(()=>null);
              alert((j && j.error) ? j.error : 'Delete failed');
            } else {
              alert('Delete failed');
            }
          }
        } catch (err) {
          console.error('confirm delete error', err);
          alert('Failed to delete (network error)');
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Delete';
          confirmBtn._pendingPriceId = null;
        }
      });
    }

    // Capture-phase delegated click: open delete modal and set pending id
    document.addEventListener('click', function (e) {
      const delBtn = e.target && e.target.closest ? e.target.closest('.open-delete-price') : null;
      if (!delBtn) return;
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

      const priceId = delBtn.dataset.priceId;
      const selectionLabel = delBtn.dataset.selectionLabel || '';

      const dlg = createDeleteModalIfMissing();
      wireConfirmDeleteOnce();

      const msgEl = document.getElementById('deleteConfirmMessage');
      if (msgEl) {
        msgEl.textContent = selectionLabel ? `Delete price rule: ${selectionLabel}?` : 'Delete this price rule?';
      }
      const confirmBtn = document.getElementById('confirmDeleteBtn');
      if (confirmBtn) confirmBtn._pendingPriceId = priceId;

      try {
        const bs = bootstrap.Modal.getInstance(dlg) || new bootstrap.Modal(dlg);
        bs.show();
      } catch (err) {
        console.error('Failed to show delete modal', err);
        // fallback: simple confirm
        if (confirm('Delete this price rule?')) {
          fetch(`/admin/services/${serviceId}/prices/${priceId}`, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(r => r.ok ? refreshPricesSection().then(()=> showToast('Price rule deleted')) : window.location.reload())
            .catch(()=> window.location.reload());
        }
      }
    }, true);

    // expose helper for debugging (optional)
    window._svcDetail = window._svcDetail || {};
    window._svcDetail._wireConfirmDeleteOnce = wireConfirmDeleteOnce;

  })(); // installDeleteModalHandler

  // Confirm delete modal action
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async function () {
      const priceId = confirmDeleteBtn._pendingPriceId;
      if (!priceId) return;
      try {
        const res = await fetch(`/admin/services/${serviceId}/prices/${priceId}`, {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const dlg = document.getElementById('deleteConfirmModal');
        if (dlg) bootstrap.Modal.getInstance(dlg)?.hide();

        if (res.ok) {
          await refreshPricesSection();
          showToast('Price rule deleted', 2000);
        } else {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json().catch(() => null);
            alert((j && j.error) ? j.error : 'Delete failed');
          } else window.location.reload();
        }
      } catch (err) {
        console.error('delete price error', err);
        window.location.reload();
      } finally {
        confirmDeleteBtn._pendingPriceId = null;
      }
    });
  }

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initServiceDetailPage();
  }, { once: true });
} else {
  initServiceDetailPage();
}

document.addEventListener('ajax:page:loaded', function () {
  initServiceDetailPage();
});
