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

  useEffect(() => {
    if (session?.user) loadProfile(session.user.id);
    else setProfile(null);
  }, [session, loadProfile]);

  const login = async (username, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) throw new Error('Wrong username or password');
  };
  const logout = () => supabase.auth.signOut();

  const loading = session === undefined || (session && !profile);
  return (
    <Ctx.Provider value={{ session, profile, loading, login, logout, reloadProfile: () => loadProfile(session.user.id) }}>
      {children}
    </Ctx.Provider>
  );
}
