(function() {
  // fetch a URL and replace #main-content with its #main-content fragment
  async function loadPage(url, push = true) {
    try {
      const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) {
        // fallback to full navigation
        window.location.href = url;
        return;
      }
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const newMain = doc.querySelector('#main-content');
      if (!newMain) {
        window.location.href = url;
        return;
      }
      const main = document.getElementById('main-content');
      main.innerHTML = newMain.innerHTML;

      // update active tab
      setActiveTabByUrl(url);

      if (push) history.pushState({ url }, '', url);

      // re-run page initializers
      initializePage();

      // smooth scroll to top of main content
      window.scrollTo({ top: main.getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' });
    } catch (err) {
      console.error('Page load failed', err);
      window.location.href = url;
    }
  }

  // set active tab based on URL pathname
  function setActiveTabByUrl(url) {
    try {
      const target = new URL(url, window.location.origin);
      const path = target.pathname.replace(/\/$/, '');
      const mapping = {
        '/admin/services': 'tab-services',
        '/admin/printers': 'tab-printers',
        '/admin/stock': 'tab-stock',
        '/admin/users': 'tab-users',
        '/admin/messaging': 'tab-messaging',
        '/admin/reports': 'tab-reports',
        '/admin/orders': 'tab-orders'   // <--- NEW: orders mapping
      };

      // default to services if root /admin
      let id = mapping[path] || (path === '/admin' ? 'tab-services' : null);
      if (!id && path.startsWith('/admin')) {
        // try to match partial, e.g. /admin/services/123
        if (path.startsWith('/admin/services')) id = 'tab-services';
        else if (path.startsWith('/admin/printers')) id = 'tab-printers';
        else if (path.startsWith('/admin/stock')) id = 'tab-stock';
        else if (path.startsWith('/admin/users')) id = 'tab-users';
        else if (path.startsWith('/admin/messaging')) id = 'tab-messaging';
        else if (path.startsWith('/admin/reports')) id = 'tab-reports';
        else if (path.startsWith('/admin/orders')) id = 'tab-orders'; // <--- NEW partial match for orders
      }
      // toggle active class
      document.querySelectorAll('#topTabs .nav-link').forEach(a => a.classList.remove('active'));
      if (id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
      }
    } catch (err) {
      console.error('setActiveTabByUrl error', err);
    }
  }

  // initialize page behaviors inside #main-content
  function initializePage() {
    // wrap main content in nice card if not already
    const main = document.getElementById('main-content');
    if (main && !main.classList.contains('content-card')) {
      // optional: keep existing block, but wrap children in .content-card for nicer look
      // only add wrapper if not already present
      const firstChild = main.firstElementChild;
      if (!main.classList.contains('no-card') ) {
        // add content-card styles by wrapping content
        const wrapper = document.createElement('div');
        wrapper.className = 'content-card';
        // move children into wrapper
        while (main.firstChild) wrapper.appendChild(main.firstChild);
        main.appendChild(wrapper);
      }
    }

    // initialize assign-price form (works for radios OR checkboxes)
    const assignBtn = document.getElementById('assignBtn');
    const formAssign = document.getElementById('assign-price');
    const selectionsInput = document.getElementById('selectionsInput');

    // remove previous handlers (defensive)
    if (assignBtn) {
      const newAssignBtn = assignBtn.cloneNode(true);
      assignBtn.parentNode.replaceChild(newAssignBtn, assignBtn);
    }

    if (newAssignBtnAvailable()) {
      const btn = document.getElementById('assignBtn');
      btn.addEventListener('click', function() {
        const radioChecked = Array.from(document.querySelectorAll('.unit-sub-radio:checked'));
        const checkboxChecked = Array.from(document.querySelectorAll('.unit-sub-checkbox:checked'));
        const checked = radioChecked.length ? radioChecked : checkboxChecked;
        const selections = checked.map(el => ({ unit: el.dataset.unit, subUnit: el.dataset.subunit }));
        if (selections.length === 0) {
          alert('Please select at least one sub-unit before assigning a price.');
          return;
        }
        if (!selectionsInput) {
          console.error('selectionsInput hidden field not found');
          return;
        }
        selectionsInput.value = JSON.stringify(selections);
        // submit the form (normal POST)
        if (formAssign) formAssign.submit();
      });
    }

    // show toast if query params present
    (function showAssignToast() {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('assigned') === '1') {
          const price = params.get('price');
          const label = params.get('label');
          let msg = 'Price assigned successfully.';
          if (label) {
            msg = `${decodeURIComponent(label)}`;
            if (price) msg += ` — ${decodeURIComponent(price)}`;
          } else if (price) {
            msg = `Price assigned: ${decodeURIComponent(price)}`;
          }
          const toastEl = document.getElementById('assignToast');
          const toastBody = document.getElementById('assignToastBody');
          if (toastBody) toastBody.textContent = msg;
          if (toastEl && window.bootstrap && window.bootstrap.Toast) {
            const toast = new bootstrap.Toast(toastEl, { delay: 8000 });
            toast.show();
          }
          // clean URL
          params.delete('assigned');
          params.delete('price');
          params.delete('label');
          const newQ = params.toString();
          const base = window.location.pathname + (newQ ? '?' + newQ : '');
          window.history.replaceState({}, document.title, base);
        }
      } catch (err) {
        console.error('toast error', err);
      }
    })();
  }

  function newAssignBtnAvailable() {
    return !!document.getElementById('assignBtn');
  }

  // Intercept clicks on tabs / links marked data-ajax=true
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a[data-ajax="true"]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    e.preventDefault();
    loadPage(href, true);
  });

  // popstate handling
  window.addEventListener('popstate', function(e) {
    const url = (e.state && e.state.url) || window.location.href;
    loadPage(url, false);
  });

  // initial setup on load
  document.addEventListener('DOMContentLoaded', function() {
    // if current path is /admin or /admin/ default to /admin/services content
    const path = window.location.pathname.replace(/\/$/, '');
    if (path === '/admin' || path === '') {
      // load services into main (will also call history.pushState)
      loadPage('/admin/services', true);
    } else {
      // set active tab and initialize page normally
      setActiveTabByUrl(window.location.href);
      initializePage();
    }
  });
})();
