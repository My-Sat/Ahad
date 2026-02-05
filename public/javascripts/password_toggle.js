// public/javascripts/password_toggle.js
(function () {
  'use strict';

  function setToggleState(btn, input, isVisible) {
    if (!btn || !input) return;
    input.type = isVisible ? 'text' : 'password';
    btn.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
    btn.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
    btn.innerHTML = isVisible
      ? '<i class="bi bi-eye-slash"></i>'
      : '<i class="bi bi-eye"></i>';
  }

  function init() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-password-toggle]');
      if (!btn) return;
      const targetId = btn.getAttribute('data-password-target');
      if (!targetId) return;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isVisible = input.type === 'password';
      setToggleState(btn, input, isVisible);
    });

    // Normalize initial button labels if DOM was updated server-side.
    document.querySelectorAll('[data-password-toggle]').forEach(function (btn) {
      const targetId = btn.getAttribute('data-password-target');
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;
      setToggleState(btn, input, false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
