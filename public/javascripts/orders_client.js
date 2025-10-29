// public/javascripts/orders_client.js
// Orders client: auto-load price rules when service changes or on initial load.
// Renders price rules showing only sub-unit names (comma-separated).
// Cart shows service name per item and supports F/B selection (fb flag sent to server).
// Services that require printers show a per-row printer select when adding an item.
// NOTE: printers are stored on the cart item for server submission, but are NOT shown in the cart UI.

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const serviceSelect = document.getElementById('serviceSelect');
  const pricesList = document.getElementById('pricesList');
  const cartTbody = document.getElementById('cartTbody');
  const cartTotalEl = document.getElementById('cartTotal');
  const orderNowBtn = document.getElementById('orderNowBtn');

  // state
  let prices = []; // loaded price rules for selected service
  let cart = [];   // { serviceId, serviceName, priceRuleId, selectionLabel, unitPrice, pages, subtotal, fb, printerId }
  let serviceRequiresPrinter = false;
  let printers = []; // { _id, name }

  function formatMoney(n) {
    const num = Number(n) || 0;
    return num.toFixed(2);
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

  // render the prices list (each item: selection (subunits comma-separated), pages input, F/B checkbox, Apply button)
  function renderPrices() {
    if (!prices || !prices.length) {
      pricesList.innerHTML = '<p class="text-muted">No price rules found for selected service.</p>';
      return;
    }
    const container = document.createElement('div');
    container.className = 'list-group';
    prices.forEach(p => {
      const row = document.createElement('div');
      row.className = 'list-group-item d-flex align-items-center gap-3 flex-column flex-md-row';

      // left: label (only subunits)
      const left = document.createElement('div');
      left.className = 'flex-grow-1';
      const subOnly = subUnitsOnlyFromLabel(p.selectionLabel || '');
      const label = document.createElement('div');
      label.innerHTML = `<strong>${escapeHtml(subOnly)}</strong>`;
      left.appendChild(label);

      // middle: qty input and FB checkbox
      const mid = document.createElement('div');
      mid.className = 'me-2 d-flex align-items-center gap-2';

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.className = 'form-control form-control-sm pages-input';
      input.placeholder = 'Qty (optional)';
      input.style.width = '110px';
      mid.appendChild(input);

      // F/B checkbox
      const fbWrap = document.createElement('div');
      fbWrap.className = 'form-check form-check-inline ms-2';
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
        printerWrap.className = 'ms-2 d-flex align-items-center';
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
  // NOTE: we still keep printerId in the cart item so it will be sent to server when placing order,
  // but we do NOT show printer info in the cart UI per requirements.
  function addToCart({ serviceId, serviceName, priceRuleId, label, unitPrice, pages, fb, printerId }) {
    pages = Number(pages) || 1;
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
      printerId: printerId || null
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
      // Do NOT show printer info in the cart UI (we still keep printerId internally)
      tr.innerHTML = `
        <td>
          <div class="small text-muted">${escapeHtml(it.serviceName || '')}</div>
          <div>${escapeHtml(it.selectionLabel)}${it.fb ? ' (F/B)' : ''}</div>
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

    // choose unitPrice: price2 if F/B checked and price2 available, else price
    let chosenPrice = Number(priceObj.unitPrice);
    if (fbChecked && priceObj.price2 !== null && priceObj.price2 !== undefined) {
      chosenPrice = Number(priceObj.price2);
    }

    // label to show in cart should be the subunits-only label, append (F/B) if chosen
    let label = subUnitsOnlyFromLabel(priceObj.selectionLabel || '');
    if (fbChecked && (priceObj.price2 !== null && priceObj.price2 !== undefined)) {
      label = `${label} (F/B)`;
    }

    const serviceName = (serviceSelect && serviceSelect.options[serviceSelect.selectedIndex]) ? (serviceSelect.options[serviceSelect.selectedIndex].text || '') : '';

    // pass printerId through but do NOT display it in cart
    addToCart({ serviceId, serviceName, priceRuleId: prId, label, unitPrice: chosenPrice, pages, fb: fbChecked, printerId: selectedPrinterId });
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
          printerId: it.printerId || null
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

      // Show modal (instead of window.alert) with order details
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

  // showOrderSuccessModal — create/show a bootstrap modal with order info
  function showOrderSuccessModal(orderId, total) {
    // if a global modal already exists, reuse it
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
        <strong>Order ID:</strong> ${escapeHtml(orderId || '')} <br/>
        <strong>Total:</strong> GH₵ ${formatMoney(total)}
      `;
    }

    try {
      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      inst.show();
    } catch (err) {
      // fallback to alert in case bootstrap is not available
      alert(`Order created: ${orderId}\nTotal: GH₵ ${formatMoney(total)}`);
    }
  }

  // expose for debug if needed
  window._ordersClient = { loadPricesForService, prices, cart, serviceRequiresPrinter, printers };

  // initial render of cart
  renderCart();
});
