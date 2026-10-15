// Qualifying Analysis panel + actions (capture/clear) sent to the backend.
export default function Qualy({ qualy, onCapture, onClear, message }) {
  if (!qualy.saved) {
    return (
      <>
        <div className="qualy-actions">
          <button onClick={onCapture}>Capture Qualy</button>
          <span id="qualy-msg">{message}</span>
        </div>
        <div id="qualy-summary">
          <div className="pace-row">
            <span className="pace-label">No qualy captured yet.</span>
          </div>
        </div>
        <table id="qualy"><tbody /></table>
      </>
    );
  }
  return (
    <>
      <div className="qualy-actions">
        <button onClick={onCapture}>Capture Qualy</button>
        <button onClick={onClear}>Clear</button>
        <span id="qualy-msg">{message}</span>
      </div>
      <div id="qualy-summary">
        <div className="pace-row"><span className="pace-label">Captured</span><span className="pace-value">{qualy.savedAtText}</span></div>
        <div className="pace-row"><span className="pace-label">Status</span><span className="pace-value">{qualy.status}</span></div>
        <div className="pace-row"><span className="pace-label">Fastest</span><span className="pace-value">{qualy.fastest}</span></div>
        <div className="pace-row"><span className="pace-label">Slowest</span><span className="pace-value">{qualy.slowest}</span></div>
      </div>
      <div className="table-wrap">
        <table id="qualy">
          <thead>
            <tr>
              <th>Q</th><th>Kart</th><th>Driver</th><th>Qualy</th><th>Race</th><th>Delta</th><th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {qualy.rows.map((r, i) => (
              <tr key={i} className={r.isOurs ? 'ours' : ''}>
                <td>{r.rank}{r.rankSuffix}</td>
                <td>{r.kart}</td>
                <td>{r.driver}</td>
                <td className="mono">{r.qualyLap}</td>
                <td className="mono">{r.raceBest}</td>
                <td className="mono">{r.delta}</td>
                <td className={`verdict-${r.verdictClass}`}>{r.verdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
