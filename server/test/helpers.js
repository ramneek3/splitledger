// Must be imported before anything that reads config: points the app at the test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://splitledger:splitledger@localhost:5433/splitledger_test';
process.env.ANTHROPIC_API_KEY = ''; // tests exercise the deterministic rule-based quick-add path
process.env.OPENROUTER_API_KEY = '';
process.env.AI_PROVIDER = '';

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app.js');
const { migrate } = await import('../src/db/migrate.js');
const { pool } = await import('../src/db/pool.js');

export const app = createApp();

export async function resetDb() {
  await migrate({ log: () => {} });
  await pool.query('TRUNCATE activity, settlements, expense_splits, expenses, group_members, groups, users RESTART IDENTITY CASCADE');
}

export async function closeDb() {
  await pool.end();
}

let n = 0;
/** Registers a user and returns a supertest agent that keeps their session cookie. */
export async function signUp(name) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ name, email: `${name.toLowerCase()}${++n}@test.dev`, password: 'password123' });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.body)}`);
  agent.user = res.body.user;
  return agent;
}

export { request };
