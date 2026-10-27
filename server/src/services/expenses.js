import { query, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { computeSplits } from './splits.js';
import { assertWritable, getMembership } from './groups.js';
import { logActivity } from './activity.js';

export const CATEGORIES = ['food', 'groceries', 'rent', 'utilities', 'travel', 'transport', 'entertainment', 'shopping', 'health', 'other'];

async function activeMemberIds(client, groupId) {
  const { rows } = await client.query(`SELECT user_id FROM group_members WHERE group_id = $1 AND left_at IS NULL`, [groupId]);
  return new Set(rows.map((r) => r.user_id));
}

/** Validates people + computes the split rows. Shared by create and update. */
async function prepare(client, groupId, input) {
  const members = await activeMemberIds(client, groupId);
  if (!members.has(input.paidBy)) throw badRequest('The payer must be a current member of the group');
  const outsider = input.participants.find((p) => !members.has(p.userId));
  if (outsider) throw badRequest('Everyone in the split must be a current member of the group');
  const today = new Date();
  today.setUTCDate(today.getUTCDate() + 1); // allow timezone slack
  if (input.expenseDate && input.expenseDate > today.toISOString().slice(0, 10)) {
    throw badRequest('Expense date cannot be in the future');
  }
  return computeSplits(input.amount, input.splitType, input.participants);
}

async function insertSplits(client, expenseId, splits) {
  for (const s of splits) {
    await client.query(
      `INSERT INTO expense_splits (expense_id, user_id, share_minor, input_value) VALUES ($1, $2, $3, $4)`,
      [expenseId, s.userId, s.share, s.input],
    );
  }
}

/**
 * Creates an expense. `idempotencyKey` makes double-submits safe: a retry with the same
 * key returns the original expense with `duplicate: true` instead of creating a second one.
 */
export async function createExpense(userId, groupId, input) {
  return withTransaction(async (client) => {
    const group = await getMembership(groupId, userId, { client, lock: true });
    assertWritable(group);

    if (input.idempotencyKey) {
      const dup = await client.query(`SELECT id FROM expenses WHERE group_id = $1 AND idempotency_key = $2`, [groupId, input.idempotencyKey]);
      if (dup.rows[0]) return { ...(await getExpense(dup.rows[0].id, client)), duplicate: true };
    }

    const splits = await prepare(client, groupId, input);
    const { rows } = await client.query(
      `INSERT INTO expenses (group_id, description, amount_minor, paid_by, category, split_type, expense_date, created_by, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8, $9) RETURNING id`,
      [groupId, input.description, input.amount, input.paidBy, input.category, input.splitType, input.expenseDate || null, userId, input.idempotencyKey || null],
    );
    const id = rows[0].id;
    await insertSplits(client, id, splits);
    await logActivity(client, groupId, userId, 'expense.created', {
      expenseId: id, description: input.description, amount: input.amount, source: input.source || 'manual',
    });
    return { ...(await getExpense(id, client)), duplicate: false };
  });
}

/** Only the person who added an expense, or the group owner, may change it. */
function assertCanModify(group, expense, userId) {
  if (expense.created_by !== userId && group.role !== 'owner') {
    throw forbidden('Only the person who added this expense or the group owner can change it');
  }
}

/**
 * Updates an expense using optimistic concurrency: the client sends the `version` it
 * last saw. If someone else edited in between, we refuse with VERSION_CONFLICT rather
 * than silently overwriting their change.
 */
export async function updateExpense(userId, groupId, expenseId, input) {
  return withTransaction(async (client) => {
    const group = await getMembership(groupId, userId, { client, lock: true });
    assertWritable(group);
    const existing = await loadRow(client, groupId, expenseId);
    assertCanModify(group, existing, userId);
    if (existing.version !== input.version) {
      throw conflict('VERSION_CONFLICT', 'Someone else changed this expense while you were editing. Reload and try again.', {
        currentVersion: existing.version,
      });
    }
    const splits = await prepare(client, groupId, input);
    await client.query(
      `UPDATE expenses SET description = $2, amount_minor = $3, paid_by = $4, category = $5, split_type = $6,
              expense_date = COALESCE($7::date, expense_date), version = version + 1, updated_at = now()
        WHERE id = $1`,
      [expenseId, input.description, input.amount, input.paidBy, input.category, input.splitType, input.expenseDate || null],
    );
    await client.query(`DELETE FROM expense_splits WHERE expense_id = $1`, [expenseId]);
    await insertSplits(client, expenseId, splits);
    await logActivity(client, groupId, userId, 'expense.updated', {
      expenseId, description: input.description, amount: input.amount, previousAmount: existing.amount_minor,
    });
    return getExpense(expenseId, client);
  });
}

export async function deleteExpense(userId, groupId, expenseId) {
  return withTransaction(async (client) => {
    const group = await getMembership(groupId, userId, { client, lock: true });
    assertWritable(group);
    const existing = await loadRow(client, groupId, expenseId);
    assertCanModify(group, existing, userId);
    await client.query(`UPDATE expenses SET deleted_at = now() WHERE id = $1`, [expenseId]);
    await logActivity(client, groupId, userId, 'expense.deleted', {
      expenseId, description: existing.description, amount: existing.amount_minor,
    });
  });
}

async function loadRow(client, groupId, expenseId) {
  const { rows } = await client.query(
    `SELECT * FROM expenses WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL FOR UPDATE`, [expenseId, groupId]);
  if (!rows[0]) throw notFound('Expense');
  return rows[0];
}

export async function getExpense(id, db = { query }) {
  const { rows } = await db.query(
    `SELECT e.*, u.name AS paid_by_name,
            COALESCE(json_agg(json_build_object('userId', s.user_id, 'name', su.name, 'share', s.share_minor, 'input', s.input_value)
                     ORDER BY su.name) FILTER (WHERE s.user_id IS NOT NULL), '[]') AS splits
       FROM expenses e
       JOIN users u ON u.id = e.paid_by
       LEFT JOIN expense_splits s ON s.expense_id = e.id
       LEFT JOIN users su ON su.id = s.user_id
      WHERE e.id = $1 GROUP BY e.id, u.name`,
    [id],
  );
  if (!rows[0]) throw notFound('Expense');
  return serialize(rows[0]);
}

/**
 * Lists expenses with search, filters and pagination. Each row includes `myShare`
 * so the UI can show "you owe / you lent" without another request.
 */
export async function listExpenses(userId, groupId, f) {
  const where = ['e.group_id = $1', 'e.deleted_at IS NULL'];
  const params = [groupId, userId];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.q) add('e.description ILIKE ?', `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (f.category) add('e.category = ?', f.category);
  if (f.paidBy) add('e.paid_by = ?', f.paidBy);
  if (f.from) add('e.expense_date >= ?', f.from);
  if (f.to) add('e.expense_date <= ?', f.to);
  if (f.involvesMe) where.push('(e.paid_by = $2 OR EXISTS (SELECT 1 FROM expense_splits x WHERE x.expense_id = e.id AND x.user_id = $2))');

  const whereSql = where.join(' AND ');
  // $2 (the caller) is only referenced by some filters; the cast keeps its type known when it isn't.
  const total = await query(
    `SELECT count(*)::int AS n, COALESCE(sum(amount_minor), 0)::bigint AS sum FROM expenses e WHERE ${whereSql} AND $2::uuid IS NOT NULL`, params);
  params.push(f.limit, f.offset);
  const { rows } = await query(
    `SELECT e.id, e.description, e.amount_minor, e.paid_by, u.name AS paid_by_name, e.category, e.split_type,
            e.expense_date, e.created_by, e.version, e.created_at,
            COALESCE((SELECT share_minor FROM expense_splits s WHERE s.expense_id = e.id AND s.user_id = $2), 0) AS my_share,
            (SELECT count(*)::int FROM expense_splits s WHERE s.expense_id = e.id) AS participant_count
       FROM expenses e JOIN users u ON u.id = e.paid_by
      WHERE ${whereSql}
      ORDER BY e.expense_date DESC, e.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.map(serialize), total: total.rows[0].n, totalAmount: total.rows[0].sum };
}

function serialize(r) {
  return {
    id: r.id,
    groupId: r.group_id,
    description: r.description,
    amount: r.amount_minor,
    paidBy: r.paid_by,
    paidByName: r.paid_by_name,
    category: r.category,
    splitType: r.split_type,
    expenseDate: r.expense_date,
    createdBy: r.created_by,
    version: r.version,
    createdAt: r.created_at,
    ...(r.splits && { splits: r.splits.map((s) => ({ ...s, share: Number(s.share), input: s.input === null ? null : Number(s.input) })) }),
    ...(r.my_share !== undefined && { myShare: r.my_share, participantCount: r.participant_count }),
  };
}
