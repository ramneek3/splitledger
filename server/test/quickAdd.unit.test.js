import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWithRules, normalize, resolveName } from '../src/services/quickAdd.js';

const members = [
  { id: 'u1', name: 'Demo User' },
  { id: 'u2', name: 'Riya Sharma' },
  { id: 'u3', name: 'Aman Verma' },
  { id: 'u4', name: 'Aman Gupta' },
];
const me = members[0];
const today = '2026-10-27';

test('rules: someone else paid, shared with a named person', () => {
  const raw = extractWithRules('Riya paid 1500 for pizza with Kabir', members.slice(0, 3));
  assert.equal(raw.amount, 1500);
  assert.equal(raw.paid_by, 'Riya Sharma');
  assert.equal(raw.category, 'food');
});

test('rules: I paid with others includes me; "1.2k" style amounts', () => {
  const raw = extractWithRules('paid 1.2k for groceries with Riya', members.slice(0, 3));
  assert.equal(raw.amount, 1200);
  assert.deepEqual(raw.participants, ['me', 'Riya Sharma']);
  assert.equal(raw.category, 'groceries');
});

test('resolveName handles me, first names, prefixes and ambiguity', () => {
  assert.equal(resolveName('me', members, me).member.id, 'u1');
  assert.equal(resolveName('riya', members, me).member.id, 'u2');
  assert.equal(resolveName('Aman Verma', members, me).member.id, 'u3');
  assert.match(resolveName('Aman', members, me).error, /more than one/);
  assert.match(resolveName('Zoya', members, me).error, /not a member/);
});

test('normalize never trusts the extractor: bad names, sums and dates are corrected with warnings', () => {
  const draft = normalize({
    description: 'Dinner', amount: 900, paid_by: 'Ghost', participants: ['me', 'Riya', 'Zoya'],
    split_type: 'exact', values: [{ name: 'me', value: 100 }, { name: 'Riya', value: 100 }],
    category: 'not-a-category', date: '2099-01-01', notes: '',
  }, members, me, today);
  assert.equal(draft.paidBy, 'u1'); // unknown payer falls back to the author
  assert.deepEqual(draft.participants.map((p) => p.userId), ['u1', 'u2']);
  assert.equal(draft.splitType, 'equal'); // exact values didn't add up -> safe fallback
  assert.equal(draft.participants.reduce((s, p) => s + p.share, 0), 90000);
  assert.equal(draft.category, 'other');
  assert.equal(draft.expenseDate, today); // future date rejected
  assert.ok(draft.warnings.some((w) => /Ghost/.test(w)));
  assert.ok(draft.warnings.some((w) => /Zoya/.test(w)));
});

test('normalize flags a missing amount instead of inventing one', () => {
  const draft = normalize({ description: 'Snacks', amount: null, paid_by: 'me', participants: ['everyone'],
    split_type: 'equal', values: [], category: 'food', date: null, notes: '' }, members, me, today);
  assert.equal(draft.amount, null);
  assert.ok(draft.warnings.some((w) => /No amount/.test(w)));
  assert.equal(draft.participants.length, 4);
});
