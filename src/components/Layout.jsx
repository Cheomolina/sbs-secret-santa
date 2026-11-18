import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import Avatar from './Avatar';
import { displayName } from '../lib/names';

export default function Layout({ children }) {
  const { profile, logout, showGames, settings } = useAuth();
  return (
    <>
      <header className="topbar">
        <span className="brand">🎅 Secret Santa</span>
        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/event">Event</NavLink>
          <NavLink to="/participants">Participants</NavLink>
          {showGames && (
            <NavLink to="/games">Games{!settings.games_visible && <span className="lock" title="Only visible to you (admin)"> 🔒</span>}</NavLink>
          )}
          <NavLink to="/me">My profile</NavLink>
          {profile.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="who">
          <Avatar url={profile.photo_url} name={displayName(profile)} size={30} />
          <span>{displayName(profile)}</span>
          <button className="btn small ghost" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
