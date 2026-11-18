import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth';
import ProfileView from '../components/ProfileView';
import { displayName } from '../lib/names';

function useCountdown(date) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!date) return null;
  const ms = new Date(date).getTime() - now;
  if (ms <= 0) return { done: true };
  const s = Math.floor(ms / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor(s / 3600) % 24, mins: Math.floor(s / 60) % 60, secs: s % 60 };
}

function Summary({ event }) {
  const items = [
    event.exchange_date && ['📅', new Date(event.exchange_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })],
    event.place && ['📍', event.place],
    event.budget && ['💶', event.budget],
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="summary">
      {items.map(([i, t]) => <span key={i}>{i} {t}</span>)}
      <Link to="/event">All details →</Link>
    </div>
  );
}

export default function Home() {
  const { profile } = useAuth();
  const [event, setEvent] = useState(null);
  const [target, setTarget] = useState(undefined);
  const cd = useCountdown(event?.draw_date);

  useEffect(() => {
    (async () => {
      const { data: ev } = await supabase.from('events').select('*').neq('status', 'archived').single();
      setEvent(ev);
      if (ev?.status === 'started') {
        const { data: a } = await supabase.from('assignments').select('receiver_id').eq('event_id', ev.id).maybeSingle();
        if (a) {
          const { data: t } = await supabase.from('profiles').select('*, hints(*)').eq('id', a.receiver_id).single();
          setTarget(t);
        } else setTarget(null);
      }
    })();
  }, []);

  if (!event) return <p>Loading…</p>;

  if (event.status === 'started') {
    return (
      <>
        <Summary event={event} />
        {!profile.active && <div className="banner warn">You are currently marked as not taking part in this event.</div>}
        {target && !target.active && (
          <div className="banner warn">
            🎁 The person you were drawn for ({displayName(target)}) has left the event. The admin will re-pair
            people soon; check back here to see your new target.
          </div>
        )}
        {target === null && profile.active && (
          <div className="banner warn">You don&apos;t have a target at the moment. If someone left, the admin is still re-pairing; check back soon.</div>
        )}
        {target && target.active && <div className="banner">🎄 The draw is done! You are the Secret Santa of…</div>}
        {target && <ProfileView profile={target} />}
      </>
    );
  }

  return (
    <div className="center-card wide">
      <div className="big-emoji">⏳</div>
      <h1>{event.name}</h1>
      <p>Hi {displayName(profile)}! The draw hasn&apos;t happened yet. Meanwhile, add your photo and wishlist in <strong>My profile</strong> so your Secret Santa knows what to get you.</p>
      <Summary event={event} />
      {event.draw_date ? (
        <>
          <p className="muted">Draw date: {new Date(event.draw_date).toLocaleString()}</p>
          {cd && !cd.done && (
            <div className="countdown">
              {[['days', cd.days], ['hours', cd.hours], ['min', cd.mins], ['sec', cd.secs]].map(([l, v]) => (
                <div key={l}><b>{v}</b><span>{l}</span></div>
              ))}
            </div>
          )}
          {cd?.done && <p>The draw is about to happen — refresh in a few minutes.</p>}
        </>
      ) : <p className="muted">The draw date hasn&apos;t been set yet.</p>}
      {!profile.active && <p className="error">You are currently marked as not taking part, so you won&apos;t be in the draw.</p>}
    </div>
  );
}
