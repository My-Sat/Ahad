// public/javascripts/customer_editor.js
(function () {
  'use strict';

  if (typeof window.editingCustomerId === 'undefined') {
    window.editingCustomerId = null;
  }
  let regModal = null;
  let editingCustomerId = null;

  function initCustomerEditor() {
    const regModalEl = document.getElementById('registerCustomerModal');
    if (window.bootstrap && regModalEl) {
      regModal = new bootstrap.Modal(regModalEl);
    }
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

  window.editingCustomerId = customer._id;


  const titleEl = document.getElementById('registerCustomerModalLabel');
  if (titleEl) titleEl.textContent = 'Edit Customer';

  const categoryEl = document.getElementById('regCategory');
  if (categoryEl) {
    categoryEl.value = customer.category || 'one_time';
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

  if (regModal) regModal.show();
}

  // expose globally
  window.openEditCustomerModal = openEditCustomerModal;
  window.initCustomerEditor = initCustomerEditor;

  document.addEventListener('DOMContentLoaded', initCustomerEditor);
})();
