(function () {
  'use strict';

  function initEnquiriesPage() {
    const root = document.getElementById('enquiriesPage');
    if (!root) return;
    if (root.dataset.initDone === '1') return;
    root.dataset.initDone = '1';

    const isAdmin = root.dataset.isAdmin === 'true';
    const firstNameInput = document.getElementById('enquiryFirstName');
    const phoneInput = document.getElementById('enquiryPhone');
    const printBtn = document.getElementById('enquiryPrintBtn');
    const shareBtn = document.getElementById('enquiryShareBtn');
    const reloadCatalogBtn = document.getElementById('enquiryReloadCatalogBtn');
    const openEnquiriesBtn = document.getElementById('openEnquiriesListBtn');
    const enquiriesModalEl = document.getElementById('enquiriesListModal');
    const catalogList = document.getElementById('enquiryCatalogList');
    const categoryNameInput = document.getElementById('enquiryCategoryName');
    const addCategoryBtn = document.getElementById('enquiryAddCategoryBtn');
    const manageCategorySelect = document.getElementById('enquiryManageCategorySelect');
    const serviceNameInput = document.getElementById('enquiryServiceName');
    const addServiceBtn = document.getElementById('enquiryAddServiceBtn');
    const enquiriesTbody = document.querySelector('#enquiriesTable tbody');
    const countEl = document.getElementById('enquiriesListCount');
    const moreBtn = document.getElementById('enquiriesMoreBtn');

    let catalog = [];
    let page = 1;
    let hasMore = false;
    const pageSize = 100;
    const enquiriesModal = (window.bootstrap && enquiriesModalEl)
      ? window.bootstrap.Modal.getOrCreateInstance(enquiriesModalEl)
      : null;

    function escapeHtml(s) {
      return String(s || '').replace(/[&<>"'`=\/]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
    }

    function showAlert(message) {
      if (typeof window.showGlobalToast === 'function') {
        try { window.showGlobalToast(String(message || ''), 2400); return; } catch (e) {}
      }
      alert(String(message || ''));
    }

    function customerSnapshot() {
      return {
        firstName: String(firstNameInput && firstNameInput.value ? firstNameInput.value : '').trim(),
        phone: String(phoneInput && phoneInput.value ? phoneInput.value : '').trim()
      };
    }

    function catalogRows() {
      return (Array.isArray(catalog) ? catalog : []).map(cat => ({
        id: String(cat && cat.id ? cat.id : '').trim(),
        name: String(cat && cat.name ? cat.name : '').trim(),
        services: (Array.isArray(cat && cat.services) ? cat.services : []).map(service => ({
          id: String(service && service.id ? service.id : '').trim(),
          name: String(service && service.name ? service.name : '').trim()
        }))
      }));
    }

    function renderManageCategories() {
      if (!manageCategorySelect) return;
      const selected = manageCategorySelect.value;
      const rows = catalogRows();
      manageCategorySelect.innerHTML = '<option value="">-- Select category --</option>';
      rows.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name || 'Category';
        manageCategorySelect.appendChild(opt);
      });
      if (selected && rows.some(cat => cat.id === selected)) manageCategorySelect.value = selected;
    }

    function renderCatalog() {
      if (!catalogList) return;
      const rows = catalogRows();
      if (!rows.length) {
        catalogList.innerHTML = '<p class="text-muted-light mb-0">No service categories found.</p>';
        renderManageCategories();
        return;
      }

      catalogList.innerHTML = rows.map(cat => {
        const services = Array.isArray(cat.services) ? cat.services : [];
        const serviceHtml = services.length
          ? services.map(s => `
              <li class="list-group-item d-flex justify-content-between align-items-center">
                <span>${escapeHtml(s.name || 'Service')}</span>
                ${isAdmin ? `
                  <span class="d-inline-flex gap-1">
                    <button class="btn btn-sm btn-outline-light-custom enquiry-edit-service-btn" type="button" data-category-id="${escapeHtml(cat.id)}" data-service-id="${escapeHtml(s.id)}" data-service-name="${escapeHtml(s.name || '')}">Edit</button>
                    <button class="btn btn-sm btn-outline-danger enquiry-delete-service-btn" type="button" data-category-id="${escapeHtml(cat.id)}" data-service-id="${escapeHtml(s.id)}">Delete</button>
                  </span>
                ` : ''}
              </li>
            `).join('')
          : '<li class="list-group-item text-muted-light">No services under this category.</li>';
        return `
          <div class="card dark-surface mb-3">
            <div class="card-body dark-card-body py-2">
              <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
                <h6 class="text-white mb-0">${escapeHtml(String(cat.name || '').toUpperCase())}</h6>
                ${isAdmin ? `
                  <span class="d-inline-flex gap-1">
                    <button class="btn btn-sm btn-outline-light-custom enquiry-edit-category-btn" type="button" data-category-id="${escapeHtml(cat.id)}" data-category-name="${escapeHtml(cat.name || '')}">Edit</button>
                    <button class="btn btn-sm btn-outline-danger enquiry-delete-category-btn" type="button" data-category-id="${escapeHtml(cat.id)}">Delete</button>
                  </span>
                ` : ''}
              </div>
              <ul class="list-group list-group-flush">${serviceHtml}</ul>
            </div>
          </div>
        `;
      }).join('');
      renderManageCategories();
    }

    async function loadCatalog() {
      if (catalogList) catalogList.innerHTML = '<p class="text-muted-light mb-0">Loading services...</p>';
      try {
        const res = await fetch('/registrations/enquiries/catalog', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'Failed to load catalog');
        catalog = Array.isArray(j.catalog) ? j.catalog : [];
        renderCatalog();
      } catch (err) {
        console.error('load enquiries catalog failed', err);
        if (catalogList) catalogList.innerHTML = '<p class="text-danger mb-0">Failed to load services.</p>';
      }
    }

    async function catalogRequest(url, options) {
      const res = await fetch(url, Object.assign({
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      }, options || {}));
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'Our services update failed');
      await loadCatalog();
      return j;
    }

    async function addCategory() {
      if (!isAdmin || !categoryNameInput) return;
      const name = String(categoryNameInput.value || '').trim();
      if (!name) return showAlert('Enter category name.');
      const old = addCategoryBtn ? addCategoryBtn.textContent : '';
      if (addCategoryBtn) { addCategoryBtn.disabled = true; addCategoryBtn.textContent = 'Adding...'; }
      try {
        await catalogRequest('/registrations/enquiries/catalog/categories', {
          method: 'POST',
          body: JSON.stringify({ name })
        });
        categoryNameInput.value = '';
      } catch (err) {
        showAlert(err.message || 'Failed to add category.');
      } finally {
        if (addCategoryBtn) { addCategoryBtn.disabled = false; addCategoryBtn.textContent = old || 'Add Category'; }
      }
    }

    async function addService() {
      if (!isAdmin || !manageCategorySelect || !serviceNameInput) return;
      const categoryId = String(manageCategorySelect.value || '').trim();
      const name = String(serviceNameInput.value || '').trim();
      if (!categoryId) return showAlert('Select a category first.');
      if (!name) return showAlert('Enter service name.');
      const old = addServiceBtn ? addServiceBtn.textContent : '';
      if (addServiceBtn) { addServiceBtn.disabled = true; addServiceBtn.textContent = 'Adding...'; }
      try {
        await catalogRequest(`/registrations/enquiries/catalog/categories/${encodeURIComponent(categoryId)}/services`, {
          method: 'POST',
          body: JSON.stringify({ name })
        });
        serviceNameInput.value = '';
      } catch (err) {
        showAlert(err.message || 'Failed to add service.');
      } finally {
        if (addServiceBtn) { addServiceBtn.disabled = false; addServiceBtn.textContent = old || 'Add Service'; }
      }
    }

    function renderEnquiryRows(rows, append) {
      if (!enquiriesTbody) return;
      const list = Array.isArray(rows) ? rows : [];
      if (!append) enquiriesTbody.innerHTML = '';
      if (!list.length && !append) {
        enquiriesTbody.innerHTML = '<tr><td class="text-muted-light" colspan="3">No enquiries saved yet.</td></tr>';
        if (countEl) countEl.textContent = '0 shown';
        return;
      }
      list.forEach(row => {
        const tr = document.createElement('tr');
        tr.dataset.enquiryRow = '1';
        tr.innerHTML = `
          <td>${escapeHtml(row.firstName || '-')}</td>
          <td>${escapeHtml(row.phone || '')}</td>
          <td>${row.createdAt ? escapeHtml(new Date(row.createdAt).toLocaleString()) : '-'}</td>
        `;
        enquiriesTbody.appendChild(tr);
      });
    }

    function updateEnquiriesCount() {
      if (!countEl || !enquiriesTbody) return;
      const shown = enquiriesTbody.querySelectorAll('tr[data-enquiry-row="1"]').length;
      countEl.textContent = `${shown} shown`;
    }

    async function loadEnquiries(reset) {
      if (reset) page = 1;
      try {
        const res = await fetch(`/registrations/enquiries/api?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(pageSize)}`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || 'Failed to load enquiries');
        hasMore = !!j.hasMore;
        renderEnquiryRows(j.enquiries || [], !reset);
        updateEnquiriesCount();
        if (moreBtn) moreBtn.style.display = hasMore ? '' : 'none';
      } catch (err) {
        console.error('load enquiries failed', err);
        if (enquiriesTbody && reset) enquiriesTbody.innerHTML = '<tr><td class="text-danger" colspan="3">Failed to load enquiries.</td></tr>';
      }
    }

    async function saveEnquiry(action) {
      const customer = customerSnapshot();
      if (!customer.phone) {
        showAlert('Enter customer phone number before printing or sharing.');
        if (phoneInput) phoneInput.focus();
        return null;
      }

      const res = await fetch('/registrations/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ firstName: customer.firstName, phone: customer.phone, action })
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || !j.ok || !j.enquiry) {
        throw new Error((j && j.error) || 'Failed to save enquiry');
      }
      await loadEnquiries(true);
      return j.enquiry;
    }

    function businessHeaderHtml(subtitle) {
      return `
        <div class="header">
          <div class="brand">
            <img class="logo" src="/images/AHAD LOGO3.jpeg" alt="AHAD">
            <div class="company-block">
              <div class="company-name">AHADPRINT</div>
              <div class="muted">${escapeHtml(subtitle || 'Our Services')}</div>
            </div>
            <div class="business-info">
              <div class="business-line"><strong>Services:</strong> Digital Printing, Sales of Home Use Computers, Stationery and general merchandise.</div>
              <div class="business-line"><strong>Location:</strong> Tamale Technical University.</div>
              <div class="business-line"><strong>Tel:</strong> 0244104350.</div>
              <div class="business-line"><strong>WhatsApp:</strong> 0558590262</div>
            </div>
          </div>
        </div>
      `;
    }

    function buildPrintHtml(enquiry) {
      const rows = catalogRows();
      const serviceHtml = rows.map(cat => {
        const services = Array.isArray(cat.services) ? cat.services : [];
        const items = services.length
          ? services.map(s => `<li>${escapeHtml(s.name || 'Service')}</li>`).join('')
          : '<li class="muted">No services listed.</li>';
        return `
          <section class="category">
            <h2>${escapeHtml(String(cat.name || '').toUpperCase())}</h2>
            <ul>${items}</ul>
          </section>
        `;
      }).join('');
      const name = String((enquiry && enquiry.firstName) || '').trim();
      const phone = String((enquiry && enquiry.phone) || '').trim();
      const date = enquiry && enquiry.createdAt ? new Date(enquiry.createdAt) : new Date();

      return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Our Services</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color:#111827; margin:0; font-size:12px; }
    .header { border-bottom:2px solid #111827; padding-bottom:14px; margin-bottom:16px; }
    .brand { display:flex; align-items:flex-start; gap:14px; }
    .logo { max-height:62px; max-width:150px; object-fit:contain; }
    .company-name { font-size:18px; font-weight:800; letter-spacing:.08em; white-space:nowrap; }
    .company-block { min-width:128px; }
    .business-info { border-left:1px solid #ddd; padding-left:12px; }
    .business-line { font-size:10.5px; line-height:1.35; max-width:380px; }
    .muted { color:#555; }
    h1 { margin:0 0 10px; font-size:22px; }
    h2 { font-size:13px; letter-spacing:.06em; margin:0 0 8px; color:#0f4f65; }
    .meta { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; border:1px solid #ddd; border-radius:8px; padding:10px; margin-bottom:14px; }
    .category { border:1px solid #d5e7ec; border-radius:10px; padding:10px; margin-bottom:10px; }
    ul { margin:0; padding-left:18px; columns:2; column-gap:32px; }
    li { margin:0 0 6px; break-inside:avoid; }
  </style>
</head>
<body>
  ${businessHeaderHtml('Our Services')}
  <h1>OUR SERVICES</h1>
  <div class="meta">
    <div><strong>Name:</strong> ${escapeHtml(name || '-')}</div>
    <div><strong>Phone:</strong> ${escapeHtml(phone)}</div>
    <div><strong>Date:</strong> ${escapeHtml(date.toLocaleString())}</div>
  </div>
  ${serviceHtml || '<p class="muted">No services listed.</p>'}
</body>
</html>`;
    }

    async function printEnquiry(enquiry) {
      const w = window.open('', '_blank', 'toolbar=0,location=0,menubar=0');
      if (!w) return showAlert('Unable to open print window. Please allow pop-ups.');
      w.document.open();
      w.document.write(buildPrintHtml(enquiry));
      w.document.close();
      w.focus();
      const runPrint = () => {
        try { w.print(); } catch (e) { showAlert('Print failed.'); }
      };
      const logo = w.document.querySelector('.logo');
      if (logo && !logo.complete) {
        let done = false;
        const go = () => { if (done) return; done = true; setTimeout(runPrint, 150); };
        logo.onload = go;
        logo.onerror = go;
        setTimeout(go, 1400);
      } else {
        setTimeout(runPrint, 150);
      }
    }

    function sanitizePdfText(text) {
      return String(text || '').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E]/g, '');
    }

    function pdfEscape(text) {
      return sanitizePdfText(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    }

    function wrapPdfLine(text, maxLen) {
      const words = sanitizePdfText(text).split(/\s+/);
      const lines = [];
      let current = '';
      words.forEach(word => {
        if (!word) return;
        if ((current + ' ' + word).trim().length > maxLen) {
          if (current) lines.push(current);
          current = word;
        } else {
          current = (current ? current + ' ' : '') + word;
        }
      });
      if (current) lines.push(current);
      return lines.length ? lines : [''];
    }

    function bytesToHex(bytes) {
      let out = '';
      for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0').toUpperCase();
      return out;
    }

    function getJpegDimensions(bytes) {
      if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
      let offset = 2;
      const sof = new Set([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF]);
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xFF) { offset += 1; continue; }
        while (bytes[offset] === 0xFF) offset += 1;
        const marker = bytes[offset]; offset += 1;
        if (marker === 0xD9 || marker === 0xDA) break;
        if (offset + 1 >= bytes.length) break;
        const length = (bytes[offset] << 8) + bytes[offset + 1];
        if (!length || offset + length > bytes.length) break;
        if (sof.has(marker) && length >= 7) {
          return { height: (bytes[offset + 3] << 8) + bytes[offset + 4], width: (bytes[offset + 5] << 8) + bytes[offset + 6], components: bytes[offset + 7] || 3 };
        }
        offset += length;
      }
      return null;
    }

    async function loadLogoForPdf() {
      try {
        const res = await fetch('/images/AHAD LOGO3.jpeg', { cache: 'force-cache' });
        if (!res.ok) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const dims = getJpegDimensions(bytes);
        if (!dims) return null;
        return { bytes, width: dims.width, height: dims.height, components: dims.components || 3 };
      } catch (e) {
        return null;
      }
    }

    function enquiryPdfFileName(enquiry) {
      const raw = String((enquiry && (enquiry.firstName || enquiry.phone)) || 'service_enquiry').trim();
      const safe = raw.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70);
      return `${safe || 'service_enquiry'}_services.pdf`;
    }

    async function buildPdfBlob(enquiry) {
      const logo = await loadLogoForPdf();
      const lines = [];
      const date = enquiry && enquiry.createdAt ? new Date(enquiry.createdAt) : new Date();
      lines.push(`Generated: ${date.toLocaleString()}`);
      lines.push(`Customer: ${enquiry.firstName || '-'}`);
      lines.push(`Phone: ${enquiry.phone || ''}`);
      lines.push('');
      lines.push('OUR SERVICES');
      catalogRows().forEach(cat => {
        lines.push('');
        lines.push(String(cat.name || '').toUpperCase());
        const services = Array.isArray(cat.services) ? cat.services : [];
        if (!services.length) {
          lines.push('  - No services listed.');
        } else {
          services.forEach(s => {
            lines.push(`  - ${s.name || 'Service'}`);
          });
        }
      });

      const wrapped = [];
      lines.forEach(line => wrapPdfLine(line, 86).forEach(w => wrapped.push(w)));
      const pageSize = logo ? 44 : 48;
      const pages = [];
      for (let i = 0; i < wrapped.length; i += pageSize) pages.push(wrapped.slice(i, i + pageSize));
      if (!pages.length) pages.push(['OUR SERVICES']);

      const objects = [];
      const addObj = body => { objects.push(body); return objects.length; };
      const catalogId = addObj('');
      const pagesId = addObj('');
      const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
      const fontBoldId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');
      let imageId = null;
      let logoCommand = '';
      if (logo) {
        const imgWidth = 72;
        const imgHeight = Math.min(58, Math.max(30, Number((imgWidth * (logo.height / logo.width)).toFixed(2))));
        const imgX = 50;
        const imgY = 765;
        const colorSpace = logo.components === 1 ? '/DeviceGray' : (logo.components === 4 ? '/DeviceCMYK' : '/DeviceRGB');
        const imageStream = `${bytesToHex(logo.bytes)}>`;
        imageId = addObj(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${imageStream.length} >>\nstream\n${imageStream}\nendstream`);
        logoCommand = `q\n${imgWidth} 0 0 ${imgHeight} ${imgX} ${imgY} cm\n/Im1 Do\nQ`;
      }

      const headerCommands = () => {
        const commands = [];
        if (logoCommand) commands.push(logoCommand);
        const companyX = logoCommand ? 136 : 50;
        const infoX = logoCommand ? 278 : 198;
        const addLabelValue = (x, y, label, value, dx) => {
          commands.push('BT','/F2 8 Tf',`${x} ${y} Td`,`(${pdfEscape(label)}) Tj`,'ET','BT','/F1 8 Tf',`${x + dx} ${y} Td`,`(${pdfEscape(value)}) Tj`,'ET');
        };
        commands.push('BT','/F2 18 Tf',`${companyX} 803 Td`,`(${pdfEscape('AHADPRINT')}) Tj`,'/F1 9 Tf','0 -16 Td',`(${pdfEscape('OUR SERVICES')}) Tj`,'ET');
        addLabelValue(infoX, 807, 'Services:', 'Digital Printing, Sales of Home Use Computers,', 46);
        commands.push('BT','/F1 8 Tf',`${infoX} 796 Td`,`(${pdfEscape('Stationery and general merchandise.')}) Tj`,'ET');
        addLabelValue(infoX, 785, 'Location:', 'Tamale Technical University.', 48);
        addLabelValue(infoX, 774, 'Tel:', '0244104350.', 22);
        addLabelValue(infoX, 763, 'WhatsApp:', '0558590262', 52);
        return commands;
      };

      const pageIds = [];
      pages.forEach(pageLines => {
        const commands = headerCommands();
        commands.push('BT','/F1 10 Tf','50 724 Td');
        pageLines.forEach((line, idx) => {
          if (idx > 0) commands.push('0 -14 Td');
          commands.push(`(${pdfEscape(line)}) Tj`);
        });
        commands.push('ET');
        const stream = commands.join('\n');
        const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        const xObjectResource = imageId ? `/XObject << /Im1 ${imageId} 0 R >> ` : '';
        const pageId = addObj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> ${xObjectResource}>> /Contents ${contentId} 0 R >>`);
        pageIds.push(pageId);
      });

      objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
      objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
      let pdf = '%PDF-1.4\n';
      const offsets = [0];
      objects.forEach((body, idx) => {
        offsets.push(pdf.length);
        pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
      });
      const xref = pdf.length;
      pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
      pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
      return new Blob([pdf], { type: 'application/pdf' });
    }

    async function sharePdf(enquiry) {
      const blob = await buildPdfBlob(enquiry);
      const filename = enquiryPdfFileName(enquiry);
      const file = (typeof File !== 'undefined') ? new File([blob], filename, { type: 'application/pdf' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ title: 'Our Services', text: 'Our services from AHADPRINT', files: [file] });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showAlert('PDF downloaded. You can attach and send it to the customer.');
    }

    async function ensureCatalogLoaded() {
      if (!catalog.length) await loadCatalog();
      if (!catalog.length) throw new Error('No services available to print/share.');
    }

    async function handlePrint() {
      const original = printBtn ? printBtn.innerHTML : '';
      if (printBtn) { printBtn.disabled = true; printBtn.textContent = 'Saving...'; }
      try {
        await ensureCatalogLoaded();
        const enquiry = await saveEnquiry('print');
        if (!enquiry) return;
        if (printBtn) printBtn.textContent = 'Printing...';
        await printEnquiry(enquiry);
      } catch (err) {
        console.error('print enquiry failed', err);
        showAlert(err.message || 'Failed to print enquiry.');
      } finally {
        if (printBtn) { printBtn.disabled = false; printBtn.innerHTML = original || 'Print'; }
      }
    }

    async function handleShare() {
      const original = shareBtn ? shareBtn.innerHTML : '';
      if (shareBtn) { shareBtn.disabled = true; shareBtn.textContent = 'Preparing...'; }
      try {
        await ensureCatalogLoaded();
        const enquiry = await saveEnquiry('share');
        if (!enquiry) return;
        await sharePdf(enquiry);
      } catch (err) {
        console.error('share enquiry failed', err);
        showAlert(err.message || 'Failed to share enquiry PDF.');
      } finally {
        if (shareBtn) { shareBtn.disabled = false; shareBtn.innerHTML = original || 'Share PDF'; }
      }
    }

    function openEnquiriesList() {
      if (enquiriesModal) {
        enquiriesModal.show();
      } else if (enquiriesModalEl) {
        enquiriesModalEl.style.display = 'block';
        enquiriesModalEl.removeAttribute('aria-hidden');
      }
      loadEnquiries(true);
    }

    if (printBtn) printBtn.addEventListener('click', handlePrint);
    if (shareBtn) shareBtn.addEventListener('click', handleShare);
    if (reloadCatalogBtn) reloadCatalogBtn.addEventListener('click', loadCatalog);
    if (openEnquiriesBtn) openEnquiriesBtn.addEventListener('click', openEnquiriesList);
    if (addCategoryBtn) addCategoryBtn.addEventListener('click', addCategory);
    if (addServiceBtn) addServiceBtn.addEventListener('click', addService);
    if (categoryNameInput) {
      categoryNameInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          addCategory();
        }
      });
    }
    if (serviceNameInput) {
      serviceNameInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          addService();
        }
      });
    }
    if (catalogList) {
      catalogList.addEventListener('click', async function (ev) {
        if (!isAdmin) return;

        const editCategory = ev.target.closest('.enquiry-edit-category-btn');
        if (editCategory) {
          const categoryId = String(editCategory.dataset.categoryId || '').trim();
          const currentName = String(editCategory.dataset.categoryName || '').trim();
          const name = String(prompt('Category name:', currentName) || '').trim();
          if (!categoryId || !name || name === currentName) return;
          try {
            await catalogRequest(`/registrations/enquiries/catalog/categories/${encodeURIComponent(categoryId)}`, {
              method: 'PUT',
              body: JSON.stringify({ name })
            });
          } catch (err) {
            showAlert(err.message || 'Failed to update category.');
          }
          return;
        }

        const deleteCategory = ev.target.closest('.enquiry-delete-category-btn');
        if (deleteCategory) {
          const categoryId = String(deleteCategory.dataset.categoryId || '').trim();
          if (!categoryId || !confirm('Delete this enquiry category and its services?')) return;
          try {
            await catalogRequest(`/registrations/enquiries/catalog/categories/${encodeURIComponent(categoryId)}`, {
              method: 'DELETE'
            });
          } catch (err) {
            showAlert(err.message || 'Failed to delete category.');
          }
          return;
        }

        const editService = ev.target.closest('.enquiry-edit-service-btn');
        if (editService) {
          const categoryId = String(editService.dataset.categoryId || '').trim();
          const serviceId = String(editService.dataset.serviceId || '').trim();
          const currentName = String(editService.dataset.serviceName || '').trim();
          const name = String(prompt('Service name:', currentName) || '').trim();
          if (!categoryId || !serviceId || !name || name === currentName) return;
          try {
            await catalogRequest(`/registrations/enquiries/catalog/categories/${encodeURIComponent(categoryId)}/services/${encodeURIComponent(serviceId)}`, {
              method: 'PUT',
              body: JSON.stringify({ name })
            });
          } catch (err) {
            showAlert(err.message || 'Failed to update service.');
          }
          return;
        }

        const deleteService = ev.target.closest('.enquiry-delete-service-btn');
        if (deleteService) {
          const categoryId = String(deleteService.dataset.categoryId || '').trim();
          const serviceId = String(deleteService.dataset.serviceId || '').trim();
          if (!categoryId || !serviceId || !confirm('Delete this enquiry service?')) return;
          try {
            await catalogRequest(`/registrations/enquiries/catalog/categories/${encodeURIComponent(categoryId)}/services/${encodeURIComponent(serviceId)}`, {
              method: 'DELETE'
            });
          } catch (err) {
            showAlert(err.message || 'Failed to delete service.');
          }
        }
      });
    }
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        if (!hasMore) return;
        page += 1;
        loadEnquiries(false);
      });
    }

    loadCatalog();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEnquiriesPage, { once: true });
  } else {
    initEnquiriesPage();
  }

  document.addEventListener('ajax:page:loaded', initEnquiriesPage);
})();
