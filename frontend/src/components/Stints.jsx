// "Our Stints" panel.
export default function Stints({ stints }) {
  return (
    <>
      {stints.map((s, i) => (
        <div key={i} className={`stint${s.isCurrent ? ' current' : ''}`}>
          <div className="head">
            <span>Laps {s.startLap}–{s.endLap}</span>
            {s.isCurrent ? <span className="cur">● current</span> : null}
            <span>{s.lapCount} laps</span>
          </div>
          <div className="row">Best {s.bestTime} · Avg {s.avgTime}</div>
        </div>
      ))}
    </>
  );
}
