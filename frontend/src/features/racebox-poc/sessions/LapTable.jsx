import { formatLapTime } from '../../../services/devices/racebox/RaceBoxAnalysis.js';

export default function LapTable({ laps, bestIndex, selectedIndex, onSelect }) {
  if (!laps || laps.length === 0) {
    return <p className="rb-muted">No se detectaron vueltas. La sesión se muestra como un único tramo.</p>;
  }
  const best = laps[bestIndex];
  return (
    <div className="rb-table-wrap">
      <table className="rb-table">
        <thead>
          <tr>
            <th>Vuelta</th>
            <th>Tiempo</th>
            <th>Delta</th>
            <th>Dist.</th>
            <th>V. máx</th>
            <th>G máx</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((lap, i) => {
            const delta = best ? lap.durationS - best.durationS : 0;
            const isBest = i === bestIndex;
            return (
              <tr
                key={i}
                className={`${isBest ? 'rb-row-active' : ''}${i === selectedIndex ? ' rb-row-selected' : ''}`}
                onClick={() => onSelect(i)}
                style={{ cursor: 'pointer' }}
              >
                <td className="rb-mono">
                  {i + 1}
                  {isBest && <span className="rb-tag" style={{ marginLeft: 8 }}>mejor</span>}
                </td>
                <td className="rb-mono">{formatLapTime(lap.durationS)}</td>
                <td className={`rb-mono ${delta > 0 ? 'rb-off' : 'rb-ok'}`}>
                  {isBest ? '—' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(3)}`}
                </td>
                <td className="rb-mono">{lap.distanceM.toFixed(0)} m</td>
                <td className="rb-mono">{lap.maxSpeed.toFixed(0)}</td>
                <td className="rb-mono">{(lap.maxG / 1000).toFixed(2)} g</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
