// public/javascripts/orders_client.js
// Orders client: auto-load price rules when service changes or on initial load.
// Renders price rules showing only sub-unit names (comma-separated).
// Cart now shows service name per item.

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  const serviceSelect = document.getElementById('serviceSelect');
  const pricesList = document.getElementById('pricesList');
  const cartTbody = document.getElementById('cartTbody');
  const cartTotalEl = document.getElementById('cartTotal');
  const orderNowBtn = document.getElementById('orderNowBtn');

  let prices = []; // loaded price rules for selected service
  let cart = [];   // { serviceId, serviceName, priceRuleId, selectionLabel, unitPrice, pages, subtotal }

  function formatMoney(n) {
    return Number(n).toFixed(2);
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

  // render the prices list (each item: selection (subunits comma-separated), pages input, Apply button)
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

      // middle: pages input
      const mid = document.createElement('div');
      mid.className = 'me-2';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.className = 'form-control form-control-sm pages-input';
      input.placeholder = 'Pages (optional)';
      input.style.width = '110px';
      mid.appendChild(input);

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

  // safe escape
  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

  // load price rules for selected service via API
  async function loadPricesForService(serviceId) {
    if (!serviceId) {
      prices = [];
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
        unitPrice: Number(x.unitPrice)
      }));
      renderPrices();
    } catch (err) {
      console.error('loadPricesForService err', err);
      pricesList.innerHTML = `<p class="text-danger small">Error loading price rules.</p>`;
    }
  }

  // add item to cart
  function addToCart({ serviceId, serviceName, priceRuleId, label, unitPrice, pages }) {
    pages = Number(pages) || 1;
    const subtotal = Number((unitPrice * pages).toFixed(2));
    cart.push({ serviceId, serviceName, priceRuleId, selectionLabel: label, unitPrice, pages, subtotal });
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
      // show service name as muted small above selection label
      tr.innerHTML = `
        <td>
          <div class="small text-muted">${escapeHtml(it.serviceName || '')}</div>
          <div>${escapeHtml(it.selectionLabel)}</div>
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
    const serviceId = serviceSelect.value;
    const priceObj = prices.find(p => String(p._id) === String(prId));
    if (!priceObj) return alert('Price rule not found');

    // find pages input in same list item (or default to 1)
    const row = btn.closest('.list-group-item');
    const pagesInput = row ? row.querySelector('.pages-input') : null;
    const pages = pagesInput && pagesInput.value ? Number(pagesInput.value) : 1;

    // label to show in cart should be the subunits-only label
    const label = subUnitsOnlyFromLabel(priceObj.selectionLabel || '');
    const serviceName = (serviceSelect.options[serviceSelect.selectedIndex] || {}).text || '';

    addToCart({ serviceId, serviceName, priceRuleId: prId, label, unitPrice: priceObj.unitPrice, pages });
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
          pages: it.pages
        }))
      };
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (!res.ok) {
        alert(j.error || 'Order creation failed');
        return;
      }
      if (typeof showGlobalToast === 'function') showGlobalToast(`Order created: ${j.orderId}`, 3200);
      alert(`Order created successfully.\nOrder ID: ${j.orderId}\nTotal: GH₵ ${Number(j.total).toFixed(2)}\nUse this ID at payment.`);
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

  // expose for debug if needed
  window._ordersClient = { loadPricesForService, prices, cart };

  // initial render of cart
  renderCart();
});
