import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSplits, distribute } from '../src/services/splits.js';
import { computeBalances, simplifyDebts } from '../src/services/ledger.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const ppl = (...ids) => ids.map((userId) => ({ userId }));

test('equal split distributes leftover paise deterministically', () => {
  const r = computeSplits(10000, 'equal', ppl('a', 'b', 'c'));
  assert.deepEqual(r.map((x) => x.share), [3334, 3333, 3333]);
  assert.equal(sum(r.map((x) => x.share)), 10000);
});

test('exact split must match the total', () => {
  assert.throws(
    () => computeSplits(1000, 'exact', [{ userId: 'a', value: 600 }, { userId: 'b', value: 300 }]),
    /add up to 9.00 but the expense is 10.00/,
  );
  const ok = computeSplits(1000, 'exact', [{ userId: 'a', value: 700 }, { userId: 'b', value: 300 }]);
  assert.deepEqual(ok.map((x) => x.share), [700, 300]);
});

test('percent split must total 100 and never loses a paisa', () => {
  assert.throws(() => computeSplits(1000, 'percent', [{ userId: 'a', value: 50 }, { userId: 'b', value: 40 }]), /90%/);
  const r = computeSplits(999, 'percent', [
    { userId: 'a', value: 33.33 }, { userId: 'b', value: 33.33 }, { userId: 'c', value: 33.34 },
  ]);
  assert.equal(sum(r.map((x) => x.share)), 999);
});

test('shares split is proportional to weights', () => {
  const r = computeSplits(9000, 'shares', [{ userId: 'a', value: 2 }, { userId: 'b', value: 1 }]);
  assert.deepEqual(r.map((x) => x.share), [6000, 3000]);
  assert.throws(() => computeSplits(100, 'shares', [{ userId: 'a', value: 0 }]), /above zero/);
});

test('rejects duplicate participants, empty splits and bad amounts', () => {
  assert.throws(() => computeSplits(100, 'equal', ppl('a', 'a')), /twice/);
  assert.throws(() => computeSplits(100, 'equal', []), /at least one/);
  assert.throws(() => computeSplits(0, 'equal', ppl('a')), /greater than zero/);
  assert.throws(() => computeSplits(100, 'weird', ppl('a')), /Unknown split type/);
});

test('distribute property: always sums to amount for random inputs', () => {
  for (let i = 0; i < 500; i++) {
    const amount = 1 + Math.floor(Math.random() * 1_000_000);
    const weights = Array.from({ length: 1 + Math.floor(Math.random() * 8) }, () => Math.random() * 10 + 0.01);
    const parts = distribute(amount, weights);
    assert.equal(sum(parts), amount);
    assert.ok(parts.every((p) => Number.isInteger(p) && p >= 0));
  }
});

test('balances account for expenses and settlements', () => {
  const b = computeBalances(
    ['a', 'b', 'c'],
    [{ paidBy: 'a', amount: 3000, splits: [{ userId: 'a', share: 1000 }, { userId: 'b', share: 1000 }, { userId: 'c', share: 1000 }] }],
    [{ fromUser: 'b', toUser: 'a', amount: 1000 }],
  );
  assert.equal(b.get('a').net, 1000);
  assert.equal(b.get('b').net, 0);
  assert.equal(b.get('c').net, -1000);
  assert.equal(sum([...b.values()].map((v) => v.net)), 0);
});

test('simplifyDebts settles everyone in at most n-1 transfers', () => {
  const nets = { a: 5000, b: -2000, c: -2000, d: -1000 };
  const t = simplifyDebts(nets);
  assert.ok(t.length <= 3);
  const after = { ...nets };
  for (const { from, to, amount } of t) {
    after[from] += amount;
    after[to] -= amount;
  }
  assert.ok(Object.values(after).every((v) => v === 0));
});

test('simplifyDebts collapses a debt chain', () => {
  // a owes b 10, b owes c 10  ==> a pays c directly
  const t = simplifyDebts({ a: -1000, b: 0, c: 1000 });
  assert.deepEqual(t, [{ from: 'a', to: 'c', amount: 1000 }]);
});
