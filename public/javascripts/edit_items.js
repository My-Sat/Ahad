// public/javascripts/edit_items.js
// Production-ready edit modal wiring for Services, Units, Sub-units.
// - listens for clicks on dropdown-item.edit-*-btn
// - hides containing dropdown, then shows modal
// - performs AJAX PUT for edits and updates DOM or reloads as necessary

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  function hideContainingDropdown(el) {
    if (!el) return false;
    const dropdownRoot = el.closest('.dropdown');
    if (!dropdownRoot) return false;
    const toggle = dropdownRoot.querySelector('[data-bs-toggle="dropdown"]');
    if (!toggle) return false;
    let inst = bootstrap.Dropdown.getInstance(toggle);
    try {
      if (!inst) inst = new bootstrap.Dropdown(toggle);
      inst.hide();
      return true;
    } catch (e) {
      return false;
    }
  }

  function showModalById(modalId, prepareFn) {
    const modalEl = document.getElementById(modalId);
    if (!modalEl) return false;
    try {
      if (typeof prepareFn === 'function') {
        try { prepareFn(modalEl); } catch (e) { /* ignore prepare errors */ }
      }
      let inst = bootstrap.Modal.getInstance(modalEl);
      if (!inst) inst = new bootstrap.Modal(modalEl);
      inst.show();
      return true;
    } catch (e) {
      return false;
    }
  }

  // use global toast util if available
  function showToastMessage(msg, delay = 3000) {
    if (window.showGlobalToast) return window.showGlobalToast(msg, delay);
    const toastEl = document.getElementById('assignToast');
    const toastBody = document.getElementById('assignToastBody');
    if (toastBody) toastBody.textContent = msg;
    if (toastEl && window.bootstrap && window.bootstrap.Toast) {
      const t = new bootstrap.Toast(toastEl, { delay });
      t.show();
    } else {
      console.log('Toast:', msg);
    }
  }

  document.addEventListener('click', function (e) {
    // SERVICE edit
    const svcBtn = e.target.closest('.dropdown-item.edit-service-btn');
    if (svcBtn) {
      e.preventDefault();
      e.stopPropagation();
      hideContainingDropdown(svcBtn);
      showModalById('editServiceModal', () => {
        const id = svcBtn.dataset.serviceId;
        const name = svcBtn.dataset.serviceName || '';
        const idInput = document.getElementById('editServiceId');
        const nameInput = document.getElementById('editServiceName');
        if (idInput) idInput.value = id;
        if (nameInput) {
          nameInput.value = name;
          try { nameInput.focus(); nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length); } catch (err) {}
        }
      });
      return;
    }

    // UNIT edit
    const unitBtn = e.target.closest('.dropdown-item.edit-unit-btn');
    if (unitBtn) {
      e.preventDefault();
      e.stopPropagation();
      hideContainingDropdown(unitBtn);
      showModalById('editUnitModal', () => {
        const unitId = unitBtn.dataset.unitId;
        const unitName = unitBtn.dataset.unitName || '';
        const idInput = document.getElementById('editUnitId');
        const nameInput = document.getElementById('editUnitName');
        if (idInput) idInput.value = unitId;
        if (nameInput) {
          nameInput.value = unitName;
          try { nameInput.focus(); nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length); } catch (err) {}
        }
      });
      return;
    }

    // SUB-UNIT edit
    const subBtn = e.target.closest('.dropdown-item.edit-subunit-btn');
    if (subBtn) {
      e.preventDefault();
      e.stopPropagation();
      hideContainingDropdown(subBtn);
      showModalById('editSubunitModal', () => {
        const unitId = subBtn.dataset.unitId;
        const subunitId = subBtn.dataset.subunitId;
        const subunitName = subBtn.dataset.subunitName || '';
        const unitIdInput = document.getElementById('editSubunitUnitId');
        const idInput = document.getElementById('editSubunitId');
        const nameInput = document.getElementById('editSubunitName');
        if (unitIdInput) unitIdInput.value = unitId;
        if (idInput) idInput.value = subunitId;
        if (nameInput) {
          nameInput.value = subunitName;
          try { nameInput.focus(); nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length); } catch (err) {}
        }
      });
      return;
    }
  });

  async function handleResponseMaybeJson(res) {
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    if (res.ok) {
      if (isJson) return await res.json();
      return null;
    } else {
      if (isJson) {
        const j = await res.json().catch(() => null);
        const message = j && j.error ? j.error : JSON.stringify(j) || `HTTP ${res.status}`;
        throw new Error(message);
      } else {
        const text = await res.text().catch(() => null);
        if (text && (text.trim().startsWith('<!DOCTYPE') || text.includes('<html'))) {
          return { reload: true };
        }
        throw new Error(text || `HTTP ${res.status}`);
      }
    }
  }

  // Save Service edits (AJAX PUT)
  const saveServiceBtn = document.getElementById('saveEditServiceBtn');
  if (saveServiceBtn) {
    saveServiceBtn.addEventListener('click', async function () {
      const id = document.getElementById('editServiceId').value;
      const name = document.getElementById('editServiceName').value.trim();
      if (!id || !name) return alert('Name is required');
      saveServiceBtn.disabled = true;
      try {
        const res = await fetch(`/admin/services/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ name })
        });
        const parsed = await handleResponseMaybeJson(res);
        if (parsed === null || (parsed && parsed.reload)) {
          const modalEl = document.getElementById('editServiceModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          window.location.reload();
          return;
        }
        if (parsed && parsed.ok) {
          const link = document.querySelector(`a.service-link[href="/admin/services/${id}"]`);
          if (link) link.textContent = name;
          const editBtns = document.querySelectorAll(`.edit-service-btn[data-service-id="${id}"]`);
          editBtns.forEach(b => b.dataset.serviceName = name);
          const modalEl = document.getElementById('editServiceModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          showToastMessage('Service updated', 2500);
        } else {
          const modalEl = document.getElementById('editServiceModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          window.location.reload();
        }
      } catch (err) {
        console.error('Update service failed', err);
        alert('Error updating service: ' + (err.message || 'unknown'));
      } finally {
        saveServiceBtn.disabled = false;
      }
    });
  }

  // Save Unit edits (AJAX PUT)
  const saveUnitBtn = document.getElementById('saveEditUnitBtn');
  if (saveUnitBtn) {
    saveUnitBtn.addEventListener('click', async function () {
      const id = document.getElementById('editUnitId').value;
      const name = document.getElementById('editUnitName').value.trim();
      if (!id || !name) return alert('Name is required');
      saveUnitBtn.disabled = true;
      try {
        const res = await fetch(`/admin/units/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ name })
        });
        const parsed = await handleResponseMaybeJson(res);
        if (parsed === null || (parsed && parsed.reload)) {
          const modalEl = document.getElementById('editUnitModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          window.location.reload();
          return;
        }
        if (parsed && parsed.ok) {
          const editBtns = document.querySelectorAll(`.edit-unit-btn[data-unit-id="${id}"]`);
          editBtns.forEach(btn => {
            btn.dataset.unitName = name;
            const accordionItem = btn.closest('.accordion-item');
            if (accordionItem) {
              const unitNameSpan = accordionItem.querySelector('.unit-name');
              if (unitNameSpan) unitNameSpan.textContent = name;
            }
          });
          const modalEl = document.getElementById('editUnitModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          showToastMessage('Unit updated', 2500);
        } else {
          const modalEl = document.getElementById('editUnitModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          window.location.reload();
        }
      } catch (err) {
        console.error('Update unit failed', err);
        alert('Error updating unit: ' + (err.message || 'unknown'));
      } finally {
        saveUnitBtn.disabled = false;
      }
    });
  }

  // Save Subunit edits (AJAX PUT)
  const saveSubunitBtn = document.getElementById('saveEditSubunitBtn');
  if (saveSubunitBtn) {
    saveSubunitBtn.addEventListener('click', async function () {
      const unitId = document.getElementById('editSubunitUnitId').value;
      const id = document.getElementById('editSubunitId').value;
      const name = document.getElementById('editSubunitName').value.trim();
      if (!unitId || !id || !name) return alert('Name is required');
      saveSubunitBtn.disabled = true;
      try {
        const res = await fetch(`/admin/units/${unitId}/subunits/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ name })
        });
        const parsed = await handleResponseMaybeJson(res);
        if (parsed === null || (parsed && parsed.reload)) {
          const modalEl = document.getElementById('editSubunitModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          window.location.reload();
          return;
        }
        if (parsed && parsed.ok) {
          const editBtns = document.querySelectorAll(`.edit-subunit-btn[data-subunit-id="${id}"]`);
          editBtns.forEach(btn => {
            btn.dataset.subunitName = name;
            const li = btn.closest('li.list-group-item');
            if (li) {
              const nameSpan = li.querySelector('.subunit-name');
              if (nameSpan) nameSpan.textContent = name;
            }
          });
          const modalEl = document.getElementById('editSubunitModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          showToastMessage('Sub-unit updated', 2500);
        } else {
          const modalEl = document.getElementById('editSubunitModal');
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          window.location.reload();
        }
      } catch (err) {
        console.error('Update subunit failed', err);
        alert('Error updating sub-unit: ' + (err.message || 'unknown'));
      } finally {
        saveSubunitBtn.disabled = false;
      }
    });
  }
});
