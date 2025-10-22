// public/javascripts/records.js
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const form = document.getElementById('recordsFilter');
  const fromDate = document.getElementById('fromDate');
  const toDate = document.getElementById('toDate');
  const materialSelect = document.getElementById('materialSelect');
  const recordsArea = document.getElementById('recordsArea');
  const exportCsvLink = document.getElementById('exportCsv');

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

  function qs(params) {
    const u = new URLSearchParams();
    Object.keys(params).forEach(k => {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') u.append(k, params[k]);
    });
    return u.toString();
  }

  async function fetchData() {
    recordsArea.innerHTML = '<div class="text-muted">Loading usage data…</div>';
    const params = {
      from: fromDate ? fromDate.value : '',
      to: toDate ? toDate.value : '',
      materialId: materialSelect ? materialSelect.value : ''
    };
    try {
      const res = await fetch('/admin/records/usage?' + qs(params), { headers: { 'X-Requested-With': 'XMLHttpRequest' }});
      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        recordsArea.innerHTML = `<p class="text-danger">Error loading data: ${(j && j.error) ? j.error : res.statusText}</p>`;
        return;
      }
      const j = await res.json();
      if (!j.ok) {
        recordsArea.innerHTML = `<p class="text-danger">Error: ${j.error || 'Unknown'}</p>`;
        return;
      }
      renderData(j);
      // update CSV link
      if (exportCsvLink) {
        exportCsvLink.href = '/admin/records/export?' + qs(params);
      }
    } catch (err) {
      console.error('fetchData error', err);
      recordsArea.innerHTML = '<p class="text-danger">Failed to load data</p>';
    }
  }

  function renderData(payload) {
    // payload: { totals: { materialId: total }, usages: [ ... ] }
    const totals = payload.totals || {};
    const usages = payload.usages || [];

    // build top totals table
    let html = `
      <div class="table-responsive">
        <table class="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Material</th>
              <th class="text-end">Count (filtered)</th>
              <th class="text-center">Recent usages (most recent first)</th>
            </tr>
          </thead>
          <tbody>
    `;

    // group usages by material id
    const byMat = {};
    for (const u of usages) {
      const mid = u.material ? String(u.material._id) : 'unknown';
      byMat[mid] = byMat[mid] || [];
      byMat[mid].push(u);
    }

    // iterate materials present in usages (sorted by totals desc)
    const matIds = Object.keys(totals).sort((a,b)=> (totals[b]||0) - (totals[a]||0));

    if (matIds.length === 0) {
      html += `<tr><td colspan="3" class="text-muted">No usage records found for the selected filters.</td></tr>`;
    } else {
      for (const mid of matIds) {
        const rows = byMat[mid] || [];
        const sample = rows.slice(0,6).map(r => {
          const when = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
          const ord = r.orderId ? `Order: ${escapeHtml(r.orderId)}` : '';
          return `<div class="small">${escapeHtml(ord)} — ${r.count} × @ ${when}</div>`;
        }).join('');
        const matName = (rows[0] && rows[0].material && rows[0].material.name) ? escapeHtml(rows[0].material.name) : escapeHtml(mid);
        html += `
          <tr>
            <td><strong>${matName}</strong><div class="small text-muted">${escapeHtml(mid)}</div></td>
            <td class="text-end">${totals[mid] || 0}</td>
            <td>${sample || '<span class="text-muted small">—</span>'}</td>
          </tr>
        `;
      }
    }

    html += `</tbody></table></div>`;

    // Also show a full usage table below (paginated/limited by server)
    html += `<hr/><h6>Raw usage rows (most recent)</h6>`;
    html += `<div class="table-responsive"><table class="table table-sm table-hover"><thead><tr>
      <th>Material</th><th>Order ID</th><th>Item #</th><th class="text-end">Count</th><th>When</th>
    </tr></thead><tbody>`;

    for (const u of usages) {
      const mname = u.material ? escapeHtml(u.material.name) : '';
      const oid = u.orderId ? escapeHtml(u.orderId) : '';
      const itemIdx = (u.itemIndex != null) ? u.itemIndex : '';
      const cnt = u.count != null ? u.count : '';
      const when = u.createdAt ? new Date(u.createdAt).toLocaleString() : '';
      html += `<tr>
        <td>${mname}</td>
        <td>${oid}</td>
        <td>${itemIdx}</td>
        <td class="text-end">${cnt}</td>
        <td>${when}</td>
      </tr>`;
    }

    html += `</tbody></table></div>`;

    recordsArea.innerHTML = html;
  }

  // form submit
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      fetchData();
    });
  }

  // initial fetch
  fetchData();
});
