import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import Avatar from '../components/Avatar';

export default function Participants() {
  const [people, setPeople] = useState(null);
  useEffect(() => {
    supabase.from('profiles').select('id, username, photo_url, hints(id)').order('username')
      .then(({ data }) => setPeople(data ?? []));
  }, []);

  if (!people) return <p>Loading…</p>;
  return (
    <>
      <h2>Participants ({people.length})</h2>
      <div className="people-grid">
        {people.map((p) => (
          <Link key={p.id} to={`/participants/${p.id}`} className="person">
            <Avatar url={p.photo_url} name={p.username} size={72} />
            <strong>{p.username}</strong>
            <span className="muted">{p.hints.length} hint{p.hints.length === 1 ? '' : 's'}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
