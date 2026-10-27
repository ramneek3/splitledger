const formatters = new Map();

/** Formats integer minor units (paise/cents) as currency, e.g. 123450 -> ₹1,234.50 */
export function money(minor, currency = 'INR') {
  if (!formatters.has(currency)) {
    formatters.set(currency, new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency }));
  }
  return formatters.get(currency).format((minor || 0) / 100);
}

/** Minor units -> plain decimal string for inputs ("1234.50"). */
export const toInput = (minor) => (minor == null ? '' : (minor / 100).toFixed(2).replace(/\.00$/, ''));

export function dateLabel(iso) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return dateLabel(iso);
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const CATEGORIES = {
  food: '🍽️ Food', groceries: '🛒 Groceries', rent: '🏠 Rent', utilities: '💡 Utilities', travel: '✈️ Travel',
  transport: '🚕 Transport', entertainment: '🎬 Entertainment', shopping: '🛍️ Shopping', health: '💊 Health', other: '📦 Other',
};

export const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
