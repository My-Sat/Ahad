// public/javascripts/forms_spinner.js
// Robust spinner helper. Works for normal and AJAX form submissions.
// Exposes window.__FormSpinner.show(btn) and .hide(btn)
(function () {
  'use strict';

  const SPINNER_CLASS = 'cc-btn-spinner';
  const SPINNER_DATA = 'data-spinner-active';
  const LAST_CLICK_ATTR = 'data-last-clicked';

  // create spinner element (Bootstrap style) and append to button
  function _createSpinnerEl() {
    const s = document.createElement('span');
    s.className = `${SPINNER_CLASS} spinner-border spinner-border-sm ms-2`;
    s.setAttribute('role', 'status');
    s.setAttribute('aria-hidden', 'true');
    s.style.display = 'inline-block';
    return s;
  }

  // show spinner on a button element (idempotent)
  function showButtonSpinner(btn) {
    if (!btn || !(btn instanceof Element)) return;
    try {
      if (btn.getAttribute(SPINNER_DATA) === '1') return; // already active
      btn.setAttribute(SPINNER_DATA, '1');
      // disable button
      try { btn.disabled = true; } catch (e) {}
      // ensure spinner exists
      let spinner = btn.querySelector(`.${SPINNER_CLASS}`);
      if (!spinner) {
        spinner = _createSpinnerEl();
        btn.appendChild(spinner);
      } else {
        spinner.style.display = 'inline-block';
      }
      btn.classList.add('loading'); // optional class for styling
    } catch (err) {
      console.error('showButtonSpinner error', err);
    }
  }

  // hide spinner and re-enable button
  function hideButtonSpinner(btn) {
    if (!btn || !(btn instanceof Element)) return;
    try {
      btn.setAttribute(SPINNER_DATA, '0');
      try { btn.disabled = false; } catch (e) {}
      const spinner = btn.querySelector(`.${SPINNER_CLASS}`);
      if (spinner) spinner.style.display = 'none';
      btn.classList.remove('loading');
    } catch (err) {
      console.error('hideButtonSpinner error', err);
    }
  }

  // find the submit button that triggered the form submit
  function findTriggerButtonForForm(form) {
    if (!form) return null;
    // prefer explicitly marked last-clicked within this form
    const marked = form.querySelector(`[${LAST_CLICK_ATTR}="1"]`);
    if (marked) return marked;
    // fallback: first submit button inside form
    const first = form.querySelector('button[type="submit"], input[type="submit"]');
    if (first) return first;
    return null;
  }

  // Track last-clicked submit button (capture phase)
  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('button[type="submit"], input[type="submit"]') : null;
    if (!btn) return;
    // clear previous markers in same form
    const form = btn.form;
    if (form) {
      form.querySelectorAll(`[${LAST_CLICK_ATTR}="1"]`).forEach(b => b.removeAttribute(LAST_CLICK_ATTR));
      btn.setAttribute(LAST_CLICK_ATTR, '1');
    } else {
      // global (buttons outside forms) - clear global markers
      document.querySelectorAll(`[${LAST_CLICK_ATTR}="1"]`).forEach(b => b.removeAttribute(LAST_CLICK_ATTR));
      btn.setAttribute(LAST_CLICK_ATTR, '1');
    }
  }, true);

  // On form submit (capture) show spinner on the triggering button
  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    // allow opt-out
    if (form.dataset.disableSpinner === 'true') return;
    const btn = findTriggerButtonForForm(form);
    if (btn) {
      showButtonSpinner(btn);
      return;
    }
    // fallback: try to find page primary submit button
    const fallback = document.querySelector('button.primary-action[type="submit"], button.btn-primary[type="submit"]');
    if (fallback) showButtonSpinner(fallback);
  }, true);

  // For standalone buttons that trigger AJAX / JS actions: mark with data-spinner="true"
  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-spinner="true"]') : null;
    if (!btn) return;
    // If it's part of a form, the form submit handler will manage it; otherwise show spinner now
    if (btn.form) return;
    showButtonSpinner(btn);
  }, true);

  // Public API
  window.__FormSpinner = {
    show: showButtonSpinner,
    hide: hideButtonSpinner
  };

  // Optional: expose helper to find the current trigger button for a form
  window.__FormSpinner.findTriggerButtonForForm = findTriggerButtonForForm;

})();
