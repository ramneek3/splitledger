import { query } from '../db/pool.js';

/**
 * Escapes one CSV cell. Values starting with = + - @ are prefixed with a quote so
 * spreadsheet apps don't execute them as formulas (CSV injection).
 */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function groupLedgerCsv(groupId) {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT e.expense_date AS date, 'expense' AS kind, e.description, e.category, u.name AS paid_by,
              NULL AS paid_to, e.amount_minor, e.split_type,
              (SELECT string_agg(su.name || ':' || to_char(s.share_minor / 100.0, 'FM999999990.00'), '; ' ORDER BY su.name)
                 FROM expense_splits s JOIN users su ON su.id = s.user_id WHERE s.expense_id = e.id) AS split,
              e.created_at
         FROM expenses e JOIN users u ON u.id = e.paid_by WHERE e.group_id = $1 AND e.deleted_at IS NULL
       UNION ALL
       SELECT st.created_at::date, 'payment', COALESCE(st.note, 'Settle up'), 'settlement', f.name, t.name,
              st.amount_minor, NULL, NULL, st.created_at
         FROM settlements st JOIN users f ON f.id = st.from_user JOIN users t ON t.id = st.to_user
        WHERE st.group_id = $1 AND st.deleted_at IS NULL
     ) x ORDER BY date, created_at`,
    [groupId],
  );
  const header = ['date', 'type', 'description', 'category', 'paid_by', 'paid_to', 'amount', 'split_type', 'split'];
  const lines = rows.map((r) =>
    [r.date, r.kind, r.description, r.category, r.paid_by, r.paid_to, (r.amount_minor / 100).toFixed(2), r.split_type, r.split]
      .map(csvCell).join(','));
  return [header.join(','), ...lines].join('\n') + '\n';
}
