import { useApi } from '../../hooks.js';
import { CATEGORIES, money } from '../../format.js';
import { Empty, ErrorBox, Spinner } from '../../components/ui.jsx';

const monthLabel = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });

export default function InsightsTab({ group, version }) {
  const { data, error, loading, reload } = useApi(`/groups/${group.id}/insights`, [version]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  if (!data.groupTotal) return <Empty icon="📊" title="No spending yet">Insights appear once expenses are added.</Empty>;

  const cur = group.currency;
  const maxMonth = Math.max(1, ...data.byMonth.map((m) => m.total));
  const maxCat = Math.max(1, ...data.byCategory.map((c) => c.total));

  return (
    <div className="stack">
      <div className="summary">
        <div><span className="muted">Group spending</span><strong>{money(data.groupTotal, cur)}</strong></div>
        <div><span className="muted">Your share</span><strong>{money(data.myShare, cur)}</strong></div>
        <div><span className="muted">Your share %</span><strong>{Math.round((data.myShare / data.groupTotal) * 100)}%</strong></div>
      </div>
      <div className="two-col">
        <section className="card">
          <h2>Last 6 months</h2>
          <div className="col-chart" role="img" aria-label="Monthly group spending with your share">
            {data.byMonth.map((m) => (
              <div className="col" key={m.month} title={`${m.month}: ${money(m.total, cur)} (you ${money(m.mine, cur)})`}>
                <div className="col-value small">{m.total ? money(m.total, cur).replace(/\.\d+$/, '') : ''}</div>
                <div className="col-bar" style={{ height: `${(m.total / maxMonth) * 100}%` }}>
                  <div className="col-mine" style={{ height: m.total ? `${(m.mine / m.total) * 100}%` : 0 }} />
                </div>
                <div className="muted small">{monthLabel(m.month)}</div>
              </div>
            ))}
          </div>
          <p className="legend small"><span className="swatch swatch-total" /> Group <span className="swatch swatch-mine" /> Your share</p>
        </section>
        <section className="card">
          <h2>By category</h2>
          <ul className="hbars">
            {data.byCategory.map((c) => (
              <li key={c.category}>
                <span className="hbar-label">{CATEGORIES[c.category] || c.category}</span>
                <span className="hbar-track"><span className="hbar" style={{ width: `${(c.total / maxCat) * 100}%` }} /></span>
                <span className="num small">{money(c.total, cur)}</span>
              </li>
            ))}
          </ul>
          <h3>Who paid most</h3>
          <ul className="hbars">
            {data.byPayer.map((p) => (
              <li key={p.name}>
                <span className="hbar-label">{p.name}</span>
                <span className="hbar-track"><span className="hbar hbar-alt" style={{ width: `${(p.total / data.byPayer[0].total) * 100}%` }} /></span>
                <span className="num small">{money(p.total, cur)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
