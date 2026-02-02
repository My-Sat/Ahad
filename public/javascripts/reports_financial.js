// public/javascripts/reports_financial.js
(function () {
  function fmt(n) {
    return Number(n || 0).toFixed(2);
  }

  function formatCedi(n) {
    return `GH\u20B5 ${fmt(n)}`;
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, c => '&#' + c.charCodeAt(0) + ';');
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) {
      throw new Error((j && j.error) ? j.error : `Request failed (${res.status})`);
    }
    return j;
  }

  function buildQuery(params) {
    const sp = new URLSearchParams();
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if (v) sp.set(k, v);
    });
    const qs = sp.toString();
    return qs ? `?${qs}` : '';
  }

  function renderPaymentsByMethod(rows) {
    const table = document.getElementById('paymentsByMethodTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="3">No payments in this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.method)}</td>
        <td class="text-end">${Number(r.count || 0)}</td>
        <td class="text-end">${formatCedi(r.total || 0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderCashierCollections(rows) {
    const table = document.getElementById('cashierCollectionsTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="4">No cashier data for this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.name || '')}</td>
        <td class="text-end">${formatCedi(r.totalCashRecorded || 0)}</td>
        <td class="text-end">${formatCedi(r.totalCollected || 0)}</td>
        <td class="text-end">${formatCedi(r.previousBalance || 0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderAccountantLedger(rows) {
    const table = document.getElementById('accountantLedgerTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="2">No accountant data for this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.name || '')}</td>
        <td class="text-end">${formatCedi(r.totalCollected || 0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderDebtorsAging(buckets, topDebtors) {
    const agingTable = document.getElementById('debtorsAgingTable');
    const topTable = document.getElementById('topDebtorsTable');
    if (!agingTable || !topTable) return;

    const agingBody = agingTable.querySelector('tbody');
    const topBody = topTable.querySelector('tbody');
    if (!agingBody || !topBody) return;

    const bucketOrder = ['0-7', '8-30', '31-60', '61-90', '90+'];
    const bucketMap = {};
    (buckets || []).forEach(b => { bucketMap[b.bucket] = b; });

    agingBody.innerHTML = '';
    bucketOrder.forEach(label => {
      const row = bucketMap[label] || { count: 0, totalOutstanding: 0 };
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${label}</td>
        <td class="text-end">${Number(row.count || 0)}</td>
        <td class="text-end">${formatCedi(row.totalOutstanding || 0)}</td>
      `;
      agingBody.appendChild(tr);
    });

    if (!topDebtors || !topDebtors.length) {
      topBody.innerHTML = '<tr><td class="text-muted" colspan="3">No debtors found.</td></tr>';
      return;
    }
    topBody.innerHTML = '';
    topDebtors.forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(d.name || '')}</td>
        <td class="text-end">${Number(d.ordersCount || 0)}</td>
        <td class="text-end">${formatCedi(d.totalOutstanding || 0)}</td>
      `;
      topBody.appendChild(tr);
    });
  }

  function renderDiscountsSummary(totalAmount, ordersCount, byScope) {
    setText('discountTotalAmount', formatCedi(totalAmount || 0));
    setText('discountOrdersCount', Number(ordersCount || 0));

    const table = document.getElementById('discountScopeTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!byScope || !byScope.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="3">No discounts in this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    byScope.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(s.scope || 'unknown')}</td>
        <td class="text-end">${Number(s.ordersCount || 0)}</td>
        <td class="text-end">${formatCedi(s.totalDiscountAmount || 0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderOrdersByStatus(rows) {
    const table = document.getElementById('ordersByStatusTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="4">No orders in this range.</td></tr>';
      return;
    }
    const order = ['pending', 'paid', 'cancelled'];
    const map = {};
    rows.forEach(r => { map[r.status] = r; });
    const sorted = [];
    order.forEach(k => { if (map[k]) sorted.push(map[k]); });
    rows.forEach(r => { if (!order.includes(r.status)) sorted.push(r); });

    tbody.innerHTML = '';
    sorted.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.status || 'unknown')}</td>
        <td class="text-end">${Number(r.ordersCount || 0)}</td>
        <td class="text-end">${formatCedi(r.totalAmount || 0)}</td>
        <td class="text-end">${formatCedi(r.outstandingAmount || 0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderOrdersByStaff(rows) {
    const table = document.getElementById('ordersByStaffTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="5">No orders in this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.name || '')}</td>
        <td class="text-end">${Number(r.ordersCount || 0)}</td>
        <td class="text-end">${formatCedi(r.totalAmount || 0)}</td>
        <td class="text-end">${Number(r.paidOrdersCount || 0)}</td>
        <td class="text-end">${formatCedi(r.totalPaidAmount || 0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderSalesByService(rows) {
    const table = document.getElementById('salesByServiceTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="3">No items in this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.serviceName || 'Unknown')}</td>
        <td class="text-end">${Number(r.itemsCount || 0)}</td>
        <td class="text-end">${formatCedi(r.totalAmount || 0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderSalesByCategory(rows) {
    const table = document.getElementById('salesByCategoryTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="4">No items in this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.categoryName || 'Uncategorized')}</td>
        <td class="text-end">${Number(r.itemsCount || 0)}</td>
        <td class="text-end">${Number(r.servicesCount || 0)}</td>
        <td class="text-end">${formatCedi(r.totalAmount || 0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function formatDateTime(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }

  function renderCustomerSummary(rows) {
    const table = document.getElementById('customerSummaryTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="6">No customer orders in this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.name || '')}</td>
        <td class="text-end">${Number(r.ordersCount || 0)}</td>
        <td class="text-end">${formatCedi(r.totalAmount || 0)}</td>
        <td class="text-end">${formatCedi(r.paidAmount || 0)}</td>
        <td class="text-end">${formatCedi(r.outstandingAmount || 0)}</td>
        <td>${escapeHtml(formatDateTime(r.lastOrderAt))}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderCustomerAccountActivity(totals, rows) {
    setText('customerCreditsTotal', formatCedi(totals?.totalCredits || 0));
    setText('customerDebitsTotal', formatCedi(totals?.totalDebits || 0));
    setText('customerTxnsTotal', Number(totals?.totalTxns || 0));

    const table = document.getElementById('customerAccountActivityTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="6">No account activity in this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.name || '')}</td>
        <td class="text-end">${formatCedi(r.credits || 0)}</td>
        <td class="text-end">${formatCedi(r.debits || 0)}</td>
        <td class="text-end">${formatCedi(r.net || 0)}</td>
        <td class="text-end">${formatCedi(r.accountBalance || 0)}</td>
        <td>${escapeHtml(formatDateTime(r.lastTxnAt))}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderPrinterUsage(totals, rows) {
    setText('printerUsageTotal', Number(totals?.totalUsed || 0));

    const table = document.getElementById('printerUsageTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="5">No printer usage in this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.name || '')}</td>
        <td class="text-end">${Number(r.totalCount || 0)}</td>
        <td class="text-end">${Number(r.monoCount || 0)}</td>
        <td class="text-end">${Number(r.colourCount || 0)}</td>
        <td>${escapeHtml(r.location || '')}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderMaterialUsage(totals, rows) {
    setText('materialUsageTotal', Number(totals?.totalUsed || 0));

    const table = document.getElementById('materialUsageTable');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td class="text-muted" colspan="3">No material usage in this range.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(r.storeName || '')}</td>
        <td>${escapeHtml(r.materialName || '')}</td>
        <td class="text-end">${Number(r.totalCount || 0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function loadReports() {
    const fromEl = document.getElementById('reportFrom');
    const toEl = document.getElementById('reportTo');
    const statusEl = document.getElementById('reportStatus');

    const from = fromEl ? fromEl.value : '';
    const to = toEl ? toEl.value : '';

    if (from && to && new Date(from) > new Date(to)) {
      alert('From date cannot be after To date');
      return;
    }

    if (statusEl) statusEl.textContent = 'Loading reports...';

    const rangeQuery = buildQuery({ from, to });
    const asOf = to || from || '';
    const agingQuery = buildQuery({ asOf });

    try {
      const [
        financial,
        cashiers,
        accountants,
        debtors,
        discounts,
        ordersByStatus,
        ordersByStaff,
        salesByService,
        salesByCategory,
        customerSummary,
        customerAccount,
        printerUsage,
        materialUsage
      ] = await Promise.all([
        fetchJson(`/admin/reports/api/financial-summary${rangeQuery}`),
        fetchJson(`/admin/reports/api/cashier-collections${rangeQuery}`),
        fetchJson(`/admin/reports/api/accountant-ledger${rangeQuery}`),
        fetchJson(`/admin/reports/api/debtors-aging${agingQuery}`),
        fetchJson(`/admin/reports/api/discounts${rangeQuery}`),
        fetchJson(`/admin/reports/api/orders-by-status${rangeQuery}`),
        fetchJson(`/admin/reports/api/orders-by-staff${rangeQuery}`),
        fetchJson(`/admin/reports/api/sales-by-service${rangeQuery}`),
        fetchJson(`/admin/reports/api/sales-by-category${rangeQuery}`),
        fetchJson(`/admin/reports/api/customer-summary${rangeQuery}`),
        fetchJson(`/admin/reports/api/customer-account-activity${rangeQuery}`),
        fetchJson(`/admin/reports/api/printer-usage${rangeQuery}`),
        fetchJson(`/admin/reports/api/material-usage${rangeQuery}`)
      ]);

      if (financial && financial.summary) {
        const s = financial.summary;
        setText('summaryTotalOrders', formatCedi(s.totalOrdersAmount || 0));
        setText('summaryTotalPaid', formatCedi(s.totalPaidOrdersAmount || 0));
        setText('summaryOutstanding', formatCedi(s.totalOutstandingAmount || 0));
        setText('summaryPaymentsReceived', formatCedi(s.totalPaymentsReceived || 0));
        setText('summaryOrdersCount', Number(s.ordersCount || 0));
        setText('summaryPaidOrdersCount', Number(s.paidOrdersCount || 0));
        renderPaymentsByMethod(financial.paymentsByMethod || []);
      }

      renderCashierCollections((cashiers && cashiers.cashiers) ? cashiers.cashiers : []);
      renderAccountantLedger((accountants && accountants.accountants) ? accountants.accountants : []);
      renderDebtorsAging((debtors && debtors.buckets) ? debtors.buckets : [], (debtors && debtors.topDebtors) ? debtors.topDebtors : []);
      renderDiscountsSummary(
        (discounts && discounts.totalDiscountAmount) ? discounts.totalDiscountAmount : 0,
        (discounts && discounts.discountedOrdersCount) ? discounts.discountedOrdersCount : 0,
        (discounts && discounts.byScope) ? discounts.byScope : []
      );

      renderOrdersByStatus((ordersByStatus && ordersByStatus.rows) ? ordersByStatus.rows : []);
      renderOrdersByStaff((ordersByStaff && ordersByStaff.rows) ? ordersByStaff.rows : []);
      renderSalesByService((salesByService && salesByService.rows) ? salesByService.rows : []);
      renderSalesByCategory((salesByCategory && salesByCategory.rows) ? salesByCategory.rows : []);

      renderCustomerSummary((customerSummary && customerSummary.rows) ? customerSummary.rows : []);
      renderCustomerAccountActivity(
        (customerAccount && customerAccount.totals) ? customerAccount.totals : { totalCredits: 0, totalDebits: 0, totalTxns: 0 },
        (customerAccount && customerAccount.rows) ? customerAccount.rows : []
      );

      renderPrinterUsage(
        (printerUsage && printerUsage.totals) ? printerUsage.totals : { totalUsed: 0 },
        (printerUsage && printerUsage.rows) ? printerUsage.rows : []
      );
      renderMaterialUsage(
        (materialUsage && materialUsage.totals) ? materialUsage.totals : { totalUsed: 0 },
        (materialUsage && materialUsage.rows) ? materialUsage.rows : []
      );

      if (statusEl) {
        const label = (financial && financial.range)
          ? `Range: ${financial.range.from} to ${financial.range.to}`
          : 'Reports loaded.';
        statusEl.textContent = label;
      }
    } catch (err) {
      console.error('loadReports error', err);
      if (statusEl) statusEl.textContent = 'Failed to load one or more reports.';
    }
  }

  function initReportsPage() {
    const applyBtn = document.getElementById('reportApplyBtn');

    // Defensive: remove any previous click handlers by cloning the button
    if (applyBtn && applyBtn.parentNode) {
      const freshBtn = applyBtn.cloneNode(true);
      applyBtn.parentNode.replaceChild(freshBtn, applyBtn);
      freshBtn.addEventListener('click', loadReports);
    }

    // Load immediately (works for both full load and ajax loads)
    loadReports();
  }

  document.addEventListener('DOMContentLoaded', () => {
    initReportsPage();
  });

  document.addEventListener('ajax:page:loaded', (e) => {
    if (e && e.detail && typeof e.detail.url === 'string' && e.detail.url.includes('/admin/reports')) {
      initReportsPage();
    }
  });
})();
