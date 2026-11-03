import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth';
import { uploadImage, removeImageByUrl } from '../lib/images';
import Avatar from '../components/Avatar';
import { HintCard } from '../components/ProfileView';

const empty = { name: '', description: '', url: '', image_url: null };

function HintForm({ initial, onSave, onCancel, uid }) {
  const [h, setH] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setH({ ...h, [k]: e.target.value });

  const pickImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true); setError('');
    try {
      const url = await uploadImage(file, `${uid}/hints/${crypto.randomUUID()}.jpg`);
      if (h.image_url) removeImageByUrl(h.image_url);
      setH({ ...h, image_url: url });
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (h.url && !/^https?:\/\//i.test(h.url)) return setError('The link must start with http:// or https://');
    setBusy(true); setError('');
    try { await onSave({ ...h, url: h.url || null, description: h.description || null }); }
    catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <form className="card" onSubmit={submit}>
      <label>Name<input value={h.name} onChange={set('name')} maxLength={80} required placeholder="e.g. Wireless headphones" /></label>
      <label>Description<textarea value={h.description || ''} onChange={set('description')} maxLength={500} rows={3} placeholder="Colour, size, brand…" /></label>
      <label>Link (optional)<input value={h.url || ''} onChange={set('url')} placeholder="https://…" /></label>
      <label>Image (optional)<input type="file" accept="image/*" onChange={pickImage} /></label>
      {h.image_url && <img className="preview" src={h.image_url} alt="" />}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save hint'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function MyProfile() {
  const { profile, reloadProfile } = useAuth();
  const [hints, setHints] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | hint id
  const [msg, setMsg] = useState('');
  const fileRef = useRef();

  const load = () => supabase.from('hints').select('*').eq('owner_id', profile.id).order('created_at')
    .then(({ data }) => setHints(data ?? []));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const changePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setMsg('Uploading…');
    try {
      const url = await uploadImage(file, `${profile.id}/avatar-${Date.now()}.jpg`);
      const { error } = await supabase.from('profiles').update({ photo_url: url }).eq('id', profile.id);
      if (error) throw error;
      removeImageByUrl(profile.photo_url);
      await reloadProfile();
      setMsg('Photo updated ✔');
    } catch (err) { setMsg(err.message); }
  };

  const save = async (h) => {
    const row = { name: h.name, description: h.description, url: h.url, image_url: h.image_url };
    const { error } = editing === 'new'
      ? await supabase.from('hints').insert({ ...row, owner_id: profile.id })
      : await supabase.from('hints').update(row).eq('id', editing);
    if (error) throw error;
    setEditing(null);
    load();
  };

  const remove = async (h) => {
    if (!confirm(`Delete "${h.name}"?`)) return;
    await supabase.from('hints').delete().eq('id', h.id);
    removeImageByUrl(h.image_url);
    load();
  };

  return (
    <>
      <h2>My profile</h2>
      <div className="card row">
        <Avatar url={profile.photo_url} name={profile.username} size={96} />
        <div>
          <strong>{profile.username}</strong>
          <p><button className="btn small" onClick={() => fileRef.current.click()}>Change photo</button></p>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={changePhoto} />
          {msg && <p className="muted">{msg}</p>}
        </div>
      </div>

      <div className="row spread">
        <h3>My gift hints</h3>
        {editing === null && <button className="btn small" onClick={() => setEditing('new')}>+ Add hint</button>}
      </div>
      <p className="muted">These are what your Secret Santa will see. Everyone can see them, but nobody knows who is drawing you.</p>

      {editing === 'new' && <HintForm initial={empty} uid={profile.id} onSave={save} onCancel={() => setEditing(null)} />}
      {hints === null ? <p>Loading…</p> : hints.length === 0 && editing !== 'new' && <p className="muted">No hints yet. Add some!</p>}
      <div className="hint-grid">
        {hints?.map((h) => editing === h.id
          ? <HintForm key={h.id} initial={h} uid={profile.id} onSave={save} onCancel={() => setEditing(null)} />
          : (
            <HintCard key={h.id} hint={h}>
              <div className="row">
                <button className="btn small ghost" onClick={() => setEditing(h.id)}>Edit</button>
                <button className="btn small danger" onClick={() => remove(h)}>Delete</button>
              </div>
            </HintCard>
          ))}
      </div>
    </>
  );
}
