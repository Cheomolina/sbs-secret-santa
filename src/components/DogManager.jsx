import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth';
import { uploadImage, removeImageByUrl } from '../lib/images';

const newPath = (uid) => `${uid}/dogs/${crypto.randomUUID()}.jpg`;

export default function DogManager() {
  const { profile } = useAuth();
  const [dogs, setDogs] = useState(null);
  const [name, setName] = useState('');
  const [main, setMain] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const formRef = useRef();

  const load = () => supabase.from('dogs').select('*').order('created_at').then(({ data, error }) => {
    if (error) setMsg(`Error: ${error.message}`);
    setDogs(data ?? []);
  });
  useEffect(() => { load(); }, []);

  const guard = async (fn, ok) => {
    setBusy(true); setMsg('');
    try { await fn(); if (ok) setMsg(ok); await load(); }
    catch (e) { setMsg(`Error: ${e.message}`); }
    setBusy(false);
  };

  const add = (e) => {
    e.preventDefault();
    if (!main) return setMsg('Error: choose a main image');
    guard(async () => {
      const main_image_url = await uploadImage(main, newPath(profile.id));
      const gallery_urls = [];
      for (const f of gallery) gallery_urls.push(await uploadImage(f, newPath(profile.id)));
      const { error } = await supabase.from('dogs').insert({ name: name.trim(), main_image_url, gallery_urls });
      if (error) throw error;
      setName(''); setMain(null); setGallery([]); formRef.current.reset();
    }, 'Dog added ✔');
  };

  const update = async (id, patch) => {
    const { error } = await supabase.from('dogs').update(patch).eq('id', id);
    if (error) throw error;
  };

  const rename = (d) => {
    const n = prompt('Dog name:', d.name);
    if (n?.trim()) guard(() => update(d.id, { name: n.trim() }));
  };

  const addGallery = (d, files) => guard(async () => {
    const urls = [];
    for (const f of files) urls.push(await uploadImage(f, newPath(profile.id)));
    await update(d.id, { gallery_urls: [...d.gallery_urls, ...urls] });
  });

  const removeGallery = (d, url) => guard(async () => {
    await update(d.id, { gallery_urls: d.gallery_urls.filter((u) => u !== url) });
    removeImageByUrl(url);
  });

  const replaceMain = (d, file) => guard(async () => {
    const url = await uploadImage(file, newPath(profile.id));
    await update(d.id, { main_image_url: url });
    removeImageByUrl(d.main_image_url);
  });

  const del = (d) => {
    if (!confirm(`Delete "${d.name}" and all the votes it received?`)) return;
    guard(async () => {
      const { error } = await supabase.from('dogs').delete().eq('id', d.id);
      if (error) throw error;
      [d.main_image_url, ...d.gallery_urls].forEach(removeImageByUrl);
    });
  };

  return (
    <div className="subcard">
      <h4>Dogs</h4>
      <form ref={formRef} className="row wrap" onSubmit={add}>
        <label>Title<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="e.g. Rex" /></label>
        <label>Main image<input type="file" accept="image/*" onChange={(e) => setMain(e.target.files[0])} required /></label>
        <label>Gallery (optional, several)<input type="file" accept="image/*" multiple onChange={(e) => setGallery([...e.target.files].slice(0, 12))} /></label>
        <button className="btn" disabled={busy}>{busy ? 'Working…' : 'Add dog'}</button>
      </form>
      {msg && <p className={msg.startsWith('Error') ? 'error' : 'ok'}>{msg}</p>}

      {!dogs ? <p>Loading…</p> : dogs.length === 0 && <p className="muted">No dogs yet.</p>}
      <div className="manager-list">
        {dogs?.map((d) => (
          <div key={d.id} className="manager-dog">
            <img className="manager-main" src={d.main_image_url} alt={d.name} />
            <div className="manager-info">
              <strong>{d.name}</strong> {d.is_example && <span className="pill amber">Example</span>}
              <div className="thumbs">
                {d.gallery_urls.map((u) => (
                  <span key={u} className="thumb-x">
                    <img src={u} alt="" />
                    <button type="button" title="Remove" onClick={() => removeGallery(d, u)} disabled={busy}>×</button>
                  </span>
                ))}
              </div>
              <div className="row wrap">
                <button className="btn small ghost" onClick={() => rename(d)} disabled={busy}>Rename</button>
                <label className="btn small ghost filebtn">Add gallery images
                  <input type="file" accept="image/*" multiple hidden
                    onChange={(e) => { addGallery(d, [...e.target.files]); e.target.value = ''; }} />
                </label>
                <label className="btn small ghost filebtn">Replace main image
                  <input type="file" accept="image/*" hidden
                    onChange={(e) => { if (e.target.files[0]) replaceMain(d, e.target.files[0]); e.target.value = ''; }} />
                </label>
                <button className="btn small danger" onClick={() => del(d)} disabled={busy}>Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
