// public/javascripts/services_admin.js
// Robust AJAX add for Service, Unit, and Sub-unit forms.
// Defensive handling so buttons never stay stuck disabled after invalid submit.
// Uses application/x-www-form-urlencoded so express.urlencoded() can parse req.body.

function ensureServiceCategoryActionHandlers() {
  'use strict';

  if (window.__serviceCategoryActionsBound === true) return;
  window.__serviceCategoryActionsBound = true;

  function isServicesPage() {
    return !!document.getElementById('serviceCategorySelect');
  }

  function els() {
    return {
      select: document.getElementById('serviceCategorySelect'),
      modal: document.getElementById('categoryModal'),
      id: document.getElementById('categoryId'),
      name: document.getElementById('categoryName'),
      showInOrders: document.getElementById('categoryShowInOrders'),
      save: document.getElementById('saveCategoryBtn'),
      hiddenServiceCategory: document.getElementById('addServiceCategoryId'),
      servicesTbody: document.getElementById('services-tbody')
    };
  }

  function escapeHtml(s) {
    if (!s && s !== 0) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }

  function renderServiceRowsFromDocument(doc) {
    const e = els();
    if (!e.servicesTbody || !doc) return false;
    const freshTbody = doc.querySelector('#services-tbody');
    if (!freshTbody) return false;
    e.servicesTbody.innerHTML = freshTbody.innerHTML;
    return true;
  }

  async function reloadAllServicesRows() {
    const e = els();
    if (e.hiddenServiceCategory) e.hiddenServiceCategory.value = '';
    if (!e.servicesTbody) return;

    const res = await fetch('/admin/services', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Failed to reload services: ${res.status}`);

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!renderServiceRowsFromDocument(doc)) {
      throw new Error('Unable to find refreshed services table');
    }
  }

  function cleanCategoryLabel(text) {
    return String(text || '').replace(/\s+\(hidden\)\s*$/i, '').trim();
  }

  function showToast(message) {
    if (window.showGlobalToast) {
      try { window.showGlobalToast(message, 2200); return; } catch (e) {}
    }
  }

  function setSaveLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent || 'Save';
      btn.disabled = true;
      btn.textContent = 'Saving...';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || 'Save';
    }
  }

  function showCategoryModal() {
    const e = els();
    if (!e.modal) return false;
    try {
      if (window.bootstrap && window.bootstrap.Modal) {
        const inst = window.bootstrap.Modal.getOrCreateInstance(e.modal);
        inst.show();
        return true;
      }
    } catch (err) {
      console.warn('Unable to show category modal', err);
    }
    alert('Category modal is not available. Please refresh the page.');
    return false;
  }

  function hideCategoryModal() {
    const e = els();
    if (!e.modal) return;
    try {
      if (window.bootstrap && window.bootstrap.Modal) {
        const inst = window.bootstrap.Modal.getInstance(e.modal) || window.bootstrap.Modal.getOrCreateInstance(e.modal);
        inst.hide();
      }
    } catch (err) {
      // ignore; save already succeeded
    }

    // Defensive cleanup for AJAX-injected pages where Bootstrap's data API
    // can occasionally miss the dynamically-created modal instance.
    setTimeout(function () {
      const modal = document.getElementById('categoryModal');
      if (!modal || !modal.classList.contains('show')) return;

      modal.classList.remove('show');
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      modal.removeAttribute('aria-modal');
      modal.removeAttribute('role');

      document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        if (!document.querySelector('.modal.show')) backdrop.remove();
      });

      if (!document.querySelector('.modal.show')) {
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      }
    }, 80);
  }

  function applyLocalCategoryFilter(categoryId) {
    const e = els();
    const catId = String(categoryId || '');
    if (e.hiddenServiceCategory) e.hiddenServiceCategory.value = catId;
    if (!e.servicesTbody) return;

    if (!catId) {
      reloadAllServicesRows().catch(err => {
        console.warn('Failed to reload all services; using visible-row fallback', err);
        e.servicesTbody.querySelectorAll('tr').forEach(row => { row.style.display = ''; });
      });
      return;
    }

    e.servicesTbody.querySelectorAll('tr').forEach(row => {
      const rowCat = row.dataset.category || '';
      row.style.display = (!catId || String(rowCat) === catId) ? '' : 'none';
    });
  }

  async function reloadCategories(selectedId) {
    const e = els();
    if (!e.select) return;

    const wantedId = String(selectedId || e.select.value || '');
    const res = await fetch('/admin/service-categories', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !Array.isArray(j.categories)) {
      throw new Error((j && j.error) ? j.error : 'Failed to reload service categories');
    }

    e.select.innerHTML = '<option value="">-- All categories --</option>';
    j.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat._id;
      opt.textContent = cat.name + (cat.showInOrders ? '' : ' (hidden)');
      e.select.appendChild(opt);
    });

    e.select.value = wantedId;
    if (e.hiddenServiceCategory) e.hiddenServiceCategory.value = e.select.value || '';

    if (window.__initServiceCategories) {
      try {
        window.__initServiceCategories({ selectedCategoryId: e.select.value || '', applyFilter: true });
        return;
      } catch (err) {
        console.warn('Service category re-init failed; using local filter fallback', err);
      }
    }

    applyLocalCategoryFilter(e.select.value || '');
  }

  async function openEditCategoryModal() {
    const e = els();
    const categoryId = e.select ? String(e.select.value || '') : '';
    if (!categoryId) {
      alert('Select a category to edit');
      return;
    }

    const selectedOption = e.select ? e.select.options[e.select.selectedIndex] : null;
    if (e.id) e.id.value = categoryId;
    if (e.name) {
      e.name.value = selectedOption ? cleanCategoryLabel(selectedOption.textContent) : '';
      e.name.classList.remove('is-invalid');
    }
    if (e.showInOrders) e.showInOrders.checked = selectedOption ? !/\(hidden\)\s*$/i.test(selectedOption.textContent || '') : true;

    try {
      const res = await fetch(`/admin/service-categories/${encodeURIComponent(categoryId)}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.category) {
        if (e.id) e.id.value = j.category._id || categoryId;
        if (e.name) e.name.value = j.category.name || '';
        if (e.showInOrders) e.showInOrders.checked = !!j.category.showInOrders;
      }
    } catch (err) {
      // The modal can still open with the option text as fallback.
      console.warn('Could not fetch category details; using selected option fallback', err);
    }

    showCategoryModal();
  }

  async function saveCategory() {
    const e = els();
    const categoryId = e.id ? String(e.id.value || '') : '';
    const name = e.name ? String(e.name.value || '').trim() : '';
    const showInOrders = e.showInOrders ? !!e.showInOrders.checked : true;

    if (!name) {
      if (e.name) {
        e.name.classList.add('is-invalid');
        try { e.name.focus(); } catch (err) {}
      }
      return;
    }

    setSaveLoading(e.save, true);
    try {
      const url = categoryId
        ? `/admin/service-categories/${encodeURIComponent(categoryId)}`
        : '/admin/service-categories';
      const method = categoryId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: new URLSearchParams({
          name,
          showInOrders: showInOrders ? '1' : '0'
        }).toString()
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) {
        alert((j && j.error) ? j.error : 'Failed to save category');
        return;
      }

      const savedId = j.category && j.category._id ? j.category._id : categoryId;
      await reloadCategories(savedId);
      hideCategoryModal();
      showToast(categoryId ? 'Category updated' : 'Category created');
    } catch (err) {
      console.error('save category err', err);
      alert((err && err.message) ? err.message : 'Failed to save category');
    } finally {
      setSaveLoading(e.save, false);
    }
  }

  async function deleteSelectedCategory() {
    const e = els();
    const categoryId = e.select ? String(e.select.value || '') : '';
    if (!categoryId) {
      alert('Select a category to delete');
      return;
    }
    if (!confirm('Delete this category? Services in it will not be removed.')) return;

    try {
      const res = await fetch(`/admin/service-categories/${encodeURIComponent(categoryId)}`, {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || (j && j.ok === false)) {
        alert((j && j.error) ? j.error : 'Failed to delete category');
        return;
      }
      await reloadCategories('');
      if (e.select) e.select.value = '';
      applyLocalCategoryFilter('');
      showToast('Category deleted');
    } catch (err) {
      console.error('delete category err', err);
      alert('Failed to delete category');
    }
  }

  document.addEventListener('click', function (event) {
    if (!isServicesPage()) return;

    const categoryDismissBtn = event.target.closest('#categoryModal [data-bs-dismiss="modal"], #categoryModal .btn-close');
    if (categoryDismissBtn) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideCategoryModal();
      return;
    }

    const newBtn = event.target.closest('#newCategoryBtn');
    if (newBtn) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const e = els();
      if (e.id) e.id.value = '';
      if (e.name) {
        e.name.value = '';
        e.name.classList.remove('is-invalid');
      }
      if (e.showInOrders) e.showInOrders.checked = true;
      showCategoryModal();
      return;
    }

    const editBtn = event.target.closest('#editCategoryBtn');
    if (editBtn) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openEditCategoryModal();
      return;
    }

    const deleteBtn = event.target.closest('#deleteCategoryBtn');
    if (deleteBtn) {
      event.preventDefault();
      event.stopImmediatePropagation();
      deleteSelectedCategory();
      return;
    }

    const saveBtn = event.target.closest('#saveCategoryBtn');
    if (saveBtn) {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveCategory();
    }
  }, true);

  document.addEventListener('submit', function (event) {
    if (!isServicesPage()) return;
    if (!event.target || event.target.id !== 'categoryForm') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    saveCategory();
  }, true);
}

function initServicesAdmin() {
  'use strict';

  const root = document.getElementById('add-service-form') || document.getElementById('add-unit-form');
  if (!root) return;
  if (root.dataset.servicesAdminInit === '1') return;
  root.dataset.servicesAdminInit = '1';

  const mainRowSelector = '.row.g-4';

  // Prefer global spinner API if present, otherwise fallback to local DOM toggles
  function setButtonLoading(btn, loading) {
    if (!btn) return;
    // use global spinner if available
    if (window.__FormSpinner && typeof window.__FormSpinner.show === 'function') {
      if (loading) window.__FormSpinner.show(btn);
      else window.__FormSpinner.hide(btn);
      return;
    }

    // local fallback
    const spinner = btn.querySelector('.spinner-border');
    if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
    if (loading) {
      btn.classList.add('loading');
      try { btn.setAttribute('disabled', 'disabled'); } catch (e) {}
      try { btn.setAttribute('aria-disabled', 'true'); } catch (e) {}
      btn.disabled = true;
    } else {
      btn.classList.remove('loading');
      try { btn.removeAttribute('disabled'); } catch (e) {}
      try { btn.removeAttribute('aria-disabled'); } catch (e) {}
      btn.disabled = false;
    }
  }

  function forceEnableButton(btn) {
    if (!btn) return;
    // prefer global hide
    if (window.__FormSpinner && typeof window.__FormSpinner.hide === 'function') {
      try { window.__FormSpinner.hide(btn); } catch (e) { /* ignore */ }
      return;
    }
    try { btn.removeAttribute('disabled'); } catch (e) {}
    btn.disabled = false;
    try { btn.removeAttribute('aria-disabled'); } catch (e) {}
    btn.classList.remove('loading');
    const spinner = btn.querySelector('.spinner-border');
    if (spinner) spinner.style.display = 'none';
  }

  async function refreshMainRow() {
    try {
      const prevCategoryId = document.getElementById('serviceCategorySelect')?.value || '';
      const res = await fetch('/admin/services', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error(`Failed to reload UI: ${res.status}`);
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const newMainRow = doc.querySelector(mainRowSelector);
      if (!newMainRow) {
        window.location.reload();
        return;
      }
      const old = document.querySelector(mainRowSelector);
      if (old && old.parentNode) {
        old.parentNode.replaceChild(newMainRow, old);
      } else {
        document.querySelector('main')?.appendChild(newMainRow);
      }

      // Re-initialize form handlers on the newly injected DOM
      // small delay to ensure DOM parsed and scripts/styles applied
      setTimeout(() => {
        initForms(); // rebind handlers for new forms
        if (window.__initServiceCategories) {
          window.__initServiceCategories({ selectedCategoryId: prevCategoryId });
        }
      }, 0);
    } catch (err) {
      console.error('refreshMainRow error', err);
      window.location.reload();
    }
  }

  function formToUrlEncoded(form) {
    const params = new URLSearchParams();
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      params.append(key, value);
    }
    return params.toString();
  }

  async function submitFormAjax(form, submitBtn) {
    if (!form) return false;
    const btn = submitBtn || form.querySelector('button[type="submit"], button');
    try {
      setButtonLoading(btn, true);

      const bodyString = formToUrlEncoded(form);

      const opts = {
        method: (form.method || 'POST').toUpperCase(),
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: bodyString
      };

      const res = await fetch(form.action, opts);

      if (res.ok) {
        await refreshMainRow();
        if (window.showGlobalToast) window.showGlobalToast('Saved.', 2500);
        return true;
      } else {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const j = await res.json().catch(() => null);
          const msg = (j && j.error) ? j.error : 'Error';
          alert('Error: ' + msg);
        } else {
          window.location.reload();
        }
        return false;
      }
    } catch (err) {
      console.error('submitFormAjax error', err);
      window.location.reload();
      return false;
    } finally {
      // ensure spinner hidden (global API will no-op if DOM replaced)
      setButtonLoading(btn, false);
    }
  }

  function attachOneTimeReenableListener(form, submitBtn) {
    if (!form) return;
    function onInput() {
      forceEnableButton(submitBtn);
      try { form.removeEventListener('input', onInput, true); } catch (e) {}
    }
    form.addEventListener('input', onInput, true);
  }

  function getSubmitterFromEvent(e, form) {
    // prefer standard submitter (supported by modern browsers)
    if (e && e.submitter) return e.submitter;
    // fallback: element that had focus when submit fired
    const active = document.activeElement;
    if (active && (active.tagName === 'BUTTON' || active.tagName === 'INPUT') && form.contains(active)) {
      return active;
    }
    // last-resort: first submit button found
    return form.querySelector('button[type="submit"], button');
  }

  function interceptFormSubmit(form) {
    if (!form) return;
    // idempotent guard
    if (form.dataset._ajaxIntercepted === '1') return;
    form.dataset._ajaxIntercepted = '1';

    form.addEventListener('submit', function (e) {
      if (!window.fetch) return;
      const submitBtn = getSubmitterFromEvent(e, form);
      e.preventDefault();

      if (!form.checkValidity()) {
        form.classList.add('was-validated');
        forceEnableButton(submitBtn);
        attachOneTimeReenableListener(form, submitBtn);
        const firstInvalid = form.querySelector(':invalid');
        if (firstInvalid) try { firstInvalid.focus(); } catch (err) {}
        return;
      }

      submitFormAjax(form, submitBtn);
    });
  }

  function initForms() {
    // wire known forms; this function is called on DOMContentLoaded and after fragment refresh
    const addServiceForm = document.getElementById('add-service-form');
    if (addServiceForm) interceptFormSubmit(addServiceForm);

    const addUnitForm = document.getElementById('add-unit-form');
    if (addUnitForm) interceptFormSubmit(addUnitForm);

    // sub-unit creation route may be generic: intercept any matching POST form (delegated handler)
    // no-op here — we keep the delegated submit listener below for subunits (it handles dynamically added forms)
  }

  // initial wiring
  initForms();

  // Delegated handler for sub-unit forms that match route pattern (works for dynamically inserted forms)
  if (!window.__servicesAdminDelegatedSubmit) {
    window.__servicesAdminDelegatedSubmit = true;
    document.addEventListener('submit', function (e) {
      const form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      try {
        const action = form.getAttribute('action') || '';
        const method = (form.getAttribute('method') || 'POST').toUpperCase();
        if (method === 'POST' && /\/admin\/units\/[^\/]+\/subunits$/.test(action)) {
          if (!window.fetch) return;
          const submitBtn = getSubmitterFromEvent(e, form);
          e.preventDefault();

          if (!form.checkValidity()) {
            form.classList.add('was-validated');
            forceEnableButton(submitBtn);
            attachOneTimeReenableListener(form, submitBtn);
            const firstInvalid = form.querySelector(':invalid');
            if (firstInvalid) try { firstInvalid.focus(); } catch (err) {}
            return;
          }

          submitFormAjax(form, submitBtn);
        }
      } catch (err) {
        // ignore
      }
    }, true);
  }

}

ensureServiceCategoryActionHandlers();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    ensureServiceCategoryActionHandlers();
    initServicesAdmin();
  }, { once: true });
} else {
  ensureServiceCategoryActionHandlers();
  initServicesAdmin();
}

document.addEventListener('ajax:page:loaded', function () {
  ensureServiceCategoryActionHandlers();
  initServicesAdmin();
});
