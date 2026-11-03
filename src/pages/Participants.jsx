import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, callAdmin } from '../lib/supabase';
import { useAuth } from '../auth';
import Avatar from '../components/Avatar';
import CreateUser from '../components/CreateUser';

export default function Participants() {
  const { profile } = useAuth();
  const isAdmin = profile.role === 'admin';
  const [people, setPeople] = useState(null);
  const [started, setStarted] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [{ data }, { data: ev }] = await Promise.all([
      supabase.from('profiles').select('id, username, photo_url, role, hints(id)').order('username'),
      supabase.from('event').select('status').eq('id', 1).single(),
    ]);
    setPeople(data ?? []);
    setStarted(ev?.status === 'started');
  };
  useEffect(() => { load(); }, []);

  const del = async (p) => {
    if (!confirm(`Delete "${p.username}" and all their hints and photos?`)) return;
    try { await callAdmin({ action: 'delete', id: p.id }); setMsg(''); load(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
  };

  if (!people) return <p>Loading…</p>;
  return (
    <>
      <h2>Participants ({people.length})</h2>

      {isAdmin && (
        <section className="card">
          <h3>Add participant</h3>
          {started && <p className="muted">The event has started, so participants can't be added or deleted. Reset it in the Admin page first.</p>}
          <CreateUser onDone={load} disabled={started} />
          {msg && <p className="error">{msg}</p>}
        </section>
      )}

      <div className="people-grid">
        {people.map((p) => (
          <div key={p.id} className="person-wrap">
            <Link to={`/participants/${p.id}`} className="person">
              <Avatar url={p.photo_url} name={p.username} size={72} />
              <strong>{p.username}{p.role === 'admin' && ' ⭐'}</strong>
              <span className="muted">{p.hints.length} hint{p.hints.length === 1 ? '' : 's'}</span>
            </Link>
            {isAdmin && p.id !== profile.id && (
              <button className="btn small danger" onClick={() => del(p)} disabled={started}>Delete</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
