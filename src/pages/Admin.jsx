import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, callAdmin } from '../lib/supabase';
import { useAuth } from '../auth';
import CreateUser from '../components/CreateUser';

const MIN_LEAVERS = 2; // keep in sync with min_leavers in repair_event() (schema.sql)
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : 'not set');

function EventPanel({ event, leavers, reload }) {
  const [test, setTest] = useState(null);
  const [msg, setMsg] = useState('');
  const started = event.status === 'started';

  const run = async (fn, okMsg) => {
    setMsg('');
    try { await fn(); if (okMsg) setMsg(okMsg); await reload(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
  };
  const rpc = async (name, args) => { const { data, error } = await supabase.rpc(name, args); if (error) throw error; return data; };

  const runTest = () => run(async () => setTest(await rpc('test_draw')));

  const start = () => {
    if (!confirm('Run the draw NOW? Nobody can see the pairs, and users cannot be added or removed afterwards.')) return;
    run(() => rpc('start_event'), 'The draw is done 🎄');
  };

  const reset = () => {
    if (prompt('This ERASES the draw. Type RESET to confirm.') !== 'RESET') return;
    run(async () => { await rpc('reset_event'); setTest(null); }, 'Event reset to draft.');
  };

  const replace = () => {
    if (!confirm(`${leavers} participants have left. Re-pair the people left without a giver or giftee? Everybody else keeps their target.`)) return;
    run(async () => { const r = await rpc('repair_event'); setMsg(`Done: ${r.repaired} new pair(s) created ✔`); });
  };

  const next = () => {
    if (prompt(`This closes "${event.name}" (kept as history, used to avoid repeats) and opens next year's event. Everyone is turned back on. Type NEXT to confirm.`) !== 'NEXT') return;
    run(async () => { await rpc('start_next_event'); setTest(null); }, "Next year's event is ready ✔ — set its details on the Event page.");
  };

  return (
    <section className="card">
      <h3>{event.name} — <span className={`pill ${started ? 'green' : 'amber'}`}>{started ? 'Started' : 'Draft'}</span></h3>
      <p className="muted">
        Draw date: {fmt(event.draw_date)} · <Link to="/event">edit event details</Link>. The draw runs automatically once the date passes (checked every 5 minutes).
      </p>

      {!started && (
        <div className="row wrap">
          <button className="btn ghost" onClick={runTest}>Run event test</button>
          <button className="btn" onClick={start}>Start draw now</button>
        </div>
      )}

      {started && (
        <>
          <div className="subcard">
            <h4>Replace system</h4>
            <p className="muted">
              If people drop out, turn them <strong>off</strong> in the list below. Once at least {MIN_LEAVERS} have left, you can re-pair the
              people who lost their giver or giftee; everyone else keeps their target.
            </p>
            <p>Participants who have left: <strong>{leavers}</strong></p>
            <button className="btn" onClick={replace} disabled={leavers < MIN_LEAVERS}>
              Replace participants
            </button>
            {leavers < MIN_LEAVERS && <span className="muted"> &nbsp;Needs at least {MIN_LEAVERS}.</span>}
          </div>
          <div className="row wrap">
            <button className="btn" onClick={next}>Close event &amp; start next year…</button>
            <button className="btn ghost danger" onClick={reset}>Reset event…</button>
          </div>
        </>
      )}
      {msg && <p className={msg.startsWith('Error') ? 'error' : 'ok'}>{msg}</p>}

      {test && (
        <div className="test">
          <h4>{test.ok ? '✅ All checks passed' : '⚠️ Some checks failed'}</h4>
          <ul>{test.checks.map((c) => <li key={c.name}>{c.pass ? '✔' : '✘'} {c.name}</li>)}</ul>
          {test.warnings.map((w) => <p key={w} className="muted">⚠ {w}</p>)}
          {test.sample?.length > 0 && (
            <>
              <h4>Sample draw (test only)</h4>
              <table>
                <thead><tr><th>Giver</th><th></th><th>Receiver</th></tr></thead>
                <tbody>
                  {test.sample.map((p) => (
                    <tr key={p.giver}><td>{p.giver}</td><td>→</td><td>{p.receiver}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="muted">This is only a test: nothing is saved, and the real draw will be completely different. Run it again for a new sample.</p>
        </div>
      )}
    </section>
  );
}

export default function Admin() {
  const { profile } = useAuth();
  const [event, setEvent] = useState(null);
  const [history, setHistory] = useState([]);
  const [users, setUsers] = useState(null);
  const [leavers, setLeavers] = useState(0);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [{ data: evs }, { data: us }] = await Promise.all([
      supabase.from('events').select('*').order('id', { ascending: false }),
      supabase.from('profiles').select('id, username, role, active, created_at').order('username'),
    ]);
    const current = evs?.find((e) => e.status !== 'archived');
    setEvent(current);
    setHistory(evs?.filter((e) => e.status === 'archived') ?? []);
    setUsers(us ?? []);
    if (current?.status === 'started') {
      const { data } = await supabase.rpc('leavers_count');
      setLeavers(data ?? 0);
    } else setLeavers(0);
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
  const toggle = async (u) => {
    const { error } = await supabase.rpc('set_participant_active', { uid: u.id, flag: !u.active });
    setMsg(error ? `Error: ${error.message}` : '');
    load();
  };

  if (!event || !users) return <p>Loading…</p>;
  const started = event.status === 'started';
  const activeCount = users.filter((u) => u.active).length;

  return (
    <>
      <h2>Admin</h2>
      <EventPanel event={event} leavers={leavers} reload={load} />

      <section className="card">
        <h3>Users ({users.length}) — {activeCount} taking part</h3>
        {started && <p className="muted">The event has started: users can't be added or deleted. Use <strong>Turn off</strong> for people who drop out.</p>}
        <CreateUser onDone={load} disabled={started} />
        {msg && <p className={msg.startsWith('Error') ? 'error' : 'ok'}>{msg}</p>}
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'off'}>
                <td>{u.username}{u.id === profile.id && ' (you)'}</td>
                <td>{u.role}</td>
                <td><span className={`pill ${u.active ? 'green' : 'grey'}`}>{u.active ? 'On' : 'Off'}</span></td>
                <td className="actions">
                  <button className="btn small ghost" onClick={() => toggle(u)}>{u.active ? 'Turn off' : 'Turn on'}</button>
                  <button className="btn small ghost" onClick={() => resetPw(u)}>Set password</button>
                  <button className="btn small danger" onClick={() => del(u)} disabled={started || u.id === profile.id}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {history.length > 0 && (
        <section className="card">
          <h3>Past events</h3>
          <p className="muted">Last year&apos;s pairs are used to avoid repeats in the next draw.</p>
          <ul>
            {history.map((h) => <li key={h.id}>{h.name} — drawn {h.started_at ? new Date(h.started_at).toLocaleDateString() : '—'}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}
