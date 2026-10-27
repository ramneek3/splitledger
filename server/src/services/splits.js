import { badRequest } from '../lib/errors.js';

/**
 * Pure split calculator. All amounts are integer minor units (paise).
 *
 * Guarantees for every split type:
 *   - every share is a non-negative integer
 *   - shares always sum exactly to `amount` (no paisa is created or lost)
 *   - rounding leftovers are distributed deterministically (largest remainder,
 *     ties broken by participant order) so recomputing gives the same answer.
 *
 * @param {number} amount   total in minor units, > 0
 * @param {'equal'|'exact'|'percent'|'shares'} type
 * @param {{userId: string, value?: number}[]} participants
 *        value meaning: exact -> minor units, percent -> 0..100, shares -> weight
 * @returns {{userId: string, share: number, input: number|null}[]}
 */
export function computeSplits(amount, type, participants) {
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Amount must be greater than zero');
  if (!participants?.length) throw badRequest('Choose at least one person to split with');
  const ids = participants.map((p) => p.userId);
  if (new Set(ids).size !== ids.length) throw badRequest('A person appears twice in the split');

  switch (type) {
    case 'equal':
      return distribute(amount, participants.map(() => 1)).map((share, i) => ({
        userId: ids[i], share, input: null,
      }));

    case 'exact': {
      const values = participants.map((p) => p.value);
      if (values.some((v) => !Number.isInteger(v) || v < 0)) throw badRequest('Each exact amount must be zero or more');
      const sum = values.reduce((a, b) => a + b, 0);
      if (sum !== amount) {
        throw badRequest(`Exact amounts add up to ${fmt(sum)} but the expense is ${fmt(amount)}`, {
          difference: amount - sum,
        });
      }
      return participants.map((p) => ({ userId: p.userId, share: p.value, input: p.value }));
    }

    case 'percent': {
      const values = participants.map((p) => Number(p.value));
      if (values.some((v) => !Number.isFinite(v) || v < 0)) throw badRequest('Percentages must be zero or more');
      const total = values.reduce((a, b) => a + b, 0);
      // Allow tiny float noise like 33.33 + 33.33 + 33.34
      if (Math.abs(total - 100) > 0.001) throw badRequest(`Percentages add up to ${round2(total)}%, they must total 100%`);
      return distribute(amount, values).map((share, i) => ({ userId: ids[i], share, input: values[i] }));
    }

    case 'shares': {
      const values = participants.map((p) => Number(p.value));
      if (values.some((v) => !Number.isFinite(v) || v < 0)) throw badRequest('Shares must be zero or more');
      if (values.reduce((a, b) => a + b, 0) <= 0) throw badRequest('At least one person needs a share above zero');
      return distribute(amount, values).map((share, i) => ({ userId: ids[i], share, input: values[i] }));
    }

    default:
      throw badRequest(`Unknown split type "${type}"`);
  }
}

/**
 * Splits `amount` proportionally to `weights` using the largest remainder method.
 * Exported for tests.
 */
export function distribute(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (amount * w) / total);
  const floors = exact.map(Math.floor);
  let leftover = amount - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .filter(({ i }) => weights[i] > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; leftover > 0; k = (k + 1) % order.length, leftover--) floors[order[k].i] += 1;
  return floors;
}

const fmt = (minor) => (minor / 100).toFixed(2);
const round2 = (x) => Math.round(x * 100) / 100;
