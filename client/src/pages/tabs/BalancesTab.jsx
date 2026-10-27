import { api } from '../../api.js';
import { useApi } from '../../hooks.js';
import { useToast } from '../../context.jsx';
import { money, timeAgo } from '../../format.js';
import { Avatar, Empty, ErrorBox, Signed } from '../../components/ui.jsx';

export default function BalancesTab({ group, members, me, balances, transfers, readOnly, version, refresh, settle }) {
  const toast = useToast();
  const history = useApi(`/groups/${group.id}/settlements`, [version]);
  const name = (id) => (id === me.id ? 'You' : members.find((m) => m.id === id)?.name);
  const max = Math.max(1, ...balances.map((b) => Math.abs(b.net)));
  const shown = balances.filter((b) => b.active || b.net !== 0);

  const undo = async (s) => {
    if (!window.confirm('Undo this payment? The debt will reappear in balances.')) return;
    try {
      await api(`/groups/${group.id}/settlements/${s.id}`, { method: 'DELETE' });
      toast('Payment removed');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="two-col">
      <section className="card">
        <h2>Who owes what</h2>
        <ul className="balances">
          {shown.map((b) => (
            <li key={b.userId}>
              <Avatar name={b.name} small />
              <span className="grow">{b.userId === me.id ? `${b.name} (you)` : b.name}</span>
              <div className="bar-track" aria-hidden>
                <div className={`bar ${b.net >= 0 ? 'bar-pos' : 'bar-neg'}`} style={{ width: `${(Math.abs(b.net) / max) * 50}%`, [b.net >= 0 ? 'left' : 'right']: '50%' }} />
              </div>
              <Signed value={b.net}><span className="num">{b.net > 0 ? '+' : ''}{money(b.net, group.currency)}</span></Signed>
            </li>
          ))}
        </ul>
        <p className="muted small">Positive = the group owes them. Negative = they owe the group.</p>
      </section>

      <section className="card">
        <h2>Settle up plan</h2>
        <p className="muted small">The fewest payments that clear every balance ({transfers.length} instead of paying each expense back separately).</p>
        {!transfers.length ? (
          <Empty icon="🎉" title="Everyone is settled up" />
        ) : (
          <ul className="transfers">
            {transfers.map((t) => (
              <li key={`${t.from}-${t.to}`}>
                <span><strong>{name(t.from)}</strong> → <strong>{name(t.to)}</strong></span>
                <span className="num">{money(t.amount, group.currency)}</span>
                {!readOnly && (t.from === me.id || t.to === me.id || group.myRole === 'owner') && (
                  <button className="btn btn-sm" onClick={() => settle(t)}>Record</button>
                )}
              </li>
            ))}
          </ul>
        )}

        <h3>Payment history</h3>
        <ErrorBox error={history.error} onRetry={history.reload} />
        {history.data && !history.data.settlements.length && <p className="muted">No payments recorded yet.</p>}
        <ul className="list compact">
          {history.data?.settlements.map((s) => (
            <li key={s.id} className="list-item">
              <div className="grow">
                <span>{s.fromName} paid {s.toName} <strong>{money(s.amount, group.currency)}</strong></span>
                <div className="muted small">{timeAgo(s.createdAt)}{s.note && ` · ${s.note}`}</div>
              </div>
              {!readOnly && (s.createdBy === me.id || group.myRole === 'owner') && (
                <button className="btn btn-ghost btn-sm danger" onClick={() => undo(s)}>Undo</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
