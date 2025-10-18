// public/javascripts/services_admin.js
// Robust AJAX add for Service, Unit, and Sub-unit forms.
// Defensive handling so buttons never stay stuck disabled after invalid submit.
// Uses application/x-www-form-urlencoded so express.urlencoded() can parse req.body.

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const mainRowSelector = '.row.g-4';

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    const spinner = btn.querySelector('.spinner-border');
    if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
    if (loading) {
      btn.classList.add('loading');
      btn.setAttribute('disabled', 'disabled');
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    } else {
      btn.classList.remove('loading');
      try { btn.removeAttribute('disabled'); } catch (e) {}
      btn.disabled = false;
      try { btn.removeAttribute('aria-disabled'); } catch (e) {}
    }
  }

  function forceEnableButton(btn) {
    if (!btn) return;
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
        // show global toast (uses toast.js)
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
    if (e && e.submitter) return e.submitter;
    const active = document.activeElement;
    if (active && (active.tagName === 'BUTTON' || active.tagName === 'INPUT') && form.contains(active)) {
      return active;
    }
    return form.querySelector('button[type="submit"], button');
  }

  function interceptFormSubmit(form) {
    if (!form) return;
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

  const addServiceForm = document.getElementById('add-service-form');
  if (addServiceForm) interceptFormSubmit(addServiceForm);

  const addUnitForm = document.getElementById('add-unit-form');
  if (addUnitForm) interceptFormSubmit(addUnitForm);

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
