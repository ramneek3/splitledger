import { query } from '../db/pool.js';

/** Spending analytics for one group, plus the caller's personal share. */
export async function groupInsights(groupId, userId) {
  const [byCategory, byMonth, byPayer, mine] = await Promise.all([
    query(
      `SELECT category, sum(amount_minor)::bigint AS total, count(*)::int AS count
         FROM expenses WHERE group_id = $1 AND deleted_at IS NULL
        GROUP BY category ORDER BY total DESC`, [groupId]),
    query(
      `SELECT to_char(m, 'YYYY-MM') AS month,
              COALESCE(sum(e.amount_minor), 0)::bigint AS total,
              COALESCE(sum(s.share_minor), 0)::bigint AS mine
         FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') m
         LEFT JOIN expenses e ON e.group_id = $1 AND e.deleted_at IS NULL AND date_trunc('month', e.expense_date) = m
         LEFT JOIN expense_splits s ON s.expense_id = e.id AND s.user_id = $2
        GROUP BY m ORDER BY m`, [groupId, userId]),
    query(
      `SELECT u.name, sum(e.amount_minor)::bigint AS total FROM expenses e JOIN users u ON u.id = e.paid_by
        WHERE e.group_id = $1 AND e.deleted_at IS NULL GROUP BY u.name ORDER BY total DESC`, [groupId]),
    query(
      `SELECT COALESCE(sum(s.share_minor), 0)::bigint AS my_share, COALESCE(sum(e.amount_minor), 0)::bigint AS group_total
         FROM expenses e LEFT JOIN expense_splits s ON s.expense_id = e.id AND s.user_id = $2
        WHERE e.group_id = $1 AND e.deleted_at IS NULL`, [groupId, userId]),
  ]);
  return {
    byCategory: byCategory.rows,
    byMonth: byMonth.rows,
    byPayer: byPayer.rows,
    myShare: mine.rows[0].my_share,
    groupTotal: mine.rows[0].group_total,
  };
}
