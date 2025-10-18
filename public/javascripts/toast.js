// public/javascripts/toast.js
// Small global toast utility used by multiple scripts.
// Ensures a toast element exists and provides a simple API: showGlobalToast(message, delayMs)

(function () {
  'use strict';

  // create toast DOM (Bootstrap 5 markup) if not present
  function ensureToastExists() {
    let container = document.getElementById('globalToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'globalToastContainer';
      container.className = 'position-fixed';
      container.style.bottom = '1rem';
      container.style.right = '1rem';
      container.style.zIndex = '1080';
      document.body.appendChild(container);
    }

    let toast = document.getElementById('globalToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'globalToast';
      toast.className = 'toast align-items-center text-bg-success border-0';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.setAttribute('aria-atomic', 'true');

      const toastBody = document.createElement('div');
      toastBody.id = 'globalToastBody';
      toastBody.className = 'd-flex';
      // message span
      const msgSpan = document.createElement('div');
      msgSpan.id = 'globalToastMsg';
      msgSpan.className = 'toast-body';
      msgSpan.textContent = 'Saved.';
      // close button
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn-close btn-close-white me-2 m-auto';
      closeBtn.setAttribute('data-bs-dismiss', 'toast');
      closeBtn.setAttribute('aria-label', 'Close');

      toastBody.appendChild(msgSpan);
      toastBody.appendChild(closeBtn);
      toast.appendChild(toastBody);
      container.appendChild(toast);
    }
    return { container, toast, msgEl: document.getElementById('globalToastMsg') };
  }

  // show function
  function showGlobalToast(message, delay = 2500) {
    try {
      if (!window.bootstrap || !window.bootstrap.Toast) {
        // fallback: simple alert (very rare)
        console.log('Toast:', message);
        return;
      }
      const els = ensureToastExists();
      if (els.msgEl) els.msgEl.textContent = message;
      const toastInstance = bootstrap.Toast.getInstance(els.toast) || new bootstrap.Toast(els.toast, { delay });
      toastInstance.show();
    } catch (err) {
      // safe fallback
      console.log('Toast fallback:', message, err);
    }
  }

  // expose globally
  window.showGlobalToast = showGlobalToast;
})();
