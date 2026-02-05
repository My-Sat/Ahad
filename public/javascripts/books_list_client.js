// public/javascripts/books_list_client.js
function initBooksListPage() {
  'use strict';

  const table = document.getElementById('booksTable');
  if (!table) return;
  if (table.dataset.booksListInit === '1') return;
  table.dataset.booksListInit = '1';

  const tbody = table.querySelector('tbody');

  function escapeHtml(s) {
    if (!s && s !== 0) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

  // Create a reusable Bootstrap confirmation modal (for deletes)
  function ensureConfirmModal() {
    let modalEl = document.getElementById('bookConfirmModal');
    if (modalEl) return modalEl;
    const html = `
<div class="modal fade" id="bookConfirmModal" tabindex="-1" aria-labelledby="bookConfirmModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-sm modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="bookConfirmModalLabel">Confirm</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body" id="bookConfirmModalBody"></div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" data-action="cancel" type="button">Cancel</button>
        <button class="btn btn-danger btn-sm" data-action="confirm" type="button">Delete</button>
      </div>
    </div>
  </div>
</div>`;
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container.firstElementChild);
    modalEl = document.getElementById('bookConfirmModal');
    return modalEl;
  }

  // Create a simple loading spinner HTML fragment
  function spinnerHtml() {
    return '<div class="text-center py-2"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div></div>';
  }

  async function loadList() {
    try {
      const res = await fetch('/books/list', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error('Failed to load');
      const j = await res.json().catch(()=>null);
      if (!j || !Array.isArray(j.books)) throw new Error('Invalid response');
      renderRows(j.books);
    } catch (err) {
      console.error('books list load err', err);
      tbody.innerHTML = '<tr><td class="text-muted-light" colspan="4">Unable to load service.</td></tr>';
    }
  }

  function renderRows(rows) {
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted-light" colspan="4">No service created yet.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(b => {
      const tr = document.createElement('tr');
      tr.className = 'book-row';
      tr.setAttribute('data-id', b._id);
      const created = b.createdAt ? (new Date(b.createdAt)).toLocaleString() : '';
      tr.innerHTML = `
        <td>${escapeHtml(b.name || '')}</td>
        <td class="text-end">GH₵ ${Number(b.unitPrice || 0).toFixed(2)}</td>
        <td class="text-center">${escapeHtml(created)}</td>
        <td class="text-center">
          <button
            class="btn btn-sm btn-outline-secondary preview-book-btn"
            type="button"
            data-id="${escapeHtml(b._id)}"
          >
            Preview
          </button>

          <a
            class="btn btn-sm btn-primary ms-1"
            href="/books/new?id=${escapeHtml(b._id)}"
          >
            Edit
          </a>

          <button
            class="btn btn-sm btn-danger ms-1 delete-book-btn"
            type="button"
            data-id="${escapeHtml(b._id)}"
          >
            Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);

      // preview placeholder row (hidden initially)
      const pr = document.createElement('tr');
      pr.className = 'book-preview-row';
      pr.setAttribute('data-id', b._id);
      pr.style.display = 'none';
      // NOTE: include dark-card-body on the preview container so it matches the dark theme and isn't white
      pr.innerHTML = `<td colspan="4"><div class="book-preview-container dark-card-body">${spinnerHtml()}</div></td>`;
      tbody.appendChild(pr);
    });
  }

  // Delegated click: preview and delete buttons
  tbody.addEventListener('click', function (ev) {
    const previewBtn = ev.target.closest('.preview-book-btn');
    if (previewBtn) {
      const id = previewBtn.getAttribute('data-id');
      if (!id) return;
      togglePreviewRow(id, previewBtn);
      return;
    }

    const btn = ev.target.closest('.delete-book-btn');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (!id) return;
    // show bootstrap confirm modal
    showDeleteConfirm(id, btn);
  });

  // Toggle preview row (expand/collapse). Caches fetched data in the DOM to avoid repeated fetches.
  async function togglePreviewRow(id, btn) {
    const previewRow = tbody.querySelector(`tr.book-preview-row[data-id="${id}"]`);
    if (!previewRow) return;
    const container = previewRow.querySelector('.book-preview-container');
    if (!container) return;

    if (previewRow.style.display === 'none' || previewRow.style.display === '') {
      // show -> load details if not cached
      previewRow.style.display = '';
      // if already loaded with data attribute `data-loaded="1"`, just return
      if (previewRow.getAttribute('data-loaded') === '1') return;
      container.innerHTML = spinnerHtml();
      try {
        const res = await fetch('/books/' + encodeURIComponent(id), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!res.ok) {
          container.innerHTML = `<div class="text-danger small">Unable to load preview</div>`;
          return;
        }
        const j = await res.json().catch(()=>null);
        if (!j || !j.book) {
          container.innerHTML = `<div class="text-muted small">No preview available</div>`;
          return;
        }
        const book = j.book;
        // Render a simple table of constituent items
        const rows = (book.items || []).map((it, idx) => {
          const selLabel = it.selectionLabel || (it.selections && it.selections.length ? it.selections.map(s => (s.subUnit ? (s.subUnit.name || String(s.subUnit)) : '')).join(', ') : '(no label)');
          const pagesOrig = Number(it.pages || 1);
          const isFb = !!it.fb;
          const effective = isFb ? Math.ceil(pagesOrig / 2) : pagesOrig;
          const unit = (typeof it.unitPrice !== 'undefined' && it.unitPrice !== null) ? Number(it.unitPrice) : '';
          const subtotal = (typeof it.subtotal !== 'undefined' && it.subtotal !== null) ? Number(it.subtotal) : (unit ? (unit * effective) : '');
          return `<tr>
              <td style="min-width:280px">${escapeHtml(selLabel)}${isFb ? ' <span class="badge bg-secondary ms-2">F/B</span>' : ''}</td>
              <td class="text-center">${escapeHtml(String(effective))}${pagesOrig !== effective ? ` <small class="text-muted">(orig ${pagesOrig})</small>` : ''}</td>
              <td class="text-end">GH₵ ${unit ? unit.toFixed(2) : '-'}</td>
              <td class="text-end">GH₵ ${subtotal ? Number(subtotal).toFixed(2) : '-'}</td>
            </tr>`;
        }).join('');
        const html = `
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead><tr><th>Selection</th><th class="text-center">QTY</th><th class="text-end">Unit</th><th class="text-end">Subtotal</th></tr></thead>
              <tbody>${rows || '<tr><td class="text-muted" colspan="4">No items</td></tr>'}</tbody>
            </table>
          </div>
        `;
        // leave container element's classes intact (it already has dark-card-body)
        container.innerHTML = html;
        previewRow.setAttribute('data-loaded', '1');
      } catch (err) {
        console.error('preview load err', err);
        container.innerHTML = `<div class="text-danger small">Network error loading preview</div>`;
      }
    } else {
      // hide
      previewRow.style.display = 'none';
    }
  }

  // Show delete confirmation modal (Bootstrap)
  function showDeleteConfirm(id, sourceBtn) {
    const modalEl = ensureConfirmModal();
    const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    const body = modalEl.querySelector('#bookConfirmModalBody');
    body.textContent = 'Delete this book? This cannot be undone. Existing orders are not affected.';
    const btnConfirm = modalEl.querySelector('[data-action="confirm"]');
    const btnCancel = modalEl.querySelector('[data-action="cancel"]');

    // cleanup handler references
    function cleanup() {
      btnConfirm.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      modalEl.removeEventListener('hidden.bs.modal', onHidden);
    }
    async function onConfirm() {
      cleanup();
      inst.hide();
      // show spinner on source button
      const original = sourceBtn.innerHTML;
      sourceBtn.disabled = true;
      sourceBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
      try {
        const res = await fetch('/books/' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' }
        });
        const j = await res.json().catch(()=>null);
        if (!res.ok) {
          const msg = (j && j.error) ? j.error : `Delete failed (${res.status})`;
          alert(msg);
          sourceBtn.disabled = false;
          sourceBtn.innerHTML = original;
          return;
        }
        // remove the row and its preview row
        const row = tbody.querySelector(`tr.book-row[data-id="${id}"]`);
        const previewRow = tbody.querySelector(`tr.book-preview-row[data-id="${id}"]`);
        if (row) row.remove();
        if (previewRow) previewRow.remove();
        if (!tbody.querySelector('tr')) {
          tbody.innerHTML = '<tr><td class="text-muted-light" colspan="4">No service created yet.</td></tr>';
        }
        if (typeof window.showGlobalToast === 'function') window.showGlobalToast('Book deleted', 1400);
      } catch (err) {
        console.error('delete book err', err);
        alert('Network error deleting book');
        sourceBtn.disabled = false;
        sourceBtn.innerHTML = original;
      }
    }
    function onCancel() {
      cleanup();
      inst.hide();
    }
    function onHidden() { cleanup(); }

    btnConfirm.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    modalEl.addEventListener('hidden.bs.modal', onHidden);
    inst.show();
  }

  // initial load: prefer client refresh to ensure latest
  loadList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initBooksListPage();
  }, { once: true });
} else {
  initBooksListPage();
}

document.addEventListener('ajax:page:loaded', function () {
  initBooksListPage();
});
