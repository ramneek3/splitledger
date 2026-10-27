import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { money } from '../../format.js';
import { Avatar } from '../../components/ui.jsx';

export default function MembersTab({ group, active, me, balances, transfers, readOnly, refresh }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const isOwner = group.myRole === 'owner';
  const link = `${window.location.origin}/join/${group.inviteCode}`;
  const net = (id) => balances.find((b) => b.userId === id)?.net ?? 0;

  // Every action reports the server's reason on failure (e.g. "still owes money").
  const run = async (fn, success, after = refresh) => {
    setBusy(true);
    try {
      await fn();
      toast(success);
      after();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      toast('Could not copy, please select and copy manually', 'error');
    }
  };

  return (
    <div className="two-col">
      <section className="card">
        <h2>Members ({active.length})</h2>
        <ul className="list compact">
          {active.map((m) => (
            <li key={m.id} className="list-item">
              <Avatar name={m.name} small />
              <div className="grow">
                <div>{m.name}{m.id === me.id && ' (you)'} {m.role === 'owner' && <span className="badge badge-accent">Owner</span>}</div>
                <div className="muted small">{m.email} · balance {money(net(m.id), group.currency)}</div>
              </div>
              {isOwner && m.id !== me.id && !readOnly && (
                <div className="item-actions">
                  <button className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={() => window.confirm(`Make ${m.name} the owner? You will become a regular member.`)
                      && run(() => api(`/groups/${group.id}/transfer-ownership`, { method: 'POST', body: { userId: m.id } }), `${m.name} is now the owner`)}>
                    Make owner
                  </button>
                  <button className="btn btn-ghost btn-sm danger" disabled={busy}
                    onClick={() => window.confirm(`Remove ${m.name} from the group?`)
                      && run(() => api(`/groups/${group.id}/members/${m.id}`, { method: 'DELETE' }), `${m.name} was removed`)}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack">
        {!readOnly && (
          <>
            <h2>Invite people</h2>
            <p className="muted small">Share this link or code. Anyone with it can join after signing in.</p>
            <div className="invite">
              <code className="mono big">{group.inviteCode}</code>
              <button className="btn btn-sm" onClick={() => copy(link)}>Copy invite link</button>
            </div>
            {isOwner && (
              <button className="btn btn-ghost btn-sm" disabled={busy}
                onClick={() => run(() => api(`/groups/${group.id}/invite-code`, { method: 'POST' }), 'New invite code generated. The old one no longer works.')}>
                Reset invite code
              </button>
            )}
          </>
        )}

        <h2>Group</h2>
        <a className="btn btn-sm" href={`/api/groups/${group.id}/export.csv`} download>⬇ Export ledger (CSV)</a>
        {isOwner && (
          <button className="btn btn-sm" disabled={busy || (!readOnly && transfers.length > 0)}
            title={!readOnly && transfers.length ? 'Everyone must be settled up first' : ''}
            onClick={() => run(() => api(`/groups/${group.id}/archive`, { method: 'POST', body: { archived: !readOnly } }),
              readOnly ? 'Group reopened' : 'Group archived')}>
            {readOnly ? 'Reopen group' : 'Archive group'}
          </button>
        )}
        {isOwner && !readOnly && transfers.length > 0 && <p className="muted small">You can archive once everyone is settled up.</p>}
        <button className="btn btn-sm danger" disabled={busy}
          onClick={() => window.confirm('Leave this group?')
            && run(() => api(`/groups/${group.id}/leave`, { method: 'POST' }), 'You left the group', () => navigate('/'))}>
          Leave group
        </button>
      </section>
    </div>
  );
}
