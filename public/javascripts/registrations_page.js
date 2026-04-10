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
    const walkInBtn = document.getElementById('secretaryWalkInBtn');
    const submitBtn = document.getElementById('secretarySubmitBtn');
    const refreshBtn = document.getElementById('refreshRegistrationsBtn');
    const categoriesBox = document.getElementById('secretaryCategoriesBox');
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
      return Array.from(document.querySelectorAll('.secretary-cat-check:checked')).map(el => el.value);
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
        categoriesBox.innerHTML = '';
        categories.forEach(cat => {
          const col = document.createElement('div');
          col.className = 'col-12 col-md-4';
          col.innerHTML = `
            <div class="form-check">
              <input class="form-check-input secretary-cat-check" type="checkbox" value="${escapeHtml(cat._id)}" id="secCat_${escapeHtml(cat._id)}">
              <label class="form-check-label" for="secCat_${escapeHtml(cat._id)}">${escapeHtml(cat.name)}</label>
            </div>
          `;
          categoriesBox.appendChild(col);
        });
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
          pendingTableBody.innerHTML = '<tr><td class="text-muted-light" colspan="4">No pending registerations for today.</td></tr>';
          return;
        }
        pendingTableBody.innerHTML = '';
        rows.forEach(r => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${escapeHtml(r.displayName || '')}</td>
            <td>${escapeHtml(r.phone || '-')}</td>
            <td>${escapeHtml((r.categories || []).map(c => c.name).join(', ') || '-')}</td>
            <td>${new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          `;
          pendingTableBody.appendChild(tr);
        });
      } catch (err) {
        if (pendingTableBody) {
          pendingTableBody.innerHTML = '<tr><td class="text-danger" colspan="4">Failed to load pending registerations.</td></tr>';
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
      if (!selected) return showAlert('Select a customer or click Walk-in first');
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
        document.querySelectorAll('.secretary-cat-check:checked').forEach(el => { el.checked = false; });
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
        if (!term) return showAlert('Enter phone or name');
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

    if (walkInBtn) {
      walkInBtn.addEventListener('click', function () {
        setSelectedWalkIn();
        showAlert('Walk-in selected. Choose categories and submit.');
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

    if (regCategory) regCategory.addEventListener('change', updateRegFields);
    if (saveCustomerBtn) saveCustomerBtn.addEventListener('click', saveCustomer);

    updateRegFields();
    loadCategories();
    loadPending();
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

