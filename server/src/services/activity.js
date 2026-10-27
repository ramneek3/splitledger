import { query } from '../db/pool.js';

/** Appends an audit entry. Always called with the same client as the write it describes. */
export function logActivity(client, groupId, actorId, type, payload) {
  return client.query(
    `INSERT INTO activity (group_id, actor_id, type, payload) VALUES ($1, $2, $3, $4)`,
    [groupId, actorId, type, payload],
  );
}

export async function listActivity(groupId, { before, limit = 30 } = {}) {
  const { rows } = await query(
    `SELECT a.id, a.type, a.payload, a.created_at, a.actor_id, u.name AS actor_name
       FROM activity a JOIN users u ON u.id = a.actor_id
      WHERE a.group_id = $1 AND ($2::bigint IS NULL OR a.id < $2)
      ORDER BY a.id DESC LIMIT $3`,
    [groupId, before ?? null, limit],
  );
  return { items: rows, nextCursor: rows.length === limit ? rows[rows.length - 1].id : null };
}
