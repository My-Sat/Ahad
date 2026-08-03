(function () {
  'use strict';

  function initRegistrationsPage() {
    const root = document.getElementById('registrationsPage');
    if (!root) return;
    if (root.dataset.initDone === '1') return;
    root.dataset.initDone = '1';

    const lookupForm = document.getElementById('secretaryLookupForm');
    const lookupInput = document.getElementById('secretaryLookupInput');
    const lookupBtn = document.getElementById('secretaryLookupBtn');
    const registerBtn = document.getElementById('secretaryRegisterBtn');
    const submitBtn = document.getElementById('secretarySubmitBtn');
    const refreshBtn = document.getElementById('refreshRegistrationsBtn');
    const categoriesBox = document.getElementById('secretaryCategoriesBox');
    const categoryTabs = document.getElementById('secretaryCategoryTabs');
    const pendingTableBody = document.querySelector('#pendingRegistrationsTable tbody');
    const pendingCount = document.getElementById('pendingRegistrationsCount');

    const selectedCard = document.getElementById('selectedSecretaryCustomerCard');
    const selectedName = document.getElementById('selectedSecretaryCustomerName');
    const selectedPhone = document.getElementById('selectedSecretaryCustomerPhone');
    const selectedCategory = document.getElementById('selectedSecretaryCustomerCategory');
    const clearSelectionBtn = document.getElementById('secretaryClearSelectionBtn');

    const regModalEl = document.getElementById('secretaryRegisterCustomerModal');
    const regModal = (window.bootstrap && regModalEl) ? new bootstrap.Modal(regModalEl) : null;
    const regCategory = document.getElementById('secretaryRegCategory');
    const regFirstName = document.getElementById('secretaryRegFirstName');
    const regBusinessName = document.getElementById('secretaryRegBusinessName');
    const regPhone = document.getElementById('secretaryRegPhone');
    const regNotes = document.getElementById('secretaryRegNotes');
    const regFirstGroup = document.getElementById('secretaryRegFirstNameGroup');
    const regBusinessGroup = document.getElementById('secretaryRegBusinessNameGroup');
    const saveCustomerBtn = document.getElementById('secretarySaveCustomerBtn');

    let selected = null; // { mode:'customer'|'walkin', customer? }
    let categories = [];
    let activeCategoryGroup = 'digital';
    const selectedCategoryIdSet = new Set();
    let suggestionsBox = null;
    let taTimer = null;

    function showAlert(message) {
      if (window.showGlobalToast) {
        try { window.showGlobalToast(message, 2400); return; } catch (e) {}
      }
      alert(message);
    }

    function normalizePhone(v) {
      return String(v || '').replace(/\s+/g, '').trim();
    }

    function escapeHtml(s) {
      return String(s || '').replace(/[&<>"'`=\/]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
    }

    function categoryDisplayName(name) {
      return String(name || '').trim().toUpperCase();
    }

    function customerName(c) {
      if (!c) return '';
      const cat = String(c.category || '').toLowerCase();
      if (cat === 'artist' || cat === 'organisation') return c.businessName || c.phone || 'Customer';
      return c.firstName || c.businessName || c.phone || 'Customer';
    }

    function customerCategoryLabel(c) {
      const cat = String(c && c.category ? c.category : '').toLowerCase();
      if (cat === 'artist') return 'Artist';
      if (cat === 'organisation') return 'Organisation';
      if (cat === 'regular') return 'Regular';
      return 'One-Time';
    }

    function readPreselectedCustomer() {
      const raw = String(root.dataset.preselectedCustomer || '').trim();
      if (!raw) return null;
      try {
        const c = JSON.parse(raw);
        return c && c._id ? c : null;
      } catch (e) {
        return null;
      }
    }

    function setSelectedCustomer(c) {
      selected = { mode: 'customer', customer: c };
      selectedName.textContent = customerName(c);
      selectedPhone.textContent = c.phone || '';
      selectedCategory.textContent = customerCategoryLabel(c);
      selectedCard.style.display = '';
    }

    function setSelectedWalkIn() {
      selected = { mode: 'walkin' };
      selectedName.textContent = 'Walk-in';
      selectedPhone.textContent = '';
      selectedCategory.textContent = '';
      selectedCard.style.display = '';
    }

    function clearSelected() {
      selected = null;
      selectedName.textContent = '';
      selectedPhone.textContent = '';
      selectedCategory.textContent = '';
      selectedCard.style.display = 'none';
    }

    function selectedCategoryIds() {
      return Array.from(selectedCategoryIdSet);
    }

    function categoryBelongsToGroup(category, group) {
      const groups = Array.isArray(category && category.categoryGroups)
        ? category.categoryGroups.map(value => String(value || '').toLowerCase())
        : ['digital'];
      return groups.includes(group);
    }

    function renderCategories() {
      if (!categoriesBox) return;
      const visibleCategories = categories.filter(category => categoryBelongsToGroup(category, activeCategoryGroup));
      categoriesBox.innerHTML = '';

      if (!visibleCategories.length) {
        const label = activeCategoryGroup === 'large_format' ? 'Large Format' : 'Digital';
        categoriesBox.innerHTML = `<div class="col-12"><span class="text-muted-light">No ${label} categories available.</span></div>`;
        return;
      }

      visibleCategories.forEach(cat => {
        const id = String(cat._id || '');
        const inputId = `secCat_${activeCategoryGroup}_${id}`;
        const col = document.createElement('div');
        col.className = 'col-12 col-md-4';
        col.innerHTML = `
          <div class="form-check">
            <input class="form-check-input secretary-cat-check" type="checkbox" value="${escapeHtml(id)}" id="${escapeHtml(inputId)}" ${selectedCategoryIdSet.has(id) ? 'checked' : ''}>
            <label class="form-check-label" for="${escapeHtml(inputId)}">${escapeHtml(categoryDisplayName(cat.name))}</label>
          </div>
        `;
        categoriesBox.appendChild(col);
      });
    }

    async function loadCategories() {
      if (!categoriesBox) return;
      categoriesBox.innerHTML = '<div class="col-12"><span class="text-muted-light">Loading categories...</span></div>';
      try {
        const res = await fetch('/registrations/categories', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'Failed');
        categories = Array.isArray(j.categories) ? j.categories : [];
        if (!categories.length) {
          categoriesBox.innerHTML = '<div class="col-12"><span class="text-muted-light">No visible service categories.</span></div>';
          return;
        }
        const validIds = new Set(categories.map(category => String(category._id || '')));
        selectedCategoryIdSet.forEach(id => {
          if (!validIds.has(id)) selectedCategoryIdSet.delete(id);
        });
        renderCategories();
      } catch (err) {
        categoriesBox.innerHTML = '<div class="col-12"><span class="text-danger">Failed to load categories.</span></div>';
      }
    }

    async function loadPending() {
      try {
        const res = await fetch('/registrations/pending', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const j = await res.json().catch(() => null);
        const rows = (res.ok && j && j.ok && Array.isArray(j.submissions)) ? j.submissions : [];
        if (pendingCount) pendingCount.textContent = String(rows.length);
        if (!pendingTableBody) return;
        if (!rows.length) {
          pendingTableBody.innerHTML = '<tr><td class="text-muted-light" colspan="6">No registerations found.</td></tr>';
          return;
        }
        pendingTableBody.innerHTML = '';
        rows.forEach(r => {
          const served = !!r.served || String(r.status || '') === 'consumed';
          const statusHtml = served
            ? '<span class="badge bg-success-subtle text-success-emphasis border border-success-subtle">Served</span>'
            : '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">Not Served</span>';
          const actionHtml = served
            ? '<span class="text-muted-light">-</span>'
            : `<button type="button" class="btn btn-sm btn-outline-danger clear-registration-btn" data-id="${escapeHtml(r.id)}">Clear</button>`;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${escapeHtml(r.displayName || '')}</td>
            <td>${escapeHtml(r.phone || '-')}</td>
            <td>${escapeHtml((r.categories || []).map(c => categoryDisplayName(c.name)).join(', ') || '-')}</td>
            <td>${statusHtml}</td>
            <td>${new Date(r.createdAt).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
            <td class="text-end">${actionHtml}</td>
          `;
          pendingTableBody.appendChild(tr);
        });
      } catch (err) {
        if (pendingTableBody) {
          pendingTableBody.innerHTML = '<tr><td class="text-danger" colspan="6">Failed to load registerations.</td></tr>';
        }
      }
    }

    async function lookupByPhoneOrName(term) {
      const q = normalizePhone(term) || String(term || '').trim();
      if (!q) return null;
      const res = await fetch(`/customers/lookup?phone=${encodeURIComponent(q)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) return null;
      return j;
    }

    async function searchCustomers(q) {
      if (!q || !q.trim()) return [];
      const res = await fetch(`/customers/search?q=${encodeURIComponent(q)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !Array.isArray(j.results)) return [];
      return j.results;
    }

    function createSuggestionsBox() {
      if (suggestionsBox) return suggestionsBox;
      suggestionsBox = document.createElement('div');
      suggestionsBox.className = 'list-group position-absolute shadow-sm';
      suggestionsBox.style.zIndex = 1050;
      suggestionsBox.style.maxHeight = '260px';
      suggestionsBox.style.overflow = 'auto';
      suggestionsBox.style.minWidth = '280px';
      suggestionsBox.style.display = 'none';
      document.body.appendChild(suggestionsBox);
      return suggestionsBox;
    }

    function positionSuggestionsBox() {
      if (!suggestionsBox || !lookupInput) return;
      const rect = lookupInput.getBoundingClientRect();
      suggestionsBox.style.left = (rect.left + window.scrollX) + 'px';
      suggestionsBox.style.top = (rect.bottom + window.scrollY + 6) + 'px';
      suggestionsBox.style.width = Math.max(rect.width, 280) + 'px';
    }

    function hideSuggestions() {
      if (suggestionsBox) suggestionsBox.style.display = 'none';
    }

    function renderSuggestions(rows) {
      createSuggestionsBox();
      positionSuggestionsBox();
      if (!suggestionsBox) return;
      if (!rows || !rows.length) {
        suggestionsBox.style.display = 'none';
        return;
      }
      suggestionsBox.innerHTML = '';
      rows.forEach(r => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'list-group-item list-group-item-action';
        const nm = customerName(r);
        b.innerHTML = `<div class="d-flex w-100 justify-content-between"><strong>${escapeHtml(nm)}</strong><small class="text-muted">${escapeHtml(r.phone || '')}</small></div>`;
        b.addEventListener('click', function () {
          setSelectedCustomer(r);
          if (lookupInput) lookupInput.value = r.phone || '';
          hideSuggestions();
        });
        suggestionsBox.appendChild(b);
      });
      suggestionsBox.style.display = '';
    }

    function updateRegFields() {
      const cat = regCategory ? String(regCategory.value || 'one_time') : 'one_time';
      const isBiz = (cat === 'artist' || cat === 'organisation');
      if (regFirstGroup) regFirstGroup.style.display = isBiz ? 'none' : '';
      if (regBusinessGroup) regBusinessGroup.style.display = isBiz ? '' : 'none';
    }

    async function saveCustomer() {
      const category = regCategory ? String(regCategory.value || 'one_time') : 'one_time';
      const phone = normalizePhone(regPhone ? regPhone.value : '');
      const firstName = regFirstName ? String(regFirstName.value || '').trim() : '';
      const businessName = regBusinessName ? String(regBusinessName.value || '').trim() : '';
      const notes = regNotes ? String(regNotes.value || '').trim() : '';

      if (!phone) return showAlert('Phone is required');
      if (category === 'one_time' && !firstName) return showAlert('Full name is required');
      if ((category === 'artist' || category === 'organisation') && !businessName) return showAlert('Business name is required');

      saveCustomerBtn.disabled = true;
      saveCustomerBtn.textContent = 'Saving...';
      try {
        const res = await fetch('/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ category, phone, firstName, businessName, notes })
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.customer) {
          showAlert((j && j.error) ? j.error : 'Failed to save customer');
          return;
        }
        setSelectedCustomer(j.customer);
        if (lookupInput) lookupInput.value = j.customer.phone || '';
        if (regModal) regModal.hide();
        showAlert('Customer saved and selected');
      } catch (err) {
        showAlert('Network error while saving customer');
      } finally {
        saveCustomerBtn.disabled = false;
        saveCustomerBtn.textContent = 'Register';
      }
    }

    async function submitRegistration() {
      const categoryIds = selectedCategoryIds();
      if (!selected) return showAlert('Select a customer or click Lookup with empty field for walk-in');
      if (!categoryIds.length) return showAlert('Select at least one service category');

      const payload = {
        customerId: selected.mode === 'customer' ? String(selected.customer._id || '') : '',
        categoryIds
      };

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
      try {
        const res = await fetch('/registrations/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify(payload)
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) {
          showAlert((j && j.error) ? j.error : 'Failed to submit');
          return;
        }
        clearSelected();
        selectedCategoryIdSet.clear();
        renderCategories();
        if (lookupInput) lookupInput.value = '';
        await loadPending();
        showAlert('Submitted to Jobs');
      } catch (err) {
        showAlert('Network error while submitting');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit to Jobs';
      }
    }

    if (lookupInput) {
      lookupInput.addEventListener('input', function () {
        const q = String(this.value || '').trim();
        if (taTimer) clearTimeout(taTimer);
        if (!q) return hideSuggestions();
        taTimer = setTimeout(async () => {
          const rows = await searchCustomers(q);
          renderSuggestions(rows);
        }, 220);
      });
      lookupInput.addEventListener('focus', function () {
        positionSuggestionsBox();
      });
      window.addEventListener('resize', positionSuggestionsBox);
    }

    document.addEventListener('click', function (ev) {
      if (!suggestionsBox) return;
      if (ev.target === lookupInput || suggestionsBox.contains(ev.target)) return;
      hideSuggestions();
    });

    if (lookupForm) {
      lookupForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const term = String(lookupInput ? lookupInput.value : '').trim();
        if (!term) {
          setSelectedWalkIn();
          hideSuggestions();
          showAlert('Walk-in selected. Choose categories and submit.');
          if (lookupBtn) {
            lookupBtn.disabled = false;
            lookupBtn.textContent = 'Lookup';
          }
          if (window.__FormSpinner && typeof window.__FormSpinner.hide === 'function' && lookupBtn) {
            try { window.__FormSpinner.hide(lookupBtn); } catch (e) {}
          } else if (lookupBtn) {
            lookupBtn.classList.remove('loading');
            lookupBtn.removeAttribute('data-spinner-active');
          }
          return;
        }
        lookupBtn.disabled = true;
        lookupBtn.textContent = 'Searching...';
        try {
          const r = await lookupByPhoneOrName(term);
          if (r && r.found && r.customer) {
            setSelectedCustomer(r.customer);
            hideSuggestions();
          } else {
            showAlert('Customer not found. Use Register Customer.');
          }
        } catch (err) {
          showAlert('Lookup failed');
        } finally {
          lookupBtn.disabled = false;
          lookupBtn.textContent = 'Lookup';
          if (window.__FormSpinner && typeof window.__FormSpinner.hide === 'function' && lookupBtn) {
            try { window.__FormSpinner.hide(lookupBtn); } catch (e) {}
          } else if (lookupBtn) {
            lookupBtn.classList.remove('loading');
            lookupBtn.removeAttribute('data-spinner-active');
          }
        }
      });
    }

    if (registerBtn) {
      registerBtn.addEventListener('click', function () {
        if (regCategory) regCategory.value = 'one_time';
        if (regFirstName) regFirstName.value = '';
        if (regBusinessName) regBusinessName.value = '';
        if (regPhone) regPhone.value = lookupInput ? normalizePhone(lookupInput.value) : '';
        if (regNotes) regNotes.value = '';
        updateRegFields();
        if (regModal) regModal.show();
      });
    }

    if (clearSelectionBtn) {
      clearSelectionBtn.addEventListener('click', function () {
        clearSelected();
      });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', submitRegistration);
    }

    if (categoriesBox) {
      categoriesBox.addEventListener('change', function (ev) {
        const checkbox = ev.target.closest('.secretary-cat-check');
        if (!checkbox) return;
        const id = String(checkbox.value || '').trim();
        if (!id) return;
        if (checkbox.checked) selectedCategoryIdSet.add(id);
        else selectedCategoryIdSet.delete(id);
      });
    }

    if (categoryTabs) {
      categoryTabs.addEventListener('click', function (ev) {
        const tab = ev.target.closest('[data-category-group]');
        if (!tab) return;
        activeCategoryGroup = String(tab.dataset.categoryGroup || 'digital') === 'large_format' ? 'large_format' : 'digital';
        categoryTabs.querySelectorAll('[data-category-group]').forEach(button => {
          const isActive = String(button.dataset.categoryGroup || '') === activeCategoryGroup;
          button.classList.toggle('active', isActive);
          button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        renderCategories();
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function () {
        refreshBtn.disabled = true;
        const text = refreshBtn.textContent;
        refreshBtn.textContent = 'Refreshing...';
        try {
          await Promise.all([loadPending(), loadCategories()]);
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.textContent = text;
        }
      });
    }

    if (pendingTableBody && pendingTableBody.dataset.clearBound !== '1') {
      pendingTableBody.dataset.clearBound = '1';
      pendingTableBody.addEventListener('click', async function (ev) {
        const btn = ev.target.closest('.clear-registration-btn');
        if (!btn) return;

        const id = String(btn.dataset.id || '').trim();
        if (!id) return;
        if (!confirm('Clear this not-served registration?')) return;

        const old = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Clearing...';
        try {
          const res = await fetch(`/registrations/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });
          const j = await res.json().catch(() => null);
          if (!res.ok || !j || !j.ok) {
            showAlert((j && j.error) ? j.error : 'Failed to clear registration');
            return;
          }
          await loadPending();
          showAlert('Registration cleared.');
        } catch (err) {
          showAlert('Network error while clearing registration');
        } finally {
          btn.disabled = false;
          btn.textContent = old;
        }
      });
    }

    if (regCategory) regCategory.addEventListener('change', updateRegFields);
    if (saveCustomerBtn) saveCustomerBtn.addEventListener('click', saveCustomer);

    updateRegFields();
    loadCategories();
    loadPending();

    const preselectedCustomer = readPreselectedCustomer();
    if (preselectedCustomer) {
      setSelectedCustomer(preselectedCustomer);
      if (lookupInput) lookupInput.value = preselectedCustomer.phone || customerName(preselectedCustomer);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRegistrationsPage, { once: true });
  } else {
    initRegistrationsPage();
  }

  document.addEventListener('ajax:page:loaded', function () {
    initRegistrationsPage();
  });
})();
