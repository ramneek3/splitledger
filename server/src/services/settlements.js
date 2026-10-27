import { query, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertWritable, computeGroupLedger, getMembership } from './groups.js';
import { logActivity } from './activity.js';

/**
 * Records a repayment from one member to another.
 *
 * Rules:
 *  - only the payer, the receiver, or the group owner can record it
 *  - the payer must actually owe money and the receiver must actually be owed money
 *  - the amount can't exceed what either side has outstanding, so a settlement can
 *    never flip someone from "owes" to "is owed" (that would be a new loan, not a repayment)
 *
 * The group row is locked for the duration so two people settling at the same moment
 * cannot both pass validation against the same stale balance.
 */
export async function createSettlement(userId, groupId, input) {
  return withTransaction(async (client) => {
    const group = await getMembership(groupId, userId, { client, lock: true });
    assertWritable(group);
    const { fromUser, toUser, amount } = input;
    if (fromUser === toUser) throw badRequest('You cannot settle with yourself');
    if (userId !== fromUser && userId !== toUser && group.role !== 'owner') {
      throw forbidden('Only the two people involved or the group owner can record this payment');
    }

    if (input.idempotencyKey) {
      const dup = await client.query(`SELECT * FROM settlements WHERE group_id = $1 AND idempotency_key = $2`, [groupId, input.idempotencyKey]);
      if (dup.rows[0]) return { ...serialize(dup.rows[0]), duplicate: true };
    }

    const ledger = await computeGroupLedger(groupId, client);
    const active = new Set(ledger.members.filter((m) => !m.left_at).map((m) => m.id));
    if (!active.has(fromUser) || !active.has(toUser)) throw badRequest('Both people must be current members of the group');

    const owes = -ledger.netOf(fromUser);
    const owed = ledger.netOf(toUser);
    if (owes <= 0) throw conflict('NOTHING_OWED', 'The payer does not owe anything in this group');
    if (owed <= 0) throw conflict('NOTHING_OWED', 'The receiver is not owed anything in this group');
    const max = Math.min(owes, owed);
    if (amount > max) {
      throw conflict('SETTLEMENT_EXCEEDS_DEBT', `That is more than is outstanding. The most you can record here is ${(max / 100).toFixed(2)}.`, { max });
    }

    const { rows } = await client.query(
      `INSERT INTO settlements (group_id, from_user, to_user, amount_minor, note, created_by, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [groupId, fromUser, toUser, amount, input.note || null, userId, input.idempotencyKey || null],
    );
    const names = Object.fromEntries(ledger.members.map((m) => [m.id, m.name]));
    await logActivity(client, groupId, userId, 'settlement.created', {
      settlementId: rows[0].id, from: names[fromUser], to: names[toUser], amount,
    });
    return { ...serialize(rows[0]), duplicate: false };
  });
}

export async function deleteSettlement(userId, groupId, settlementId) {
  return withTransaction(async (client) => {
    const group = await getMembership(groupId, userId, { client, lock: true });
    assertWritable(group);
    const { rows } = await client.query(
      `SELECT * FROM settlements WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL FOR UPDATE`, [settlementId, groupId]);
    const s = rows[0];
    if (!s) throw notFound('Payment');
    if (s.created_by !== userId && group.role !== 'owner') throw forbidden('Only the person who recorded this payment or the owner can undo it');
    await client.query(`UPDATE settlements SET deleted_at = now() WHERE id = $1`, [settlementId]);
    await logActivity(client, groupId, userId, 'settlement.deleted', { settlementId, amount: s.amount_minor });
  });
}

export async function listSettlements(groupId) {
  const { rows } = await query(
    `SELECT s.*, f.name AS from_name, t.name AS to_name FROM settlements s
       JOIN users f ON f.id = s.from_user JOIN users t ON t.id = s.to_user
      WHERE s.group_id = $1 AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 100`,
    [groupId],
  );
  return rows.map(serialize);
}

function serialize(r) {
  return {
    id: r.id,
    fromUser: r.from_user,
    toUser: r.to_user,
    fromName: r.from_name,
    toName: r.to_name,
    amount: r.amount_minor,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}
