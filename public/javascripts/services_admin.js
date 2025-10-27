// public/javascripts/services_admin.js
// Robust AJAX add for Service, Unit, and Sub-unit forms.
// Defensive handling so buttons never stay stuck disabled after invalid submit.
// Uses application/x-www-form-urlencoded so express.urlencoded() can parse req.body.

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

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

});
