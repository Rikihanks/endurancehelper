import { formatLapTime } from '../../../services/devices/racebox/RaceBoxAnalysis.js';

// Sector times per lap, coloured against the best time of each sector (like the
// official apps' "Sectors" mode). Works for laps produced by the track timing
// (computeTrackLaps) and by the heuristic fallback.

export default function SectorTable({ laps, bestIndex }) {
  const sectorCount = laps.reduce((max, l) => Math.max(max, (l.sectors || []).length), 0);
  if (!sectorCount) {
    return (
      <p className="rb-muted">
        Sin sectores todavía. Con el editor de abajo puedes colocar la meta y hasta 4 líneas de
        sector sobre esta misma sesión: los tiempos se recalculan al instante.
      </p>
    );
  }

  const bestSector = new Array(sectorCount).fill(null);
  for (const lap of laps) {
    (lap.sectors || []).forEach((s, i) => {
      if (s != null && (bestSector[i] == null || s < bestSector[i])) bestSector[i] = s;
    });
  }

  const indices = Array.from({ length: sectorCount }, (_, i) => i);

  return (
    <div className="rb-table-wrap">
      <table className="rb-table">
        <thead>
          <tr>
            <th>Vuelta</th>
            {indices.map((i) => (
              <th key={i}>S{i + 1}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((lap, i) => (
            <tr key={i} className={i === bestIndex ? 'rb-row-active' : ''}>
              <td className="rb-mono">{i + 1}</td>
              {indices.map((k) => {
                const s = (lap.sectors || [])[k];
                const best = bestSector[k];
                const delta = s != null && best != null ? s - best : null;
                const slower = delta != null && delta > 0.002;
                const faster = delta != null && delta < -0.002;
                return (
                  <td
                    key={k}
                    className={`rb-mono${slower ? ' rb-off' : ''}${faster ? ' rb-ok' : ''}`}
                  >
                    {s != null ? s.toFixed(3) : '—'}
                    {delta != null && Math.abs(delta) > 0.002 && (
                      <span className="rb-muted">
                        {' '}
                        {delta > 0 ? '+' : '−'}
                        {Math.abs(delta).toFixed(3)}
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="rb-mono">{formatLapTime(lap.durationS)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
