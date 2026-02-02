// public/javascripts/customers_front.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const lookupForm = document.getElementById('customerLookupForm');
  const lookupPhoneInput = document.getElementById('lookupPhone');
  const lookupBtn = document.getElementById('lookupBtn');

  const registerBtn = document.getElementById('registerBtn');
  const regModalEl = document.getElementById('registerCustomerModal');
  const regModal = (window.bootstrap && regModalEl) ? new bootstrap.Modal(regModalEl) : null;
  const regForm = document.getElementById('registerCustomerForm');
  const regCategory = document.getElementById('regCategory');
  const regFirstName = document.getElementById('regFirstName');
  const regBusinessName = document.getElementById('regBusinessName');
  const regPhone = document.getElementById('regPhone');
  const regNotes = document.getElementById('regNotes');
  const saveCustomerBtn = document.getElementById('saveCustomerBtn');  

  // Typeahead container
  let suggestionsBox = null;

  function showAlert(msg, title = 'Notice') {
    if (window.showGlobalToast) { try { window.showGlobalToast(msg, 2400); return; } catch(e){} }
    alert(msg);
  }

  function normalizePhone(v) {
    return (v || '').toString().replace(/\s+/g,'').trim();
  }

  // update registration fields visibility
  function updateRegFields() {
    const cat = regCategory ? regCategory.value : 'one_time';
    const firstGrp = document.getElementById('regFirstNameGroup');
    const busGrp = document.getElementById('regBusinessNameGroup');
    if (cat === 'artist' || cat === 'organisation') {
      if (firstGrp) firstGrp.style.display = 'none';
      if (busGrp) busGrp.style.display = '';
    } else {
      if (firstGrp) firstGrp.style.display = '';
      if (busGrp) busGrp.style.display = 'none';
    }
  }
  if (regCategory) regCategory.addEventListener('change', updateRegFields);
  updateRegFields();

  async function lookupByPhone(phone) {
    try {
      const url = `/customers/lookup?phone=${encodeURIComponent(phone)}`;
      const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        showAlert((j && j.error) ? j.error : 'Lookup failed');
        return null;
      }
      const j = await res.json().catch(()=>null);
      if (!j) return null;
      return j;
    } catch (err) {
      console.error('lookup err', err);
      showAlert('Network error during lookup');
      return null;
    }
  }

  function isOrdersNewPage() {
    return !!document.getElementById('ordersNewPage');
  }

  function setText(el, value) {
    if (!el) return;
    el.textContent = value || '';
  }

  function formatCustomerName(c) {
    if (!c) return '';
    if (c.category === 'artist' || c.category === 'organisation') {
      return c.businessName || c.phone || '';
    }
    return c.firstName || c.businessName || c.phone || '';
  }

  function formatCustomerCategory(c) {
    if (!c) return '';
    if (c.category === 'artist') return 'Artist';
    if (c.category === 'organisation') return 'Organisation';
    if (c.category === 'regular') return 'Regular';
    return 'One-Time';
  }

  function attachCustomerToOrderPage(cust) {
    if (!cust) return false;
    if (!isOrdersNewPage()) return false;

    let customerIdEl = document.getElementById('orderCustomerId');
    if (!customerIdEl) {
      customerIdEl = document.createElement('input');
      customerIdEl.type = 'hidden';
      customerIdEl.id = 'orderCustomerId';
      const container = document.getElementById('ordersNewPage') || document.body;
      container.appendChild(customerIdEl);
    }
    customerIdEl.value = cust._id || '';

    const card = document.getElementById('selectedCustomerCard');
    const nameEl = document.getElementById('selectedCustomerName');
    const phoneEl = document.getElementById('selectedCustomerPhone');
    const categoryEl = document.getElementById('selectedCustomerCategory');

    setText(nameEl, formatCustomerName(cust));
    setText(phoneEl, cust.phone || '');
    setText(categoryEl, formatCustomerCategory(cust));

    if (card) card.style.display = '';
    return true;
  }

  // ---------- Typeahead logic ----------
  let taTimer = null;
  const TA_DEBOUNCE = 220; // ms

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
    if (!suggestionsBox || !lookupPhoneInput) return;
    const rect = lookupPhoneInput.getBoundingClientRect();
    suggestionsBox.style.left = (rect.left + window.scrollX) + 'px';
    suggestionsBox.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    suggestionsBox.style.width = Math.max(rect.width, 280) + 'px';
  }

  async function fetchSuggestions(q) {
    if (!q || q.trim() === '') {
      hideSuggestions();
      return;
    }
    try {
      const res = await fetch(`/customers/search?q=${encodeURIComponent(q)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      if (!res.ok) return hideSuggestions();
      const j = await res.json().catch(()=>null);
      if (!j || !Array.isArray(j.results)) return hideSuggestions();
      renderSuggestions(j.results);
    } catch (err) {
      console.error('suggestion fetch err', err);
      hideSuggestions();
    }
  }

  function renderSuggestions(results) {
    createSuggestionsBox();
    positionSuggestionsBox();
    if (!suggestionsBox) return;
    if (!results || !results.length) { suggestionsBox.style.display = 'none'; return; }
    suggestionsBox.innerHTML = '';
    results.forEach(r => {
      const label = (r.category === 'artist' || r.category === 'organisation') ? (r.businessName || r.phone) : (r.firstName || r.businessName || r.phone);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'list-group-item list-group-item-action';
      el.dataset.customerId = r._id;
      el.dataset.customerPhone = r.phone;
      el.innerHTML = `<div class="d-flex w-100 justify-content-between"><strong>${escapeHtml(label)}</strong><small class="text-muted">${escapeHtml(r.phone)}</small></div><div class="small text-muted">${escapeHtml(r.category || '')}</div>`;
      el.addEventListener('click', function () {
        // fill phone and redirect to orders if desired
        const phone = this.dataset.customerPhone || '';
        if (lookupPhoneInput) lookupPhoneInput.value = phone;
        hideSuggestions();
        // optional: directly lookup and redirect
        setTimeout(async () => {
          const r = await lookupByPhone(phone);
          if (r && r.found && r.customer) {
            if (attachCustomerToOrderPage(r.customer)) {
              if (window.showGlobalToast) {
                try { window.showGlobalToast('Customer attached', 1600); } catch (e) {}
              }
            } else {
              window.location.href = `/orders/new?customerId=${encodeURIComponent(r.customer._id)}`;
            }
          } else {
            // fallback: show registration modal with phone prefilled
            if (regPhone) regPhone.value = phone;
            if (regModal) regModal.show();
          }
        }, 50);
      });
      suggestionsBox.appendChild(el);
    });
    suggestionsBox.style.display = '';
  }

  function hideSuggestions() {
    if (suggestionsBox) suggestionsBox.style.display = 'none';
  }

  // hide suggestions on esc or blur outside
  document.addEventListener('click', function (ev) {
    if (!suggestionsBox) return;
    if (ev.target === lookupPhoneInput || (suggestionsBox && suggestionsBox.contains(ev.target))) return;
    hideSuggestions();
  });

  // key handling for arrow/up/down/enter could be added here; keep it simple for now.

  // wire input event
  if (lookupPhoneInput) {
    lookupPhoneInput.addEventListener('input', function (e) {
      const q = this.value || '';
      if (taTimer) clearTimeout(taTimer);
      taTimer = setTimeout(() => {
        fetchSuggestions(q);
      }, TA_DEBOUNCE);
    });
    window.addEventListener('resize', positionSuggestionsBox);
    lookupPhoneInput.addEventListener('focus', function () { positionSuggestionsBox(); if (this.value) { if (taTimer) clearTimeout(taTimer); taTimer = setTimeout(()=> fetchSuggestions(this.value), TA_DEBOUNCE); } });
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }

  // ---------- existing lookup/register logic (unchanged) ----------

  // on lookup submit
  if (lookupForm) {
    lookupForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const phoneRaw = lookupPhoneInput ? lookupPhoneInput.value : '';
      const phone = normalizePhone(phoneRaw);
      if (!phone) return showAlert('Enter a phone number');
      lookupBtn.disabled = true;
      lookupBtn.textContent = 'Searching...';
      try {
        const r = await lookupByPhone(phone);
        if (!r) return;
        if (r.found) {
          const cust = r.customer;
          // attach to current order page when possible
          if (attachCustomerToOrderPage(cust)) {
            if (window.showGlobalToast) {
              try { window.showGlobalToast('Customer attached', 1600); } catch (e) {}
            }
          } else {
            window.location.href = `/orders/new?customerId=${encodeURIComponent(cust._id)}`;
          }
          return;
        } else {
          // show modal with phone prefilled for registration
          if (regPhone) regPhone.value = phone;
          if (regCategory) regCategory.value = 'one_time';
          updateRegFields();
          if (regFirstName) regFirstName.value = '';
          if (regBusinessName) regBusinessName.value = '';
          if (regNotes) regNotes.value = '';
          if (regModal) regModal.show();
        }
      } finally {
        lookupBtn.disabled = false;
        lookupBtn.textContent = 'Lookup';
      }
    });
  }

  // Register button opens modal (clear fields)
if (registerBtn) {
  registerBtn.addEventListener('click', function () {
    // reset edit state
    window.editingCustomerId = null;

    // reset modal title + button
    const titleEl = document.getElementById('registerCustomerModalLabel');
    if (titleEl) titleEl.textContent = 'Register Customer';
    if (saveCustomerBtn) saveCustomerBtn.textContent = 'Register';

    // prefill phone if available
    if (regPhone) {
      regPhone.value = lookupPhoneInput
        ? normalizePhone(lookupPhoneInput.value)
        : '';
    }

    if (regCategory) regCategory.value = 'one_time';
    updateRegFields();

    if (regFirstName) regFirstName.value = '';
    if (regBusinessName) regBusinessName.value = '';
    if (regNotes) regNotes.value = '';

    if (regModal) regModal.show();
  });
}

  // Save registration
if (saveCustomerBtn) {
  saveCustomerBtn.addEventListener('click', async function () {
    const category = regCategory ? regCategory.value : 'one_time';
    const phone = normalizePhone(regPhone ? regPhone.value : '');
    const firstName = regFirstName ? regFirstName.value.trim() : '';
    const businessName = regBusinessName ? regBusinessName.value.trim() : '';
    const notes = regNotes ? regNotes.value.trim() : '';

    // ---- validations (unchanged logic) ----
    if (!phone) return showAlert('Phone is required');

    if (category === 'one_time' && !firstName) {
      return showAlert('First name is required for a customer');
    }

    if ((category === 'artist' || category === 'organisation') && !businessName) {
      return showAlert('Business name is required');
    }

    saveCustomerBtn.disabled = true;
    saveCustomerBtn.textContent = window.editingCustomerId ? 'Updating...' : 'Saving...';

    try {
      const payload = { category, phone, firstName, businessName, notes };

      const url = window.editingCustomerId
        ? `/customers/${encodeURIComponent(window.editingCustomerId)}`
        : '/customers';

      const method = window.editingCustomerId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(payload)
      });

      const j = await res.json().catch(() => null);

      if (!res.ok) {
        showAlert((j && j.error) ? j.error : 'Operation failed');
        return;
      }

      // ---- EDIT MODE ----
      if (window.editingCustomerId) {
        window.editingCustomerId = null;

      const modal = bootstrap.Modal.getInstance(
        document.getElementById('registerCustomerModal')
      );
      if (modal) modal.hide();

        // 🔔 Notify other pages/components
        document.dispatchEvent(
          new CustomEvent('customer:updated', {
            detail: { customer: j.customer }
          })
        );

  showAlert('Customer updated successfully');
  return;
}

      // ---- CREATE MODE (existing behavior preserved) ----
      if (j && j.customer) {
        if (regModal) regModal.hide();
        if (attachCustomerToOrderPage(j.customer)) {
          if (window.showGlobalToast) {
            try { window.showGlobalToast('Customer attached', 1600); } catch (e) {}
          }
          return;
        }
        window.location.href = `/orders/new?customerId=${encodeURIComponent(j.customer._id)}`;
        return;
      }

      showAlert('Unexpected response from server');

    } catch (err) {
      console.error('save customer err', err);
      showAlert('Network error while saving');
    } finally {
      saveCustomerBtn.disabled = false;
      saveCustomerBtn.textContent = window.editingCustomerId ? 'Update' : 'Register';
    }
  });
}

});
