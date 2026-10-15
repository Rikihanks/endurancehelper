// Strategy panel: renders the rows of label/value the backend computed.
import { AppIcon } from './AppIcon.jsx';

export default function Strategy({ rows, objectiveValue, onObjective }) {
  return (
    <aside id="strategy-section" className="card">
      <div className="strat-row head">
        <span className="strat-ico"><AppIcon name="target" size={16} /></span>
        <span className="strat-label">Objetivo</span>
        <select
          id="strat-objetivo"
          value={objectiveValue}
          onChange={(e) => onObjective(e.target.value)}
        >
          <option value="adelantar">Adelantar</option>
          <option value="defender">Defender</option>
          <option value="mantener">Mantener ritmo</option>
          <option value="ahorrar">Ahorrar</option>
        </select>
      </div>
      {rows.map((r, i) => (
        <div className="strat-row" key={i} title={r.title}>
          <span className="strat-ico"><AppIcon name={r.icon} size={16} /></span>
          <span className="strat-label" dangerouslySetInnerHTML={{ __html: r.label }} />
          <span className={`strat-value ${r.css}`}>{r.value}</span>
        </div>
      ))}
    </aside>
  );
}
