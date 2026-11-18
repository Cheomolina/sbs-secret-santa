import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { usernameToEmail } from './lib/config';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadProfile = useCallback(async (uid) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    setProfile(data);
  }, []);

  // Games switches: games_visible (menu open to users) and dog_poll_revealed (results public).
  const [settings, setSettings] = useState({ games_visible: false, dog_poll_revealed: false });
  const reloadSettings = useCallback(async () => {
    const { data } = await supabase.from('game_settings').select('*').eq('id', 1).maybeSingle();
    if (data) setSettings(data);
  }, []);

  useEffect(() => {
    if (session?.user) { loadProfile(session.user.id); reloadSettings(); }
    else setProfile(null);
  }, [session, loadProfile, reloadSettings]);

  const login = async (username, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) throw new Error('Wrong username or password');
  };
  const logout = () => supabase.auth.signOut();

  const loading = session === undefined || (session && !profile);
  const showGames = profile?.role === 'admin' || settings.games_visible;
  return (
    <Ctx.Provider value={{ session, profile, loading, login, logout, settings, reloadSettings, showGames,
      reloadProfile: () => loadProfile(session.user.id) }}>
      {children}
    </Ctx.Provider>
  );
}
