import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth';
import ProfileView from '../components/ProfileView';

function useCountdown(date) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!date) return null;
  const ms = new Date(date).getTime() - now;
  if (ms <= 0) return { done: true };
  const s = Math.floor(ms / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor(s / 3600) % 24, mins: Math.floor(s / 60) % 60, secs: s % 60 };
}

export default function Home() {
  const { profile } = useAuth();
  const [event, setEvent] = useState(null);
  const [target, setTarget] = useState(undefined);
  const cd = useCountdown(event?.event_date);

  useEffect(() => {
    (async () => {
      const { data: ev } = await supabase.from('event').select('*').eq('id', 1).single();
      setEvent(ev);
      if (ev?.status === 'started') {
        const { data: a } = await supabase.from('assignments').select('receiver_id').maybeSingle();
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
        <div className="banner">🎄 The draw is done! You are the Secret Santa of…</div>
        {target ? <ProfileView profile={target} /> : <p>No assignment was found for you. Please contact the admin.</p>}
      </>
    );
  }

  return (
    <div className="center-card wide">
      <div className="big-emoji">⏳</div>
      <h1>Hi {profile.username}!</h1>
      <p>The draw hasn't happened yet. Meanwhile, add your photo and gift hints in <strong>My profile</strong> so your Secret Santa knows what to get you.</p>
      {event.event_date ? (
        <>
          <p className="muted">Draw date: {new Date(event.event_date).toLocaleString()}</p>
          {cd && !cd.done && (
            <div className="countdown">
              {[['days', cd.days], ['hours', cd.hours], ['min', cd.mins], ['sec', cd.secs]].map(([l, v]) => (
                <div key={l}><b>{v}</b><span>{l}</span></div>
              ))}
            </div>
          )}
          {cd?.done && <p>The draw is about to happen — refresh in a few minutes.</p>}
        </>
      ) : <p className="muted">The draw date hasn't been set yet.</p>}
    </div>
  );
}
