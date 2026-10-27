import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { useAuth, useToast } from '../context.jsx';
import { ErrorBox, Spinner } from '../components/ui.jsx';
import ExpenseForm from '../components/ExpenseForm.jsx';
import SettleForm from '../components/SettleForm.jsx';
import ExpensesTab from './tabs/ExpensesTab.jsx';
import BalancesTab from './tabs/BalancesTab.jsx';
import ActivityTab from './tabs/ActivityTab.jsx';
import InsightsTab from './tabs/InsightsTab.jsx';
import MembersTab from './tabs/MembersTab.jsx';

const TABS = { expenses: 'Expenses', balances: 'Balances', insights: 'Insights', activity: 'Activity', members: 'Members' };

export default function GroupPage() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS[params.get('tab')] ? params.get('tab') : 'expenses';
  const { data, error, loading, reload } = useApi(`/groups/${groupId}`);
  const [modal, setModal] = useState(null); // { type: 'expense' | 'settle', expense?, transfer? }
  const [version, setVersion] = useState(0); // bump to make child tabs refetch after a write

  if (error) {
    return (
      <div className="stack">
        <ErrorBox error={error} onRetry={error.status === 404 ? undefined : reload} />
        <Link to="/">← Back to your groups</Link>
      </div>
    );
  }
  if (loading && !data) return <Spinner />;

  const { group, members, balances, transfers } = data;
  const active = members.filter((m) => m.active);
  const me = active.find((m) => m.id === user.id);
  const myNet = balances.find((b) => b.userId === user.id)?.net ?? 0;
  const readOnly = !!group.archivedAt;
  const refresh = () => {
    setModal(null);
    reload();
    setVersion((v) => v + 1);
  };

  const openEdit = async (id) => {
    try {
      const { expense } = await api(`/groups/${groupId}/expenses/${id}`);
      setModal({ type: 'expense', expense });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const ctx = { group, members, active, me, balances, transfers, readOnly, version, refresh, openEdit,
    settle: (transfer) => setModal({ type: 'settle', transfer }) };

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/" className="muted back">← Groups</Link>
          <h1>{group.name} {readOnly && <span className="badge">Archived · read-only</span>}</h1>
          <p className="muted">
            {myNet === 0 ? 'You are all settled up' : myNet > 0 ? 'You are owed money' : 'You owe money'} · {active.length} members
          </p>
        </div>
        {!readOnly && (
          <div className="row">
            <button className="btn" onClick={() => setModal({ type: 'settle', transfer: transfers.find((t) => t.from === user.id) })}>Settle up</button>
            <button className="btn btn-primary" onClick={() => setModal({ type: 'expense' })}>+ Add expense</button>
          </div>
        )}
      </div>

      <nav className="tabs" role="tablist">
        {Object.entries(TABS).map(([k, v]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''}
            onClick={() => setParams(k === 'expenses' ? {} : { tab: k })}>{v}</button>
        ))}
      </nav>

      {tab === 'expenses' && <ExpensesTab {...ctx} />}
      {tab === 'balances' && <BalancesTab {...ctx} />}
      {tab === 'insights' && <InsightsTab {...ctx} />}
      {tab === 'activity' && <ActivityTab {...ctx} />}
      {tab === 'members' && <MembersTab {...ctx} />}

      {modal?.type === 'expense' && (
        <ExpenseForm group={group} members={active} me={me} expense={modal.expense} onClose={() => setModal(null)} onSaved={refresh} />
      )}
      {modal?.type === 'settle' && (
        <SettleForm group={group} members={active} transfer={modal.transfer} onClose={() => setModal(null)} onSaved={refresh} />
      )}
    </>
  );
}
