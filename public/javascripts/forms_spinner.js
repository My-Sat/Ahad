// public/javascripts/forms_spinner.js
// Adds a small spinner and disables the submit button while the form is being submitted.
// Works for normal (non-AJAX) form submissions and for AJAX ones too (spinner shows until you hide it).
(function () {
  function addSpinnerOnSubmit(formSelector, btnSelector, spinnerSelector) {
    const form = document.querySelector(formSelector);
    if (!form) return;
    form.addEventListener('submit', function (ev) {
      try {
        // Find the submit button; use provided selector or fallback to first submit button in the form
        let btn = btnSelector ? form.querySelector(btnSelector) : form.querySelector('button[type="submit"], input[type="submit"]');
        if (!btn) return;
        // Show spinner if present
        const spinner = spinnerSelector ? form.querySelector(spinnerSelector) : btn.querySelector('.spinner-border');
        if (spinner) spinner.style.display = 'inline-block';
        // Disable button to prevent double submits
        btn.disabled = true;
        btn.classList.add('loading');
        // allow submission to proceed (do not call preventDefault)
      } catch (err) {
        // don't block submission on JS errors
        console.error('Spinner handler error', err);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Add spinner behavior for Add Service form
    addSpinnerOnSubmit('#add-service-form', '#addServiceBtn', '#addServiceSpinner');

    // Add spinner behavior for Add Unit form
    addSpinnerOnSubmit('#add-unit-form', '#addUnitBtn', '#addUnitSpinner');

    // If you have other forms that should show spinner, call addSpinnerOnSubmit with the appropriate selectors.
  });
})();
