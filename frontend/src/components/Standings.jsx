import Sparkline from './Sparkline.jsx';

// Standings table. All cell values come pre-formatted from the backend.
export default function Standings({ rows, onSelect }) {
  return (
    <div className="table-wrap" id="standings-wrap">
      <table id="standings">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Dorsal</th>
            <th>Equipo</th>
            <th>Gap Líder</th>
            <th>Última vuelta</th>
            <th>Mejor vuelta</th>
            <th>Tendencia</th>
            <th>Estado</th>
            <th>Paradas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d, i) => (
            <tr
              key={i}
              className={`${d.isOurs ? 'ours' : ''}${d.isFastest ? ' fastest' : ''}`}
              data-kart={d.kart}
              onClick={() => onSelect(d.kart)}
            >
              <td>{d.position} {d.posArrow && <span dangerouslySetInnerHTML={{ __html: d.posArrow }} />}</td>
              <td className="mono">{d.kart}</td>
              <td>{d.driver}</td>
              <td className="mono">{d.gap}</td>
              <td className={`mono ${d.lastLapClass}`}>{d.lastLap}</td>
              <td className={`mono ${d.bestLapClass}`}>{d.bestLap}</td>
              <td><Sparkline laps={d.sparkLaps} /></td>
              <td>
                <span className={`status-badge ${d.statusClass}`}>{d.statusText}</span>
              </td>
              <td className="mono">{d.pits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
