// public/javascripts/delete_modal.js
// Handles showing a delete confirmation modal and submitting the deletion via form or AJAX,
// then showing a toast on success and refreshing the fragment.

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const deleteModalEl = document.getElementById('deleteConfirmModal');
  let deleteModal = null;
  if (deleteModalEl && window.bootstrap && window.bootstrap.Modal) {
    deleteModal = new bootstrap.Modal(deleteModalEl);
  }

  let pendingAction = null;

  // open modal when user clicks any .open-delete-modal button
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.open-delete-modal');
    if (!btn) return;
    e.preventDefault();
    pendingAction = btn.dataset.action || btn.getAttribute('data-action') || btn.getAttribute('href') || null;
    const itemType = btn.dataset.itemType || btn.getAttribute('data-item-type') || 'Item';
    const itemName = btn.dataset.itemName || btn.getAttribute('data-item-name') || '';
    const msg = itemName ? `Delete ${itemType}: "${itemName}"?` : `Delete ${itemType}?`;
    const msgEl = document.getElementById('deleteConfirmMessage');
    if (msgEl) msgEl.textContent = msg;
    if (deleteModal) deleteModal.show();
  });

  // Confirm button action
  const confirmBtn = document.getElementById('confirmDeleteBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async function () {
      if (!pendingAction) {
        // nothing to do
        if (deleteModal) deleteModal.hide();
        return;
      }

      // If the action looks like a regular form action (method override), submit via fetch
      try {
        // parse action URL and method from string; we assume server expects DELETE with ?_method=DELETE or endpoint accepting DELETE
        let url = pendingAction;
        let method = 'POST';
        // if action contains ?_method=DELETE we will still POST URL encoded so server handles it (because we use existing handlers)
        if (url.includes('_method=DELETE') || url.includes('_method=delete')) {
          method = 'POST';
        } else {
          // try using DELETE request if endpoint supports it
          method = 'DELETE';
        }

        // Decide whether to use AJAX or fallback to creating and submitting a hidden form
        // We'll prefer AJAX so we can show toast and refresh fragment.
        const headers = { 'X-Requested-With': 'XMLHttpRequest' };

        let opts = { method, headers };
        // For POST with _method=DELETE it's easier to just do a simple form-encoded body if needed.
        if (method === 'POST') {
          // preserve query string if present
          opts.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
          // ensure body contains nothing (server only reads _method from query)
          opts.body = '';
        }

        const res = await fetch(url, opts);

        if (res.ok) {
          // hide modal, show toast, refresh fragment
          if (deleteModal) deleteModal.hide();
          if (window.showGlobalToast) window.showGlobalToast('Deleted.', 2500);
          // refresh the services main area
          // reuse the same refresh strategy as services_admin.js: fetch /admin/services and replace .row.g-4
          try {
            const fragmentRes = await fetch('/admin/services', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            if (fragmentRes.ok) {
              const html = await fragmentRes.text();
              const parser = new DOMParser();
              const doc = parser.parseFromString(html, 'text/html');
              const newMainRow = doc.querySelector('.row.g-4');
              const old = document.querySelector('.row.g-4');
              if (newMainRow && old && old.parentNode) {
                old.parentNode.replaceChild(newMainRow, old);
              } else {
                window.location.reload();
              }
            } else {
              window.location.reload();
            }
          } catch (err) {
            console.error('refresh after delete failed', err);
            window.location.reload();
          }
        } else {
          // non-ok -> redirect or show error
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json().catch(() => null);
            const msg = j && j.error ? j.error : 'Delete failed';
            alert(msg);
          } else {
            window.location.reload();
          }
        }
      } catch (err) {
        console.error('delete action failed', err);
        window.location.reload();
      } finally {
        pendingAction = null;
      }
    });
  }
});
