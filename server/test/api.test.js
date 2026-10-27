import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { app, closeDb, request, resetDb, signUp } from './helpers.js';

before(resetDb);
after(closeDb);

/** Creates a group owned by `owner` and joins the other agents via invite code. */
async function makeGroup(owner, others = [], name = 'Flat 4B') {
  const g = await owner.post('/api/groups').send({ name }).expect(201);
  const detail = await owner.get(`/api/groups/${g.body.group.id}`).expect(200);
  for (const a of others) await a.post('/api/groups/join').send({ code: detail.body.group.inviteCode }).expect(201);
  return g.body.group.id;
}

const balanceOf = (detail, userId) => detail.body.balances.find((b) => b.userId === userId).net;

describe('auth', () => {
  test('register, me, logout, login', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/auth/register').send({ name: 'Asha', email: 'Asha@Example.com', password: 'password123' }).expect(201);
    assert.equal(reg.body.user.email, 'asha@example.com');
    assert.equal(reg.body.user.password_hash, undefined);
    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
    await agent.post('/api/auth/login').send({ email: 'asha@example.com', password: 'wrongpass1' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'ASHA@example.com', password: 'password123' }).expect(200);
  });

  test('rejects duplicate email and weak input', async () => {
    await request(app).post('/api/auth/register').send({ name: 'Dup', email: 'dup@test.dev', password: 'password123' }).expect(201);
    const dup = await request(app).post('/api/auth/register').send({ name: 'Dup', email: 'DUP@test.dev', password: 'password123' }).expect(409);
    assert.equal(dup.body.error.code, 'EMAIL_TAKEN');
    const weak = await request(app).post('/api/auth/register').send({ name: 'W', email: 'nope', password: '1' }).expect(400);
    assert.ok(weak.body.error.details.fields.email);
  });

  test('protected routes require a session', async () => {
    await request(app).get('/api/groups').expect(401);
  });
});

describe('groups and authorization', () => {
  test('non-members cannot see a group (404, not 403, to avoid leaking ids)', async () => {
    const a = await signUp('Owner');
    const outsider = await signUp('Outsider');
    const id = await makeGroup(a);
    await outsider.get(`/api/groups/${id}`).expect(404);
    await outsider.get(`/api/groups/${id}/expenses`).expect(404);
    await outsider.get('/api/groups/not-a-uuid').expect(404);
  });

  test('joining twice is rejected', async () => {
    const a = await signUp('Anu');
    const b = await signUp('Bala');
    const id = await makeGroup(a, [b]);
    const detail = await a.get(`/api/groups/${id}`);
    const again = await b.post('/api/groups/join').send({ code: detail.body.group.inviteCode }).expect(409);
    assert.equal(again.body.error.code, 'ALREADY_MEMBER');
    await b.post('/api/groups/join').send({ code: 'ZZZZZZZZ' }).expect(404);
  });
});

describe('expense → balance → settle workflow', () => {
  test('full lifecycle with validation, idempotency and concurrency control', async () => {
    const asha = await signUp('Asha');
    const ben = await signUp('Ben');
    const chen = await signUp('Chen');
    const gid = await makeGroup(asha, [ben, chen]);
    const [A, B, C] = [asha.user.id, ben.user.id, chen.user.id];

    // Equal split of 100.00 between three people -> 33.34 / 33.33 / 33.33
    const key = crypto.randomUUID();
    const body = { description: 'Groceries', amount: '100', paidBy: A, splitType: 'equal', category: 'groceries',
      participants: [{ userId: A }, { userId: B }, { userId: C }], idempotencyKey: key };
    const created = await asha.post(`/api/groups/${gid}/expenses`).send(body).expect(201);
    assert.equal(created.body.expense.splits.reduce((s, x) => s + x.share, 0), 10000);

    // Double submit with the same key returns the same expense, does not double count
    const dup = await asha.post(`/api/groups/${gid}/expenses`).send(body).expect(200);
    assert.equal(dup.body.expense.id, created.body.expense.id);
    assert.equal(dup.body.expense.duplicate, true);

    // Exact split that doesn't add up is rejected with a helpful message
    const bad = await ben.post(`/api/groups/${gid}/expenses`).send({
      description: 'Cab', amount: 300, paidBy: B, splitType: 'exact',
      participants: [{ userId: A, value: '100' }, { userId: B, value: '100' }],
    }).expect(400);
    assert.match(bad.body.error.message, /add up to 200.00 but the expense is 300.00/);

    // Payer must be a member
    const outsider = await signUp('Zed');
    await asha.post(`/api/groups/${gid}/expenses`).send({ ...body, idempotencyKey: undefined, paidBy: outsider.user.id }).expect(400);

    let detail = await asha.get(`/api/groups/${gid}`).expect(200);
    assert.equal(balanceOf(detail, A), 6666);
    assert.equal(balanceOf(detail, B), -3333);
    assert.equal(balanceOf(detail, C), -3333);
    assert.equal(detail.body.transfers.length, 2);

    // Only creator or owner may edit; Ben is neither
    const eid = created.body.expense.id;
    await ben.put(`/api/groups/${gid}/expenses/${eid}`).send({ ...body, version: 1 }).expect(403);

    // Optimistic concurrency: first edit wins, stale version is rejected
    await asha.put(`/api/groups/${gid}/expenses/${eid}`).send({ ...body, amount: '90', version: 1 }).expect(200);
    const stale = await asha.put(`/api/groups/${gid}/expenses/${eid}`).send({ ...body, amount: '80', version: 1 }).expect(409);
    assert.equal(stale.body.error.code, 'VERSION_CONFLICT');

    // Settlement larger than the debt is refused
    detail = await asha.get(`/api/groups/${gid}`);
    assert.equal(balanceOf(detail, B), -3000);
    const over = await ben.post(`/api/groups/${gid}/settlements`).send({ fromUser: B, toUser: A, amount: '31' }).expect(409);
    assert.equal(over.body.error.code, 'SETTLEMENT_EXCEEDS_DEBT');
    assert.equal(over.body.error.details.max, 3000);

    // Someone not involved (Chen) cannot record a payment between Ben and Asha
    await chen.post(`/api/groups/${gid}/settlements`).send({ fromUser: B, toUser: A, amount: '10' }).expect(403);

    // Valid settlement updates balances
    await ben.post(`/api/groups/${gid}/settlements`).send({ fromUser: B, toUser: A, amount: '30', idempotencyKey: crypto.randomUUID() }).expect(201);
    detail = await asha.get(`/api/groups/${gid}`);
    assert.equal(balanceOf(detail, B), 0);

    // Ben is settled and can leave; Chen still owes and cannot
    const chenLeave = await chen.post(`/api/groups/${gid}/leave`).expect(409);
    assert.equal(chenLeave.body.error.code, 'UNSETTLED_BALANCE');
    await ben.post(`/api/groups/${gid}/leave`).expect(204);

    // Owner cannot archive while debts remain
    await asha.post(`/api/groups/${gid}/archive`).send({ archived: true }).expect(409);
    await chen.post(`/api/groups/${gid}/settlements`).send({ fromUser: C, toUser: A, amount: '30' }).expect(201);
    await asha.post(`/api/groups/${gid}/archive`).send({ archived: true }).expect(204);

    // Archived groups are read-only
    const ro = await asha.post(`/api/groups/${gid}/expenses`).send({ ...body, idempotencyKey: undefined, participants: [{ userId: A }, { userId: C }] }).expect(409);
    assert.equal(ro.body.error.code, 'GROUP_ARCHIVED');

    // Activity log recorded every step
    const act = await asha.get(`/api/groups/${gid}/activity`).expect(200);
    const types = act.body.items.map((i) => i.type);
    for (const t of ['expense.created', 'expense.updated', 'settlement.created', 'member.left', 'group.archived']) assert.ok(types.includes(t), t);
  });

  test('concurrent settlements cannot both pass validation', async () => {
    const a = await signUp('Pay');
    const b = await signUp('Owe');
    const gid = await makeGroup(a, [b]);
    await a.post(`/api/groups/${gid}/expenses`).send({
      description: 'Rent', amount: '200', paidBy: a.user.id, splitType: 'equal', category: 'rent',
      participants: [{ userId: a.user.id }, { userId: b.user.id }],
    }).expect(201);
    // b owes 100. Fire two 100 settlements at once: the group row lock means only one succeeds.
    const send = () => b.post(`/api/groups/${gid}/settlements`).send({ fromUser: b.user.id, toUser: a.user.id, amount: '100' });
    const results = await Promise.all([send(), send()]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });
});

describe('search, insights, export, quick add', () => {
  test('filters, csv injection safety and rule-based drafts', async () => {
    const a = await signUp('Riya');
    const b = await signUp('Aman');
    const gid = await makeGroup(a, [b]);
    const P = [{ userId: a.user.id }, { userId: b.user.id }];
    await a.post(`/api/groups/${gid}/expenses`).send({ description: 'Pizza night', amount: '600', paidBy: a.user.id, splitType: 'equal', category: 'food', participants: P }).expect(201);
    await a.post(`/api/groups/${gid}/expenses`).send({ description: '=HYPERLINK("x")', amount: '50', paidBy: b.user.id, splitType: 'shares', category: 'other',
      participants: [{ userId: a.user.id, value: 2 }, { userId: b.user.id, value: 1 }] }).expect(201);

    const search = await a.get(`/api/groups/${gid}/expenses?q=pizza`).expect(200);
    assert.equal(search.body.total, 1);
    const byCat = await a.get(`/api/groups/${gid}/expenses?category=other`).expect(200);
    assert.equal(byCat.body.items[0].myShare, 3333); // 2:1 of 50.00 -> 33.33 / 16.67
    await a.get(`/api/groups/${gid}/expenses?limit=1000`).expect(400);

    const ins = await a.get(`/api/groups/${gid}/insights`).expect(200);
    assert.equal(ins.body.groupTotal, 65000);
    assert.equal(ins.body.byMonth.length, 6);

    const csv = await a.get(`/api/groups/${gid}/export.csv`).expect(200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.includes(`"'=HYPERLINK(""x"")"`), 'formula cell is neutralised');

    const draft = await a.post(`/api/groups/${gid}/expenses/draft`).send({ text: 'Aman paid 450 for uber' }).expect(200);
    assert.equal(draft.body.source, 'rules');
    assert.equal(draft.body.draft.amount, 45000);
    assert.equal(draft.body.draft.paidBy, b.user.id);
    assert.equal(draft.body.draft.category, 'transport');
    assert.equal(draft.body.draft.participants.reduce((s, p) => s + p.share, 0), 45000);
  });
});
