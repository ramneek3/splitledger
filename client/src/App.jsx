import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, ToastProvider, useAuth } from './context.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import GroupPage from './pages/GroupPage.jsx';
import JoinPage from './pages/JoinPage.jsx';
import { Spinner } from './components/ui.jsx';

function Protected({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <div className="center-page"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <span className="brand-mark" aria-hidden>↯</span> SplitLedger
      </Link>
      {user && (
        <div className="topbar-right">
          <span className="muted hide-sm">{user.name}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      )}
    </header>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Header />
        <main className="container">
          <Routes>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route path="/" element={<Protected><Dashboard /></Protected>} />
            <Route path="/join/:code" element={<Protected><JoinPage /></Protected>} />
            <Route path="/groups/:groupId" element={<Protected><GroupPage /></Protected>} />
            <Route path="*" element={<div className="empty"><h2>Page not found</h2><Link to="/">Go home</Link></div>} />
          </Routes>
        </main>
      </AuthProvider>
    </ToastProvider>
  );
}
