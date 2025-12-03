// public/javascripts/books_client.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';
  const containers = document.querySelectorAll('.priceRulesContainer');

  // ---------- Inline dark alert modal helpers ----------
  function ensureInlineAlertModal() {
    let modalEl = document.getElementById('booksInlineAlertModal');
    if (modalEl) return modalEl;

    const container = document.createElement('div');
    container.innerHTML = ''
      + '<div class="modal fade" id="booksInlineAlertModal" tabindex="-1" aria-labelledby="booksInlineAlertModalLabel" aria-hidden="true">'
      + '  <div class="modal-dialog modal-dialog-centered">'
      + '    <div class="modal-content dark-surface">'
      + '      <div class="modal-header">'
      + '        <h5 class="modal-title" id="booksInlineAlertModalLabel">Notice</h5>'
      + '        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>'
      + '      </div>'
      + '      <div class="modal-body">'
      + '        <div class="dark-card-body" id="booksInlineAlertModalBodyContainer">'
      + '          <div id="booksInlineAlertModalBody"></div>'
      + '        </div>'
      + '      </div>'
      + '      <div class="modal-footer">'
      + '        <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">OK</button>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '</div>';

    document.body.appendChild(container.firstElementChild);
    modalEl = document.getElementById('booksInlineAlertModal');
    return modalEl;
  }

  function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }

  function showInlineAlert(message, title) {
    const modalEl = ensureInlineAlertModal();
    const titleEl = modalEl.querySelector('#booksInlineAlertModalLabel');
    const bodyEl = modalEl.querySelector('#booksInlineAlertModalBody');
    if (titleEl) titleEl.textContent = title || 'Notice';
    if (bodyEl) bodyEl.innerHTML = escapeHtml(String(message || ''));
    const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    inst.show();
  }
  // ---------- end inline modal helpers ----------

  async function loadServicePrices(serviceId, container) {
    container.innerHTML = '<div class="text-muted small">Loading...</div>';
    try {
      const res = await fetch(`/admin/services/${encodeURIComponent(serviceId)}/prices`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error('failed');
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'no data');
      const prices = (j.prices || []).map(p => ({ _id: p._id, selectionLabel: p.selectionLabel, unitPrice: Number(p.unitPrice), price2: (p.price2 !== undefined && p.price2 !== null) ? Number(p.price2) : null }));
      // render UI: each price rule with qty input, fb checkbox, printer select (if needed), spoiled
      const frag = document.createElement('div');
      frag.className = 'list-group';
      prices.forEach(p => {
        const row = document.createElement('div');
        row.className = 'list-group-item d-flex align-items-center gap-2';
        row.innerHTML = `
          <div style="flex:1;min-width:0;"><strong>${escapeHtml(p.selectionLabel)}</strong></div>
          <div class="d-flex gap-2 align-items-center">
            <input type="number" min="1" class="form-control form-control-sm rule-pages" placeholder="Qty" style="width:90px" />
            <div class="form-check form-check-inline ms-1">
              <input type="checkbox" class="form-check-input rule-fb" />
              <label class="form-check-label small">F/B</label>
            </div>
            <input type="number" min="0" class="form-control form-control-sm rule-spoiled" placeholder="Spoiled" style="width:96px" />
            <button class="btn btn-sm btn-outline-primary add-rule-to-book" type="button">Add</button>
          </div>
        `;
        // store price meta
        row._meta = p;
        frag.appendChild(row);
      });
      container.innerHTML = '';
      container.appendChild(frag);
      // delegate Add buttons
      frag.addEventListener('click', function (ev) {
        const btn = ev.target.closest('.add-rule-to-book');
        if (!btn) return;
        const row = btn.closest('.list-group-item');
        const pages = row.querySelector('.rule-pages').value || 1;
        const fb = !!row.querySelector('.rule-fb').checked;
        const spoiled = row.querySelector('.rule-spoiled').value || 0;
        const priceMeta = row._meta;
        if (!priceMeta) {
          showInlineAlert('Price rule not found', 'Error');
          return;
        }
        // create a "chosen" list in the container (append a li)
        let chosen = container.querySelector('.chosen-list');
        if (!chosen) {
          chosen = document.createElement('div');
          chosen.className = 'mt-2 chosen-list';
          container.appendChild(chosen);
        }
        const unitPrice = fb && priceMeta.price2 !== null && priceMeta.price2 !== undefined ? Number(priceMeta.price2) : Number(priceMeta.unitPrice || 0);
        const effectiveQty = fb ? Math.ceil(Number(pages) / 2) : Number(pages);
        const subtotal = Number((unitPrice * effectiveQty).toFixed(2));
        const itemHtml = document.createElement('div');
        itemHtml.className = 'mb-1';
        itemHtml.innerHTML = `
          <div class="d-flex justify-content-between align-items-center">
            <div><small class="text-muted">${escapeHtml(priceMeta.selectionLabel)}</small><div><strong>Unit: GH₵ ${unitPrice}</strong> <small class="text-muted">Q:${pages} (eff ${effectiveQty})</small></div></div>
            <div><button class="btn btn-sm btn-outline-danger remove-chosen">Remove</button></div>
          </div>
        `;
        // store the metadata for saving
        itemHtml._meta = {
          service: priceMeta._serviceId || null, // if you include service id in server price response; otherwise server will infer
          priceRule: priceMeta._id,
          pages: Number(pages),
          fb,
          spoiled: Number(spoiled),
          unitPrice,
          subtotal,
          selectionLabel: priceMeta.selectionLabel
        };
        chosen.appendChild(itemHtml);
        // remove handler
        itemHtml.querySelector('.remove-chosen').addEventListener('click', function () { itemHtml.remove(); });
      });
    } catch (err) {
      container.innerHTML = '<div class="text-danger small">Unable to load prices</div>';
    }
  }

  containers.forEach(c => {
    const sid = c.getAttribute('data-service-id');
    if (sid) loadServicePrices(sid, c);
  });

  // Save Book
  const saveBtn = document.getElementById('saveBookBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async function () {
      const nameInput = document.getElementById('bookName');
      if (!nameInput || !nameInput.value.trim()) {
        showInlineAlert('Enter a book name', 'Book name required');
        return;
      }
      const name = nameInput.value.trim();
      const allChosen = [];
      document.querySelectorAll('.chosen-list').forEach(list => {
        Array.from(list.children).forEach(ch => {
          if (ch._meta) allChosen.push(ch._meta);
        });
      });
      if (!allChosen.length) {
        showInlineAlert('Add at least one price rule to the book', 'No items');
        return;
      }
      // compute unitPrice (sum of subtotals)
      const unitPrice = allChosen.reduce((s, it) => s + (Number(it.subtotal) || 0), 0);
      try {
        const payload = { name, items: allChosen, unitPrice };
        const res = await fetch('/books', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(payload) });
        const j = await res.json().catch(()=>null);
        if (!res.ok) {
          showInlineAlert((j && j.error) ? j.error : 'Failed to save book', 'Save failed');
          return;
        }
        // on success navigate back to orders page (or show a success message)
        window.location.href = '/orders/new';
      } catch (err) {
        console.error('save book err', err);
        showInlineAlert('Network error saving book', 'Network error');
      }
    });
  }
});
