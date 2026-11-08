/** Number and currency formatting shared by the pill and the panel. */

export function money(amount, symbol) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${symbol}—`;
  return `${symbol}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function countText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
}

export function currencySymbol(currency) {
  return currency === 'USD' ? '$' : '¥';
}
