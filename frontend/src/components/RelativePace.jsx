import Sparkline from './Sparkline.jsx';

// Relative Pace panel: summary + table, all values pre-formatted by the backend.
export default function RelativePace({ paceRows, rows, onSelect }) {
  return (
    <section id="relative-panel" className="card">
      <h2>Relative Pace</h2>
      <div id="pace-summary">
        {paceRows.map((r, i) => (
          <div className="pace-row" key={i}>
            <span className="pace-label">{r.label}</span>
            <span className={`pace-value ${r.css}`}>{r.value}</span>
          </div>
        ))}
      </div>
      <div className="table-wrap" id="relative-wrap">
        <table id="relative">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Dorsal</th>
              <th>Equipo</th>
              <th>Mejor vuelta</th>
              <th>Ritmo actual</th>
              <th>Delta rápido</th>
              <th>Tendencia</th>
              <th>Gap adelante</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.isOurs ? 'ours' : ''} data-kart={r.kart} onClick={() => onSelect(r.kart)}>
                <td>{r.position}</td>
                <td className="mono">{r.kart}</td>
                <td>{r.driver}</td>
                <td className="mono">{r.bestLap}</td>
                <td className="mono">{r.rolling}</td>
                <td className={`mono ${r.deltaClass}`}>{r.delta}</td>
                <td><Sparkline laps={r.sparkLaps} /></td>
                <td className="mono">{r.gapAhead}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
