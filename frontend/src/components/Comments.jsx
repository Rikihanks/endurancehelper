// Race Comments panel. Kart numbers render as chips (ours highlighted). Comments
// that mention OUR dorsal are highlighted in red and counted as sanctions.
export default function Comments({ comments }) {
  return (
    <>
      {comments.map((c, i) => {
        let text = c.text || '';
        for (const k of c.karts || []) {
          if (text.startsWith(k)) {
            text = text.slice(k.length).trim();
            break;
          }
        }
        return (
          <div className={`com${c.isOurs ? ' com-ours' : ''}`} key={i}>
            <span className="t">{c.time}</span>
            {(c.karts || []).map((k) => (
              <span key={k} className={`com-chip${c.isOurs ? ' ours' : ''}`}>#{k}</span>
            ))}
            {c.isOurs && <span className="flag flag-ours">SANCION</span>}
            {text}
          </div>
        );
      })}
    </>
  );
}
