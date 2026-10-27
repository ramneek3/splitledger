import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../context.jsx';
import { ErrorBox, Spinner } from '../components/ui.jsx';

/** Landing page for shared invite links: /join/ABCD2345 */
export default function JoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [error, setError] = useState(null);
  const started = useRef(false); // StrictMode runs effects twice in dev; join only once

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api('/groups/join', { method: 'POST', body: { code } })
      .then(({ group }) => {
        toast(`Joined “${group.name}”`);
        navigate(`/groups/${group.id}`, { replace: true });
      })
      .catch((err) => {
        if (err.code === 'ALREADY_MEMBER') navigate(`/groups/${err.details.groupId}`, { replace: true });
        else setError(err);
      });
  }, [code, navigate, toast]);

  return (
    <div className="center-page stack">
      {error ? <><ErrorBox error={error} /><Link to="/">Back to your groups</Link></> : <><Spinner /><p className="muted">Joining group…</p></>}
    </div>
  );
}
