/**
 * Pure ledger math: turns expenses + settlements into per-member net balances,
 * then into the smallest practical set of "who pays whom" transfers.
 *
 * Sign convention: net > 0 means the group owes this member money,
 *                  net < 0 means this member owes the group.
 */

/**
 * @param {string[]} memberIds
 * @param {{paidBy: string, amount: number, splits: {userId: string, share: number}[]}[]} expenses
 * @param {{fromUser: string, toUser: string, amount: number}[]} settlements
 * @returns {Map<string, {paid: number, owed: number, sent: number, received: number, net: number}>}
 */
export function computeBalances(memberIds, expenses, settlements) {
  const b = new Map();
  const get = (id) => {
    if (!b.has(id)) b.set(id, { paid: 0, owed: 0, sent: 0, received: 0, net: 0 });
    return b.get(id);
  };
  memberIds.forEach(get);

  for (const e of expenses) {
    get(e.paidBy).paid += e.amount;
    for (const s of e.splits) get(s.userId).owed += s.share;
  }
  for (const s of settlements) {
    get(s.fromUser).sent += s.amount; // paying back reduces what you owe
    get(s.toUser).received += s.amount;
  }
  for (const v of b.values()) v.net = v.paid - v.owed + v.sent - v.received;
  return b;
}

/**
 * Greedy debt simplification: repeatedly match the largest creditor with the
 * largest debtor. Produces at most (n - 1) transfers and never routes money
 * through someone who is already settled.
 *
 * @param {Map<string, {net: number}>|Record<string, number>} nets
 * @returns {{from: string, to: string, amount: number}[]}
 */
export function simplifyDebts(nets) {
  const entries = nets instanceof Map ? [...nets].map(([id, v]) => [id, v.net]) : Object.entries(nets);
  const creditors = entries.filter(([, n]) => n > 0).map(([id, n]) => ({ id, n }));
  const debtors = entries.filter(([, n]) => n < 0).map(([id, n]) => ({ id, n: -n }));
  const byAmount = (a, b) => b.n - a.n || (a.id < b.id ? -1 : 1);

  const transfers = [];
  while (creditors.length && debtors.length) {
    creditors.sort(byAmount);
    debtors.sort(byAmount);
    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.n, d.n);
    transfers.push({ from: d.id, to: c.id, amount });
    c.n -= amount;
    d.n -= amount;
    if (c.n === 0) creditors.shift();
    if (d.n === 0) debtors.shift();
  }
  return transfers;
}
