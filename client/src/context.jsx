import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);
const ToastContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking session

  useEffect(() => {
    api('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null));
    setUnauthorizedHandler(() => setUser(null)); // session expired mid-use -> back to login
  }, []);

  const value = useMemo(() => ({
    user,
    login: async (email, password) => setUser((await api('/auth/login', { method: 'POST', body: { email, password } })).user),
    register: async (name, email, password) => setUser((await api('/auth/register', { method: 'POST', body: { name, email, password } })).user),
    logout: async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      setUser(null);
    },
  }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const id = useRef(0);
  const push = useCallback((message, kind = 'success') => {
    const t = { id: ++id.current, message, kind };
    setToasts((xs) => [...xs, t]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== t.id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
