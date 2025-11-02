// public/javascripts/forms_spinner.js
(function () {
  'use strict';

  const SPINNER_CLASS = 'cc-btn-spinner';
  const SPINNER_DATA = 'data-spinner-active';
  const LAST_CLICK_ATTR = 'data-last-clicked';

  function _createSpinnerEl() {
    const s = document.createElement('span');
    s.className = `${SPINNER_CLASS} spinner-border spinner-border-sm ms-2`;
    s.setAttribute('role', 'status');
    s.setAttribute('aria-hidden', 'true');
    s.style.display = 'inline-block';
    return s;
  }

  function showButtonSpinner(btn) {
    if (!btn || !(btn instanceof Element)) return;
    try {
      if (btn.getAttribute(SPINNER_DATA) === '1') return; // already active
      btn.setAttribute(SPINNER_DATA, '1');
      try { btn.disabled = true; } catch (e) {}

      // Prefer an existing cc-btn-spinner element first, then any spinner-border inside the button.
      let spinner = btn.querySelector(`.${SPINNER_CLASS}`);
      if (!spinner) {
        // If there is a spinner-border inserted by server markup (like in templates), reuse it.
        spinner = btn.querySelector('.spinner-border');
        if (spinner) {
          // mark it as our spinner (so hide logic can find it) by adding our class if missing
          if (!spinner.classList.contains(SPINNER_CLASS)) spinner.classList.add(SPINNER_CLASS);
          spinner.style.display = 'inline-block';
        } else {
          // no spinner found — create our own
          spinner = _createSpinnerEl();
          btn.appendChild(spinner);
        }
      } else {
        spinner.style.display = 'inline-block';
      }
      btn.classList.add('loading');
    } catch (err) {
      console.error('showButtonSpinner error', err);
    }
  }

  function hideButtonSpinner(btn) {
    if (!btn || !(btn instanceof Element)) return;
    try {
      btn.setAttribute(SPINNER_DATA, '0');
      try { btn.disabled = false; } catch (e) {}
      const spinner = btn.querySelector(`.${SPINNER_CLASS}`);
      if (spinner) spinner.style.display = 'none';
      // also hide any spinner-border that might not have our class
      const alt = btn.querySelector('.spinner-border:not(.' + SPINNER_CLASS + ')');
      if (alt) alt.style.display = 'none';
      btn.classList.remove('loading');
    } catch (err) {
      console.error('hideButtonSpinner error', err);
    }
  }

  function findTriggerButtonForForm(form) {
    if (!form) return null;
    const marked = form.querySelector(`[${LAST_CLICK_ATTR}="1"]`);
    if (marked) return marked;
    const first = form.querySelector('button[type="submit"], input[type="submit"]');
    if (first) return first;
    return null;
  }

  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('button[type="submit"], input[type="submit"]') : null;
    if (!btn) return;
    const form = btn.form;
    if (form) {
      form.querySelectorAll(`[${LAST_CLICK_ATTR}="1"]`).forEach(b => b.removeAttribute(LAST_CLICK_ATTR));
      btn.setAttribute(LAST_CLICK_ATTR, '1');
    } else {
      document.querySelectorAll(`[${LAST_CLICK_ATTR}="1"]`).forEach(b => b.removeAttribute(LAST_CLICK_ATTR));
      btn.setAttribute(LAST_CLICK_ATTR, '1');
    }
  }, true);

  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if (form.dataset.disableSpinner === 'true') return;
    const btn = findTriggerButtonForForm(form);
    if (btn) {
      showButtonSpinner(btn);
      return;
    }
    const fallback = document.querySelector('button.primary-action[type="submit"], button.btn-primary[type="submit"]');
    if (fallback) showButtonSpinner(fallback);
  }, true);

  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-spinner="true"]') : null;
    if (!btn) return;
    if (btn.form) return;
    showButtonSpinner(btn);
  }, true);

  window.__FormSpinner = {
    show: showButtonSpinner,
    hide: hideButtonSpinner
  };

  window.__FormSpinner.findTriggerButtonForForm = findTriggerButtonForForm;

})();
