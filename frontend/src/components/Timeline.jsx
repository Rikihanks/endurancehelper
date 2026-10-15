// Race timeline as a PIT LANE seen from above: asphalt lane with dashed center
// line, checkered flags at start/meta, stop markers as cones, amber progress.
export default function Timeline({ timeline }) {
  if (!timeline) return null;
  return (
    <div id="timeline">
      <div className="tl-track">
        <div className="tl-progress" style={{ width: `${timeline.progressPct}%` }} />
        {timeline.stops.map((s) => (
          <div
            key={s.index}
            className="tl-stop"
            style={{ left: `${s.leftPct}%` }}
            title={`Parada ${s.index}${s.done ? ' · hecha' : ' · prevista'}`}
          >
            <span className={`tl-cone ${s.done ? 'done' : 'todo'}`} />
            <span className="tl-stop-num">{s.index}</span>
          </div>
        ))}
        {timeline.pitClose && (
          <div className="tl-pitclose" style={{ left: `${timeline.pitClose.leftPct}%` }} title="El carril de pits cierra">
            <span className="tl-pitclose-tag">CIERRE</span>
          </div>
        )}
        <span className="tl-flag tl-flag-start" title="Salida" />
        <span className="tl-flag tl-flag-end" title="Meta" />
        <span className="tl-label tl-start">SALIDA</span>
        <span className="tl-label tl-end">META</span>
      </div>
    </div>
  );
}
