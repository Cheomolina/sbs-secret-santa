import { useState } from 'react';
import { callAdmin } from '../lib/supabase';

export default function CreateUser({ onDone, disabled }) {
  const [f, setF] = useState({ username: '', password: '', role: 'user' });
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setMsg('');
    try {
      await callAdmin({ action: 'create', ...f });
      setF({ username: '', password: '', role: 'user' });
      setMsg('User created ✔');
      onDone();
    } catch (err) { setMsg(`Error: ${err.message}`); }
  };

  return (
    <form className="row wrap" onSubmit={submit}>
      <label>Username<input value={f.username} onChange={set('username')} required disabled={disabled} /></label>
      <label>Password<input type="text" value={f.password} onChange={set('password')} minLength={8} required disabled={disabled} /></label>
      <label>Role
        <select value={f.role} onChange={set('role')} disabled={disabled}><option value="user">User</option><option value="admin">Admin</option></select>
      </label>
      <button className="btn" disabled={disabled}>Create user</button>
      {msg && <p className={msg.startsWith('Error') ? 'error' : 'ok'}>{msg}</p>}
    </form>
  );
}
