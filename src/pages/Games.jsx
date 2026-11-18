import { Link } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Games() {
  const { settings } = useAuth();
  return (
    <>
      <h2>Games</h2>
      {!settings.games_visible && (
        <div className="banner warn">🔒 Only you (the admin) can see this section. Open it to everyone from Admin → Games.</div>
      )}
      <div className="people-grid">
        <Link to="/games/dog-poll" className="person game-card">
          <span className="big-emoji">🐶</span>
          <strong>The Dog Poll</strong>
          <span className="muted small">Which colleague does each dog look like?</span>
        </Link>
      </div>
    </>
  );
}
