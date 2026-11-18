import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth';
import Avatar from '../components/Avatar';
import ResultsCarousel, { buildSlides } from '../components/ResultsCarousel';
import { displayName, byName } from '../lib/names';

function DogCard({ dog, users, value, disabled, onPick, status, taken }) {
  const images = [dog.main_image_url, ...dog.gallery_urls];
  const [shown, setShown] = useState(0);
  return (
    <article className="dog">
      <div className="dog-photo">
        <img src={images[shown]} alt={dog.name} />
        {dog.is_example && <span className="pill amber example">Example</span>}
      </div>
      {images.length > 1 && (
        <div className="thumbs">
          {images.map((src, i) => (
            <button key={src + i} type="button" className={i === shown ? 'on' : ''} onClick={() => setShown(i)}>
              <img src={src} alt="" />
            </button>
          ))}
        </div>
      )}
      <div className="dog-body">
        <h4>{dog.name}</h4>
        <label>This is the spirit dog of…
          <select value={value || ''} disabled={disabled} onChange={(e) => onPick(dog.id, e.target.value || null)}>
            <option value="">— choose a colleague —</option>
            {users.map((u) => {
              const used = taken.has(u.id) && u.id !== value;
              return <option key={u.id} value={u.id} disabled={used}>{displayName(u)}{used ? ' (already chosen)' : ''}</option>;
            })}
          </select>
        </label>
        {status && <span className={status === 'saved' ? 'ok small' : 'error small'}>{status === 'saved' ? '✔ saved' : status}</span>}
      </div>
    </article>
  );
}

function Results({ dogs, people }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('slides');

  useEffect(() => {
    supabase.rpc('dog_poll_results').then(({ data, error: e }) => (e ? setError(e.message) : setRows(data)));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p>Loading results…</p>;
  const dogById = Object.fromEntries(dogs.map((d) => [d.id, d]));
  const sorted = rows
    .map((r) => ({ ...r, user: people.find((p) => p.id === r.user_id) }))
    .filter((r) => r.user)
    .sort((a, b) => byName(a.user, b.user));

  const slides = buildSlides(sorted, dogById);

  return (
    <section className="card results">
      <div className="row spread">
        <h3>🏆 Results</h3>
        {sorted.length > 0 && (
          <div className="seg">
            <button className={view === 'slides' ? 'on' : ''} onClick={() => setView('slides')}>Slideshow</button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
          </div>
        )}
      </div>
      {sorted.length === 0 && <p className="muted">Nobody got any votes.</p>}
      {view === 'slides' && <ResultsCarousel slides={slides} />}
      {view === 'list' && sorted.map((r) => (
        <div key={r.user_id} className="result-row">
          <div className="result-user">
            <Avatar url={r.user.photo_url} name={displayName(r.user)} size={44} />
            <strong>{displayName(r.user)}</strong>
          </div>
          <span className="looks">his/her spirit dog is</span>
          <div className="result-dogs">
            {r.dogs.map((d) => {
              const dog = dogById[d.dog_id];
              if (!dog) return null;
              return (
                <div key={d.dog_id} className="result-dog">
                  <img src={dog.main_image_url} alt={dog.name} />
                  <div>
                    <strong>{dog.name}</strong>
                    <div className="muted small">{d.votes} vote{d.votes === 1 ? '' : 's'}</div>
                  </div>
                </div>
              );
            })}
            {r.dogs.length > 1 && <span className="pill amber">Tie</span>}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function DogPoll() {
  const { profile, settings, reloadSettings } = useAuth();
  const [dogs, setDogs] = useState(null);
  const [people, setPeople] = useState([]);
  const [votes, setVotes] = useState({});
  const [status, setStatus] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      await reloadSettings();
      const [d, p, v] = await Promise.all([
        supabase.from('dogs').select('*').order('created_at'),
        supabase.from('profiles').select('id, username, nickname, photo_url'),
        supabase.from('dog_votes').select('dog_id, voted_user_id'),
      ]);
      const failure = d.error || p.error || v.error;
      if (failure) setError(`${failure.message}. Run the latest supabase/schema.sql in the SQL Editor.`);
      setDogs(d.data ?? []);
      setPeople((p.data ?? []).sort(byName));
      setVotes(Object.fromEntries((v.data ?? []).map((x) => [x.dog_id, x.voted_user_id])));
    })();
  }, []); // eslint-disable-line

  const others = useMemo(() => people.filter((p) => p.id !== profile.id), [people, profile.id]);
  const revealed = settings.dog_poll_revealed;
  const taken = useMemo(() => new Set(Object.values(votes).filter(Boolean)), [votes]);

  const pick = async (dogId, userId) => {
    setVotes((v) => ({ ...v, [dogId]: userId || undefined }));
    const { error: e } = await supabase.rpc('cast_vote', { p_dog: dogId, p_user: userId });
    setStatus((s) => ({ ...s, [dogId]: e ? e.message : 'saved' }));
  };

  if (!dogs) return <p>Loading…</p>;
  const done = dogs.filter((d) => votes[d.id]).length;

  return (
    <>
      <Link to="/games">← Games</Link>
      <h2>🐶 The Dog Poll</h2>
      {!settings.games_visible && (
        <div className="banner warn">🔒 Only you (the admin) can see this. Your votes count like everybody&apos;s; wipe them from Admin → Games.</div>
      )}
      {error && <p className="error">{error}</p>}

      {revealed
        ? <div className="banner">Voting is closed. Here are the results!</div>
        : (
          <p>
            Pick the colleague each dog is the spirit dog of. Your choices are <strong>private</strong>: nobody sees them until the results are revealed.
            You&apos;ve voted on <strong>{done}</strong> of <strong>{dogs.length}</strong> dogs.
          </p>
        )}

      {revealed && <Results dogs={dogs} people={people} />}

      {revealed && dogs.length > 0 && <h3>Your votes</h3>}
      {dogs.length === 0 && <p className="muted">No dogs yet.</p>}
      <div className="dog-grid">
        {dogs.map((d) => (
          <DogCard key={d.id} dog={d} users={others} value={votes[d.id]} disabled={revealed}
            onPick={pick} status={status[d.id]} taken={taken} />
        ))}
      </div>

      {dogs.length > 0 && (
        <section className="card">
          <h3>Your choices</h3>
          {done === 0 && <p className="muted">You haven&apos;t chosen anyone yet.</p>}
          <ul className="choice-list">
            {dogs.filter((d) => votes[d.id]).map((d) => {
              const person = people.find((p) => p.id === votes[d.id]);
              return (
                <li key={d.id}>
                  <span><strong>{person ? displayName(person) : '?'}</strong> → {d.name}</span>
                  {!revealed && <button className="btn small ghost danger" onClick={() => pick(d.id, null)}>Clear</button>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
