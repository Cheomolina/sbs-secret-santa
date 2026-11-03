import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import Avatar from './Avatar';

export default function Layout({ children }) {
  const { profile, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <span className="brand">🎅 Secret Santa</span>
        <nav>
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/participants">Participants</NavLink>
          <NavLink to="/me">My profile</NavLink>
          {profile.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="who">
          <Avatar url={profile.photo_url} name={profile.username} size={30} />
          <span>{profile.username}</span>
          <button className="btn small ghost" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
