// public/javascripts/printers.js
// Client JS for the printers list & details modal
(function () {
  'use strict';

  // Elements (page-level)
  const addForm = document.getElementById('add-printer-form');
  const addNameEl = document.getElementById('addPrinterName');
  const addBtn = document.getElementById('addPrinterBtn');
  const addSpinner = document.getElementById('addPrinterSpinner');
  const addSuccess = document.getElementById('addPrinterSuccess');
  const addSuccessText = document.getElementById('addPrinterSuccessText');
  const printersTbody = document.getElementById('printersTbody');

  // Modals and modal elements
  const editModalEl = document.getElementById('editPrinterModal');
  const editModal = (window.bootstrap && editModalEl) ? new bootstrap.Modal(editModalEl) : null;
  const editIdEl = document.getElementById('editPrinterId');
  const editNameEl = document.getElementById('editPrinterName');
  const saveEditBtn = document.getElementById('saveEditPrinterBtn');

  const delModalEl = document.getElementById('printersDeleteConfirm');
  const delModal = (window.bootstrap && delModalEl) ? new bootstrap.Modal(delModalEl) : null;
  const delMessage = document.getElementById('printersDeleteMessage');
  const confirmDeleteBtn = document.getElementById('confirmDeletePrinterBtn');

  const adjustModalEl = document.getElementById('adjustPrinterModal');
  const adjustModal = (window.bootstrap && adjustModalEl) ? new bootstrap.Modal(adjustModalEl) : null;
  const adjustIdEl = document.getElementById('adjustPrinterId');
  const adjustModeEl = document.getElementById('adjustPrinterMode');
  const adjustValueEl = document.getElementById('adjustPrinterValue');
  const doAdjustBtn = document.getElementById('doAdjustPrinterBtn');

  const detailsModalEl = document.getElementById('printerDetailsModal');
  const detailsModal = (window.bootstrap && detailsModalEl) ? new bootstrap.Modal(detailsModalEl) : null;
  const pdHeader = document.getElementById('printerDetailsHeader');
  const pdSummary = document.getElementById('printerDetailsSummary');
  const pdCountValue = document.getElementById('pd-count-value');
  const pdRevValue = document.getElementById('pd-rev-value');
  const pdRecentLoading = document.getElementById('pd-recent-loading');
  const pdRecentList = document.getElementById('pd-recent-list');

  // date range controls
  const pdRangeStart = document.getElementById('pd-range-start');
  const pdRangeEnd = document.getElementById('pd-range-end');
  const pdRangeRefresh = document.getElementById('pd-range-refresh');

  let pendingDeleteAction = null;
  let pendingDeleteRow = null;

  // Helpers
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }
  function escapeHtmlAttr(s) {
    if (!s) return '';
    return String(s).replace(/["']/g, function (c) { return c === '"' ? '&quot;' : '&#39;'; });
  }

function createPrinterRow(pr) {
  const tr = document.createElement('tr');
  tr.setAttribute('data-id', pr._id);
  tr.setAttribute('data-mono-count', (typeof pr.monochromeCount !== 'undefined' && pr.monochromeCount !== null) ? pr.monochromeCount : 0);
  tr.setAttribute('data-colour-count', (typeof pr.colourCount !== 'undefined' && pr.colourCount !== null) ? pr.colourCount : 0);

  // Build breakdown lines if values exist (server may supply 0 explicitly)
  const monoExists = (typeof pr.monochromeCount !== 'undefined' && pr.monochromeCount !== null);
  const colourExists = (typeof pr.colourCount !== 'undefined' && pr.colourCount !== null);

  const monoHtml = monoExists
    ? `<div class="small mb-1 mono-value">Monochrome: ${escapeHtml(String(pr.monochromeCount || 0))}</div>`
    : '';
  const colourHtml = colourExists
    ? `<div class="small mb-0 colour-value">Colour: ${escapeHtml(String(pr.colourCount || 0))}</div>`
    : '';

  // collapse id (unique per printer)
  const collapseId = `printer-totals-${pr._id}`;

  tr.innerHTML = `
    <td>
      <div class="d-flex align-items-center justify-content-between">
        <div class="me-3" style="min-width:0;">
          <strong class="printer-name">${escapeHtml(pr.name)}</strong>
          ${pr.location ? '<br><small class="text-muted">' + escapeHtml(pr.location) + '</small>' : ''}
        </div>
      </div>
    </td>
    <td class="text-center">
      <div class="printer-total-wrap position-relative">
        <div class="printer-total-box d-flex align-items-center justify-content-center">
          <span class="total-label small text-muted me-2">Total:</span>
          <span class="total-value text-end"><strong>${pr.totalCount || 0}</strong></span>
        </div>
        ${ (pr.monochromeCount || pr.colourCount) ? `
          <button class="btn btn-sm btn-link expand-toggle position-absolute top-50 end-0 translate-middle-y" type="button" aria-expanded="false" aria-controls="printer-totals-${pr._id}" title="Show breakdown" data-bs-toggle="collapse" data-bs-target="#printer-totals-${pr._id}">
            <i class="bi bi-chevron-down"></i>
          </button>
        ` : '' }
      </div>

      ${ (pr.monochromeCount || pr.colourCount) ? `
        <div class="collapse mt-2" id="printer-totals-${pr._id}">
          <div class="card card-body p-2">
            ${ pr.monochromeCount ? `<div class="small mb-1 mono-value">Monochrome: ${pr.monochromeCount}</div>` : '' }
            ${ pr.colourCount ? `<div class="small mb-0 colour-value">Colour: ${pr.colourCount}</div>` : '' }
          </div>
        </div>
      ` : '' }
    </td>
    <td class="text-center">
      <div class="btn-group">
        <button class="btn btn-sm btn-light dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Actions">
          <i class="bi bi-three-dots"></i>
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><a class="dropdown-item role-action-details" href="#" data-printer-id="${pr._id}" data-printer-name="${escapeHtmlAttr(pr.name)}"><i class="bi bi-eye me-2"></i>View</a></li>
          <li><a class="dropdown-item role-action-edit" href="#" data-printer-id="${pr._id}" data-printer-name="${escapeHtmlAttr(pr.name)}"><i class="bi bi-pencil me-2"></i>Edit</a></li>
          <li><a class="dropdown-item role-action-delete" href="#" data-action="/admin/printers/${pr._id}" data-printer-name="${escapeHtmlAttr(pr.name)}"><i class="bi bi-trash me-2"></i>Delete</a></li>
          <li><a class="dropdown-item role-action-adjust" href="#" data-printer-id="${pr._id}" data-printer-name="${escapeHtmlAttr(pr.name)}"><i class="bi bi-tools me-2"></i>Adjust count</a></li>
        </ul>
      </div>
    </td>
  `;

  // If collapse exists, wire icon toggle behavior to keep UI in sync.
  // This ensures the chevron flips when collapse opens/closes.
  try {
    const collapseEl = tr.querySelector(`#${collapseId}`);
    const toggleBtn = tr.querySelector('.expand-toggle');
    if (collapseEl && toggleBtn && window.bootstrap && window.bootstrap.Collapse) {
      // When collapse shown -> change icon to up
      collapseEl.addEventListener('shown.bs.collapse', function () {
        const ico = toggleBtn.querySelector('i');
        if (ico) {
          ico.classList.remove('bi-chevron-down');
          ico.classList.add('bi-chevron-up');
        }
        toggleBtn.setAttribute('aria-expanded', 'true');
      });
      // When collapse hidden -> change icon to down
      collapseEl.addEventListener('hidden.bs.collapse', function () {
        const ico = toggleBtn.querySelector('i');
        if (ico) {
          ico.classList.remove('bi-chevron-up');
          ico.classList.add('bi-chevron-down');
        }
        toggleBtn.setAttribute('aria-expanded', 'false');
      });
      // Also allow the button itself to toggle the collapse via JS (keeps accessibility tidy)
      toggleBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        // Use bootstrap Collapse API to toggle
        let inst = bootstrap.Collapse.getInstance(collapseEl);
        if (!inst) inst = new bootstrap.Collapse(collapseEl, { toggle: false });
        inst.toggle();
      });
    }
  } catch (e) {
    // non-fatal: if wiring fails, collapse still works via data-bs attributes in markup
    console.warn('Failed to wire collapse icon for printer row', e);
  }

  return tr;
}

  // ---------- Add printer (AJAX) ----------
  if (addForm) {
    addForm.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (!addNameEl || !addNameEl.value.trim()) {
        try { addNameEl.classList.add('is-invalid'); } catch (e) {}
        return;
      }
      const name = addNameEl.value.trim();

      addBtn.disabled = true;
      if (addSpinner) addSpinner.style.display = 'inline-block';

      try {
        const body = new URLSearchParams();
        body.append('name', name);

        const res = await fetch(addForm.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: body.toString()
        });

        if (!res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json().catch(()=>null);
            alert((j && j.error) ? j.error : 'Failed to add printer');
            return;
          }
          window.location.reload();
          return;
        }

        const j = await res.json().catch(()=>null);
        const created = j && j.printer ? j.printer : null;
        if (created && created._id) {
          if (!printersTbody) { window.location.reload(); return; }

          const row = createPrinterRow(created);
          printersTbody.appendChild(row);

          addNameEl.value = '';
          if (addSuccess && addSuccessText) {
            addSuccessText.textContent = created.name;
            addSuccess.style.display = 'block';
            setTimeout(()=> { addSuccess.style.display = 'none'; }, 2600);
          } else {
            try { window.showGlobalToast && window.showGlobalToast('Printer added', 2000); } catch(_) {}
          }
        } else {
          window.location.reload();
        }
      } catch (err) {
        console.error('Add printer failed', err);
        alert('Failed to add printer');
      } finally {
        try {
          if (addSpinner) addSpinner.style.display = 'none';
          const spinners = addBtn.querySelectorAll ? addBtn.querySelectorAll('.spinner-border') : [];
          if (spinners && spinners.length) spinners.forEach(s => { try { s.style.display = 'none'; } catch(_){} });
        } catch(e) { console.error('hide spinners failed', e); }
        addBtn.disabled = false;
      }
    });
  }

  // ---------- Global delegation for dropdown actions ----------
  document.addEventListener('click', function (ev) {

    // Details / View
    const detailsBtn = ev.target.closest ? ev.target.closest('.role-action-details') : null;
    if (detailsBtn) {
      ev.preventDefault();
      const pid = detailsBtn.dataset.printerId;
      const pname = detailsBtn.dataset.printerName || '';
      if (!pid) return;
      // open details modal — default filter = today
      openPrinterDetails(pid, pname, { mode: 'today' });
      return;
    }

    // Edit
    const editLink = ev.target.closest ? ev.target.closest('.role-action-edit') : null;
    if (editLink) {
      ev.preventDefault();
      const pid = editLink.dataset.printerId;
      const pname = editLink.dataset.printerName || '';
      if (!pid) return;
      if (editIdEl) editIdEl.value = pid;
      if (editNameEl) { editNameEl.value = pname; try { editNameEl.focus(); editNameEl.setSelectionRange(editNameEl.value.length, editNameEl.value.length); } catch(e){} }
      if (editModal) editModal.show();
      return;
    }

    // Delete
    const delLink = ev.target.closest ? ev.target.closest('.role-action-delete') : null;
    if (delLink) {
      ev.preventDefault();
      const action = delLink.dataset.action || delLink.getAttribute('data-action') || null;
      const pname = delLink.dataset.printerName || '';
      if (!action) return;
      pendingDeleteAction = action;
      pendingDeleteRow = delLink.closest('tr');
      if (delMessage) delMessage.textContent = pname ? `Delete printer: "${pname}"?` : 'Delete this printer?';
      if (delModal) delModal.show();
      else if (confirm(`Delete printer: "${pname}"?`)) performDeletePrinter(action, pendingDeleteRow);
      return;
    }

    // Adjust
    const adjLink = ev.target.closest ? ev.target.closest('.role-action-adjust') : null;
  if (adjLink) {
    ev.preventDefault();
    const pid = adjLink.dataset.printerId;
    const pname = adjLink.dataset.printerName || '';
    if (!pid) return;
    if (adjustIdEl) adjustIdEl.value = pid;
    if (adjustModeEl) adjustModeEl.value = 'delta';
    if (adjustValueEl) adjustValueEl.value = '';

    // Populate target select based on existing row data attributes
    const targetSelect = document.getElementById('adjustPrinterTarget');
    if (targetSelect) {
      // clear options
      targetSelect.innerHTML = '';
      const row = document.querySelector(`tr[data-id="${pid}"]`);
      const monoCount = row ? Number(row.getAttribute('data-mono-count') || 0) : 0;
      const colourCount = row ? Number(row.getAttribute('data-colour-count') || 0) : 0;
      // Prefer showing colored options if they exist
      const opts = [];
      opts.push({ v: 'total', t: 'Total' });
      if (monoCount || row && row.dataset.monoCount !== undefined) opts.push({ v: 'monochrome', t: 'Monochrome' });
      if (colourCount || row && row.dataset.colourCount !== undefined) opts.push({ v: 'colour', t: 'Colour' });
      // append
      opts.forEach(o => {
        const op = document.createElement('option'); op.value = o.v; op.textContent = o.t; targetSelect.appendChild(op);
      });
      // default selection preference
      if (opts.some(o=>o.v==='monochrome')) targetSelect.value = 'monochrome';
      else if (opts.some(o=>o.v==='colour')) targetSelect.value = 'colour';
      else targetSelect.value = 'total';
    }

    const adjustLabel = document.getElementById('adjustPrinterModalLabel');
    if (adjustLabel) adjustLabel.textContent = `Adjust printer count — ${pname}`;
    if (adjustModal) adjustModal.show();
    return;
  }  
});

  // ---------- Save Edit (AJAX PUT) ----------
  if (saveEditBtn) {
    saveEditBtn.addEventListener('click', async function () {
      const id = editIdEl ? editIdEl.value : null;
      const name = editNameEl ? editNameEl.value.trim() : '';
      if (!id || !name) { if (editNameEl) editNameEl.classList.add('is-invalid'); return; }
      saveEditBtn.disabled = true;
      try {
        const body = new URLSearchParams(); body.append('name', name);
        const res = await fetch(`/admin/printers/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: body.toString()
        });
        if (!res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json().catch(()=>null);
            alert((j && j.error) ? j.error : 'Failed to update printer');
            return;
          }
          window.location.reload();
          return;
        }
        const j = await res.json().catch(()=>null);
        const updated = j && j.printer ? j.printer : null;
        if (updated && updated._id) {
          const row = document.querySelector(`tr[data-id="${updated._id}"]`);
          if (row) {
            const nameCell = row.querySelector('.printer-name');
            if (nameCell) nameCell.textContent = updated.name;
            const btns = row.querySelectorAll('.role-action-edit, .role-action-delete, .role-action-adjust, .role-action-details');
            btns.forEach(b => { if (b.dataset) b.dataset.printerName = updated.name; });
          } else {
            printersTbody.appendChild(createPrinterRow(updated));
          }
          if (editModal) editModal.hide();
          try { window.showGlobalToast && window.showGlobalToast('Printer updated', 1800); } catch(_) {}
        } else { window.location.reload(); }
      } catch (err) {
        console.error('Save edit printer failed', err);
        alert('Failed to update printer');
      } finally { saveEditBtn.disabled = false; }
    });
  }

  // ---------- Confirm delete ----------
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async function () {
      if (!pendingDeleteAction) { if (delModal) delModal.hide(); return; }
      confirmDeleteBtn.disabled = true;
      try {
        await performDeletePrinter(pendingDeleteAction, pendingDeleteRow);
        if (delModal) delModal.hide();
      } catch (err) {
        console.error('Delete printer failed', err);
        alert('Failed to delete printer');
      } finally {
        confirmDeleteBtn.disabled = false;
        pendingDeleteAction = null;
        pendingDeleteRow = null;
      }
    });
  }

  // perform delete (AJAX)
  async function performDeletePrinter(actionUrl, row) {
    if (!actionUrl) return;
    try {
      const res = await fetch(actionUrl, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      if (!res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const j = await res.json().catch(()=>null);
          alert((j && j.error) ? j.error : 'Failed to delete printer');
          return;
        }
        window.location.reload();
        return;
      }
      if (row) {
        row.remove();
        try { window.showGlobalToast && window.showGlobalToast('Printer deleted', 1800); } catch(_) {}
      } else window.location.reload();
    } catch (err) {
      console.error('performDeletePrinter err', err);
      throw err;
    }
  }

  // ---------- Fetch printer usage (legacy) ----------
  async function fetchPrinterUsage(printerId, listEl) {
    if (!printerId) return;
    try {
      const res = await fetch(`/admin/printers/${encodeURIComponent(printerId)}/usage`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        throw new Error((j && j.error) ? j.error : `Failed to fetch usage (${res.status})`);
      }
      const j = await res.json();
      const usages = (j && j.usages) ? j.usages : [];
      if (!listEl) return;
      if (!usages.length) { listEl.innerHTML = '<div class="small text-muted">No usage entries found.</div>'; return; }

      const container = document.createElement('div'); container.className = 'list-group small';
      usages.forEach(u => {
        let when;
        if (u.createdAt) when = new Date(u.createdAt);
        else {
          try {
            if (u._id && typeof u._id === 'string' && /^[0-9a-fA-F]{24}$/.test(u._id)) {
              when = new Date(parseInt(u._id.substring(0,8),16) * 1000);
            } else if (u._id && typeof u._id === 'object' && typeof u._id.getTimestamp === 'function') {
              when = u._id.getTimestamp();
            } else when = new Date();
          } catch(e) { when = new Date(); }
        }
        const pretty = `${String(when.getDate()).padStart(2,'0')}/${String(when.getMonth()+1).padStart(2,'0')}/${when.getFullYear()} ${String(when.getHours()).padStart(2,'0')}:${String(when.getMinutes()).padStart(2,'0')}`;
        const note = u.note ? ` — ${escapeHtml(u.note)}` : '';
        const order = u.orderId ? ` (Order: ${escapeHtml(u.orderId)})` : '';
        const sign = (u.count >= 0) ? '+' : '';
        const item = document.createElement('div');
        item.className = 'list-group-item d-flex justify-content-between align-items-start';
        item.innerHTML = `<div>${pretty}${note}${order}</div><div><strong>${sign}${escapeHtml(String(u.count))}</strong></div>`;
        container.appendChild(item);
      });
      listEl.innerHTML = '';
      listEl.appendChild(container);
    } catch (err) {
      console.error('fetchPrinterUsage err', err);
      if (listEl) listEl.innerHTML = `<div class="small text-danger">Failed to load usage</div>`;
    }
  }

  // ---------- Fetch printer stats ----------
  async function fetchPrinterStats(printerId, days = 30) {
    try {
      const res = await fetch(`/admin/printers/${encodeURIComponent(printerId)}/stats?days=${encodeURIComponent(days)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        throw new Error((j && j.error) ? j.error : `Failed to fetch stats (${res.status})`);
      }
      const j = await res.json();
      if (!j || !j.ok) throw new Error('Invalid stats response');
      return j;
    } catch (err) {
      console.error('fetchPrinterStats err', err);
      throw err;
    }
  }

  // ---------- Render details modal (single value per container) ----------
  function renderPrinterDetailsModal(data, printerName, selectedRange) {
    try {
      if (pdHeader) pdHeader.textContent = `Printer: ${printerName || data.printerId || ''}`;
      if (pdSummary) pdSummary.style.display = '';

      // selectedRange: { mode: 'today'|'week'|'month'|'range', start?, end? }
      let selCount = 0;
      let selRev = 0.0;
      const mode = selectedRange && selectedRange.mode ? selectedRange.mode : 'today';

      if (mode === 'today') {
        selCount = (data.counts && data.counts.today) ? data.counts.today : 0;
        selRev = (data.revenue && typeof data.revenue.today !== 'undefined') ? Number(data.revenue.today) : 0;
      } else if (mode === 'week') {
        selCount = (data.counts && data.counts.week) ? data.counts.week : 0;
        selRev = (data.revenue && typeof data.revenue.week !== 'undefined') ? Number(data.revenue.week) : 0;
      } else if (mode === 'month') {
        selCount = (data.counts && data.counts.month) ? data.counts.month : 0;
        selRev = (data.revenue && typeof data.revenue.month !== 'undefined') ? Number(data.revenue.month) : 0;
      } else {
        // range — aggregate perDay array returned by server
        const perDay = data.perDay || [];
        selCount = perDay.reduce((s, r) => s + (Number(r.count) || 0), 0);
        selRev = perDay.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
      }

      if (pdCountValue) pdCountValue.textContent = String(selCount || 0);
      if (pdRevValue) pdRevValue.textContent = Number(selRev || 0).toFixed(2);

      // Recent usages
      if (pdRecentLoading) pdRecentLoading.textContent = '';
      if (pdRecentList) {
        pdRecentList.innerHTML = '';
        const recent = (data.latestUsages || []);
        if (!recent.length) {
          pdRecentList.innerHTML = '<div class="small text-muted">No recent usage entries</div>';
        } else {
          recent.forEach(u => {
            let when;
            if (u.createdAt) when = new Date(u.createdAt);
            else {
              if (u._id && typeof u._id === 'string' && /^[0-9a-fA-F]{24}$/.test(u._id)) when = new Date(parseInt(u._id.substring(0,8),16) * 1000);
              else when = new Date();
            }
            const pretty = `${String(when.getDate()).padStart(2,'0')}/${String(when.getMonth()+1).padStart(2,'0')}/${when.getFullYear()} ${String(when.getHours()).padStart(2,'0')}:${String(when.getMinutes()).padStart(2,'0')}`;
            const note = u.note ? ` — ${escapeHtml(u.note)}` : '';
            const order = u.orderId ? ` (Order: ${escapeHtml(u.orderId)})` : '';
            const sign = (u.count >= 0) ? '+' : '';
            const el = document.createElement('div');
            el.className = 'list-group-item d-flex justify-content-between align-items-start';
            el.innerHTML = `<div>${pretty}${note}${order}</div><div><strong>${sign}${escapeHtml(String(u.count))}</strong></div>`;
            pdRecentList.appendChild(el);
          });
        }
      }

      // show modal
      const inst = bootstrap.Modal.getInstance(detailsModalEl) || new bootstrap.Modal(detailsModalEl);
      inst.show();
    } catch (err) {
      console.error('renderPrinterDetailsModal err', err);
      alert('Failed to render printer details');
    }
  }

  // open details (fetch + render)
  async function openPrinterDetails(pid, pname, opts = { mode: 'today' }) {
    if (!pid) return;

    // attach current printer id to modal for filter handlers
    if (detailsModalEl) detailsModalEl.setAttribute('data-current-printer', pid);

    // show loading skeleton / text
    if (pdHeader) pdHeader.textContent = 'Loading...';
    if (pdSummary) pdSummary.style.display = 'none';
    if (pdRecentLoading) pdRecentLoading.textContent = 'Loading...';
    if (pdRecentList) pdRecentList.innerHTML = '';

    // default days param for server stats call:
    // - today => 1
    // - week => 7
    // - month => 30
    // - range => computed from start/end inclusive
    let days = 30;
    let mode = opts.mode || 'today';
    let start = null;
    let end = null;

    if (mode === 'today') days = 1;
    else if (mode === 'week') days = 7;
    else if (mode === 'month') days = 30;
    else if (mode === 'range' && opts.start && opts.end) {
      start = opts.start; end = opts.end;
      const s = new Date(start + 'T00:00:00Z');
      const e = new Date(end + 'T00:00:00Z');
      // inclusive days
      const ms = e - s;
      days = Math.min(365, Math.max(1, Math.floor(ms / (1000*60*60*24)) + 1));
    }

    try {
      const data = await fetchPrinterStats(pid, days);
      renderPrinterDetailsModal(data, pname || data.printerId, { mode, start, end });
    } catch (err) {
      console.error('openPrinterDetails err', err);
      if (pdHeader) pdHeader.textContent = 'Failed to load printer details';
      if (pdRecentLoading) pdRecentLoading.textContent = '';
      alert((err && err.message) ? err.message : 'Failed to load details');
      const inst = bootstrap.Modal.getInstance(detailsModalEl) || new bootstrap.Modal(detailsModalEl);
      inst.show();
    }
  }

  // ---------- Adjust printer (AJAX POST) ----------
// doAdjustBtn handler (send 'target')
if (doAdjustBtn) {
  doAdjustBtn.addEventListener('click', async function () {
    if (!adjustIdEl || !adjustModeEl || !adjustValueEl) return;
    const pid = adjustIdEl.value;
    const mode = adjustModeEl.value;
    const targetSelect = document.getElementById('adjustPrinterTarget');
    const target = targetSelect ? (targetSelect.value || 'total') : 'total';
    const raw = adjustValueEl.value;
    if (!raw || raw.trim() === '') { adjustValueEl.classList.add('is-invalid'); return; }
    const v = Number(raw);
    if (isNaN(v)) { adjustValueEl.classList.add('is-invalid'); return; }

    // show spinner in button and disable
    doAdjustBtn.disabled = true;
    // create spinner element if not present
    let spinner = doAdjustBtn.querySelector('.btn-spinner');
    if (!spinner) {
      spinner = document.createElement('span');
      spinner.className = 'spinner-border spinner-border-sm btn-spinner me-2';
      spinner.setAttribute('role', 'status');
      spinner.setAttribute('aria-hidden', 'true');
      doAdjustBtn.insertBefore(spinner, doAdjustBtn.firstChild);
    }
    // optionally change text to "Applying..."
    const originalText = doAdjustBtn._origText || doAdjustBtn.textContent.trim();
    doAdjustBtn._origText = originalText;
    // keep icon space, set text content after spinner (so we don't remove spinner)
    // ensure we don't clobber spinner by setting only text node after it:
    // remove existing text nodes (except spinner) and append new text
    Array.from(doAdjustBtn.childNodes).forEach(n => {
      if (n.nodeType === Node.TEXT_NODE) n.remove();
    });
    doAdjustBtn.appendChild(document.createTextNode('Applying...'));

    try {
      const body = new URLSearchParams();
      body.append('target', String(target));
      if (mode === 'set') body.append('setTo', String(Math.floor(v)));
      else body.append('delta', String(Math.floor(v)));

      const res = await fetch(`/admin/printers/${encodeURIComponent(pid)}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: body.toString()
      });

      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        alert((j && j.error) ? j.error : 'Adjust failed');
        return;
      }
      const j = await res.json().catch(()=>null);
      if (j && j.printer) {
        const pidSelector = j.printer._id;
        const row = document.querySelector(`tr[data-id="${pidSelector}"]`);
        if (row) {
          // update displayed total
          const totalCell = row.querySelector('td:nth-child(2)');
          if (totalCell) {
            const strongEl = totalCell.querySelector('strong');
            if (strongEl) strongEl.textContent = j.printer.totalCount || 0;
          }

          // Update data attributes
          if (typeof j.printer.monochromeCount !== 'undefined') {
            row.setAttribute('data-mono-count', j.printer.monochromeCount || 0);
          }
          if (typeof j.printer.colourCount !== 'undefined') {
            row.setAttribute('data-colour-count', j.printer.colourCount || 0);
          }

          // Update collapse markers (without creating duplicates)
          const collapse = row.querySelector(`#printer-totals-${pidSelector}`);
          const cardBody = collapse ? collapse.querySelector('.card-body') : null;

          function upsertMarker(className, label, value) {
            if (!cardBody) return;
            // remove any plain-text duplicate lines that don't have the marker class but contain the label
            const plainMatches = Array.from(cardBody.querySelectorAll('div')).filter(d => !d.classList.contains(className) && d.textContent.trim().startsWith(label));
            plainMatches.forEach(d => d.remove());

            let el = cardBody.querySelector(`.${className}`);
            if (!el) {
              // create and append (keep order: monochrome first, colour second)
              el = document.createElement('div');
              el.className = `small ${className === 'mono-value' ? 'mb-1' : 'mb-0'} ${className}`;
              el.textContent = `${label}: ${value}`;
              if (className === 'mono-value') cardBody.insertBefore(el, cardBody.firstChild);
              else cardBody.appendChild(el);
            } else {
              el.textContent = `${label}: ${value}`;
            }
          }

          if (typeof j.printer.monochromeCount !== 'undefined') {
            upsertMarker('mono-value', 'Monochrome', j.printer.monochromeCount || 0);
          }
          if (typeof j.printer.colourCount !== 'undefined') {
            upsertMarker('colour-value', 'Colour', j.printer.colourCount || 0);
          }
        }
      }

      // refresh details modal if open (keep default to today)
      if (detailsModalEl && (bootstrap.Modal.getInstance(detailsModalEl) || {}).isShown) {
        const pidNow = detailsModalEl.getAttribute('data-current-printer') || null;
        if (pidNow) openPrinterDetails(pidNow, null, { mode: 'today' });
      }
      if (adjustModal) adjustModal.hide();
      try { window.showGlobalToast && window.showGlobalToast('Printer count adjusted', 1600); } catch(_) {}
    } catch (err) {
      console.error('adjust printer err', err);
      alert('Adjust failed (network error)');
    } finally {
      // remove spinner and restore button state/text
      try {
        const spinnerEl = doAdjustBtn.querySelector('.btn-spinner');
        if (spinnerEl) spinnerEl.remove();
        // restore original text (if any)
        const orig = doAdjustBtn._origText || 'Apply';
        // clear text nodes and append original text
        Array.from(doAdjustBtn.childNodes).forEach(n => {
          if (n.nodeType === Node.TEXT_NODE) n.remove();
        });
        doAdjustBtn.appendChild(document.createTextNode(orig));
      } catch (e) {
        // fallback: set textContent
        doAdjustBtn.textContent = (doAdjustBtn._origText || 'Apply');
      }
      doAdjustBtn.disabled = false;
    }
  });
}

  // ---------- Filter buttons + date range refresh wiring ----------
  (function () {
    if (!detailsModalEl) return;

    // filter buttons delegation
    detailsModalEl.addEventListener('click', function (ev) {
      const btn = ev.target.closest ? ev.target.closest('button[data-filter]') : null;
      if (btn) {
        // deactivate siblings and activate this
        const parent = btn.parentElement;
        if (parent) parent.querySelectorAll('button[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const f = btn.getAttribute('data-filter');
        const pid = detailsModalEl.getAttribute('data-current-printer');
        if (!pid) return;

        // fetch for the filter
        openPrinterDetails(pid, null, { mode: (f === 'today' ? 'today' : (f === 'week' ? 'week' : 'month')) });
      }
    });

    // Refresh button for date range
    if (pdRangeRefresh) {
      pdRangeRefresh.addEventListener('click', function () {
        const s = pdRangeStart ? pdRangeStart.value : null;
        const e = pdRangeEnd ? pdRangeEnd.value : null;
        if (!s || !e) {
          alert('Please select both From and To dates');
          return;
        }
        // ensure order
        let start = s, end = e;
        if (new Date(start) > new Date(end)) {
          const tmp = start; start = end; end = tmp;
        }
        const pid = detailsModalEl.getAttribute('data-current-printer') || null;
        if (!pid) return;
        // call openPrinterDetails with range mode
        openPrinterDetails(pid, null, { mode: 'range', start: start, end: end });
      });
    }

    // when modal shown, clear date inputs? keep values (no-op)
    detailsModalEl.addEventListener('show.bs.modal', function (ev) {
      // nothing special here
    });
  })();

  // Expose small debug helpers
  window._printersPage = {
    fetchPrinterUsage,
    fetchPrinterStats,
    openPrinterDetails,
    createPrinterRow
  };

})();
