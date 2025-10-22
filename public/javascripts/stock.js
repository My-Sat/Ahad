// File: public/javascripts/stock.js
// client to support "Adjust" quick action and progressive enhancement
document.addEventListener('DOMContentLoaded', function () {
  const table = document.querySelector('table');
  if (!table) return;

  table.addEventListener('click', async function (e) {
    const btn = e.target.closest('.adjust-stock-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    const current = btn.closest('tr').querySelector('td:nth-child(2)').textContent.trim();
    let newVal = prompt('Set new stocked quantity (integer). Leave blank to cancel.', current);
    if (newVal === null) return;
    newVal = newVal.trim();
    if (newVal === '') return;
    const n = parseInt(newVal, 10);
    if (isNaN(n)) { alert('Invalid number'); return; }

    try {
      const res = await fetch(`/admin/materials/${encodeURIComponent(id)}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ stock: n })
      });
      if (!res.ok) {
        const j = await res.json().catch(()=>null);
        alert(j && j.error ? j.error : 'Failed to update stock');
        return;
      }
      // reload page to show updated values
      window.location.reload();
    } catch (err) {
      console.error('adjust stock err', err);
      alert('Failed to update stock');
    }
  });
});
