import crypto from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { computeBalances, simplifyDebts } from './ledger.js';
import { logActivity } from './activity.js';

// Unambiguous alphabet: no 0/O or 1/I/L so codes can be read out loud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generateInviteCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * Loads the group and the caller's active membership. Throws 404 for both
 * "no such group" and "not a member" so group ids cannot be probed.
 * Pass { lock: true } inside a transaction to serialize balance-changing writes.
 */
export async function getMembership(groupId, userId, { client, lock = false } = {}) {
  const db = client || { query };
  const { rows } = await db.query(
    `SELECT g.*, gm.role FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2 AND gm.left_at IS NULL
      WHERE g.id = $1 ${lock ? 'FOR UPDATE OF g' : ''}`,
    [groupId, userId],
  );
  if (!rows[0]) throw notFound('Group');
  return rows[0];
}

export function assertWritable(group) {
  if (group.archived_at) throw conflict('GROUP_ARCHIVED', 'This group is archived and read-only');
}

export function assertOwner(group) {
  if (group.role !== 'owner') throw forbidden('Only the group owner can do that');
}

export async function createGroup(userId, { name, currency }) {
  return withTransaction(async (client) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await client.query('SAVEPOINT invite');
        const { rows } = await client.query(
          `INSERT INTO groups (name, currency, invite_code, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
          [name, currency, generateInviteCode(), userId],
        );
        const group = rows[0];
        await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`, [group.id, userId]);
        await logActivity(client, group.id, userId, 'group.created', { name });
        return group;
      } catch (err) {
        // Invite code collision: retry with a new code.
        if (err.code === '23505' && err.constraint === 'groups_invite_code_key') {
          await client.query('ROLLBACK TO SAVEPOINT invite');
          continue;
        }
        throw err;
      }
    }
    throw new AppError(500, 'INVITE_CODE_EXHAUSTED', 'Could not generate an invite code, please retry');
  });
}

/** Groups the user belongs to, each with the user's own net balance. */
export async function listGroups(userId) {
  const { rows } = await query(
    `SELECT g.id, g.name, g.currency, g.archived_at, g.created_at, gm.role,
            (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id AND m.left_at IS NULL) AS member_count,
            ( COALESCE((SELECT sum(e.amount_minor) FROM expenses e
                         WHERE e.group_id = g.id AND e.deleted_at IS NULL AND e.paid_by = $1), 0)
            - COALESCE((SELECT sum(s.share_minor) FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
                         WHERE e.group_id = g.id AND e.deleted_at IS NULL AND s.user_id = $1), 0)
            + COALESCE((SELECT sum(st.amount_minor) FROM settlements st
                         WHERE st.group_id = g.id AND st.deleted_at IS NULL AND st.from_user = $1), 0)
            - COALESCE((SELECT sum(st.amount_minor) FROM settlements st
                         WHERE st.group_id = g.id AND st.deleted_at IS NULL AND st.to_user = $1), 0)
            )::bigint AS my_net
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1 AND gm.left_at IS NULL
      ORDER BY g.archived_at NULLS FIRST, g.created_at DESC`,
    [userId],
  );
  return rows;
}

/** All members ever in the group (history references people who left). */
export async function listMembers(groupId, db = { query }) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, gm.role, gm.joined_at, gm.left_at
       FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1 ORDER BY gm.joined_at`,
    [groupId],
  );
  return rows;
}

/** Reads the full ledger and returns balances plus the simplified settle-up plan. */
export async function computeGroupLedger(groupId, db = { query }) {
  // Sequential on purpose: `db` may be a single transaction client, which runs one query at a time.
  const members = await listMembers(groupId, db);
  const expenses = await db.query(`SELECT id, paid_by, amount_minor FROM expenses WHERE group_id = $1 AND deleted_at IS NULL`, [groupId]);
  const splits = await db.query(
    `SELECT s.expense_id, s.user_id, s.share_minor FROM expense_splits s
       JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = $1 AND e.deleted_at IS NULL`,
    [groupId],
  );
  const settlements = await db.query(
    `SELECT from_user, to_user, amount_minor FROM settlements WHERE group_id = $1 AND deleted_at IS NULL`, [groupId]);
  const splitsByExpense = new Map();
  for (const s of splits.rows) {
    if (!splitsByExpense.has(s.expense_id)) splitsByExpense.set(s.expense_id, []);
    splitsByExpense.get(s.expense_id).push({ userId: s.user_id, share: s.share_minor });
  }
  const balances = computeBalances(
    members.map((m) => m.id),
    expenses.rows.map((e) => ({ paidBy: e.paid_by, amount: e.amount_minor, splits: splitsByExpense.get(e.id) || [] })),
    settlements.rows.map((s) => ({ fromUser: s.from_user, toUser: s.to_user, amount: s.amount_minor })),
  );
  return {
    members,
    balances: members.map((m) => ({ userId: m.id, name: m.name, active: !m.left_at, ...balances.get(m.id) })),
    transfers: simplifyDebts(balances),
    netOf: (id) => balances.get(id)?.net ?? 0,
  };
}

export async function joinByCode(userId, code) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT * FROM groups WHERE invite_code = $1 FOR UPDATE`, [code.toUpperCase()]);
    const group = rows[0];
    if (!group) throw notFound('Invite code');
    assertWritable(group);
    const existing = await client.query(`SELECT left_at FROM group_members WHERE group_id = $1 AND user_id = $2`, [group.id, userId]);
    if (existing.rows[0] && !existing.rows[0].left_at) {
      throw conflict('ALREADY_MEMBER', 'You are already a member of this group', { groupId: group.id });
    }
    if (existing.rows[0]) {
      await client.query(`UPDATE group_members SET left_at = NULL, role = 'member', joined_at = now() WHERE group_id = $1 AND user_id = $2`, [group.id, userId]);
    } else {
      await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`, [group.id, userId]);
    }
    await logActivity(client, group.id, userId, 'member.joined', {});
    return group;
  });
}

/** Shared rule for leaving/removal: you can only exit a group once your balance is zero. */
async function assertSettled(client, groupId, userId, who) {
  const ledger = await computeGroupLedger(groupId, client);
  const net = ledger.netOf(userId);
  if (net !== 0) {
    throw conflict('UNSETTLED_BALANCE', `${who} still ${net > 0 ? 'is owed' : 'owes'} money. Settle up first.`, { net });
  }
}

export async function leaveGroup(userId, groupId) {
  return withTransaction(async (client) => {
    const group = await getMembership(groupId, userId, { client, lock: true });
    if (group.role === 'owner') {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM group_members WHERE group_id = $1 AND left_at IS NULL AND user_id <> $2`, [groupId, userId]);
      if (rows[0].n > 0) throw conflict('OWNER_MUST_TRANSFER', 'Transfer ownership to another member before leaving');
    }
    await assertSettled(client, groupId, userId, 'You');
    await client.query(`UPDATE group_members SET left_at = now() WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
    await logActivity(client, groupId, userId, 'member.left', {});
  });
}

export async function removeMember(ownerId, groupId, targetId) {
  return withTransaction(async (client) => {
    const group = await getMembership(groupId, ownerId, { client, lock: true });
    assertOwner(group);
    assertWritable(group);
    if (targetId === ownerId) throw conflict('CANNOT_REMOVE_SELF', 'Use "leave group" to remove yourself');
    const { rows } = await client.query(
      `SELECT u.name FROM group_members gm JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.left_at IS NULL`, [groupId, targetId]);
    if (!rows[0]) throw notFound('Member');
    await assertSettled(client, groupId, targetId, rows[0].name);
    await client.query(`UPDATE group_members SET left_at = now() WHERE group_id = $1 AND user_id = $2`, [groupId, targetId]);
    await logActivity(client, groupId, ownerId, 'member.removed', { userId: targetId, name: rows[0].name });
  });
}

export async function transferOwnership(ownerId, groupId, targetId) {
  return withTransaction(async (client) => {
    const group = await getMembership(groupId, ownerId, { client, lock: true });
    assertOwner(group);
    const res = await client.query(
      `UPDATE group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2 AND left_at IS NULL RETURNING user_id`, [groupId, targetId]);
    if (!res.rows[0]) throw notFound('Member');
    await client.query(`UPDATE group_members SET role = 'member' WHERE group_id = $1 AND user_id = $2`, [groupId, ownerId]);
    await logActivity(client, groupId, ownerId, 'owner.transferred', { userId: targetId });
  });
}

export async function regenerateInvite(ownerId, groupId) {
  const group = await getMembership(groupId, ownerId);
  assertOwner(group);
  assertWritable(group);
  const { rows } = await query(`UPDATE groups SET invite_code = $2 WHERE id = $1 RETURNING invite_code`, [groupId, generateInviteCode()]);
  return rows[0].invite_code;
}

export async function setArchived(ownerId, groupId, archived) {
  return withTransaction(async (client) => {
    const group = await getMembership(groupId, ownerId, { client, lock: true });
    assertOwner(group);
    if (archived) {
      const ledger = await computeGroupLedger(groupId, client);
      if (ledger.transfers.length) throw conflict('UNSETTLED_BALANCE', 'Everyone must be settled up before archiving');
    }
    await client.query(`UPDATE groups SET archived_at = ${archived ? 'now()' : 'NULL'} WHERE id = $1`, [groupId]);
    await logActivity(client, groupId, ownerId, archived ? 'group.archived' : 'group.unarchived', {});
  });
}
