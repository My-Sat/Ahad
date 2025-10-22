// public/javascripts/service_detail.js
// Handles Assign Price (AJAX), single-check-per-unit, Edit/Delete price rules with modal and action dropdowns.

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const assignForm = document.getElementById('assign-price');
  const assignBtn = document.getElementById('assignBtn');
  const assignSpinner = document.getElementById('assignSpinner');
  const priceInput = document.getElementById('priceInput');
  const price2Input = document.getElementById('price2Input');
  const pricesSectionSelector = '#pricesSection';

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
    } else {
      // fallback to alert if nothing else
      try { console.log('Toast:', msg); } catch(e) {}
    }
  }

  function showError(msg) {
    // prefer toast for errors, fall back to alert
    if (window.showGlobalToast) {
      // use a red/danger toast if possible by creating a transient element
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
    // ultimate fallback
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

  // Helper to gather selections (one per unit)
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

  // spinner toggle for Assign button
  function setAssignLoading(loading) {
    if (!assignBtn) return;
    assignBtn.disabled = !!loading;
    if (assignSpinner) assignSpinner.style.display = loading ? 'inline-block' : 'none';
  }

  // Replace prices section by fetching the service detail page fragment
  async function refreshPricesSection() {
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
      } else {
        window.location.reload();
      }
    } catch (err) {
      console.error('refreshPricesSection error', err);
      window.location.reload();
    }
  }

  // ----------------------------
  // Add material: guard against double-submit (global lock + binding guard)
  // ----------------------------
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

      // read stock value
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
        // NEW: send stock
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

        // success — clear form and uncheck checkboxes
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
  // ----------------------
  // Assign submit handler (AJAX)
  // ----------------------
  if (assignForm) {
    assignForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      // validation: at least one selection and valid price
      const selections = gatherSelections();
      if (!selections.length) {
        // show invalid visual
        if (priceInput) priceInput.classList.add('is-invalid');
        return;
      }
      const val = priceInput ? priceInput.value : '';
      if (!val || isNaN(val) || Number(val) < 0) {
        if (priceInput) priceInput.classList.add('is-invalid');
        return;
      }

      // optional price2
      const price2Val = price2Input && price2Input.value ? price2Input.value : '';

      const payload = new URLSearchParams();
      payload.append('selections', JSON.stringify(selections));
      payload.append('price', String(Number(val)));
      if (price2Val !== '') payload.append('price2', String(Number(price2Val)));

      try {
        setAssignLoading(true);
        const res = await fetch(assignForm.action, {
          method: 'POST',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: payload.toString()
        });

        if (res.ok) {
          await refreshPricesSection();
          document.querySelectorAll('.unit-sub-checkbox:checked').forEach(cb => cb.checked = false);
          if (priceInput) priceInput.value = '';
          if (price2Input) price2Input.value = '';
          showToast('Price rule assigned', 2500);
        } else {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json().catch(() => null);
            alert((j && j.error) ? j.error : 'Assign failed');
          } else {
            window.location.reload();
          }
        }
      } catch (err) {
        console.error('assign error', err);
        window.location.reload();
      } finally {
        setAssignLoading(false);
      }
    });
  }

  // ----------------------
  // Edit and Delete (dropdown-driven)
  // ----------------------

  // Edit modal wiring
  const editModalEl = document.getElementById('editPriceModal');
  const editModal = (editModalEl && window.bootstrap && window.bootstrap.Modal) ? new bootstrap.Modal(editModalEl) : null;
  const editPriceIdInput = document.getElementById('editPriceId');
  const editPriceField = document.getElementById('editPriceInput');
  const editPrice2Field = document.getElementById('editPrice2Input');
  const editSelectionLabel = document.getElementById('editSelectionLabel');
  const saveEditBtn = document.getElementById('saveEditPriceBtn');

  document.addEventListener('click', function (e) {
    // open edit modal
    const editBtn = e.target.closest('.edit-price-btn');
    if (editBtn) {
      e.preventDefault();
      const priceId = editBtn.dataset.priceId;
      const priceVal = editBtn.dataset.price;
      const price2Val = editBtn.dataset.price2;
      const label = editBtn.dataset.selectionLabel || '';

      if (editPriceIdInput) editPriceIdInput.value = priceId || '';
      if (editPriceField) {
        editPriceField.value = (priceVal !== undefined && priceVal !== null) ? priceVal : '';
        editPriceField.classList.remove('is-invalid');
      }
      if (editPrice2Field) {
        editPrice2Field.value = (price2Val !== undefined && price2Val !== null) ? price2Val : '';
      }
      if (editSelectionLabel) editSelectionLabel.textContent = label;
      if (editModal) editModal.show();
      return;
    }

    // prepare delete (use confirm modal instead of confirm())
    const delBtn = e.target.closest('.open-delete-price');
    if (delBtn) {
      e.preventDefault();
      const priceId = delBtn.dataset.priceId;
      // store pending deletion on the shared deleteConfirmModal confirm button
      const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
      if (!confirmDeleteBtn) {
        // fallback to simple confirm
        if (confirm('Delete this price rule?')) {
          fetch(`/admin/services/${serviceId}/prices/${priceId}`, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(r => r.ok ? refreshPricesSection().then(() => showToast('Price rule deleted')) : window.location.reload())
            .catch(() => window.location.reload());
        }
        return;
      }
      // attach handler once
      confirmDeleteBtn._pendingPriceId = priceId;
      // show the shared modal
      const dlg = document.getElementById('deleteConfirmModal');
      if (dlg) {
        const msgEl = document.getElementById('deleteConfirmMessage');
        if (msgEl) msgEl.textContent = 'Delete this price rule?';
        const bs = bootstrap.Modal.getInstance(dlg) || new bootstrap.Modal(dlg);
        bs.show();
      } else {
        if (confirm('Delete this price rule?')) {
          fetch(`/admin/services/${serviceId}/prices/${priceId}`, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(r => r.ok ? refreshPricesSection().then(() => showToast('Price rule deleted')) : window.location.reload())
            .catch(() => window.location.reload());
        }
      }
      return;
    }
  });

  // confirm delete modal action (shared modal)
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async function () {
      const priceId = confirmDeleteBtn._pendingPriceId;
      if (!priceId) return;
      // perform AJAX DELETE
      try {
        const res = await fetch(`/admin/services/${serviceId}/prices/${priceId}`, {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        // hide modal
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
          } else {
            window.location.reload();
          }
        }
      } catch (err) {
        console.error('delete price error', err);
        window.location.reload();
      } finally {
        confirmDeleteBtn._pendingPriceId = null;
      }
    });
  }

  // Save edited price (AJAX PUT)
  if (saveEditBtn) {
    saveEditBtn.addEventListener('click', async function () {
      const priceId = editPriceIdInput ? editPriceIdInput.value : null;
      const newVal = editPriceField ? editPriceField.value : null;
      const newP2 = editPrice2Field ? editPrice2Field.value : null;
      if (!priceId) return;
      if (!newVal || isNaN(newVal) || Number(newVal) < 0) {
        if (editPriceField) editPriceField.classList.add('is-invalid');
        return;
      }

      try {
        saveEditBtn.disabled = true;
        const url = `/admin/services/${serviceId}/prices/${priceId}`;
        const body = new URLSearchParams();
        body.append('price', String(Number(newVal)));
        if (newP2 !== undefined && newP2 !== null && String(newP2).trim() !== '') {
          body.append('price2', String(Number(newP2)));
        } else {
          body.append('price2', '');
        }

        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
          },
          body: body.toString()
        });

        if (res.ok) {
          if (editModal) editModal.hide();
          await refreshPricesSection();
          showToast('Price updated', 2000);
        } else {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json().catch(() => null);
            alert((j && j.error) ? j.error : 'Update failed');
          } else {
            window.location.reload();
          }
        }
      } catch (err) {
        console.error('update price error', err);
        window.location.reload();
      } finally {
        saveEditBtn.disabled = false;
      }
    });
  }

});
