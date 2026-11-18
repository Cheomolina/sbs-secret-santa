import { useCallback, useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { displayName } from '../lib/names';

// Slide order per user: [user] -> [winning dog] -> [that dog's gallery...] -> (next winning dog if tie) -> next user.
export function buildSlides(rows, dogById) {
  const slides = [];
  for (const r of rows) {
    slides.push({ type: 'user', user: r.user, dogs: r.dogs.length });
    for (const d of r.dogs) {
      const dog = dogById[d.dog_id];
      if (!dog) continue;
      slides.push({ type: 'dog', dog, votes: d.votes, tie: r.dogs.length > 1, user: r.user });
      dog.gallery_urls.forEach((src, i) =>
        slides.push({ type: 'gallery', dog, src, n: i + 1, total: dog.gallery_urls.length }));
    }
  }
  return slides;
}

function Slide({ s }) {
  if (s.type === 'user') {
    return (
      <div className="slide slide-user">
        <span className="kicker">{s.dogs > 1 ? 'Tie! His/her spirit dog is…' : 'His/her spirit dog is…'}</span>
        <Avatar url={s.user.photo_url} name={displayName(s.user)} size={200} />
        <h2>{displayName(s.user)}</h2>
      </div>
    );
  }
  if (s.type === 'dog') {
    return (
      <div className="slide slide-dog">
        <span className="kicker">{displayName(s.user)}&apos;s spirit dog is</span>
        <img src={s.dog.main_image_url} alt={s.dog.name} />
        <h2>{s.dog.name}</h2>
        <p className="muted">{s.votes} vote{s.votes === 1 ? '' : 's'}{s.tie && ' · tied winner'}</p>
      </div>
    );
  }
  return (
    <div className="slide slide-gallery">
      <img src={s.src} alt={s.dog.name} />
      <p className="muted">{s.dog.name} · photo {s.n} of {s.total}</p>
    </div>
  );
}

export default function ResultsCarousel({ slides }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const touchX = useRef(null);
  const n = slides.length;
  const go = useCallback((d) => setI((x) => (x + d + n) % n), [n]);

  useEffect(() => {
    if (!playing || n < 2) return undefined;
    const t = setTimeout(() => go(1), 4500);
    return () => clearTimeout(t);
  }, [playing, i, go, n]);

  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!n) return null;
  return (
    <div
      className="carousel"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <div className="carousel-stage">
        <button className="nav prev" onClick={() => go(-1)} aria-label="Previous slide">‹</button>
        <div key={i} className="carousel-slide"><Slide s={slides[i]} /></div>
        <button className="nav next" onClick={() => go(1)} aria-label="Next slide">›</button>
      </div>
      <div className="carousel-bar"><span style={{ width: `${((i + 1) / n) * 100}%` }} /></div>
      <div className="carousel-controls">
        <span className="muted small">Slide {i + 1} of {n}</span>
        <button className="btn small ghost" onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
        <button className="btn small ghost" onClick={() => { setI(0); setPlaying(false); }}>↺ Restart</button>
      </div>
    </div>
  );
}
