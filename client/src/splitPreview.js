/**
 * Client-side preview of how an expense will be split, so users see shares and
 * mistakes while typing. The server recomputes and validates authoritatively;
 * this mirrors server/src/services/splits.js.
 */
function distribute(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (amount * w) / total);
  const floors = exact.map(Math.floor);
  let left = amount - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, f: x - Math.floor(x) })).filter(({ i }) => weights[i] > 0)
    .sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) floors[order[k].i] += 1;
  return floors;
}

const toMinor = (v) => Math.round(Number(v || 0) * 100);

/** @returns {{ shares: number[] | null, problem: string | null }} */
export function previewSplit(amountMinor, type, rows) {
  if (!amountMinor || amountMinor <= 0) return { shares: null, problem: null };
  if (!rows.length) return { shares: null, problem: 'Pick at least one person' };
  const nums = rows.map((r) => Number(r.value || 0));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return { shares: null, problem: 'Values must be zero or more' };

  if (type === 'equal') return { shares: distribute(amountMinor, rows.map(() => 1)), problem: null };
  if (type === 'exact') {
    const shares = rows.map((r) => toMinor(r.value));
    const diff = amountMinor - shares.reduce((a, b) => a + b, 0);
    return { shares, problem: diff === 0 ? null : `${(Math.abs(diff) / 100).toFixed(2)} ${diff > 0 ? 'left to assign' : 'over the total'}` };
  }
  if (type === 'percent') {
    const total = nums.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 0.001) return { shares: null, problem: `Percentages total ${Math.round(total * 100) / 100}%, need 100%` };
    return { shares: distribute(amountMinor, nums), problem: null };
  }
  if (nums.reduce((a, b) => a + b, 0) <= 0) return { shares: null, problem: 'Give at least one person a share' };
  return { shares: distribute(amountMinor, nums), problem: null };
}
