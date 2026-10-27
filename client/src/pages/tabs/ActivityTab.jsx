import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { money, timeAgo } from '../../format.js';
import { Empty, ErrorBox, Spinner } from '../../components/ui.jsx';

function describe(a, currency) {
  const p = a.payload;
  switch (a.type) {
    case 'group.created': return `created the group “${p.name}”`;
    case 'member.joined': return 'joined the group';
    case 'member.left': return 'left the group';
    case 'member.removed': return `removed ${p.name}`;
    case 'owner.transferred': return 'handed over group ownership';
    case 'expense.created': return `added “${p.description}” (${money(p.amount, currency)})${p.source === 'ai' ? ' with ✨ quick add' : ''}`;
    case 'expense.updated': return `edited “${p.description}”${p.previousAmount !== p.amount ? ` (${money(p.previousAmount, currency)} → ${money(p.amount, currency)})` : ''}`;
    case 'expense.deleted': return `deleted “${p.description}” (${money(p.amount, currency)})`;
    case 'settlement.created': return `recorded ${p.from} paying ${p.to} ${money(p.amount, currency)}`;
    case 'settlement.deleted': return `undid a payment of ${money(p.amount, currency)}`;
    case 'group.archived': return 'archived the group';
    case 'group.unarchived': return 'reopened the group';
    default: return a.type;
  }
}

/** Audit trail with cursor pagination ("load older"). */
export default function ActivityTab({ group, version }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [state, setState] = useState({ loading: true, error: null });

  const load = async (before) => {
    setState({ loading: true, error: null });
    try {
      const res = await api(`/groups/${group.id}/activity${before ? `?before=${before}` : ''}`);
      setItems((xs) => (before ? [...xs, ...res.items] : res.items));
      setCursor(res.nextCursor);
      setState({ loading: false, error: null });
    } catch (error) {
      setState({ loading: false, error });
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [group.id, version]);

  return (
    <section className="card">
      <ErrorBox error={state.error} onRetry={() => load()} />
      {!items.length && !state.loading && !state.error && <Empty icon="📜" title="No activity yet" />}
      <ol className="timeline">
        {items.map((a) => (
          <li key={a.id}>
            <span><strong>{a.actor_name}</strong> {describe(a, group.currency)}</span>
            <time className="muted small" dateTime={a.created_at}>{timeAgo(a.created_at)}</time>
          </li>
        ))}
      </ol>
      {state.loading && <Spinner />}
      {cursor && !state.loading && <button className="btn btn-sm" onClick={() => load(cursor)}>Load older</button>}
    </section>
  );
}
