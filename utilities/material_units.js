function cleanUnitName(name, fallback = 'piece') {
  const value = String(name || '').trim();
  return value || fallback;
}

function toFactor(n, fallback = 1) {
  const value = Number(n);
  if (!isFinite(value) || value <= 0) return fallback;
  return Number(value.toFixed(6));
}

function normalizeStockUnits(inputUnits, baseUnitName) {
  const base = cleanUnitName(baseUnitName);
  const seen = new Set();
  const out = [{ name: base, factor: 1, isBase: true }];
  seen.add(base.toLowerCase());

  (Array.isArray(inputUnits) ? inputUnits : []).forEach(unit => {
    const name = cleanUnitName(unit && unit.name, '');
    const factor = toFactor(unit && unit.factor, 0);
    if (!name || factor <= 1) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, factor, isBase: false });
  });

  return out.sort((a, b) => Number(a.factor || 0) - Number(b.factor || 0));
}

function materialUnits(material) {
  const baseUnitName = cleanUnitName(material && material.baseUnitName);
  return normalizeStockUnits(material && material.stockUnits, baseUnitName);
}

function formatQtyNumber(n) {
  const value = Number(n || 0);
  if (!isFinite(value)) return '0';
  if (Math.abs(value - Math.round(value)) < 0.000001) return String(Math.round(value));
  return Number(value.toFixed(3)).toString();
}

function formatMaterialQuantity(quantity, material, opts = {}) {
  const qty = Math.max(0, Number(quantity || 0));
  const units = materialUnits(material);
  const base = units.find(u => Number(u.factor || 0) === 1) || units[0] || { name: 'piece', factor: 1 };

  if (opts.preferBase || units.length <= 1 || qty < 1) {
    return `${formatQtyNumber(qty)} ${base.name}`;
  }

  let remaining = qty;
  const parts = [];
  const sorted = units.slice().sort((a, b) => Number(b.factor || 0) - Number(a.factor || 0));

  sorted.forEach(unit => {
    const factor = Number(unit.factor || 0);
    if (factor <= 1) return;
    const count = Math.floor((remaining + 0.000001) / factor);
    if (count > 0) {
      parts.push(`${count} ${unit.name}`);
      remaining = Number((remaining - (count * factor)).toFixed(6));
    }
  });

  if (remaining > 0.000001 || !parts.length) {
    parts.push(`${formatQtyNumber(remaining)} ${base.name}`);
  }

  return parts.join(' + ');
}

function unitForPurchase(material, unitName, unitFactor) {
  const units = materialUnits(material);
  const requestedName = cleanUnitName(unitName, '').toLowerCase();
  const requestedFactor = toFactor(unitFactor, 0);

  let unit = null;
  if (requestedName) {
    unit = units.find(u => String(u.name || '').toLowerCase() === requestedName);
  }
  if (!unit && requestedFactor > 0) {
    unit = units.find(u => Math.abs(Number(u.factor || 0) - requestedFactor) < 0.000001);
  }
  return unit || units.find(u => Number(u.factor || 0) === 1) || { name: 'piece', factor: 1, isBase: true };
}

module.exports = {
  cleanUnitName,
  formatMaterialQuantity,
  materialUnits,
  normalizeStockUnits,
  unitForPurchase
};
