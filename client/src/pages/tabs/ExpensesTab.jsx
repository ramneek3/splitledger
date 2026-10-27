import { useState } from 'react';
import { api } from '../../api.js';
import { useApi, useDebounced } from '../../hooks.js';
import { useToast } from '../../context.jsx';
import { CATEGORIES, dateLabel, money } from '../../format.js';
import { Empty, ErrorBox, Signed, Spinner } from '../../components/ui.jsx';

const PAGE = 20;

export default function ExpensesTab({ group, members, me, readOnly, version, refresh, openEdit }) {
  const toast = useToast();
  const [filters, setFilters] = useState({ q: '', category: '', paidBy: '', involvesMe: false });
  const [page, setPage] = useState(0);
  const q = useDebounced(filters.q);
  const qs = new URLSearchParams({ limit: PAGE, offset: page * PAGE });
  if (q) qs.set('q', q);
  if (filters.category) qs.set('category', filters.category);
  if (filters.paidBy) qs.set('paidBy', filters.paidBy);
  if (filters.involvesMe) qs.set('involvesMe', 'true');
  const { data, error, loading, reload } = useApi(`/groups/${group.id}/expenses?${qs}`, [version]);

  const setFilter = (k, v) => {
    setFilters({ ...filters, [k]: v });
    setPage(0);
  };
  const filtered = q || filters.category || filters.paidBy || filters.involvesMe;

  const remove = async (e) => {
    if (!window.confirm(`Delete “${e.description}”? Balances will be recalculated.`)) return;
    try {
      await api(`/groups/${group.id}/expenses/${e.id}`, { method: 'DELETE' });
      toast('Expense deleted');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const canModify = (e) => !readOnly && (e.createdBy === me.id || group.myRole === 'owner');
  const pages = data ? Math.ceil(data.total / PAGE) : 0;

  return (
    <section className="stack">
      <div className="filters">
        <input type="search" placeholder="Search expenses…" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} aria-label="Search" />
        <select value={filters.category} onChange={(e) => setFilter('category', e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.paidBy} onChange={(e) => setFilter('paidBy', e.target.value)} aria-label="Paid by">
          <option value="">Anyone paid</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={filters.involvesMe} onChange={(e) => setFilter('involvesMe', e.target.checked)} /> Only mine</label>
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <p className="muted small">{data.total} expense{data.total === 1 ? '' : 's'} · {money(data.totalAmount, group.currency)} total{loading && ' · updating…'}</p>
      )}
      {data && !data.items.length && (filtered
        ? <Empty icon="🔍" title="No matching expenses"><p>Try a different search or clear the filters.</p></Empty>
        : <Empty title="No expenses yet"><p>Add the first one. Try the ✨ quick add, e.g. “paid 900 for groceries”.</p></Empty>)}

      <ul className="list">
        {data?.items.map((e) => {
          const iPaid = e.paidBy === me.id;
          const impact = (iPaid ? e.amount : 0) - e.myShare; // + you lent, - you borrowed
          return (
            <li key={e.id} className="list-item">
              <div className="date-chip"><span>{dateLabel(e.expenseDate)}</span></div>
              <div className="grow">
                <div className="row-between">
                  <strong>{e.description}</strong>
                  <strong>{money(e.amount, group.currency)}</strong>
                </div>
                <div className="row-between small">
                  <span className="muted">{CATEGORIES[e.category]} · {iPaid ? 'You' : e.paidByName} paid · split {e.splitType} between {e.participantCount}</span>
                  <Signed value={impact}>{impact === 0 ? 'not involved' : impact > 0 ? `you lent ${money(impact, group.currency)}` : `you owe ${money(-impact, group.currency)}`}</Signed>
                </div>
              </div>
              {canModify(e) && (
                <div className="item-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(e.id)}>Edit</button>
                  <button className="btn btn-ghost btn-sm danger" onClick={() => remove(e)}>Delete</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <div className="pager">
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Newer</button>
          <span className="muted">Page {page + 1} of {pages}</span>
          <button className="btn btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Older →</button>
        </div>
      )}
    </section>
  );
}
