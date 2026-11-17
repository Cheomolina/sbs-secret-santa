import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, callAdmin } from '../lib/supabase';
import { useAuth } from '../auth';
import Avatar from '../components/Avatar';
import CreateUser from '../components/CreateUser';
import { displayName, byName } from '../lib/names';

export default function Participants() {
  const { profile } = useAuth();
  const isAdmin = profile.role === 'admin';
  const [people, setPeople] = useState(null);
  const [started, setStarted] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [{ data }, { data: ev }] = await Promise.all([
      supabase.from('profiles').select('id, username, nickname, photo_url, role, active, hints(id)'),
      supabase.from('events').select('status').neq('status', 'archived').single(),
    ]);
    setPeople((data ?? []).sort(byName));
    setStarted(ev?.status === 'started');
  };
  useEffect(() => { load(); }, []);

  const del = async (p) => {
    if (!confirm(`Delete "${displayName(p)}" and all their hints and photos?`)) return;
    try { await callAdmin({ action: 'delete', id: p.id }); setMsg(''); load(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
  };

  if (!people) return <p>Loading…</p>;
  const taking = people.filter((p) => p.active).length;
  return (
    <>
      <h2>Participants ({taking}{taking !== people.length && ` of ${people.length}`})</h2>

      {isAdmin && (
        <section className="card">
          <h3>Add participant</h3>
          {started && <p className="muted">The event has started, so participants can&apos;t be added or deleted. Turn people off in the Admin page, or reset the event.</p>}
          <CreateUser onDone={load} disabled={started} />
          {msg && <p className="error">{msg}</p>}
        </section>
      )}

      <div className="people-grid">
        {people.map((p) => (
          <div key={p.id} className={`person-wrap ${p.active ? '' : 'off'}`}>
            <Link to={`/participants/${p.id}`} className="person">
              <Avatar url={p.photo_url} name={displayName(p)} size={72} />
              <strong>{displayName(p)}{p.role === 'admin' && ' ⭐'}</strong>
              {p.active
                ? <span className="muted">{p.hints.length} hint{p.hints.length === 1 ? '' : 's'}</span>
                : <span className="pill grey">Not taking part</span>}
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
