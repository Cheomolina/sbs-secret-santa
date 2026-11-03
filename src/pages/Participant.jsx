import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import ProfileView from '../components/ProfileView';

export default function Participant() {
  const { id } = useParams();
  const [p, setP] = useState(undefined);
  useEffect(() => {
    supabase.from('profiles').select('*, hints(*)').eq('id', id).maybeSingle()
      .then(({ data }) => setP(data));
  }, [id]);

  if (p === undefined) return <p>Loading…</p>;
  if (!p) return <p>Participant not found.</p>;
  return (<><Link to="/participants">← All participants</Link><ProfileView profile={p} /></>);
}
