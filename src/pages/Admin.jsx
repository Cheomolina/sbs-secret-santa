import { useEffect, useState } from 'react';
import { supabase, callAdmin } from '../lib/supabase';
import { useAuth } from '../auth';
import CreateUser from '../components/CreateUser';

// <input type="datetime-local"> works in local time without a zone.
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function EventPanel({ event, reload }) {
  const [date, setDate] = useState(toLocalInput(event.event_date));
  const [test, setTest] = useState(null);
  const [msg, setMsg] = useState('');
  const started = event.status === 'started';

  const run = async (fn, okMsg) => {
    setMsg('');
    try { await fn(); if (okMsg) setMsg(okMsg); await reload(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
  };

  const saveDate = () => run(async () => {
    const { error } = await supabase.rpc('set_event_date', { d: date ? new Date(date).toISOString() : null });
    if (error) throw error;
  }, 'Date saved ✔ — the draw runs automatically once it passes.');

  const runTest = () => run(async () => {
    const { data, error } = await supabase.rpc('test_draw');
    if (error) throw error;
    setTest(data);
  });

  const start = () => {
    if (!confirm('Run the draw NOW? Nobody can see the pairs, and users cannot be added or removed afterwards.')) return;
    run(async () => { const { error } = await supabase.rpc('start_event'); if (error) throw error; }, 'The draw is done 🎄');
  };

  const reset = () => {
    if (prompt('This ERASES the draw. Type RESET to confirm.') !== 'RESET') return;
    run(async () => { const { error } = await supabase.rpc('reset_event'); if (error) throw error; setTest(null); }, 'Event reset to draft.');
  };

  return (
    <section className="card">
      <h3>Event — <span className={`pill ${started ? 'green' : 'amber'}`}>{started ? 'Started' : 'Draft'}</span></h3>
      <div className="row">
        <label>Draw date &amp; time
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} disabled={started} />
        </label>
        <button className="btn" onClick={saveDate} disabled={started}>Save date</button>
      </div>
      <p className="muted">Automatic draw: once this date passes, the system runs the draw (checked every 5 minutes).</p>

      {!started && (
        <div className="row">
          <button className="btn ghost" onClick={runTest}>Run event test</button>
          <button className="btn" onClick={start}>Start draw now</button>
        </div>
      )}
      {started && <button className="btn danger" onClick={reset}>Reset event…</button>}
      {msg && <p className={msg.startsWith('Error') ? 'error' : 'ok'}>{msg}</p>}

      {test && (
        <div className="test">
          <h4>{test.ok ? '✅ All checks passed' : '⚠️ Some checks failed'}</h4>
          <ul>{test.checks.map((c) => <li key={c.name}>{c.pass ? '✔' : '✘'} {c.name}</li>)}</ul>
          {test.warnings.map((w) => <p key={w} className="muted">⚠ {w}</p>)}
          <p className="muted">The test writes nothing and reveals no names.</p>
        </div>
      )}
    </section>
  );
}

export default function Admin() {
  const { profile } = useAuth();
  const [event, setEvent] = useState(null);
  const [users, setUsers] = useState(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [{ data: ev }, { data: us }] = await Promise.all([
      supabase.from('event').select('*').eq('id', 1).single(),
      supabase.from('profiles').select('id, username, role, created_at').order('username'),
    ]);
    setEvent(ev); setUsers(us ?? []);
  };
  useEffect(() => { load(); }, []);

  const del = async (u) => {
    if (!confirm(`Delete user "${u.username}" and all their data?`)) return;
    try { await callAdmin({ action: 'delete', id: u.id }); setMsg(''); load(); } catch (e) { setMsg(`Error: ${e.message}`); }
  };
  const resetPw = async (u) => {
    const password = prompt(`New password for ${u.username} (min 8 characters):`);
    if (!password) return;
    try { await callAdmin({ action: 'set_password', id: u.id, password }); setMsg('Password changed ✔'); } catch (e) { setMsg(`Error: ${e.message}`); }
  };

  if (!event || !users) return <p>Loading…</p>;
  const started = event.status === 'started';

  return (
    <>
      <h2>Admin</h2>
      <EventPanel event={event} reload={load} />

      <section className="card">
        <h3>Users ({users.length})</h3>
        {started && <p className="muted">The event has started: users can't be added or removed. Reset the event to change them.</p>}
        <CreateUser onDone={load} disabled={started} />
        {msg && <p className={msg.startsWith('Error') ? 'error' : 'ok'}>{msg}</p>}
        <table>
          <thead><tr><th>Username</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}{u.id === profile.id && ' (you)'}</td>
                <td>{u.role}</td>
                <td className="actions">
                  <button className="btn small ghost" onClick={() => resetPw(u)}>Set password</button>
                  <button className="btn small danger" onClick={() => del(u)} disabled={started || u.id === profile.id}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
