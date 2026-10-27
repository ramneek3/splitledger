import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { money, toInput } from '../format.js';
import { ErrorBox, Modal } from './ui.jsx';

/** Record a repayment. Pre-filled from a suggested transfer; the server enforces the limits. */
export default function SettleForm({ group, members, transfer, onClose, onSaved }) {
  const toast = useToast();
  const [fromUser, setFrom] = useState(transfer?.from || members[0]?.id);
  const [toUser, setTo] = useState(transfer?.to || members[1]?.id);
  const [amount, setAmount] = useState(transfer ? toInput(transfer.amount) : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const idemKey = useRef(crypto.randomUUID());
  const name = (id) => members.find((m) => m.id === id)?.name;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${group.id}/settlements`, {
        method: 'POST', body: { fromUser, toUser, amount, note: note || undefined, idempotencyKey: idemKey.current },
      });
      toast(`Recorded: ${name(fromUser)} paid ${name(toUser)} ${money(Math.round(Number(amount) * 100), group.currency)}`);
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title="Record a payment" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <label>Who paid
            <select value={fromUser} onChange={(e) => setFrom(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Paid to
            <select value={toUser} onChange={(e) => setTo(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Amount ({group.currency})<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required /></label>
          <label>Note <span className="muted">(optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="UPI, cash…" /></label>
        </div>
        {fromUser === toUser && <p className="field-error">Pick two different people</p>}
        <ErrorBox error={error} />
        {error?.code === 'SETTLEMENT_EXCEEDS_DEBT' && (
          <button type="button" className="btn btn-sm" onClick={() => setAmount(toInput(error.details.max))}>
            Use the maximum ({money(error.details.max, group.currency)})
          </button>
        )}
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || fromUser === toUser || !amount}>{busy ? 'Saving…' : 'Record payment'}</button>
        </div>
      </form>
    </Modal>
  );
}
