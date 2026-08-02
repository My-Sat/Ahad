const MONOCHROME_PATTERN = /(b\s*(?:\/|&)\s*w|black\s*(?:and|&)\s*white|monochrome|\bmono\b|\bbw\b)/i;
const COLOUR_PATTERN = /(colour|color|c\/l|\bcol\b)/i;

function detectPrinterUsageType(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  // A rule-level B/W marker must override a colour service fallback.
  if (MONOCHROME_PATTERN.test(value)) return 'monochrome';
  if (COLOUR_PATTERN.test(value)) return 'colour';
  return null;
}

function selectionText(selections) {
  return (Array.isArray(selections) ? selections : []).map(selection => {
    const unit = selection && selection.unit;
    const subUnit = selection && selection.subUnit;
    const unitName = unit && typeof unit === 'object' ? unit.name : '';
    const subUnitName = subUnit && typeof subUnit === 'object' ? subUnit.name : '';
    return `${unitName || ''} ${subUnitName || ''}`.trim();
  }).filter(Boolean).join(' ');
}

function resolvePrinterUsageType({ ruleText, selections, serviceName, fallbackType } = {}) {
  const ruleType = detectPrinterUsageType(`${ruleText || ''} ${selectionText(selections)}`);
  if (ruleType) return ruleType;

  const serviceType = detectPrinterUsageType(serviceName);
  if (serviceType) return serviceType;

  return fallbackType === 'monochrome' || fallbackType === 'colour' ? fallbackType : null;
}

module.exports = {
  detectPrinterUsageType,
  resolvePrinterUsageType
};
