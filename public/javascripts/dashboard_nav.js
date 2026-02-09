//javascripts/dashboard_nav.js
(function() {
  function isSameOrigin(url) {
    try {
      const target = new URL(url, window.location.href);
      return target.origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

function reExecuteScripts(newRoot, targetRoot) {
  if (!newRoot || !targetRoot) return;

  const scripts = newRoot.querySelectorAll('script');
  if (!scripts.length) return;

  // Ignore scripts that live inside the newly injected targetRoot.
  // Those are inert (added via innerHTML) and should not count as "already loaded".
  const existingScripts = Array.from(document.scripts).filter(s => !targetRoot.contains(s));

  scripts.forEach(oldScript => {
    const src = oldScript.getAttribute('src');

    // ✅ If it's an external script and it's already loaded, don't load again
    if (src) {
      const absSrc = new URL(src, window.location.href).href;
      const alreadyLoaded = existingScripts.some(s => (s.src || '') === absSrc);
      if (alreadyLoaded) return;
    }

    const s = document.createElement('script');

    // copy attributes (src, type, defer, etc.)
    for (const attr of oldScript.attributes) {
      s.setAttribute(attr.name, attr.value);
    }

    // inline script content
    if (!src) {
      s.textContent = oldScript.textContent || '';
    }

    targetRoot.appendChild(s);
  });
}

  function ensureSpinner(el) {
    if (!el) return null;
    let sp = el.querySelector('.tab-spinner');
    if (!sp) {
      sp = document.createElement('span');
      sp.className = 'tab-spinner';
      sp.setAttribute('aria-hidden', 'true');
      el.appendChild(sp);
    }
    return sp;
  }

  function setTabLoading(el, loading) {
    if (!el) return;
    if (loading) {
      el.classList.add('is-loading');
      el.setAttribute('aria-busy', 'true');
      ensureSpinner(el);
    } else {
      el.classList.remove('is-loading');
      el.removeAttribute('aria-busy');
      const sp = el.querySelector('.tab-spinner');
      if (sp) sp.parentNode.removeChild(sp);
    }
  }

  function relatedTabsFor(el) {
    const list = [];
    if (el) list.push(el);
    const id = el && el.id ? el.id : '';
    if (id.endsWith('-sm')) {
      const other = document.getElementById(id.replace(/-sm$/, ''));
      if (other) list.push(other);
    }
    if (
      id === 'tab-printers' || id === 'tab-stock' ||
      id === 'tab-printers-sm' || id === 'tab-stock-sm'
    ) {
      const assets = document.getElementById('tab-assets');
      if (assets) list.push(assets);
    }
    if (
      id === 'tab-services' || id === 'tab-users' || id === 'tab-messaging' || id === 'tab-orders-discounts' ||
      id === 'tab-services-sm' || id === 'tab-users-sm' || id === 'tab-messaging-sm' || id === 'tab-orders-discounts-sm'
    ) {
      const configs = document.getElementById('tab-configs');
      if (configs) list.push(configs);
    }
    if (id === 'tab-orders-new' || id === 'tab-orders-new-sm') {
      const operations = document.getElementById('tab-operations');
      if (operations) list.push(operations);
    }
    if (id === 'tab-orders-pay' || id === 'tab-orders-pay-sm') {
      const payments = document.getElementById('tab-payments');
      if (payments) list.push(payments);
    }
    return list;
  }

  function setTabsLoadingFor(el, loading) {
    relatedTabsFor(el).forEach(t => setTabLoading(t, loading));
  }

  function clearAllTabLoading() {
    document.querySelectorAll('.nav-link.is-loading, .dropdown-item.is-loading').forEach(el => setTabLoading(el, false));
  }

  // fetch a URL and replace #main-content with its #main-content fragment
// fetch a URL and replace #main-content with its #main-content fragment
async function loadPage(url, push = true, sourceEl = null) {
  const start = Date.now();
  try {
    // Only allow same-origin fetches for safety
    if (!isSameOrigin(url)) {
      window.location.href = url;
      return;
    }

    // allow a paint so the spinner becomes visible
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // Force fresh fetch and small cache-busting param
    const u = new URL(url, window.location.href);
    u.searchParams.set('_', Date.now());

    const res = await fetch(u.href, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      cache: 'no-store',
      credentials: 'same-origin'
    });

    if (!res.ok) {
      window.location.href = url;
      return;
    }

    const html = await res.text();

    // debug: show we received a response
    console.debug('[dashboard_nav] fetched', url, 'len', html.length);

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let newMain = doc.querySelector('#main-content');

    if (!newMain) {
      // try a second parse (defensive). If still not found -> full navigation
      const fallbackDoc = parser.parseFromString(html, 'text/html');
      const fallbackMain = fallbackDoc.querySelector('#main-content');
      if (!fallbackMain) {
        window.location.href = url;
        return;
      }
      // <-- FIX: assign fallback to newMain so we can use it below
      newMain = fallbackMain;
    }

    const main = document.getElementById('main-content');
    if (!main) {
      window.location.href = url;
      return;
    }

    // Replace content
    main.innerHTML = newMain.innerHTML;

    // Re-run scripts found inside the returned fragment
    reExecuteScripts(newMain, main);

    // update active tab
    setActiveTabByUrl(url);

    if (push) history.pushState({ url }, '', url);

    // re-run page initializers
    initializePage();

    // notify listeners
    document.dispatchEvent(new CustomEvent('ajax:page:loaded', { detail: { url } }));

    // scroll
    window.scrollTo({ top: main.getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' });
  } catch (err) {
    console.error('Page load failed', err);
    window.location.href = url;
  } finally {
    const elapsed = Date.now() - start;
    const wait = elapsed < 300 ? 300 - elapsed : 0;
    if (wait) {
      setTimeout(function () {
        if (sourceEl) setTabsLoadingFor(sourceEl, false);
        clearAllTabLoading();
      }, wait);
    } else {
      if (sourceEl) setTabsLoadingFor(sourceEl, false);
      clearAllTabLoading();
    }
  }
}

  // set active tab based on URL pathname
// set active tab based on URL pathname
function setActiveTabByUrl(url) {
  try {
    const target = new URL(url, window.location.origin);
    const path = target.pathname.replace(/\/$/, '');

    // mapping for exact paths (keeps existing admin/* map)
    const mapping = {
      '/admin/services': 'tab-configs',
      '/admin/printers': 'tab-assets',
      '/admin/stock': 'tab-assets',
      '/admin/users': 'tab-configs',
      '/admin/messaging': 'tab-configs',
      '/admin/discounts': 'tab-configs',
      '/admin/reports': 'tab-reports',
      '/admin/orders': 'tab-operations', // legacy admin path
      '/orders': 'tab-operations',       // orders root
      '/orders/new': 'tab-operations',
      '/orders/pay': 'tab-payments'
    };

    // default to services if root /admin
    let id = mapping[path] || (path === '/admin' ? 'tab-configs' : null);

    if (!id && path.startsWith('/admin')) {
      // try to match partial admin/* paths e.g. /admin/services/123
      if (path.startsWith('/admin/services')) id = 'tab-configs';
      else if (path.startsWith('/admin/printers')) id = 'tab-assets';
      else if (path.startsWith('/admin/stock')) id = 'tab-assets';
      else if (path.startsWith('/admin/users')) id = 'tab-configs';
      else if (path.startsWith('/admin/messaging')) id = 'tab-configs';
      else if (path.startsWith('/admin/discounts')) id = 'tab-configs';
      else if (path.startsWith('/admin/reports')) id = 'tab-reports';
      else if (path.startsWith('/admin/orders')) id = 'tab-operations';
    }

    if (!id) {
      // also accept root-level /orders and its subpaths (new URLs)
      if (path === '/orders' || path.startsWith('/orders')) {
        id = path.startsWith('/orders/pay') ? 'tab-payments' : 'tab-operations';
      }
    }

    // toggle active class (clear all first)
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
    if (main) {
      const wantsWide = !!main.querySelector('[data-main-width="wide"]');
      main.classList.toggle('wide-content', wantsWide);
    }
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
    setTabsLoadingFor(a, true);
    loadPage(href, true, a);
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
