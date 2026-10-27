import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { useToast } from '../context.jsx';
import { money } from '../format.js';
import { Empty, ErrorBox, Modal, Signed, Spinner } from '../components/ui.jsx';

export default function Dashboard() {
  const { data, error, loading, reload } = useApi('/groups');
  const [modal, setModal] = useState(null);
  const groups = data?.groups || [];

  // Totals per currency so we never add rupees to dollars.
  const totals = {};
  for (const g of groups) {
    totals[g.currency] ??= { owed: 0, owe: 0 };
    if (g.my_net > 0) totals[g.currency].owed += g.my_net;
    else totals[g.currency].owe -= g.my_net;
  }

  return (
    <>
      <div className="page-head">
        <h1>Your groups</h1>
        <div className="row">
          <button className="btn" onClick={() => setModal('join')}>Join with code</button>
          <button className="btn btn-primary" onClick={() => setModal('create')}>+ New group</button>
        </div>
      </div>

      {Object.entries(totals).map(([cur, t]) => (
        <div className="summary" key={cur}>
          <div><span className="muted">You are owed</span><strong className="pos">{money(t.owed, cur)}</strong></div>
          <div><span className="muted">You owe</span><strong className="neg">{money(t.owe, cur)}</strong></div>
          <div><span className="muted">Net</span><strong><Signed value={t.owed - t.owe}>{money(t.owed - t.owe, cur)}</Signed></strong></div>
        </div>
      ))}

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && !groups.length && (
        <Empty icon="👋" title="No groups yet">
          <p>Create a group for your flat, a trip or a club, then share the invite code with friends.</p>
          <button className="btn btn-primary" onClick={() => setModal('create')}>Create your first group</button>
        </Empty>
      )}
      <div className="grid">
        {groups.map((g) => (
          <Link to={`/groups/${g.id}`} className={`card group-card ${g.archived_at ? 'archived' : ''}`} key={g.id}>
            <div className="row-between">
              <h3>{g.name}</h3>
              {g.archived_at ? <span className="badge">Archived</span> : g.role === 'owner' && <span className="badge badge-accent">Owner</span>}
            </div>
            <p className="muted">{g.member_count} member{g.member_count === 1 ? '' : 's'}</p>
            <p className="group-balance">
              {g.my_net === 0 ? <span className="muted">All settled up</span>
                : <Signed value={g.my_net}>{g.my_net > 0 ? 'You are owed ' : 'You owe '}{money(Math.abs(g.my_net), g.currency)}</Signed>}
            </p>
          </Link>
        ))}
      </div>

      {modal === 'create' && <CreateGroup onClose={() => setModal(null)} />}
      {modal === 'join' && <JoinGroup onClose={() => setModal(null)} />}
    </>
  );
}

function CreateGroup({ onClose }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { group } = await api('/groups', { method: 'POST', body: { name, currency } });
      toast(`Created “${group.name}”. Share the invite code from the Members tab.`);
      navigate(`/groups/${group.id}?tab=members`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal title="New group" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>Group name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Flat 4B, Goa trip" required maxLength={60} /></label>
        <label>Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button>
      </form>
    </Modal>
  );
}

function JoinGroup({ onClose }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { group } = await api('/groups/join', { method: 'POST', body: { code } });
      toast(`Joined “${group.name}”`);
      navigate(`/groups/${group.id}`);
    } catch (err) {
      if (err.code === 'ALREADY_MEMBER') return navigate(`/groups/${err.details.groupId}`);
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal title="Join a group" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>Invite code<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="8-character code" className="mono" required /></label>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy || code.length < 4}>{busy ? 'Joining…' : 'Join group'}</button>
      </form>
    </Modal>
  );
}
