// public/javascripts/orders_client.js
// Orders client: auto-load price rules when service changes or on initial load.
// Renders price rules showing only sub-unit names (comma-separated).
// Cart shows service name per item and supports F/B selection (fb flag sent to server).
// Services that require printers show a per-row printer select when adding an item.
// NOTE: printers are stored on the cart item for server submission, but are NOT shown in the cart UI.

// Also includes: Orders Explorer modal with date filters (defaults to today), detail view (copy/print).
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const serviceSelect = document.getElementById('serviceSelect');
  const pricesList = document.getElementById('pricesList');
  const cartTbody = document.getElementById('cartTbody');
  const cartTotalEl = document.getElementById('cartTotal');
  const orderNowBtn = document.getElementById('orderNowBtn');

  // Orders explorer elements
  const openOrdersExplorerBtn = document.getElementById('openOrdersExplorerBtn');
  const ordersExplorerModalEl = document.getElementById('ordersExplorerModal');
  const ordersExplorerModal = (window.bootstrap && ordersExplorerModalEl) ? new bootstrap.Modal(ordersExplorerModalEl) : null;
  const ordersFromEl = document.getElementById('ordersFrom');
  const ordersToEl = document.getElementById('ordersTo');
  const fetchOrdersBtn = document.getElementById('fetchOrdersBtn');
  const presetTodayBtn = document.getElementById('presetToday');
  const presetYesterdayBtn = document.getElementById('presetYesterday');
  const presetThisWeekBtn = document.getElementById('presetThisWeek');
  const ordersTable = document.getElementById('ordersTable');
  const ordersCountEl = document.getElementById('ordersCount');

  // Order details modal
  const orderDetailsModalEl = document.getElementById('orderDetailsModal');
  const orderDetailsModal = (window.bootstrap && orderDetailsModalEl) ? new bootstrap.Modal(orderDetailsModalEl) : null;
  const orderDetailsMeta = document.getElementById('orderDetailsMeta');
  const orderDetailsJson = document.getElementById('orderDetailsJson'); // we'll fill HTML into this element
  const copyDetailOrderIdBtn = document.getElementById('copyDetailOrderIdBtn');
  const printDetailOrderBtn = document.getElementById('printDetailOrderBtn');

  // internal state
  let prices = []; // loaded price rules for selected service
  let cart = [];   // { serviceId, serviceName, priceRuleId, selectionLabel, unitPrice, pages, subtotal, fb, printerId }
  let serviceRequiresPrinter = false;
  let printers = []; // { _id, name }

  function formatMoney(n) {
    const num = Number(n) || 0;
    return num.toFixed(2);
  }

  function isoDate(d) {
    const dt = d ? new Date(d) : new Date();
    const yr = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yr}-${mm}-${dd}`;
  }

  // highlight active preset button (visual + aria-pressed)
  function setActivePreset(activeBtn) {
    const presets = [presetTodayBtn, presetYesterdayBtn, presetThisWeekBtn].filter(Boolean);
    presets.forEach(btn => {
      if (!btn) return;
      if (btn === activeBtn) {
        btn.classList.remove('btn-outline-secondary');
        btn.classList.add('btn-primary');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline-secondary');
        btn.setAttribute('aria-pressed', 'false');
      }
    });
  }

  // default date range => today
  function setDefaultDateRange() {
    const today = new Date();
    ordersFromEl.value = isoDate(today);
    ordersToEl.value = isoDate(today);
    if (ordersCountEl) ordersCountEl.textContent = 'Default: Today';
    setActivePreset(presetTodayBtn);
  }

  // Parse a selectionLabel of form "Unit: Sub + Unit2: Sub2" into only subunit names [Sub, Sub2]
  function subUnitsOnlyFromLabel(selectionLabel) {
    if (!selectionLabel) return '';
    const parts = selectionLabel.split(/\s*\+\s*/);
    const subs = parts.map(part => {
      const idx = part.indexOf(':');
      if (idx >= 0) {
        return part.slice(idx + 1).trim();
      }
      return part.trim();
    }).filter(Boolean);
    return subs.join(', ');
  }

  // safe escape
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

  // render the prices list (each item: selection (subunits comma-separated), qty input, F/B checkbox, Apply button)
  function renderPrices() {
    if (!prices || !prices.length) {
      pricesList.innerHTML = '<p class="text-muted">No price rules found for selected service.</p>';
      return;
    }
    const container = document.createElement('div');
    container.className = 'list-group';
    prices.forEach(p => {
      const row = document.createElement('div');
      // keep everything on a single horizontal row and prevent wrapping
      row.className = 'list-group-item d-flex align-items-center gap-3 flex-nowrap';

      // left: label (only subunits)
      const left = document.createElement('div');
      left.className = 'flex-grow-1 text-truncate'; // allow ellipsis if too long
      const subOnly = subUnitsOnlyFromLabel(p.selectionLabel || '');
      const label = document.createElement('div');
      label.innerHTML = `<strong class="d-inline-block text-truncate" style="max-width:420px;">${escapeHtml(subOnly)}</strong>`;
      left.appendChild(label);

      // middle: qty input, FB checkbox, optional printer + spoiled inputs
      const mid = document.createElement('div');
      // fixed layout container that won't wrap; children will be inline and spaced
      mid.className = 'd-flex align-items-center gap-2 flex-nowrap';

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.className = 'form-control form-control-sm pages-input';
      input.placeholder = 'Qty';
      input.style.width = '90px';
      mid.appendChild(input);

      // F/B checkbox
      const fbWrap = document.createElement('div');
      fbWrap.className = 'form-check form-check-inline ms-1';
      const fbInput = document.createElement('input');
      fbInput.type = 'checkbox';
      fbInput.className = 'form-check-input fb-checkbox';
      fbInput.id = `fb-${p._id}`;
      fbInput.setAttribute('data-prid', p._id);
      const fbLabel = document.createElement('label');
      fbLabel.className = 'form-check-label small';
      fbLabel.htmlFor = fbInput.id;
      fbLabel.textContent = 'F/B';
      fbWrap.appendChild(fbInput);
      fbWrap.appendChild(fbLabel);
      mid.appendChild(fbWrap);

      // printer select (if service requires)
      if (serviceRequiresPrinter) {
        const printerWrap = document.createElement('div');
        printerWrap.className = 'd-flex align-items-center';
        const sel = document.createElement('select');
        sel.className = 'form-select form-select-sm printer-select';
        sel.style.width = '220px';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Select printer --';
        sel.appendChild(defaultOpt);

        if (printers && printers.length) {
          printers.forEach(pr => {
            const o = document.createElement('option');
            o.value = pr._id;
            o.textContent = pr.name || pr._id;
            sel.appendChild(o);
          });
        } else {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = 'No printers available';
          sel.appendChild(o);
          sel.disabled = true;
        }
        printerWrap.appendChild(sel);
        mid.appendChild(printerWrap);

        // SPOILED input (only shown for services that require a printer)
        const spoiledWrap = document.createElement('div');
        spoiledWrap.className = 'd-flex align-items-center';
        const spoiledInput = document.createElement('input');
        spoiledInput.type = 'number';
        spoiledInput.min = '0';
        spoiledInput.step = '1';
        spoiledInput.value = '';
        spoiledInput.placeholder = 'Spoiled';
        spoiledInput.setAttribute('aria-label', 'Spoiled count');
        spoiledInput.className = 'form-control form-control-sm spoiled-input';
        spoiledInput.style.width = '96px';
        spoiledInput.title = 'Spoiled count';
        spoiledWrap.appendChild(spoiledInput);
        mid.appendChild(spoiledWrap);
      }

      // right: apply button
      const right = document.createElement('div');
      right.className = 'ms-auto';
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-outline-primary apply-price-btn';
      btn.type = 'button';
      btn.dataset.prId = p._id;
      btn.textContent = 'Apply';
      right.appendChild(btn);

      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(right);

      container.appendChild(row);
    });

    pricesList.innerHTML = '';
    pricesList.appendChild(container);
  }

  // load price rules for selected service via API
  async function loadPricesForService(serviceId) {
    if (!serviceId) {
      prices = [];
      serviceRequiresPrinter = false;
      printers = [];
      renderPrices();
      return;
    }
    pricesList.innerHTML = '<div class="text-muted">Loading price rules…</div>';
    try {
      const res = await fetch(`/api/services/${encodeURIComponent(serviceId)}/prices`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j && j.error) ? j.error : 'Failed to load price rules');
      }
      const j = await res.json();
      if (!j.ok) {
        throw new Error(j.error || 'No data returned');
      }
      prices = (j.prices || []).map(x => ({
        _id: x._id,
        selectionLabel: x.selectionLabel,
        unitPrice: Number(x.unitPrice),
        price2: (x.price2 !== null && x.price2 !== undefined) ? Number(x.price2) : null
      }));
      serviceRequiresPrinter = !!j.serviceRequiresPrinter;
      printers = (j.printers || []).map(p => ({ _id: p._id, name: p.name }));
      renderPrices();
    } catch (err) {
      console.error('loadPricesForService err', err);
      pricesList.innerHTML = `<p class="text-danger small">Error loading price rules.</p>`;
    }
  }

  // add item to cart
  function addToCart({ serviceId, serviceName, priceRuleId, label, unitPrice, pages, fb, printerId, spoiled }) {
    pages = Number(pages) || 1;
    spoiled = Math.max(0, Math.floor(Number(spoiled) || 0));
    const subtotal = Number((Number(unitPrice) * pages).toFixed(2));
    cart.push({
      serviceId,
      serviceName,
      priceRuleId,
      selectionLabel: label,
      unitPrice: Number(unitPrice),
      pages,
      subtotal,
      fb: !!fb,
      printerId: printerId || null,
      spoiled
    });
    renderCart();
  }

  function renderCart() {
    cartTbody.innerHTML = '';
    if (!cart.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="text-muted" colspan="5">Cart is empty.</td>';
      cartTbody.appendChild(tr);
      cartTotalEl.textContent = 'GH₵ 0.00';
      orderNowBtn.disabled = true;
      return;
    }
    let total = 0;
    cart.forEach((it, idx) => {
      total += it.subtotal;
      const tr = document.createElement('tr');
      tr.dataset.idx = idx;

      // prepare display label and avoid duplicate (F/B)
      let displayLabel = it.selectionLabel || '';
      const hasFbInLabel = /\(F\/B\)/i.test(displayLabel);
      if (it.fb && !hasFbInLabel) {
        displayLabel = `${displayLabel} (F/B)`;
      }

      // show spoiled inline under label if > 0
      const spoiledHtml = (it.spoiled && it.spoiled > 0) ? `<br/><small class="text-danger">Spoiled: ${String(it.spoiled)}</small>` : '';

      tr.innerHTML = `
        <td>
          <div class="small text-muted">${escapeHtml(it.serviceName || '')}</div>
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px;">
            ${escapeHtml(displayLabel)}${spoiledHtml}
          </div>
        </td>
        <td class="text-center">${it.pages}</td>
        <td class="text-end">GH₵ ${formatMoney(it.unitPrice)}</td>
        <td class="text-end">GH₵ ${formatMoney(it.subtotal)}</td>
        <td class="text-center"><button class="btn btn-sm btn-outline-danger remove-cart-btn" type="button">Remove</button></td>
      `;
      cartTbody.appendChild(tr);
    });
    cartTotalEl.textContent = 'GH₵ ' + formatMoney(total);
    orderNowBtn.disabled = false;
  }

  // event delegation: Apply buttons in pricesList
  pricesList.addEventListener('click', function (e) {
    const btn = e.target.closest('.apply-price-btn');
    if (!btn) return;
    const prId = btn.dataset.prId;
    const serviceId = serviceSelect ? serviceSelect.value : null;
    const priceObj = prices.find(p => String(p._id) === String(prId));
    if (!priceObj) return alert('Price rule not found');

    // find qty input in same list item (or default to 1)
    const row = btn.closest('.list-group-item');
    const pagesInput = row ? row.querySelector('.pages-input') : null;
    const pages = pagesInput && pagesInput.value ? Number(pagesInput.value) : 1;

    // check F/B checkbox in same row
    const fbCheckbox = row ? row.querySelector('.fb-checkbox') : null;
    const fbChecked = fbCheckbox ? fbCheckbox.checked : false;

    // if service requires a printer, find the selected printer in the same row
    let selectedPrinterId = null;
    if (serviceRequiresPrinter) {
      const printerSelect = row ? row.querySelector('.printer-select') : null;
      selectedPrinterId = printerSelect ? (printerSelect.value || null) : null;
      if (!selectedPrinterId) {
        try { window.showGlobalToast && window.showGlobalToast('Please select a printer for this service', 2200); } catch(_) {}
        return alert('This service requires a printer. Please choose a printer before adding to cart.');
      }
    }

 let spoiled = 0;
    const spoiledInput = row ? row.querySelector('.spoiled-input') : null;
    if (spoiledInput && spoiledInput.value !== undefined && spoiledInput.value !== null && String(spoiledInput.value).trim() !== '') {
      const n = Number(spoiledInput.value);
      spoiled = (isNaN(n) || n < 0) ? 0 : Math.floor(n);
    }

// choose unitPrice: price2 if F/B checked and price2 available, else price
    let chosenPrice = Number(priceObj.unitPrice);
    if (fbChecked && priceObj.price2 !== null && priceObj.price2 !== undefined) {
      chosenPrice = Number(priceObj.price2);
    }

// label to show in cart should be the subunits-only label
    let label = subUnitsOnlyFromLabel(priceObj.selectionLabel || '');
    // ensure we only append (F/B) once — do not duplicate if label already contains it
    if (fbChecked && (priceObj.price2 !== null && priceObj.price2 !== undefined)) {
      if (!/\(F\/B\)/i.test(label)) {
        label = `${label} (F/B)`;
      }
    }

    const serviceName = (serviceSelect && serviceSelect.options[serviceSelect.selectedIndex]) ? (serviceSelect.options[serviceSelect.selectedIndex].text || '') : '';
// pass printerId and spoiled through (kept internally) but do NOT display printer id in cart
    addToCart({ serviceId, serviceName, priceRuleId: prId, label, unitPrice: chosenPrice, pages, fb: fbChecked, printerId: selectedPrinterId, spoiled });

    // clear inputs after Apply (qty input, fb checkbox, printer select, spoiled)
    try {
      if (pagesInput) pagesInput.value = '';
      if (fbCheckbox) { fbCheckbox.checked = false; }
      const printerSelect = row ? row.querySelector('.printer-select') : null;
      if (printerSelect) { printerSelect.selectedIndex = 0; }
      if (spoiledInput) { spoiledInput.value = ''; }
    } catch (err) {
      console.warn('Failed to clear inputs after Apply', err);
    }

    if (typeof showGlobalToast === 'function') showGlobalToast('Added to cart', 1600);
  });

  // event delegation: remove from cart
  cartTbody.addEventListener('click', function (e) {
    const btn = e.target.closest('.remove-cart-btn');
    if (!btn) return;
    const tr = btn.closest('tr');
    const idx = Number(tr.dataset.idx);
    if (!isNaN(idx)) {
      cart.splice(idx, 1);
      renderCart();
      if (typeof showGlobalToast === 'function') showGlobalToast('Removed from cart', 1200);
    }
  });

  // create order — POST /api/orders
  orderNowBtn.addEventListener('click', async function () {
    if (!cart.length) return;
    orderNowBtn.disabled = true;
    const originalText = orderNowBtn.textContent;
    orderNowBtn.textContent = 'Placing...';
    try {
      const payload = {
        items: cart.map(it => ({
          serviceId: it.serviceId,
          priceRuleId: it.priceRuleId,
          pages: it.pages,
          fb: !!it.fb,
          printerId: it.printerId || null,
          spoiled: (typeof it.spoiled === 'number') ? it.spoiled : 0
        }))
      };
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload)
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        alert((j && j.error) ? j.error : 'Order creation failed');
        return;
      }

      // Show modal (instead of window.alert) with order details and copy/print actions
      showOrderSuccessModal(j.orderId, j.total);
      if (typeof showGlobalToast === 'function') showGlobalToast(`Order created: ${j.orderId}`, 3200);

      cart = [];
      renderCart();
    } catch (err) {
      console.error('create order err', err);
      alert('Failed to create order');
    } finally {
      orderNowBtn.disabled = false;
      orderNowBtn.textContent = originalText;
    }
  });

  // Auto-load prices when service changes
  if (serviceSelect) {
    serviceSelect.addEventListener('change', function () {
      const sid = this.value;
      loadPricesForService(sid);
    });
  }

  // On load: auto-select the first non-empty service and load prices
  (function autoSelectFirstService() {
    if (!serviceSelect) return;
    let chosen = null;
    for (let i = 0; i < serviceSelect.options.length; i++) {
      const opt = serviceSelect.options[i];
      if (opt && opt.value) {
        chosen = opt.value;
        serviceSelect.selectedIndex = i;
        break;
      }
    }
    if (chosen) {
      loadPricesForService(chosen);
    } else {
      prices = [];
      renderPrices();
    }
  })();

  // Order Success Modal (Copy + Print) - reused for immediate post-order success
  function showOrderSuccessModal(orderId, total) {
    // similar to previous code — ensure modal exists and show with copy/print buttons
    let modalEl = document.getElementById('orderSuccessModal');
    if (!modalEl) {
      const html = `
<div class="modal fade" id="orderSuccessModal" tabindex="-1" aria-labelledby="orderSuccessModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title" id="orderSuccessModalLabel">Order created</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body">
        <p id="orderSuccessBody">Order created successfully.</p>
        <p class="small text-muted">Use the order ID at payment.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline-secondary" type="button" id="copyOrderIdBtn" title="Copy order ID">Copy Order ID</button>
        <button class="btn btn-outline-primary" type="button" id="printOrderBtn" title="Print order">Print</button>
        <button class="btn btn-secondary" data-bs-dismiss="modal" type="button">Close</button>
      </div>
    </div>
  </div>
</div>`;
      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      modalEl = document.getElementById('orderSuccessModal');
    }

    const body = modalEl.querySelector('#orderSuccessBody');
    if (body) {
      body.innerHTML = `
        <strong>Order ID:</strong> <span id="orderSuccessId">${escapeHtml(orderId || '')}</span> <br/>
        <strong>Total:</strong> GH₵ <span id="orderSuccessTotal">${formatMoney(total)}</span>
      `;
    }

    // set up copy/print handlers
    const copyBtn = modalEl.querySelector('#copyOrderIdBtn');
    const printBtn = modalEl.querySelector('#printOrderBtn');

    function copyOrderId() {
      const idEl = modalEl.querySelector('#orderSuccessId');
      const idText = idEl ? idEl.textContent.trim() : (orderId || '');
      if (!idText) return alert('No order ID');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(idText).then(() => {
          try { window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch(_) {}
        }).catch(() => fallbackCopyTextToClipboard(idText));
      } else {
        fallbackCopyTextToClipboard(idText);
      }
    }
    function fallbackCopyTextToClipboard(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); try { window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch(_) {} } catch (e) { alert('Copy failed — select and copy: ' + text); }
      document.body.removeChild(ta);
    }

    function printOrder() {
      const idEl = modalEl.querySelector('#orderSuccessId');
      const totalEl = modalEl.querySelector('#orderSuccessTotal');
      const idText = idEl ? idEl.textContent.trim() : (orderId || '');
      const totalText = totalEl ? totalEl.textContent.trim() : (formatMoney(total));
      const w = window.open('', '_blank', 'toolbar=0,location=0,menubar=0');
      if (!w) {
        alert('Unable to open print window (blocked). Please copy order ID and print manually.');
        return;
      }
      const doc = w.document;
      const title = 'Order ' + (idText || '');
      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #111; }
          .wrap { max-width: 560px; margin: 0 auto; text-align: center; }
          .logo { max-height: 80px; margin-bottom: 12px; display: inline-block; }
          h1 { font-size: 20px; margin-bottom: 8px; }
          p { margin: 6px 0; }
          .muted { color: #666; font-size: 13px; }
          .details { text-align: left; display: inline-block; margin-top: 12px; }
        </style>
        </head><body>
        <div class="wrap">
          <img class="logo" src="/public/images/AHAD LOGO.png" alt="AHAD" />
          <h1>Order Created</h1>
          <div class="details">
            <p><strong>Order ID:</strong> ${escapeHtml(idText)}</p>
            <p><strong>Total:</strong> GH₵ ${escapeHtml(totalText)}</p>
            <p class="muted">Show this ID at payment.</p>
          </div>
          <p class="small-note">Printed from Ahad POS.</p>
        </div>
        </body></html>`);
      doc.close();
      w.focus();
      const onLoadPrint = () => {
        try { w.print(); } catch (e) { alert('Print failed — try copying the order ID.'); }
        setTimeout(()=>{ try { w.close(); } catch (e){} }, 700);
      };
      if (w.document.readyState === 'complete') onLoadPrint(); else { w.onload = onLoadPrint; setTimeout(onLoadPrint, 800); }
    }

    if (copyBtn && !copyBtn._bound) { copyBtn._bound = true; copyBtn.addEventListener('click', copyOrderId); }
    if (printBtn && !printBtn._bound) { printBtn._bound = true; printBtn.addEventListener('click', printOrder); }

    try { const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl); inst.show(); } catch (err) { alert(`Order created: ${orderId}\nTotal: GH₵ ${formatMoney(total)}`); }
  }

  // ORDERS EXPLORER: wiring -------------------------------------------------
  function formatDateTimeForDisplay(dtStr) {
    try {
      const d = new Date(dtStr);
      // produce "29/10/2025, 14:47:32"
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2,'0');
      const min = String(d.getMinutes()).padStart(2,'0');
      const ss = String(d.getSeconds()).padStart(2,'0');
      return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss}`;
    } catch (e) { return dtStr || ''; }
  }

  // fetch orders list from server: expects GET /api/orders?from=YYYY-MM-DD&to=YYYY-MM-DD
  async function fetchOrdersList(from, to) {
    try {
      const url = `/api/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) {
        const ct = res.headers.get('content-type') || '';
        let msg = `Failed to fetch orders (${res.status})`;
        if (ct.includes('application/json')) {
          const j = await res.json().catch(()=>null);
          if (j && j.error) msg = j.error;
        }
        renderOrdersListError(msg);
        return;
      }
      const j = await res.json().catch(()=>null);
      if (!j || !Array.isArray(j.orders)) {
        renderOrdersListError('Invalid response from server (expected array of orders).');
        return;
      }
      renderOrdersList(j.orders);
    } catch (err) {
      console.error('fetchOrdersList err', err);
      renderOrdersListError('Network error while fetching orders.');
    }
  }

  function renderOrdersListError(msg) {
    const tbody = ordersTable.querySelector('tbody');
    tbody.innerHTML = `<tr><td class="text-muted" colspan="5">${escapeHtml(msg)}</td></tr>`;
    if (ordersCountEl) ordersCountEl.textContent = '0 results';
  }

  function renderOrdersList(orders) {
    const tbody = ordersTable.querySelector('tbody');
    if (!orders || !orders.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="5">No orders in this range.</td></tr>';
      if (ordersCountEl) ordersCountEl.textContent = '0 results';
      return;
    }
    tbody.innerHTML = '';
    orders.forEach(o => {
      const tr = document.createElement('tr');
      tr.dataset.orderId = o.orderId || o._id || '';
      const created = o.createdAt ? formatDateTimeForDisplay(o.createdAt) : (o.createdAt || '');
      tr.innerHTML = `
        <td><a href="#" class="orders-explorer-open-order" data-order-id="${escapeHtml(o.orderId || o._id || '')}">${escapeHtml(o.orderId || o._id || '')}</a></td>
        <td class="text-end">GH₵ ${formatMoney(o.total)}</td>
        <td>${escapeHtml(o.status || '')}</td>
        <td>${escapeHtml(created)}</td>
        <td class="text-center"><button class="btn btn-sm btn-outline-secondary view-order-btn" data-order-id="${escapeHtml(o.orderId || o._id || '')}">View</button></td>
      `;
      tbody.appendChild(tr);
    });
    if (ordersCountEl) ordersCountEl.textContent = `${orders.length} result${orders.length > 1 ? 's' : ''}`;
  }

  // view order details via existing GET /api/orders/:orderId
  async function viewOrderDetails(orderId) {
    if (!orderId) return;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        const msg = j && j.error ? j.error : `Failed to fetch order ${orderId}`;
        if (orderDetailsMeta) orderDetailsMeta.textContent = msg;
        if (orderDetailsJson) orderDetailsJson.textContent = '';
        if (orderDetailsModal) orderDetailsModal.show();
        return;
      }
      const j = await res.json().catch(()=>null);
      if (!j || !j.order) {
        if (orderDetailsMeta) orderDetailsMeta.textContent = 'Order not found';
        if (orderDetailsJson) orderDetailsJson.textContent = '';
        if (orderDetailsModal) orderDetailsModal.show();
        return;
      }
      const o = j.order;

      // Build friendly meta
      const metaText = `Order ID: ${o.orderId} — Total: GH₵ ${formatMoney(o.total)} — Status: ${o.status} — Created: ${formatDateTimeForDisplay(o.createdAt)}`;
      if (orderDetailsMeta) orderDetailsMeta.textContent = metaText;

      // Build itemized HTML list/table
      let html = '';
      if (o.items && o.items.length) {
        html += `<div class="table-responsive"><table class="table table-sm table-borderless mb-0"><thead><tr>
          <th>Selection</th><th class="text-center">QTY</th><th class="text-end">Unit</th><th class="text-end">Subtotal</th><th class="text-center">Printer</th>
        </tr></thead><tbody>`;

        o.items.forEach(it => {
          // Show ONLY the sub-unit names (comma-separated). Use selectionLabel if present.
          const rawLabel = it.selectionLabel || '';
          const selLabel = subUnitsOnlyFromLabel(rawLabel) || (it.selections && it.selections.length ? it.selections.map(s => (s.subUnit ? (s.subUnit.name || String(s.subUnit)) : '')).join(', ') : '(no label)');
          const isFb = (it.fb === true) || (typeof rawLabel === 'string' && rawLabel.includes('(F/B)'));
          const cleanLabel = isFb ? selLabel.replace(/\s*\(F\/B\)\s*$/i, '').trim() : selLabel;

          const qty = (typeof it.pages !== 'undefined' && it.pages !== null) ? String(it.pages) : '1';
          const unitPrice = (typeof it.unitPrice === 'number' || !isNaN(Number(it.unitPrice))) ? formatMoney(it.unitPrice) : (it.unitPrice || '');
          const subtotal = (typeof it.subtotal === 'number' || !isNaN(Number(it.subtotal))) ? formatMoney(it.subtotal) : (it.subtotal || '');
          // Use printer name if server provided it, otherwise dash
          const printerStr = it.printer ? escapeHtml(String(it.printer)) : '-';

          // Render selection inline, not broken into lines
          const labelHtml = `<div>${escapeHtml(cleanLabel)}${isFb ? ' <span class="badge bg-secondary ms-2">F/B</span>' : ''}</div>`;

          html += `<tr>
            <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;">${labelHtml}</td>
            <td class="text-center">${escapeHtml(qty)}</td>
            <td class="text-end">GH₵ ${escapeHtml(unitPrice)}</td>
            <td class="text-end">GH₵ ${escapeHtml(subtotal)}</td>
            <td class="text-center">${printerStr}</td>
          </tr>`;
        });

        html += `</tbody></table></div>`;
      } else {
        html += '<p class="text-muted small mb-0">No items listed for this order.</p>';
      }

      // Additional details (createdAt/paidAt)
      html += `<div class="mt-3 small text-muted">
        <div>Created: ${formatDateTimeForDisplay(o.createdAt)}</div>
        <div>Paid at: ${o.paidAt ? formatDateTimeForDisplay(o.paidAt) : 'Not paid'}</div>
      </div>`;

      if (orderDetailsJson) {
        orderDetailsJson.innerHTML = html;
      }
      if (orderDetailsModal) orderDetailsModal.show();
    } catch (err) {
      console.error('viewOrderDetails err', err);
      if (orderDetailsMeta) orderDetailsMeta.textContent = 'Network error while fetching order';
      if (orderDetailsJson) orderDetailsJson.textContent = '';
      if (orderDetailsModal) orderDetailsModal.show();
    }
  }

  // Orders explorer event wiring
  if (openOrdersExplorerBtn) {
    openOrdersExplorerBtn.addEventListener('click', function () {
      setDefaultDateRange();
      if (ordersExplorerModal) ordersExplorerModal.show();
      // Auto-fetch immediately for the default range
      const from = ordersFromEl.value || isoDate(new Date());
      const to = ordersToEl.value || isoDate(new Date());
      fetchOrdersList(from, to);
    });
  }
  if (presetTodayBtn) presetTodayBtn.addEventListener('click', function () {
    setDefaultDateRange();
    setActivePreset(presetTodayBtn);
  });
  if (presetYesterdayBtn) presetYesterdayBtn.addEventListener('click', function () {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    ordersFromEl.value = isoDate(d);
    ordersToEl.value = isoDate(d);
    setActivePreset(presetYesterdayBtn);
  });
  if (presetThisWeekBtn) presetThisWeekBtn.addEventListener('click', function () {
    const now = new Date();
    const day = now.getDay(); // 0..6
    const diffToMonday = (day + 6) % 7; // days since Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    ordersFromEl.value = isoDate(monday);
    ordersToEl.value = isoDate(now);
    setActivePreset(presetThisWeekBtn);
  });

  if (fetchOrdersBtn) {
    fetchOrdersBtn.addEventListener('click', function () {
      const from = ordersFromEl.value || isoDate(new Date());
      const to = ordersToEl.value || isoDate(new Date());
      // simple validation
      if (new Date(from) > new Date(to)) {
        alert('From date cannot be after To date');
        return;
      }
      // fetch list
      fetchOrdersList(from, to);
    });
  }

  // delegate clicks in orders table (open detail)
  if (ordersTable) {
    ordersTable.addEventListener('click', function (ev) {
      const a = ev.target.closest('.orders-explorer-open-order');
      if (a) {
        ev.preventDefault();
        const id = a.dataset.orderId;
        viewOrderDetails(id);
        return;
      }
      const vbtn = ev.target.closest('.view-order-btn');
      if (vbtn) {
        const id = vbtn.dataset.orderId;
        viewOrderDetails(id);
      }
    });
  }

  // detail modal copy/print handlers
  if (copyDetailOrderIdBtn) {
    copyDetailOrderIdBtn.addEventListener('click', function () {
      const text = (orderDetailsMeta && orderDetailsMeta.textContent) ? orderDetailsMeta.textContent.split('—')[0].replace('Order ID:', '').trim() : '';
      if (!text) return alert('No order ID available');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(()=> { try { window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch(_){}; }).catch(()=> { alert('Copy failed'); });
      else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch(e){ alert('Copy failed'); } document.body.removeChild(ta); }
    });
  }
  if (printDetailOrderBtn) {
    printDetailOrderBtn.addEventListener('click', function () {
      const meta = orderDetailsMeta ? orderDetailsMeta.textContent : '';
      const html = orderDetailsJson ? orderDetailsJson.innerHTML : '';
      // open print window
      const w = window.open('', '_blank', 'toolbar=0,location=0,menubar=0');
      if (!w) { alert('Unable to open print window (blocked).'); return; }
      const title = 'Order details';
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font-family:Arial,Helvetica,sans-serif;padding:22px;color:#111}pre{white-space:pre-wrap;background:#f8f9fa;padding:12px;border-radius:6px}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #eee}</style>
        </head><body>
        <div><img src="/public/images/AHAD LOGO.png" style="max-height:60px"/></div>
        <h2>Order</h2><p>${escapeHtml(meta || '')}</p>
        <div>${html || '<p>No details</p>'}</div>
        </body></html>`);
      w.document.close();
      w.focus();
      setTimeout(()=>{ try { w.print(); } catch(e){ alert('Print failed'); } setTimeout(()=>{ try{ w.close(); } catch(e){} }, 700); }, 400);
    });
  }

  // expose for debug
  window._ordersClient = { loadPricesForService, prices, cart, serviceRequiresPrinter, printers, fetchOrdersList, viewOrderDetails };

  // initial render of cart
  renderCart();

  // initialize Orders Explorer defaults if elements exist
  if (ordersFromEl && ordersToEl) setDefaultDateRange();

});
