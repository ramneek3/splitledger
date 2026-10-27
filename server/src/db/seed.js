/**
 * Creates a demo account with a realistic flat-share group so evaluators can explore
 * without inviting friends. Safe to re-run: it skips if the demo user already exists.
 *
 *   npm run seed            (uses DATABASE_URL)
 *
 * Demo login: demo@splitledger.app / demo12345
 */
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool, query } from './pool.js';
import { migrate } from './migrate.js';
import { createGroup, joinByCode } from '../services/groups.js';
import { createExpense } from '../services/expenses.js';
import { createSettlement } from '../services/settlements.js';

const PASSWORD = 'demo12345';
const PEOPLE = [
  ['Demo User', 'demo@splitledger.app'],
  ['Riya Sharma', 'riya@splitledger.app'],
  ['Aman Verma', 'aman@splitledger.app'],
  ['Kabir Mehta', 'kabir@splitledger.app'],
];

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export async function seed() {
  await migrate({ log: () => {} });
  const existing = await query(`SELECT 1 FROM users WHERE email = $1`, [PEOPLE[0][1]]);
  if (existing.rows[0]) return console.log('Demo data already present, skipping');

  const hash = await bcrypt.hash(PASSWORD, 10);
  const users = [];
  for (const [name, email] of PEOPLE) {
    const { rows } = await query(`INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name`, [name, email, hash]);
    users.push(rows[0]);
  }
  const [me, riya, aman, kabir] = users.map((u) => u.id);

  const flat = await createGroup(me, { name: 'Flat 302, Koramangala', currency: 'INR' });
  for (const id of [riya, aman, kabir]) await joinByCode(id, flat.invite_code);
  const all = [me, riya, aman, kabir].map((userId) => ({ userId }));

  const add = (by, description, rupees, category, ago, splitType = 'equal', participants = all) =>
    createExpense(by, flat.id, { description, amount: rupees * 100, paidBy: by, category, splitType, participants, expenseDate: daysAgo(ago) });

  await add(me, 'October rent', 64000, 'rent', 26);
  await add(riya, 'Electricity bill', 2840, 'utilities', 20);
  await add(aman, 'Wi-Fi (3 months)', 2397, 'utilities', 18);
  await add(kabir, 'Blinkit groceries', 1865, 'groceries', 12);
  await add(me, 'Dinner at Toit', 4200, 'food', 9, 'shares', [
    { userId: me, value: 1 }, { userId: riya, value: 1 }, { userId: aman, value: 2 }]);
  await add(riya, 'Cab to airport', 980, 'transport', 6, 'exact', [
    { userId: riya, value: 49000 }, { userId: kabir, value: 49000 }]);
  await add(aman, 'Movie night snacks', 640, 'entertainment', 3);
  await add(me, 'Cleaning supplies', 760, 'groceries', 1, 'percent', [
    { userId: me, value: 40 }, { userId: riya, value: 20 }, { userId: aman, value: 20 }, { userId: kabir, value: 20 }]);
  // Older months so the insights chart has history
  await add(me, 'September rent', 64000, 'rent', 56);
  await add(kabir, 'Weekend trip fuel', 3200, 'travel', 70);
  await add(riya, 'August rent', 64000, 'rent', 88);

  await createSettlement(kabir, flat.id, { fromUser: kabir, toUser: me, amount: 1000000, note: 'UPI' });

  const trip = await createGroup(riya, { name: 'Goa trip 🌴', currency: 'INR' });
  await joinByCode(me, trip.invite_code);
  await joinByCode(aman, trip.invite_code);
  const tripAll = [me, riya, aman].map((userId) => ({ userId }));
  await createExpense(riya, trip.id, { description: 'Villa booking', amount: 1800000, paidBy: riya, category: 'travel', splitType: 'equal', participants: tripAll, expenseDate: daysAgo(15) });
  await createExpense(me, trip.id, { description: 'Scooter rentals', amount: 270000, paidBy: me, category: 'transport', splitType: 'equal', participants: tripAll, expenseDate: daysAgo(14) });

  console.log(`Seeded demo data. Log in as ${PEOPLE[0][1]} / ${PASSWORD}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().then(() => pool.end()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
