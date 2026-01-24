// public/javascripts/customer_account.js
document.addEventListener('DOMContentLoaded', () => {
  const customerId = window.__CUSTOMER_ID__;
  const balanceEl = document.getElementById('acctBalance');

  async function adjust(type, amount, note) {
    const res = await fetch(`/customers/${encodeURIComponent(customerId)}/account/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ type, amount, note })
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error || 'Request failed');
    return j;
  }

  document.getElementById('creditBtn')?.addEventListener('click', async () => {
    const amt = Number(document.getElementById('creditAmount').value || 0);
    const note = (document.getElementById('creditNote').value || '').trim();
    if (!amt || isNaN(amt) || amt <= 0) return alert('Enter a valid amount');
    try {
      const j = await adjust('credit', amt, note);
      if (balanceEl) balanceEl.textContent = Number(j.balance || 0).toFixed(2);
      location.reload(); // simplest: refresh table + balance
    } catch (e) { alert(e.message); }
  });

  document.getElementById('debitBtn')?.addEventListener('click', async () => {
    const amt = Number(document.getElementById('debitAmount').value || 0);
    const note = (document.getElementById('debitNote').value || '').trim();
    if (!amt || isNaN(amt) || amt <= 0) return alert('Enter a valid amount');
    try {
      const j = await adjust('debit', amt, note);
      if (balanceEl) balanceEl.textContent = Number(j.balance || 0).toFixed(2);
      location.reload();
    } catch (e) { alert(e.message); }
  });
});
