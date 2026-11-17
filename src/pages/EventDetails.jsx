import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth';

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }) : null);

function Row({ icon, label, children }) {
  return (
    <div className="detail-row">
      <span className="detail-icon">{icon}</span>
      <div><div className="muted small">{label}</div><div>{children || <span className="muted">Not set yet</span>}</div></div>
    </div>
  );
}

function EditForm({ event, onSaved, onCancel }) {
  const [f, setF] = useState({
    name: event.name,
    draw_date: toLocalInput(event.draw_date),
    exchange_date: toLocalInput(event.exchange_date),
    place: event.place || '',
    budget: event.budget || '',
    notes: event.notes || '',
    avoid_repeats: event.avoid_repeats,
  });
  const [msg, setMsg] = useState('');
  const draft = event.status === 'draft';
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setMsg('');
    const iso = (v) => (v ? new Date(v).toISOString() : null);
    const { error } = await supabase.rpc('set_event_details', {
      p_name: f.name, p_draw_date: iso(f.draw_date), p_exchange_date: iso(f.exchange_date),
      p_place: f.place, p_budget: f.budget, p_notes: f.notes, p_avoid_repeats: f.avoid_repeats,
    });
    if (error) return setMsg(`Error: ${error.message}`);
    onSaved();
  };

  return (
    <form className="card" onSubmit={submit}>
      <label>Event name<input value={f.name} onChange={set('name')} maxLength={80} required /></label>
      <label>Gift exchange date &amp; time<input type="datetime-local" value={f.exchange_date} onChange={set('exchange_date')} /></label>
      <label>Place<input value={f.place} onChange={set('place')} maxLength={200} placeholder="e.g. Office, 3rd floor kitchen" /></label>
      <label>Budget<input value={f.budget} onChange={set('budget')} maxLength={100} placeholder="e.g. 20 € per gift" /></label>
      <label>Notes / rules<textarea rows={3} value={f.notes} onChange={set('notes')} maxLength={1000} placeholder="Wrapping, dress code, anything people should know" /></label>
      <hr />
      <label>Draw date &amp; time (automatic draw)
        <input type="datetime-local" value={f.draw_date} onChange={set('draw_date')} disabled={!draft} />
      </label>
      <label className="check">
        <input type="checkbox" checked={f.avoid_repeats} disabled={!draft}
          onChange={(e) => setF({ ...f, avoid_repeats: e.target.checked })} />
        Avoid repeating last year&apos;s pairs
      </label>
      {!draft && <p className="muted">The draw date and the repeat rule are locked once the draw is done.</p>}
      {msg && <p className="error">{msg}</p>}
      <div className="row">
        <button className="btn">Save</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function EventDetails() {
  const { profile } = useAuth();
  const [event, setEvent] = useState(null);
  const [editing, setEditing] = useState(false);

  const load = () => supabase.from('events').select('*').neq('status', 'archived').single().then(({ data }) => setEvent(data));
  useEffect(() => { load(); }, []);

  if (!event) return <p>Loading…</p>;
  return (
    <>
      <div className="row spread">
        <h2>{event.name}</h2>
        {profile.role === 'admin' && !editing && <button className="btn small" onClick={() => setEditing(true)}>Edit details</button>}
      </div>
      {editing ? (
        <EditForm event={event} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      ) : (
        <section className="card">
          <Row icon="📅" label="Gift exchange">{fmt(event.exchange_date)}</Row>
          <Row icon="📍" label="Place">{event.place}</Row>
          <Row icon="💶" label="Budget">{event.budget}</Row>
          <Row icon="🎲" label="Draw date">{event.status === 'started' ? 'The draw is done 🎄' : fmt(event.draw_date)}</Row>
          {event.notes && <Row icon="📝" label="Notes"><span className="pre">{event.notes}</span></Row>}
          {event.avoid_repeats && <p className="muted small">Last year&apos;s pairs are avoided in the draw.</p>}
        </section>
      )}
    </>
  );
}
