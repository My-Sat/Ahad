// public/javascripts/customer_editor.js
(function () {
  'use strict';

  if (typeof window.editingCustomerId === 'undefined') {
    window.editingCustomerId = null;
  }

function getRegModalInstance() {
  const modalEl = document.getElementById('registerCustomerModal');
  if (!modalEl || !window.bootstrap) return null;
  return bootstrap.Modal.getOrCreateInstance(modalEl);
}

  function updateRegFields() {
    const regCategory = document.getElementById('regCategory');
    const firstGrp = document.getElementById('regFirstNameGroup');
    const busGrp = document.getElementById('regBusinessNameGroup');

    if (!regCategory) return;

    const cat = regCategory.value;
    if (cat === 'artist' || cat === 'organisation') {
      if (firstGrp) firstGrp.style.display = 'none';
      if (busGrp) busGrp.style.display = '';
    } else {
      if (firstGrp) firstGrp.style.display = '';
      if (busGrp) busGrp.style.display = 'none';
    }
  }

function openEditCustomerModal(customer) {
  if (!customer || !customer._id) {
    console.error('Invalid customer passed to openEditCustomerModal');
    return;
  }

  const modalEl = document.getElementById('registerCustomerModal');
  if (!modalEl) {
    console.error('registerCustomerModal not found on this page');
    return;
  }

  // ✅ SET EDIT MODE
  window.editingCustomerId = customer._id;

  // ✅ Update title
  const titleEl = document.getElementById('registerCustomerModalLabel');
  if (titleEl) titleEl.textContent = 'Edit Customer';

  // ✅ Update button text
  const saveBtn = document.getElementById('saveCustomerBtn');
  if (saveBtn) saveBtn.textContent = 'Update';

  // Fill form
  const categoryEl = document.getElementById('regCategory');
  if (categoryEl) {
    const category = String(customer.category || 'one_time').trim().toLowerCase();
    categoryEl.value = category;

    // Do not let a legacy/unsupported value become an empty PATCH category.
    if (!categoryEl.value) categoryEl.value = 'one_time';
  }

  updateRegFields();

  const firstNameEl = document.getElementById('regFirstName');
  if (firstNameEl) firstNameEl.value = customer.firstName || '';

  const businessNameEl = document.getElementById('regBusinessName');
  if (businessNameEl) businessNameEl.value = customer.businessName || '';

  const phoneEl = document.getElementById('regPhone');
  if (phoneEl) phoneEl.value = customer.phone || '';

  const notesEl = document.getElementById('regNotes');
  if (notesEl) notesEl.value = customer.notes || '';

  const modal = getRegModalInstance();
if (modal) modal.show();

}

  // expose globally
  window.openEditCustomerModal = openEditCustomerModal;

})();
