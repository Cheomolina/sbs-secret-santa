import Avatar from './Avatar';
import { displayName } from '../lib/names';

export function HintCard({ hint, children }) {
  return (
    <article className="hint">
      {hint.image_url && <img src={hint.image_url} alt={hint.name} loading="lazy" />}
      <div className="hint-body">
        <h4>{hint.name}</h4>
        {hint.description && <p>{hint.description}</p>}
        {hint.url && <a href={hint.url} target="_blank" rel="noopener noreferrer">View link ↗</a>}
        {children}
      </div>
    </article>
  );
}

export default function ProfileView({ profile }) {
  const hints = profile.hints ?? [];
  return (
    <section>
      <div className="profile-head">
        <Avatar url={profile.photo_url} name={displayName(profile)} size={96} />
        <h2>{displayName(profile)}</h2>
      </div>
      <h3>Wishlist</h3>
      {hints.length === 0 && <p className="muted">The wishlist is empty so far.</p>}
      <div className="hint-grid">{hints.map((h) => <HintCard key={h.id} hint={h} />)}</div>
    </section>
  );
}
