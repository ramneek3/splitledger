import { useEffect, useRef } from 'react';
import { initials } from '../format.js';

export const Spinner = ({ label = 'Loading' }) => <div className="spinner" role="progressbar" aria-label={label} />;

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{error.message || String(error)}</span>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ icon = '🧾', title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export const Avatar = ({ name, small }) => <span className={`avatar ${small ? 'avatar-sm' : ''}`} title={name}>{initials(name)}</span>;

/** Coloured amount: green when positive (you are owed), red when negative (you owe). */
export function Signed({ value, children }) {
  return <span className={value > 0 ? 'pos' : value < 0 ? 'neg' : 'muted'}>{children}</span>;
}
