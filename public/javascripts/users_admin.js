// public/javascripts/users_admin.js
async function openPermissionsModal(userId) {
  // fetch user's current permissions
  const res = await fetch(`/admin/users/${userId}`, { headers: { 'Accept': 'application/json' }});
  if (!res.ok) {
    alert('Failed to load user info');
    return;
  }
  const user = await res.json();

  // set hidden user id
  document.getElementById('permUserId').value = user._id;

  // clear checkboxes
  document.querySelectorAll('#modalPermissions .form-check-input').forEach(cb => cb.checked = false);

  (user.permissions || []).forEach(p => {
    const cb = document.querySelector(`#modalPermissions .form-check-input[value="${p}"]`);
    if (cb) cb.checked = true;
  });

  // show modal
  const modalEl = document.getElementById('modalPermissions');
  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();
}

document.getElementById('savePermissionsBtn')?.addEventListener('click', async () => {
  const userId = document.getElementById('permUserId').value;
  const checked = Array.from(document.querySelectorAll('#modalPermissions .form-check-input:checked')).map(i => i.value);

  const res = await fetch(`/admin/users/${userId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ permissions: checked })
  });

  if (res.ok) {
    location.reload();
  } else {
    const err = await res.json().catch(()=>({ error: 'Failed' }));
    alert(err.error || 'Failed to save');
  }
});

function initNewUserPasswordMatch() {
  const form = document.getElementById('newUserForm');
  const pw = document.getElementById('newUserPassword');
  const confirm = document.getElementById('newUserPasswordConfirm');
  const msg = document.getElementById('newUserPasswordMatch');
  if (!form || !pw || !confirm || !msg) return;

  const submitBtn = form.querySelector('button[type="submit"]');

  function setState(state, text) {
    msg.textContent = text;
    msg.classList.remove('text-muted-light', 'text-success', 'text-danger');
    msg.classList.add(state);
  }

  function update() {
    const a = pw.value || '';
    const b = confirm.value || '';
    if (!a && !b) {
      setState('text-muted-light', 'Type the same password to confirm.');
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    if (!a || !b) {
      setState('text-muted-light', 'Keep typing to confirm the password.');
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    if (a === b) {
      setState('text-success', 'Passwords match.');
      if (submitBtn) submitBtn.disabled = false;
    } else {
      setState('text-danger', 'Passwords do not match.');
      if (submitBtn) submitBtn.disabled = true;
    }
  }

  pw.addEventListener('input', update);
  confirm.addEventListener('input', update);
  form.addEventListener('submit', function (e) {
    if (pw.value !== confirm.value) {
      e.preventDefault();
      setState('text-danger', 'Passwords do not match.');
      confirm.focus();
    }
  });
  update();
}

document.addEventListener('DOMContentLoaded', initNewUserPasswordMatch);

function initUserDeleteConfirm() {
  const modalEl = document.getElementById('modalDeleteUser');
  const messageEl = document.getElementById('deleteUserMessage');
  const confirmBtn = document.getElementById('confirmDeleteUserBtn');
  const form = document.getElementById('deleteUserForm');
  if (!modalEl || !messageEl || !confirmBtn || !form) return;

  let pendingAction = '';
  document.querySelectorAll('.open-user-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingAction = btn.getAttribute('data-action') || '';
      const name = btn.getAttribute('data-user-name') || 'this user';
      messageEl.textContent = `Are you sure you want to delete ${name}?`;
      const m = new bootstrap.Modal(modalEl);
      m.show();
    });
  });

  confirmBtn.addEventListener('click', () => {
    if (!pendingAction) return;
    form.setAttribute('action', pendingAction);
    form.submit();
  });
}

document.addEventListener('DOMContentLoaded', initUserDeleteConfirm);
