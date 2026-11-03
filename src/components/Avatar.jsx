export default function Avatar({ url, name, size = 48 }) {
  const style = { width: size, height: size, fontSize: size * 0.45 };
  return url
    ? <img className="avatar" src={url} alt={name} style={style} />
    : <span className="avatar placeholder" style={style}>{name?.[0]?.toUpperCase() || '?'}</span>;
}
