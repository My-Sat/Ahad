// public/javascripts/orders_client.js
// Orders client with Books support, printer-aware F/B checkbox and dynamic QTY placeholder.
// Keeps existing logic intact while adding:
//  - Books dropdown + Add Book button
//  - Add book to cart as a single cart line (expanded into items on order submission)
//  - F/B checkbox only shown when serviceRequiresPrinter is true
//  - QTY placeholder shows "Pages" when printer required, otherwise "Qty"

document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  // ---------- elements ----------
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

  // ---------- internal state ----------
  let prices = []; // loaded price rules for selected service or book preview
  let cart = [];   // cart lines: either normal item or book line
                   // normal: { isBook:false, serviceId, serviceName, priceRuleId, selectionLabel, unitPrice, pages, pagesOriginal, subtotal, fb, printerId, spoiled }
                   // book  : { isBook:true, bookId, bookName, unitPrice, qty, subtotal, bookItems: [ { serviceId, priceRuleId, pagesOriginal, fb, printerId, spoiled, unitPrice, subtotal, selectionLabel } ] }
  let serviceRequiresPrinter = false;
  let printers = []; // list of printers for the currently loaded service
  let books = [];    // list of available books (basic metadata)

    // ---------- Service categories (populate category select + filter services) ----------
  const serviceCategorySelect = document.getElementById('serviceCategorySelect');

async function loadServiceCategories() {
  if (!serviceCategorySelect) return;
  try {
    const res = await fetch('/admin/service-categories', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!res.ok) throw new Error('no categories endpoint');
    const j = await res.json().catch(()=>null);
    const cats = (j && Array.isArray(j.categories)) ? j.categories : [];

    // determine whether current user is admin (page sets window._isAdmin as boolean)
    const isAdmin = (typeof window._isAdmin !== 'undefined') ? (window._isAdmin === true || window._isAdmin === 'true') : false;

    // filter categories: only those marked showInOrders OR if admin then include all
    const visibleCats = cats.filter(c => {
      const show = (typeof c.showInOrders === 'boolean') ? c.showInOrders : (c.showInOrders === '1' || c.showInOrders === 'true' || c.showInOrders === 1);
      return show || isAdmin;
    });

    // Start with a non-actionable placeholder so nothing is treated as "selected" on load
    serviceCategorySelect.innerHTML = '<option value="" disabled selected hidden>-- Select a category --</option>';
    visibleCats.forEach(c => {
      const o = document.createElement('option');
      o.value = c._id;
      const show = (typeof c.showInOrders === 'boolean') ? c.showInOrders : (c.showInOrders === '1' || c.showInOrders === 'true' || c.showInOrders === 1);
      o.textContent = c.name + (isAdmin && !show ? ' (hidden)' : '');
      serviceCategorySelect.appendChild(o);
    });

    // Ensure services list is empty until a category is chosen
    if (serviceSelect) {
      serviceSelect.innerHTML = '<option value="">-- Select a service --</option>';
      prices = [];
      if (typeof renderPrices === 'function') renderPrices();
    }
  } catch (err) {
    // endpoint not available — ignore
    console.warn('loadServiceCategories failed', err);
  }
}

async function loadServicesForCategory(catId) {
  if (!serviceSelect) return;

  serviceSelect.innerHTML = '<option value="">-- Select a service --</option>';
  prices = [];
  renderPrices();

  if (!catId) return;

  try {
    // Load normal services
    const svcRes = await fetch(
      `/admin/service-categories/${encodeURIComponent(catId)}/services`,
      { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
    );
    const svcJson = svcRes.ok ? await svcRes.json() : null;
    const services = (svcJson && Array.isArray(svcJson.services)) ? svcJson.services : [];

    services.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s._id;
      opt.textContent = s.name;
      opt.dataset.type = 'service';
      serviceSelect.appendChild(opt);
    });

    // Load books for orders (category-aware)
    const bookRes = await fetch('/books/for-orders', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const bookJson = bookRes.ok ? await bookRes.json() : null;
    const allBooks = (bookJson && Array.isArray(bookJson.books)) ? bookJson.books : [];

    const booksInCategory = allBooks.filter(b =>
      String(b.category) === String(catId)
    );

    if (booksInCategory.length) {
      const group = document.createElement('optgroup');
      group.label = 'Compound Services';

      booksInCategory.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b._id;
        opt.textContent = `${b.name} — GH₵ ${formatMoney(b.unitPrice)}`;
        opt.dataset.type = 'book';
        group.appendChild(opt);
      });

      serviceSelect.appendChild(group);
    }

  } catch (err) {
    console.error('loadServicesForCategory failed', err);
  }
}
  // bind category change
  if (serviceCategorySelect) {
    serviceCategorySelect.addEventListener('change', function () {
      const cid = this.value || '';
      // clear book preview when changing category
      loadServicesForCategory(cid);
    });
  }

  // initial categories load
  loadServiceCategories();


  // ---------- helpers ----------
  function formatMoney(n) { return (Number(n) || 0).toFixed(2); }

  function escapeHtml(s) {
    if (!s && s !== 0) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

  function isoDate(d) {
    const dt = d ? new Date(d) : new Date();
    const yr = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yr}-${mm}-${dd}`;
  }

  // show active preset style
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

  // Alerts modal (lazy) - dark-surface friendly
  function showAlertModal(message, title = 'Notice') {
    let modalEl = document.getElementById('genericAlertModal');
    if (!modalEl) {
      const html = `
<div class="modal fade" id="genericAlertModal" tabindex="-1" aria-labelledby="genericAlertModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="genericAlertModalLabel"></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body" id="genericAlertModalBody"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-light-custom" data-bs-dismiss="modal">OK</button>
      </div>
    </div>
  </div>
</div>`;
      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      modalEl = document.getElementById('genericAlertModal');
    }
    try {
      const titleEl = modalEl.querySelector('#genericAlertModalLabel');
      const bodyEl = modalEl.querySelector('#genericAlertModalBody');
      if (titleEl) titleEl.textContent = title || 'Notice';
      if (bodyEl) bodyEl.innerHTML = escapeHtml(String(message || ''));
      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      inst.show();
    } catch (err) {
      try { alert(message); } catch (e) { console.error('alert fallback failed', e); }
    }
  }

  // Order success modal (lazy) - dark-surface friendly
  function showOrderSuccessModal(orderId, total) {
    let modalEl = document.getElementById('orderSuccessModal');
    if (!modalEl) {
      const html = `
<div class="modal fade" id="orderSuccessModal" tabindex="-1" aria-labelledby="orderSuccessModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="orderSuccessModalLabel">Order created</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body">
        <p id="orderSuccessBody">Order created successfully.</p>
        <p class="small text-muted">Use the order ID at payment.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline-light-custom" type="button" id="copyOrderIdBtn" title="Copy order ID">Copy Order ID</button>
        <button class="btn btn-outline-primary" type="button" id="printOrderBtn" title="Print order">Print</button>
        <button class="btn btn-outline-light-custom" data-bs-dismiss="modal" type="button">Close</button>
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

    const copyBtn = modalEl.querySelector('#copyOrderIdBtn');
    const printBtn = modalEl.querySelector('#printOrderBtn');

    function fallbackCopyTextToClipboard(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); try { window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch (_) {} } catch (e) { alert('Copy failed — select and copy: ' + text); }
      document.body.removeChild(ta);
    }

    function copyOrderId() {
      const idEl = modalEl.querySelector('#orderSuccessId');
      const idText = idEl ? idEl.textContent.trim() : (orderId || '');
      if (!idText) return alert('No order ID');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(idText).then(() => { try { window.showGlobalToast && window.showGlobalToast('Order ID copied', 1600); } catch (_) {} }).catch(() => fallbackCopyTextToClipboard(idText));
      } else {
        fallbackCopyTextToClipboard(idText);
      }
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

// ---------- Price rules rendering ----------
// Renders `prices` array into #pricesList
function renderPrices(bookMode = false) {
  // If not in book preview mode, require an explicit service selection before rendering
  const serviceSelected = (typeof serviceSelect !== 'undefined' && serviceSelect && serviceSelect.value);
  if (!bookMode && !serviceSelected) {
    pricesList.innerHTML = '<p class="text-muted">Select a service to load price rules.</p>';
    return;
  }

  if (!prices || !prices.length) {
    pricesList.innerHTML = '<p class="text-muted">No price rules found for selected service.</p>';
    return;
  }

  const container = document.createElement('div');
  container.className = 'list-group';
  prices.forEach(p => {
    const row = document.createElement('div');
    row.className = 'list-group-item d-flex align-items-center gap-3 flex-nowrap';

    // left: label (only subunits)
    const left = document.createElement('div');
    left.className = 'flex-grow-1 text-truncate';
    const subOnly = subUnitsOnlyFromLabel(p.selectionLabel || '');
    const label = document.createElement('div');
    label.innerHTML = `<strong class="d-inline-block text-truncate" style="max-width:420px;">${escapeHtml(subOnly)}</strong>`;
    left.appendChild(label);

    // middle: qty input, FB checkbox (only if printer required), optional printer + spoiled inputs
    const mid = document.createElement('div');
    mid.className = 'd-flex align-items-center gap-2 flex-nowrap';

    // inside price rule render block (printing service only)



    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.className = 'form-control form-control-sm pages-input';
    input.placeholder = serviceRequiresPrinter ? 'Pages' : 'Qty';
    input.style.width = '90px';
    mid.appendChild(input);
    
    // factor input (only if printer required)
    if (serviceRequiresPrinter) {
    const factorInput = document.createElement('input');
    factorInput.type = 'number';
    factorInput.min = '1';
    factorInput.step = '1';
    factorInput.value = '';
    factorInput.className = 'form-control form-control-sm factor-input';
    factorInput.placeholder = 'QTY';
    factorInput.style.width = '90px';
    mid.appendChild(factorInput);
    }

    

    // F/B checkbox only for services that require a printer
    let fbInput = null;
    if (serviceRequiresPrinter) {
      const fbWrap = document.createElement('div');
      fbWrap.className = 'form-check form-check-inline ms-1';
      fbInput = document.createElement('input');
      fbInput.type = 'checkbox';
      fbInput.className = 'form-check-input fb-checkbox';
      fbInput.id = `fb-${String(p._id)}`;
      fbInput.setAttribute('data-prid', p._id);
      const fbLabel = document.createElement('label');
      fbLabel.className = 'form-check-label small';
      fbLabel.htmlFor = fbInput.id;
      fbLabel.textContent = 'F/B';
      fbWrap.appendChild(fbInput);
      fbWrap.appendChild(fbLabel);
      mid.appendChild(fbWrap);
    }

    // printer select (if serviceRequiresPrinter)
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

      // SPOILED input
      const spoiledWrap = document.createElement('div');
      spoiledWrap.className = 'd-flex align-items-center';
      const spoiledInput = document.createElement('input');
      spoiledInput.type = 'number';
      spoiledInput.min = '0';
      spoiledInput.step = '1';
      spoiledInput.value = '';
      spoiledInput.placeholder = 'Jammed';
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
    btn.className = 'btn btn-sm btn-primary apply-price-btn';
    btn.type = 'button';
    btn.dataset.prId = p._id;
    btn.textContent = bookMode ? 'Add Book Item' : 'Apply';
    right.appendChild(btn);

    row.appendChild(left);
    row.appendChild(mid);
    row.appendChild(right);
    container.appendChild(row);
  });

  pricesList.innerHTML = '';
  pricesList.appendChild(container);
}

  // ---------- Load price rules for service ----------
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
      const res = await fetch(`/admin/services/${encodeURIComponent(serviceId)}/prices`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error((j && j.error) ? j.error : 'Failed to load price rules');
      }
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'No data returned');
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

  // load book preview (converts book items into a prices array for preview)
  async function loadBookPreview(bookId) {
    if (!bookId) {
      // clear preview -> revert to service prices load or blank
      prices = [];
      serviceRequiresPrinter = false;
      printers = [];
      renderPrices();
      return;
    }
    try {
      const res = await fetch(`/books/${encodeURIComponent(bookId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error('Failed to fetch book');
      const j = await res.json().catch(()=>null);
      if (!j || !j.book) throw new Error('Invalid book data');
      const book = j.book;
      // map book items to a synthetic prices array for preview/add
      prices = (book.items || []).map((bi, idx) => ({
        _id: `${book._id}::${idx}`,
        selectionLabel: bi.selectionLabel || '',
        unitPrice: Number(bi.unitPrice || 0),
        price2: null,
        __bookItem: {
          serviceId: bi.service,
          priceRuleId: bi.priceRule,
          pages: bi.pages,
          fb: !!bi.fb,
          printer: bi.printer || null,
          spoiled: bi.spoiled || 0,
          subtotal: Number(bi.subtotal || 0)
        }
      }));
      // conservative: if any item has a printer specified, treat preview as printer-bound
      serviceRequiresPrinter = prices.some(p => p.__bookItem && p.__bookItem.printer);
      printers = []; // optional: fetch printers for preview if you want richer UI
      renderPrices(true);
    } catch (err) {
      console.error('loadBookPreview err', err);
      prices = [];
      renderPrices();
    }
  }

  // Add a book to cart by id and quantity
  async function addBookToCartById(bookId, qty) {
    if (!bookId) return;
    try {
      const res = await fetch(`/books/${encodeURIComponent(bookId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error('Failed to fetch book details');
      const j = await res.json().catch(()=>null);
      if (!j || !j.book) throw new Error('Invalid book data');
      const book = j.book;
      const quantity = Number(qty) || 1;
      const unitPrice = Number(book.unitPrice || 0);
      const subtotal = Number((unitPrice * quantity).toFixed(2));

      // prepare internal bookItems snapshot (used for expansion at order time)
      const bookItems = (book.items || []).map(it => ({
        serviceId: it.service,
        priceRuleId: it.priceRule,
        pagesOriginal: Number(it.pages || 1),
        fb: !!it.fb,
        printerId: it.printer || null,
        spoiled: Number(it.spoiled || 0),
        unitPrice: Number(it.unitPrice || 0),
        subtotal: Number(it.subtotal || 0),
        selectionLabel: it.selectionLabel || ''
      }));

      cart.push({
        isBook: true,
        bookId: book._id,
        bookName: book.name,
        unitPrice,
        qty: quantity,
        subtotal,
        bookItems
      });
      renderCart();
      if (typeof showGlobalToast === 'function') showGlobalToast('Book added to cart', 1600);
    } catch (err) {
      console.error('addBookToCartById err', err);
      showAlertModal('Failed to add book to cart');
    }
  }

// ---------- Add single price rule to cart ----------
function addToCart({
  serviceId,
  serviceName,
  priceRuleId,
  label,
  unitPrice,
  pages,
  factor,          // NEW (optional)
  fb,
  printerId,
  spoiled
}) {
  const origPages = Number(pages) || 1;
  const factorVal = Number(factor) && Number(factor) > 0 ? Number(factor) : 1;

  spoiled = Math.max(0, Math.floor(Number(spoiled) || 0));

  // effective quantity used for price calculation (existing logic)
  const effectiveQty = fb ? Math.ceil(origPages / 2) : origPages;

  // subtotal logic:
  // - printing service → unitPrice × effectiveQty × factor
  // - non-printing service → unitPrice × effectiveQty
  const subtotal = Number(
    (
      Number(unitPrice) *
      effectiveQty *
      (printerId ? factorVal : 1)
    ).toFixed(2)
  );

  cart.push({
    isBook: false,
    serviceId,
    serviceName,
    priceRuleId,
    selectionLabel: label,
    unitPrice: Number(unitPrice),

    // what we show in cart
    pages: effectiveQty,

    // original user input (server uses this)
    pagesOriginal: origPages,

    // NEW: factor only meaningful for printing services
    factor: printerId ? factorVal : null,

    subtotal,
    fb: !!fb,
    printerId: printerId || null,
    spoiled
  });

  renderCart();
}

  // ---------- Render cart ----------
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

      let displayLabel = '';
      if (it.isBook) {
        displayLabel = `<div class="small text-muted">Book</div><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px;">${escapeHtml(it.bookName)}</div>`;
      } else {
        displayLabel = `<div class="small text-muted">${escapeHtml(it.serviceName || '')}</div><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:400px;">${escapeHtml(it.selectionLabel || '')}${(it.spoiled && it.spoiled>0) ? '<br/><small class="text-danger">Spoiled: '+String(it.spoiled)+'</small>' : ''}</div>`;
      }

      const qtyCell = it.isBook ? String(it.qty) : String(it.pages);

      tr.innerHTML = `
        <td>${displayLabel}</td>
        <td class="text-center">${escapeHtml(qtyCell)}</td>
        <td class="text-end">GH₵ ${formatMoney(it.unitPrice)}</td>
        <td class="text-end">GH₵ ${formatMoney(it.subtotal)}</td>
        <td class="text-center"><button class="btn btn-sm btn-danger remove-cart-btn" type="button">Remove</button></td>
      `;
      cartTbody.appendChild(tr);
    });
    cartTotalEl.textContent = 'GH₵ ' + formatMoney(total);
    orderNowBtn.disabled = false;
  }

  // ---------- Event delegation: Apply / Add buttons ----------
  pricesList.addEventListener('click', function (e) {
    const btn = e.target.closest('.apply-price-btn');
    if (!btn) return;
    const prId = btn.dataset.prId;
    const serviceId = serviceSelect ? serviceSelect.value : null;
    const priceObj = prices.find(p => String(p._id) === String(prId));
    if (!priceObj) return showAlertModal('Price rule not found');

    const row = btn.closest('.list-group-item');
    const pagesInput = row ? row.querySelector('.pages-input') : null;
    const pages = pagesInput && pagesInput.value ? Number(pagesInput.value) : 1;

    let factor = 1;
    if (serviceRequiresPrinter) {
      const factorInput = row ? row.querySelector('.factor-input') : null;
      if (factorInput && factorInput.value !== '') {
        const f = Number(factorInput.value);
        factor = (!isNaN(f) && f > 0) ? f : 1;
      }
    }


    const fbCheckbox = row ? row.querySelector('.fb-checkbox') : null;
    const fbChecked = fbCheckbox ? fbCheckbox.checked : false;

    let selectedPrinterId = null;
    if (serviceRequiresPrinter) {
      const printerSelect = row ? row.querySelector('.printer-select') : null;
      selectedPrinterId = printerSelect ? (printerSelect.value || null) : null;
      if (!selectedPrinterId) {
        showAlertModal('This service requires a printer. Please choose a printer before adding to cart.', 'Printer required');
        return;
      }
    }

    let spoiled = 0;
    const spoiledInput = row ? row.querySelector('.spoiled-input') : null;
    if (spoiledInput && spoiledInput.value !== undefined && spoiledInput.value !== null && String(spoiledInput.value).trim() !== '') {
      const n = Number(spoiledInput.value);
      spoiled = (isNaN(n) || n < 0) ? 0 : Math.floor(n);
    }

    // If a book preview item (bookMode) has __bookItem metadata, add either an underlying item or treat specially.
    if (priceObj.__bookItem) {
      // Treat this as adding the underlying item as a normal cart item (keeps behavior intuitive)
      addToCart({
        serviceId: priceObj.__bookItem.serviceId,
        serviceName: '', // not always available in preview; the server will reconcile names for display
        priceRuleId: priceObj.__bookItem.priceRuleId,
        label: subUnitsOnlyFromLabel(priceObj.selectionLabel || ''),
        unitPrice: Number(priceObj.unitPrice || 0),
        pages: pages,
        factor,
        fb: fbChecked,
        printerId: selectedPrinterId || priceObj.__bookItem.printer,
        spoiled
      });
    } else {
      // Normal service price add
      const serviceName = (serviceSelect && serviceSelect.options[serviceSelect.selectedIndex]) ? (serviceSelect.options[serviceSelect.selectedIndex].text || '') : '';
      // choose unitPrice: price2 if FB and available, else price
      let chosenPrice = Number(priceObj.unitPrice);
      if (fbChecked && priceObj.price2 !== null && priceObj.price2 !== undefined) {
        chosenPrice = Number(priceObj.price2);
      }
      addToCart({ serviceId, serviceName, priceRuleId: prId, label: subUnitsOnlyFromLabel(priceObj.selectionLabel || ''), unitPrice: chosenPrice, pages, factor, fb: fbChecked, printerId: selectedPrinterId, spoiled });
    }

    // clear inputs
    try {
      if (pagesInput) pagesInput.value = '';
      const factorInput = row ? row.querySelector('.factor-input') : null;
      if (factorInput) factorInput.value = '';
      if (fbCheckbox) { fbCheckbox.checked = false; }
      const printerSelect = row ? row.querySelector('.printer-select') : null;
      if (printerSelect) { printerSelect.selectedIndex = 0; }
      if (spoiledInput) spoiledInput.value = '';
    } catch (err) {
      console.warn('Failed to clear inputs after Apply', err);
    }

    if (typeof showGlobalToast === 'function') showGlobalToast('Added to cart', 1600);
  });

  // remove from cart
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

  // ---------- showAddBookModal ----------
  function showAddBookModal(bookId) {
    // Create or reuse modal HTML
    let modalEl = document.getElementById('addBookModal');
    if (!modalEl) {
      const html = `
<div class="modal fade" id="addBookModal" tabindex="-1" aria-labelledby="addBookModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-sm modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="addBookModalLabel">Add Service to Cart</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body">
        <div id="addBookModalBody">
          <div class="mb-2"><strong id="addBookName"></strong></div>
          <div class="mb-2 small text-muted">Unit Price: GH₵ <span id="addBookUnitPrice">0.00</span></div>
          <div class="mb-3">
            <label class="form-label small mb-1">Quantity</label>
            <input type="number" min="1" value="1" class="form-control form-control-sm" id="addBookQty" />
          </div>
          <div id="addBookPreview" class="small text-muted"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline-light-custom btn-sm" data-bs-dismiss="modal" type="button">Cancel</button>
        <button class="btn btn-primary btn-sm" id="confirmAddBookBtn" type="button">Add to Cart</button>
      </div>
    </div>
  </div>
</div>
`;
      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      modalEl = document.getElementById('addBookModal');
    }

    const modalInst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

    // Fill in book name/price from cached `books` if available
    const bookMeta = books.find(b => String(b._id) === String(bookId));
    const nameEl = modalEl.querySelector('#addBookName');
    const priceEl = modalEl.querySelector('#addBookUnitPrice');
    const qtyEl = modalEl.querySelector('#addBookQty');
    const previewEl = modalEl.querySelector('#addBookPreview');
    const confirmBtn = modalEl.querySelector('#confirmAddBookBtn');

    if (bookMeta) {
      if (nameEl) nameEl.textContent = bookMeta.name || '';
      if (priceEl) priceEl.textContent = formatMoney(bookMeta.unitPrice || 0);
      if (previewEl) previewEl.textContent = `This will add all price rules included in "${bookMeta.name}" multiplied by the quantity you enter. Each underlying rule will be posted to the server separately when placing the order.`;
    } else {
      if (nameEl) nameEl.textContent = 'Loading...';
      if (priceEl) priceEl.textContent = '0.00';
      if (previewEl) previewEl.textContent = '';
      fetch(`/books/${encodeURIComponent(bookId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(r => r.ok ? r.json().catch(()=>null) : null)
        .then(j => {
          if (j && j.book) {
            if (nameEl) nameEl.textContent = j.book.name || '';
            if (priceEl) priceEl.textContent = formatMoney(Number(j.book.unitPrice || 0));
            if (previewEl) previewEl.textContent = `This will add all price rules included in "${j.book.name}" multiplied by the quantity you enter. Each underlying rule will be posted to the server separately when placing the order.`;
          } else {
            if (nameEl) nameEl.textContent = '(book)';
          }
        }).catch(()=>{ if (nameEl) nameEl.textContent = '(book)'; });
    }

    function cleanup() {
      if (confirmBtn && confirmBtn._bound) {
        confirmBtn.removeEventListener('click', confirmHandler);
        confirmBtn._bound = false;
      }
      modalEl.removeEventListener('hidden.bs.modal', onHidden);
    }

    async function confirmHandler() {
      const qty = Number(qtyEl && qtyEl.value ? qtyEl.value : 1) || 1;
      // call existing addBookToCartById to keep behavior identical (it fetches book details and stores bookItems)
      await addBookToCartById(bookId, qty);
      // Reset dropdown back to default and reload service prices (so UI doesn't stay in preview)
      try {
        if (serviceSelect && serviceSelect.value) loadPricesForService(serviceSelect.value);
        else { prices = []; renderPrices(); }
      } catch (e) { /* ignore */ }
      try { modalInst.hide(); } catch (e) {}
    }

    function onHidden() {
      cleanup();
    }

    // bind confirm handler once
    if (confirmBtn && !confirmBtn._bound) {
      confirmBtn.addEventListener('click', confirmHandler);
      confirmBtn._bound = true;
    }

    modalEl.addEventListener('hidden.bs.modal', onHidden);
    qtyEl && (qtyEl.value = '1');
    modalInst.show();
  }

// ---------- Order placement ----------
async function placeOrderFlow() {
  if (!cart.length) return;
  orderNowBtn.disabled = true;
  const originalText = orderNowBtn.textContent;
  orderNowBtn.textContent = 'Placing...';

  try {
    // Build payload items
    const items = [];

    cart.forEach(line => {
      if (line.isBook) {
        // expand to underlying rules. Multiply raw pages by book quantity
        (line.bookItems || []).forEach(bi => {
          const rawPages =
            (typeof bi.pagesOriginal === 'number'
              ? bi.pagesOriginal
              : Number(bi.pagesOriginal || bi.pages || 1));

          const pagesToSend = rawPages * Number(line.qty || 1);

          items.push({
            serviceId: bi.serviceId,
            priceRuleId: bi.priceRuleId,
            pages: pagesToSend,
            factor: bi.printerId ? (bi.factor || 1) : undefined,
            fb: !!bi.fb,
            printerId: bi.printerId || null,
            spoiled: bi.spoiled || 0
          });
        });
      } else {
        const rawPages =
          (typeof line.pagesOriginal !== 'undefined')
            ? Number(line.pagesOriginal)
            : Number(line.pages || 1);

        items.push({
          serviceId: line.serviceId,
          priceRuleId: line.priceRuleId,
          pages: rawPages,
          factor: line.printerId ? (line.factor || 1) : undefined,
          fb: !!line.fb,
          printerId: line.printerId || null,
          spoiled: line.spoiled || 0
        });
      }
    });

    const payload = {
      items,
      customerId:
        (document.getElementById('orderCustomerId') &&
         document.getElementById('orderCustomerId').value)
          ? document.getElementById('orderCustomerId').value
          : null
    };

    const res = await fetch('/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify(payload)
    });

    const j = await res.json().catch(() => null);
    if (!res.ok) {
      showAlertModal((j && j.error) ? j.error : 'Order creation failed');
      return;
    }

    showOrderSuccessModal(j.orderId, j.total);
    if (typeof showGlobalToast === 'function') {
      showGlobalToast(`Order created: ${j.orderId}`, 3200);
    }

    cart = [];
    renderCart();
  } catch (err) {
    console.error('create order err', err);
    showAlertModal('Failed to create order');
  } finally {
    orderNowBtn.disabled = false;
    orderNowBtn.textContent = originalText;
  }
}

  // New "Order Now" handler: check for customer modal as before
  orderNowBtn.addEventListener('click', async function () {
    if (!cart.length) return;

    const customerEl = document.getElementById('orderCustomerId');
    const hasCustomer = !!(customerEl && customerEl.value && String(customerEl.value).trim());

    if (!hasCustomer) {
      // show modal offering proceed or go back
      // showNoCustomerModal replacement (dark-friendly)
      const choice = await (function showNoCustomerModal() {
        return new Promise((resolve) => {
          let modalEl = document.getElementById('noCustomerModal');
          if (!modalEl) {
            const html = `
<div class="modal fade" id="noCustomerModal" tabindex="-1" aria-labelledby="noCustomerModalLabel" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content dark-surface">
      <div class="modal-header">
        <h5 class="modal-title" id="noCustomerModalLabel">No customer attached</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body dark-card-body">
        <p>This order does not have a customer attached. You can proceed without a customer, or go back to the Customers page to register or select a customer first.</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline-light-custom" data-action="back">Back to Customers Page</button>
        <button type="button" class="btn btn-primary" data-action="proceed">Proceed anyway</button>
      </div>
    </div>
  </div>
</div>`;
            const container = document.createElement('div');
            container.innerHTML = html;
            document.body.appendChild(container.firstElementChild);
            modalEl = document.getElementById('noCustomerModal');
          }

          const btnProceed = modalEl.querySelector('button[data-action="proceed"]');
          const btnBack = modalEl.querySelector('button[data-action="back"]');
          const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);

          function cleanup() {
            try {
              btnProceed.removeEventListener('click', onProceed);
              btnBack.removeEventListener('click', onBack);
              modalEl.removeEventListener('hidden.bs.modal', onHidden);
            } catch (e) {}
          }
          function onProceed() { cleanup(); inst.hide(); resolve('proceed'); }
          function onBack() { cleanup(); inst.hide(); resolve('back'); }
          function onHidden() { cleanup(); resolve(null); }

          btnProceed.addEventListener('click', onProceed);
          btnBack.addEventListener('click', onBack);
          modalEl.addEventListener('hidden.bs.modal', onHidden);

          inst.show();
        });
      })();

      if (choice === 'back') {
        window.location.href = '/customers';
        return;
      } else if (choice === 'proceed') {
        await placeOrderFlow();
        return;
      } else {
        return;
      }
    }

    await placeOrderFlow();
  });

  // ---------- Orders explorer wiring (same behavior as before) ----------
  if (openOrdersExplorerBtn) {
    openOrdersExplorerBtn.addEventListener('click', function () {
      // set default today range
      const today = new Date();
      if (ordersFromEl && ordersToEl) {
        ordersFromEl.value = isoDate(today);
        ordersToEl.value = isoDate(today);
      }
      if (ordersExplorerModal) ordersExplorerModal.show();
      const from = (ordersFromEl && ordersFromEl.value) ? ordersFromEl.value : isoDate(new Date());
      const to = (ordersToEl && ordersToEl.value) ? ordersToEl.value : isoDate(new Date());
      fetchOrdersList(from, to);
    });
  }

  if (presetTodayBtn) presetTodayBtn.addEventListener('click', function () {
    const today = new Date();
    if (ordersFromEl && ordersToEl) { ordersFromEl.value = isoDate(today); ordersToEl.value = isoDate(today); }
    setActivePreset(presetTodayBtn);
  });
  if (presetYesterdayBtn) presetYesterdayBtn.addEventListener('click', function () {
    const d = new Date(); d.setDate(d.getDate() - 1);
    if (ordersFromEl && ordersToEl) { ordersFromEl.value = isoDate(d); ordersToEl.value = isoDate(d); }
    setActivePreset(presetYesterdayBtn);
  });
  if (presetThisWeekBtn) presetThisWeekBtn.addEventListener('click', function () {
    const now = new Date();
    const day = now.getDay(); // 0..6
    const diffToMonday = (day + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    if (ordersFromEl && ordersToEl) { ordersFromEl.value = isoDate(monday); ordersToEl.value = isoDate(now); }
    setActivePreset(presetThisWeekBtn);
  });

  if (fetchOrdersBtn) {
    fetchOrdersBtn.addEventListener('click', function () {
      const from = ordersFromEl.value || isoDate(new Date());
      const to = ordersToEl.value || isoDate(new Date());
      if (new Date(from) > new Date(to)) {
        alert('From date cannot be after To date');
        return;
      }
      fetchOrdersList(from, to);
    });
  }

  // ---------- Fetch orders list used by explorer ----------
  async function fetchOrdersList(from, to) {
    try {
      const url = `/orders/list?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
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
    if (!ordersTable) return;
    const tbody = ordersTable.querySelector('tbody');
    tbody.innerHTML = `<tr><td class="text-muted" colspan="5">${escapeHtml(msg)}</td></tr>`;
    if (ordersCountEl) ordersCountEl.textContent = '0 results';
  }

function renderOrdersList(orders) {
  if (!ordersTable) return;

  const tbody = ordersTable.querySelector('tbody');

  if (!orders || !orders.length) {
    tbody.innerHTML = '<tr><td class="text-muted" colspan="5">No orders in this range.</td></tr>';
    if (ordersCountEl) ordersCountEl.textContent = '0 results';
    return;
  }

  tbody.innerHTML = '';

  orders.forEach(o => {
    const orderId = o.orderId || o._id || '';
    const safeOrderId = escapeHtml(orderId);
    const name = escapeHtml(o.name || 'Walk-in');
    const viewHref = '/orders/view/' + encodeURIComponent(orderId);
    const created = o.createdAt
      ? formatDateTimeForDisplay(o.createdAt)
      : (o.createdAt || '');

    const tr = document.createElement('tr');
    tr.dataset.orderId = orderId;

    tr.innerHTML = `
      <td>
        <a href="${viewHref}"
           class="orders-explorer-open-order"
           title="Order ID: ${safeOrderId}">
          ${name}
        </a>
      </td>
      <td class="text-end">GH₵ ${formatMoney(o.total)}</td>
      <td>${escapeHtml(o.status || '')}</td>
      <td>${escapeHtml(created)}</td>
      <td class="text-center">
        <button
          class="btn btn-sm btn-outline-secondary view-order-btn"
          data-order-id="${safeOrderId}">
          View
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  if (ordersCountEl) {
    ordersCountEl.textContent = `${orders.length} result${orders.length > 1 ? 's' : ''}`;
  }
}

  // ---------- view order details (orders explorer / detail modal) ----------
  async function viewOrderDetails(orderId) {
    if (!orderId) return;
    try {
      const res = await fetch(`/orders/list/${encodeURIComponent(orderId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
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

      const metaText = `Order ID: ${o.orderId} — Total: GH₵ ${formatMoney(o.total)} — Status: ${o.status} — Created: ${formatDateTimeForDisplay(o.createdAt)}`;
      if (orderDetailsMeta) orderDetailsMeta.textContent = metaText;

      let html = '';
      if (o.items && o.items.length) {
        html += `<div class="table-responsive"><table class="table table-sm table-borderless mb-0"><thead><tr>
          <th>Selection</th><th class="text-center">QTY</th><th class="text-end">Unit</th><th class="text-end">Subtotal</th><th class="text-center">Printer</th>
        </tr></thead><tbody>`;

        o.items.forEach(it => {
          const rawLabel = it.selectionLabel || '';
          const selLabel = subUnitsOnlyFromLabel(rawLabel) || (it.selections && it.selections.length ? it.selections.map(s => (s.subUnit ? (s.subUnit.name || String(s.subUnit)) : '')).join(', ') : '(no label)');
          const isFb = (it.fb === true) || (typeof rawLabel === 'string' && rawLabel.includes('(F/B)'));
          const cleanLabel = isFb ? selLabel.replace(/\s*\(F\/B\)\s*$/i, '').trim() : selLabel;

          // IMPORTANT: display the stored subtotal and pages — do not recompute based on pages only.
          const qty = (typeof it.pages !== 'undefined' && it.pages !== null) ? String(it.pages) : '1';
          const unitPrice = (typeof it.unitPrice === 'number' || !isNaN(Number(it.unitPrice))) ? formatMoney(it.unitPrice) : (it.unitPrice || '');
          const subtotal = (typeof it.subtotal === 'number' || !isNaN(Number(it.subtotal))) ? formatMoney(it.subtotal) : (it.subtotal || '');
          const printerStr = it.printer ? escapeHtml(String(it.printer)) : '-';

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

  // Orders table click delegation (view button)
  if (ordersTable) {
    ordersTable.addEventListener('click', function (ev) {
      const a = ev.target.closest('.orders-explorer-open-order');
      if (a) return; // allow native navigation
      const vbtn = ev.target.closest('.view-order-btn');
      if (vbtn) {
        const id = vbtn.dataset.orderId;
        if (id) window.location.href = '/orders/view/' + encodeURIComponent(id);
      }
    });
  }

  // copy / print from detail modal
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

if (serviceSelect) {
  serviceSelect.addEventListener('change', function () {
    const selectedOption = this.options[this.selectedIndex];
    const value = this.value;

    if (!value || !selectedOption) {
      prices = [];
      renderPrices();
      return;
    }

    const type = selectedOption.dataset.type;

    // ---------- Compound Service (Book) ----------
    if (type === 'book') {
      // reset service pricing UI
      prices = [];
      renderPrices();

      // IMPORTANT: show quantity modal (previous behavior)
      showAddBookModal(value);

      // reset select so user can re-open it later
      this.selectedIndex = 0;
      return;
    }

    // ---------- Normal Service ----------
    loadPricesForService(value);
  });
}

  // initial render and load books list
  renderCart();
  if (booksDropdown) loadBooks();

  // fetchOrdersList helper used earlier
  function formatDateTimeForDisplay(dtStr) {
    try {
      const d = new Date(dtStr);
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2,'0');
      const min = String(d.getMinutes()).padStart(2,'0');
      const ss = String(d.getSeconds()).padStart(2,'0');
      return `${dd}/${mm}/${yyyy}, ${hh}:${min}:${ss}`;
    } catch (e) { return dtStr || ''; }
  }

  // Expose internal helpers for debugging
  window._ordersClient = {
    loadPricesForService,
    loadBooks,
    loadBookPreview,
    addBookToCartById,
    prices,
    cart,
    serviceRequiresPrinter,
    printers,
    renderCart
  };

});
