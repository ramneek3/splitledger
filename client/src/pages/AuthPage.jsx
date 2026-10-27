import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context.jsx';

export default function AuthPage({ mode }) {
  const { user, login, register } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(form.name, form.email, form.password);
      else await login(form.email, form.password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const fieldError = (k) => error?.details?.fields?.[k];

  return (
    <div className="auth-wrap">
      <section className="auth-pitch">
        <h1>Split bills without the awkward maths.</h1>
        <p>Track shared expenses with flatmates, trip buddies and hostel friends. SplitLedger keeps a running balance
          and tells you the fewest payments needed to settle everyone up.</p>
        <ul className="ticks">
          <li>Equal, exact, percentage or share-based splits, accurate to the paisa</li>
          <li>Debt simplification: fewer UPI transfers</li>
          <li>Type “paid 600 for pizza with Riya” and it fills in the form</li>
        </ul>
      </section>
      <form className="card auth-card" onSubmit={submit} noValidate>
        <h2>{isRegister ? 'Create your account' : 'Welcome back'}</h2>
        {isRegister && (
          <label>Name
            <input value={form.name} onChange={set('name')} autoComplete="name" required aria-invalid={!!fieldError('name')} />
            {fieldError('name') && <small className="field-error">{fieldError('name')}</small>}
          </label>
        )}
        <label>Email
          <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required aria-invalid={!!fieldError('email')} />
          {fieldError('email') && <small className="field-error">{fieldError('email')}</small>}
        </label>
        <label>Password
          <input type="password" value={form.password} onChange={set('password')} required minLength={isRegister ? 8 : undefined}
            autoComplete={isRegister ? 'new-password' : 'current-password'} aria-invalid={!!fieldError('password')} />
          {fieldError('password') ? <small className="field-error">{fieldError('password')}</small>
            : isRegister && <small className="muted">At least 8 characters</small>}
        </label>
        {error && !error.details?.fields && <div className="alert alert-error" role="alert">{error.message}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}</button>
        <p className="muted center">
          {isRegister ? <>Already have an account? <Link to="/login" state={location.state}>Sign in</Link></>
            : <>New here? <Link to="/register" state={location.state}>Create an account</Link></>}
        </p>
      </form>
    </div>
  );
}
