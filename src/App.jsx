import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth';
import { configured } from './lib/supabase';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import Participants from './pages/Participants';
import Participant from './pages/Participant';
import MyProfile from './pages/MyProfile';
import Admin from './pages/Admin';

export default function App() {
  const { session, profile, loading } = useAuth();

  if (!configured) {
    return <div className="center-card"><h1>Not configured</h1><p>Missing Supabase settings. See the README.</p></div>;
  }
  if (loading) return <div className="center-card"><p>Loading…</p></div>;
  if (!session) return <Login />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/participants" element={<Participants />} />
        <Route path="/participants/:id" element={<Participant />} />
        <Route path="/me" element={<MyProfile />} />
        {profile?.role === 'admin' && <Route path="/admin" element={<Admin />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
