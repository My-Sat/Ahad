// public/javascripts/books_list_client.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const table = document.getElementById('booksTable');
  if (!table) return;

  const tbody = table.querySelector('tbody');

  function escapeHtml(s) {
    if (!s && s !== 0) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
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
      tbody.innerHTML = '<tr><td class="text-muted" colspan="4">Unable to load books.</td></tr>';
    }
  }

  function renderRows(rows) {
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="4">No books created yet.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(b => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', b._id);
      const created = b.createdAt ? (new Date(b.createdAt)).toLocaleString() : '';
      tr.innerHTML = `
        <td>${escapeHtml(b.name || '')}</td>
        <td class="text-end">GH₵ ${Number(b.unitPrice || 0).toFixed(2)}</td>
        <td class="text-center">${escapeHtml(created)}</td>
        <td class="text-center"><button class="btn btn-sm btn-outline-danger delete-book-btn" type="button" data-id="${escapeHtml(b._id)}">Delete</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Delegated click: delete buttons
  tbody.addEventListener('click', function (ev) {
    const btn = ev.target.closest('.delete-book-btn');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    if (!id) return;
    // confirm
    const ok = confirm('Delete this book? This cannot be undone. Existing orders are not affected.');
    if (!ok) return;
    deleteBook(id, btn);
  });

  async function deleteBook(id, btn) {
    try {
      btn.disabled = true;
      const res = await fetch('/books/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' }
      });
      const j = await res.json().catch(()=>null);
      if (!res.ok) {
        const msg = (j && j.error) ? j.error : `Delete failed (${res.status})`;
        alert(msg);
        btn.disabled = false;
        return;
      }
      // remove the row from table
      const row = tbody.querySelector(`tr[data-id="${id}"]`);
      if (row) row.remove();
      // if no rows left show empty state
      if (!tbody.querySelector('tr')) {
        tbody.innerHTML = '<tr><td class="text-muted" colspan="4">No books created yet.</td></tr>';
      }
      if (typeof window.showGlobalToast === 'function') window.showGlobalToast('Book deleted', 1400);
    } catch (err) {
      console.error('delete book err', err);
      alert('Network error deleting book');
      if (btn) btn.disabled = false;
    }
  }

  // initial load: prefer client refresh to ensure latest
  loadList();
});
