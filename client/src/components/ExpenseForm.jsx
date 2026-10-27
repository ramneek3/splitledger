import { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { CATEGORIES, money, toInput, today } from '../format.js';
import { previewSplit } from '../splitPreview.js';
import { ErrorBox, Modal } from './ui.jsx';

const SPLIT_TYPES = { equal: 'Equally', exact: 'Exact amounts', percent: 'Percentages', shares: 'Shares' };
const VALUE_LABEL = { exact: 'Amount', percent: '%', shares: 'Shares' };
const AI_LABEL = { anthropic: 'Claude', openrouter: 'OpenRouter' };

function initialRows(members, expense) {
  const byId = new Map((expense?.splits || []).map((s) => [s.userId, s]));
  return members.map((m) => {
    const s = byId.get(m.id);
    let value = '';
    if (s && expense.splitType === 'exact') value = toInput(s.share);
    else if (s && s.input !== null) value = String(s.input);
    return { userId: m.id, name: m.name, included: expense ? byId.has(m.id) : true, value };
  });
}

/**
 * Create or edit an expense. When creating, an optional "quick add" box turns a
 * sentence into a pre-filled draft that the user reviews before saving.
 */
export default function ExpenseForm({ group, members, me, expense, onClose, onSaved }) {
  const toast = useToast();
  const editing = !!expense;
  const [f, setF] = useState(() => ({
    description: expense?.description || '',
    amount: expense ? toInput(expense.amount) : '',
    paidBy: expense?.paidBy || me.id,
    category: expense?.category || 'other',
    expenseDate: expense?.expenseDate || today(),
    splitType: expense?.splitType || 'equal',
  }));
  const [rows, setRows] = useState(() => initialRows(members, expense));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState({ text: '', busy: false, info: null });
  // One key per form: a double-click or network retry can't create a second copy.
  const idemKey = useRef(crypto.randomUUID());
  const source = useRef('manual');

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const amountMinor = /^\d+(\.\d{0,2})?$/.test(f.amount) ? Math.round(Number(f.amount) * 100) : 0;
  const included = rows.filter((r) => r.included);
  const preview = useMemo(() => previewSplit(amountMinor, f.splitType, included), [amountMinor, f.splitType, included]);

  const changeSplitType = (type) => {
    setF({ ...f, splitType: type });
    // Sensible defaults for the new mode so the form is valid straight away.
    setRows(rows.map((r) => ({ ...r, value: type === 'shares' ? '1' : type === 'percent' ? (100 / Math.max(included.length, 1)).toFixed(2) : '' })));
  };

  const runQuickAdd = async () => {
    setQuick({ ...quick, busy: true, info: null });
    setError(null);
    try {
      const { draft, source: src, provider, model, fallbackReason } = await api(`/groups/${group.id}/expenses/draft`, { method: 'POST', body: { text: quick.text } });
      source.current = src;
      setF({
        description: draft.description,
        amount: draft.amount ? toInput(draft.amount) : '',
        paidBy: draft.paidBy,
        category: draft.category,
        expenseDate: draft.expenseDate,
        splitType: draft.splitType,
      });
      const byId = new Map(draft.participants.map((p) => [p.userId, p]));
      setRows(members.map((m) => {
        const p = byId.get(m.id);
        const value = !p || p.value == null ? '' : draft.splitType === 'exact' ? toInput(p.value) : String(p.value);
        return { userId: m.id, name: m.name, included: !!p, value };
      }));
      setQuick({ text: quick.text, busy: false, info: { src, provider, model, warnings: draft.warnings, fallbackReason } });
    } catch (err) {
      setQuick({ ...quick, busy: false, info: null });
      setError(err);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (preview.problem) return setError(new Error(preview.problem));
    setBusy(true);
    setError(null);
    const body = {
      ...f,
      amount: f.amount,
      participants: included.map((r) => ({ userId: r.userId, value: f.splitType === 'equal' ? undefined : r.value })),
      ...(editing ? { version: expense.version } : { idempotencyKey: idemKey.current, source: source.current }),
    };
    try {
      const path = `/groups/${group.id}/expenses${editing ? `/${expense.id}` : ''}`;
      const res = await api(path, { method: editing ? 'PUT' : 'POST', body });
      toast(res.expense.duplicate ? 'That expense was already saved' : editing ? 'Expense updated' : 'Expense added');
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? 'Edit expense' : 'Add expense'} onClose={onClose} wide>
      {!editing && (
        <div className="quick-add">
          <label htmlFor="quick">✨ Quick add <span className="muted">Describe it in plain words</span></label>
          <div className="row">
            <input id="quick" value={quick.text} onChange={(e) => setQuick({ ...quick, text: e.target.value })} maxLength={500}
              placeholder={`e.g. "${members[1]?.name.split(' ')[0] || 'Riya'} paid 1200 for dinner, split with everyone"`}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (quick.text.trim().length >= 3) runQuickAdd(); } }} />
            <button type="button" className="btn" onClick={runQuickAdd} disabled={quick.busy || quick.text.trim().length < 3}>
              {quick.busy ? 'Reading…' : 'Fill form'}
            </button>
          </div>
          {quick.info && (
            <div className="quick-info">
              <span className="badge" title={quick.info.model || ''}>
                {quick.info.src === 'ai' ? `Filled by AI · ${AI_LABEL[quick.info.provider] || quick.info.provider}` : 'Filled by rules'}
              </span>
              {quick.info.fallbackReason && <span className="muted"> {quick.info.fallbackReason}.</span>}
              <span className="muted"> Check the details below before saving.</span>
              {quick.info.warnings.length > 0 && <ul className="warnings">{quick.info.warnings.map((w) => <li key={w}>⚠️ {w}</li>)}</ul>}
            </div>
          )}
        </div>
      )}

      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <label className="span-2">Description<input value={f.description} onChange={set('description')} required maxLength={120} placeholder="What was it for?" /></label>
          <label>Amount ({group.currency})
            <input value={f.amount} onChange={set('amount')} inputMode="decimal" required placeholder="0.00"
              aria-invalid={f.amount !== '' && !amountMinor} />
          </label>
          <label>Paid by
            <select value={f.paidBy} onChange={set('paidBy')}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (you)` : m.name}</option>)}
            </select>
          </label>
          <label>Category
            <select value={f.category} onChange={set('category')}>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Date<input type="date" value={f.expenseDate} max={today()} onChange={set('expenseDate')} required /></label>
        </div>

        <fieldset className="split-box">
          <legend>Split</legend>
          <div className="segmented" role="radiogroup" aria-label="Split type">
            {Object.entries(SPLIT_TYPES).map(([k, v]) => (
              <button type="button" key={k} role="radio" aria-checked={f.splitType === k}
                className={f.splitType === k ? 'active' : ''} onClick={() => changeSplitType(k)}>{v}</button>
            ))}
          </div>
          <table className="split-table">
            <tbody>
              {rows.map((r, i) => {
                const idx = included.indexOf(r);
                const share = r.included && preview.shares ? preview.shares[idx] : null;
                return (
                  <tr key={r.userId} className={r.included ? '' : 'excluded'}>
                    <td>
                      <label className="check">
                        <input type="checkbox" checked={r.included}
                          onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, included: e.target.checked } : x)))} />
                        {r.name}{r.userId === me.id && ' (you)'}
                      </label>
                    </td>
                    <td className="split-value">
                      {f.splitType !== 'equal' && r.included && (
                        <input aria-label={`${VALUE_LABEL[f.splitType]} for ${r.name}`} value={r.value} inputMode="decimal"
                          onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                      )}
                    </td>
                    <td className="num">{share !== null && share !== undefined ? money(share, group.currency) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {preview.problem && <p className="field-error">{preview.problem}</p>}
        </fieldset>

        <ErrorBox error={error} />
        {error?.code === 'VERSION_CONFLICT' && (
          <button type="button" className="btn" onClick={onSaved}>Reload latest version</button>
        )}
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !!preview.problem || !amountMinor}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
