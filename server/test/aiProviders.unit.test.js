import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { activeProvider, parseModelJson } from '../src/services/aiProviders.js';
import { draftFromText } from '../src/services/quickAdd.js';

const members = [{ id: 'u1', name: 'Demo User' }, { id: 'u2', name: 'Riya Sharma' }, { id: 'u3', name: 'Aman Verma' }];
const me = members[0];
const realFetch = globalThis.fetch;
const saved = { ...config };

afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(config, saved);
});

function useOpenRouter() {
  Object.assign(config, { aiProvider: '', openrouterApiKey: 'test-key', anthropicApiKey: '', openrouterModel: 'vendor/model:free' });
}

/** Stubs fetch with one OpenRouter-style response and records the request. */
function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

const reply = (content) => ({ choices: [{ message: { content } }] });

test('provider selection: explicit, auto-detect, none', () => {
  Object.assign(config, { aiProvider: '', openrouterApiKey: '', anthropicApiKey: '' });
  assert.equal(activeProvider(), null);
  Object.assign(config, { anthropicApiKey: 'a' });
  assert.equal(activeProvider().name, 'anthropic');
  Object.assign(config, { openrouterApiKey: 'o' });
  assert.equal(activeProvider().name, 'openrouter'); // free provider preferred when both set
  Object.assign(config, { aiProvider: 'anthropic' });
  assert.equal(activeProvider().name, 'anthropic');
  Object.assign(config, { aiProvider: 'none' });
  assert.equal(activeProvider(), null);
  Object.assign(config, { aiProvider: 'openrouter', openrouterApiKey: '' });
  assert.equal(activeProvider(), null); // explicitly chosen but no key -> off, not a crash
});

test('openrouter: sends schema request and builds a validated draft', async () => {
  useOpenRouter();
  const calls = stubFetch(200, reply('```json\n' + JSON.stringify({
    description: 'Uber to airport', amount: 900, paid_by: 'Riya', participants: ['Riya', 'me'],
    split_type: 'equal', values: [], category: 'transport', date: null, notes: '',
  }) + '\n```'));

  const res = await draftFromText('riya paid 900 for uber to the airport with me', members, me);
  assert.equal(res.source, 'ai');
  assert.equal(res.provider, 'openrouter');
  assert.equal(res.model, 'vendor/model:free');
  assert.equal(res.draft.amount, 90000);
  assert.equal(res.draft.paidBy, 'u2');
  assert.deepEqual(res.draft.participants.map((p) => p.share), [45000, 45000]);

  const req = calls[0];
  assert.equal(req.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(req.init.headers.Authorization, 'Bearer test-key');
  assert.equal(req.body.model, 'vendor/model:free');
  assert.equal(req.body.response_format.type, 'json_schema');
  assert.match(req.body.messages[1].content, /<expense_note>/);
});

test('openrouter: rate limit falls back to rules with a clear reason', async () => {
  useOpenRouter();
  stubFetch(429, { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } });
  const res = await draftFromText('paid 600 for pizza', members, me);
  assert.equal(res.source, 'rules');
  assert.match(res.fallbackReason, /busy or its daily limit/);
  assert.equal(res.draft.amount, 60000);
});

test('openrouter: upstream error inside a 200 and non-JSON replies both fall back', async () => {
  useOpenRouter();
  stubFetch(200, { error: { code: 502, message: 'Provider returned error' } });
  assert.equal((await draftFromText('paid 100 for chai', members, me)).source, 'rules');

  stubFetch(200, reply('Sure! The expense is 100 rupees for chai.'));
  const res = await draftFromText('paid 100 for chai', members, me);
  assert.equal(res.source, 'rules');
  assert.equal(res.fallbackReason, 'AI response could not be used');
});

test('openrouter: network failure falls back', async () => {
  useOpenRouter();
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const res = await draftFromText('paid 250 for snacks', members, me);
  assert.equal(res.source, 'rules');
  assert.equal(res.fallbackReason, 'AI service unreachable');
});

test('parseModelJson repairs loosely typed output instead of crashing', () => {
  const raw = parseModelJson('{"description": 5, "amount": "450", "participants": "everyone", "values": null}');
  assert.equal(raw.description, 'Expense');
  assert.equal(raw.amount, 450);
  assert.deepEqual(raw.participants, []);
  assert.deepEqual(raw.values, []);
  assert.equal(raw.paid_by, 'me');
  assert.throws(() => parseModelJson('[1,2]'), (e) => e.reason === 'AI response could not be used');
});

test('parseModelJson extracts the object when a model wraps it in prose', () => {
  const raw = parseModelJson('Here is the expense:\n{"description":"Chai","amount":40,"paid_by":"me","participants":["everyone"],"split_type":"equal","values":[],"category":"food","date":null,"notes":""}\nHope that helps!');
  assert.equal(raw.amount, 40);
  assert.throws(() => parseModelJson('', 'finish_reason=length'), (e) => /finish_reason=length/.test(e.message));
});
