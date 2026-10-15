import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { getRaceSessionReport } from './api.js';
import { AppIcon } from './components/AppIcon.jsx';

function fmtMs(v) {
  if (!v || v <= 0) return '-';
  const t = Math.round(v);
  const s = Math.floor(t / 1000);
  const m = Math.floor(s / 60);
  const frac = String(t % 1000).padStart(3, '0');
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}.${frac}` : `${s}.${frac}`;
}

function fmtClock(ms) {
  if (!ms && ms !== 0) return '-';
  const t = Math.round(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

const verdictBadge = {
  adelantada: ['badge-early', 'adelantada'],
  alargada: ['badge-late', 'alargada'],
  'a tiempo': ['badge-ontime', 'a tiempo'],
  'sin plan': ['badge-none', 'sin plan'],
};

// Post-race postmortem. Renders the rich report built by the backend.
export default function ReportScreen({ sessionId, onBack }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const d = await getRaceSessionReport(sessionId);
        setReport(d.report);
      } catch (e) {
        setError(e.message || 'No se pudo cargar el análisis');
      }
    })();
  }, [sessionId]);

  if (error) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1 className="login-title">Análisis no disponible</h1>
          <p className="login-sub">{error}</p>
          <button className="login-btn" onClick={onBack}>Volver</button>
        </div>
      </div>
    );
  }

  if (!report) {
    return <div className="card" style={{ padding: 24 }}>Cargando análisis…</div>;
  }

  const cfg = report.config || {};
  const fmt = cfg.kartChangeOnly
    ? 'Cambio de kart (piloto fijo)'
    : cfg.mandatoryStopEveryMin > 0
    ? `Parada cada ${cfg.mandatoryStopEveryMin} min`
    : 'Stints libres';

  const kpis = [
    { icon: 'activity', label: 'Vueltas', value: report.totalLaps },
    { icon: 'flag2', label: 'Mejor vuelta', value: fmtMs(report.bestLap) },
    { icon: 'gauge', label: 'Media', value: fmtMs(report.avgLap) },
    { icon: 'chart', label: 'Consistencia (σ)', value: fmtMs(report.consistencyMs) },
    { icon: 'repeat', label: 'Paradas', value: report.stopCount },
    { icon: 'clock', label: 'Tiempo en boxes', value: fmtClock(report.totalPitTimeMs) },
  ];

  return (
    <div className="home-screen report-screen">
      <header className="home-header report-header">
        <div>
          <h1>Análisis de la sesión</h1>
          <div className="report-chips">
            {cfg.raceDurationMin ? <span className="chip">{cfg.raceDurationMin} min</span> : null}
            <span className="chip">{fmt}</span>
            {report.fastestPilot ? <span className="chip chip-fast"><AppIcon name="flag2" size={12} /> Más rápido: {report.fastestPilot}</span> : null}
            <span className="chip">{report.status}</span>
            {report.circuitUrl ? <span className="chip chip-url truncate">{report.circuitUrl}</span> : null}
          </div>
        </div>
        <button className="login-btn-ghost" onClick={onBack}><AppIcon name="back" size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} /> Volver</button>
      </header>

      <div className="kpi-grid">
        {kpis.map((k) => (
          <div className="kpi-card" key={k.label}>
            <div className="kpi-icon"><AppIcon name={k.icon} size={20} /></div>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="report-grid">
        <ReportSection title="Por piloto" icon="users">
          {report.perPilot.length === 0 ? (
            <p className="muted">Sin vueltas registradas.</p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th>Piloto</th><th>Vueltas</th><th>Relevos</th><th>Mejor</th><th>Media</th>
                  <th>Mediana</th><th>Consist.</th><th>Boxes</th><th>+Pos</th><th>−Pos</th><th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {report.perPilot.map((p, i) => (
                  <tr key={p.name}>
                    <td><b>{p.name}</b>{i === 0 && report.fastestPilot === p.name ? <span className="tag-fast">★ rápido</span> : null}</td>
                    <td>{p.laps}</td>
                    <td>{p.stints}</td>
                    <td>{fmtMs(p.bestLap)}</td>
                    <td>{fmtMs(p.avgLap)}</td>
                    <td>{fmtMs(p.medianLap)}</td>
                    <td>{fmtMs(p.consistencyMs)}</td>
                    <td>{fmtClock(p.pitTimeMs)}</td>
                    <td>{p.positionsGained ?? '-'}</td>
                    <td>{p.positionsLost ?? '-'}</td>
                    <td className={`delta-val ${p.netPositions > 0 ? 'good' : p.netPositions < 0 ? 'danger' : ''}`}>{p.netPositions ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ReportSection>

        <ReportSection title="Relevos (stints)" icon="repeat">
          {report.stints.length === 0 ? (
            <p className="muted">Sin datos.</p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th>#</th><th>Piloto</th><th>Vueltas</th><th>Laps</th><th>Mejor</th><th>Media</th>
                  <th>Pos ini</th><th>Pos fin</th><th>Δ pos</th>
                </tr>
              </thead>
              <tbody>
                {report.stints.map((s) => (
                  <tr key={s.index}>
                    <td className="muted">{s.index}</td>
                    <td>{s.driver}</td>
                    <td className="mono">{s.startLap}–{s.endLap}</td>
                    <td>{s.laps}</td>
                    <td>{fmtMs(s.bestLap)}</td>
                    <td>{fmtMs(s.avgLap)}</td>
                    <td>{s.positionStart ?? '-'}</td>
                    <td>{s.positionEnd ?? '-'}</td>
                    <td className={`delta-val ${s.netPosition > 0 ? 'good' : s.netPosition < 0 ? 'danger' : ''}`}>{s.netPosition ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ReportSection>

        <ReportSection title="Paradas: plan vs real" icon="route">
          {report.pitStops.length === 0 ? (
            <p className="muted">Sin paradas registradas.</p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th>#</th><th>Vuelta</th><th>Tiempo</th><th>Pos entrada</th>
                  <th>Plan</th><th>Dif.</th><th>Veredicto</th><th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {report.pitStops.map((p) => {
                  const [bcls, blab] = verdictBadge[p.verdict] || ['badge-none', p.verdict];
                  return (
                    <tr key={p.pitNumber}>
                      <td className="muted">{p.pitNumber}</td>
                      <td className="mono">{p.lap}</td>
                      <td>{fmtMs(p.pitTimeMs)}</td>
                      <td>{p.position ?? '-'}</td>
                      <td className="mono">{p.plannedLap ?? '-'}</td>
                      <td className={`delta-val ${p.diffLaps != null && p.diffLaps < -0.5 ? 'danger' : p.diffLaps != null && p.diffLaps > 0.5 ? 'warn' : ''}`}>
                        {p.diffLaps != null ? `${p.diffLaps > 0 ? '+' : ''}${p.diffLaps} v` : '-'}
                      </td>
                      <td><span className={`badge ${bcls}`}>{blab}</span></td>
                      <td className="muted">{p.plannedReason || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ReportSection>
      </div>

      {report.positionSeries.length > 0 && (
        <ReportSection title="Posición en el tiempo" icon="history">
          <PositionChart series={report.positionSeries} />
        </ReportSection>
      )}

      {report.paceEvolution.length > 0 && (
        <ReportSection title={`Evolución del ritmo · últimas ${Math.min(40, report.paceEvolution.length)} vueltas`} icon="chart">
          <PaceChart laps={report.paceEvolution.slice(-40)} />
        </ReportSection>
      )}
    </div>
  );
}

function ReportSection({ title, icon, children }) {
  return (
    <section className="card home-panel report-panel">
      <div className="report-panel-head">
        <span className="report-panel-icon"><AppIcon name={icon} size={18} /></span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

const TOOLTIP_STYLE = { background: '#0c121c', border: '1px solid #2a3240', borderRadius: 8, color: '#fff', fontSize: 12 };
const TICK = { fill: '#8a94a6', fontSize: 11 };
const GRID = 'rgba(255,255,255,.07)';

// Position over the race (P1 on top) with a net gain/loss summary.
function PositionChart({ series }) {
  const rows = series.filter((s) => s.position != null);
  if (rows.length < 2) {
    return <p className="muted">Datos de posición insuficientes.</p>;
  }
  const pos = rows.map((s) => s.position);
  const best = Math.min(...pos);
  const worst = Math.max(...pos);
  const first = pos[0];
  const last = pos[pos.length - 1];
  const net = first - last;
  const data = rows.map((s) => ({ t: fmtClock(s.elapsedMs), pos: s.position, driver: s.driver || '' }));

  return (
    <div>
      <div className="pos-chart-summary">
        <span className="chip">Inicio: <b>P{first}</b></span>
        <span className="chip chip-good">Mejor: <b>P{best}</b></span>
        <span className="chip chip-bad">Peor: <b>P{worst}</b></span>
        <span className="chip">Final: <b>P{last}</b></span>
        <span className={`chip ${net > 0 ? 'chip-good' : net < 0 ? 'chip-bad' : ''}`}>
          Δ <b>{net > 0 ? '+' : ''}{net}</b> {net > 0 ? 'posiciones ganadas' : net < 0 ? 'posiciones perdidas' : 'sin cambio'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 10, right: 24, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="t" tick={TICK} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis
            reversed
            allowDecimals={false}
            domain={['dataMin - 1', 'dataMax + 1']}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={26}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#8a94a6' }} formatter={(v) => [`P${v}`, 'Posición']} />
          <Line type="stepAfter" dataKey="pos" stroke="#e2a33d" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Lap times over laps (faster = higher), with best/average reference lines.
function PaceChart({ laps }) {
  const rows = laps.filter((l) => l.timeMs > 0);
  if (rows.length < 2) {
    return <p className="muted">Datos de ritmo insuficientes.</p>;
  }
  const times = rows.map((r) => r.timeMs);
  const best = Math.min(...times);
  const worst = Math.max(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const last = times[times.length - 1];
  const sec = (ms) => Number((ms / 1000).toFixed(2));
  const data = rows.map((r) => ({ lap: r.lap, time: sec(r.timeMs) }));

  return (
    <div>
      <div className="pos-chart-summary">
        <span className="chip chip-good">Mejor: <b>{fmtMs(best)}</b></span>
        <span className="chip">Media: <b>{fmtMs(avg)}</b></span>
        <span className="chip chip-bad">Peor: <b>{fmtMs(worst)}</b></span>
        <span className="chip">Última: <b>{fmtMs(last)}</b></span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 10, right: 24, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="lap" tick={TICK} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis
            reversed
            domain={['dataMin - 0.4', 'dataMax + 0.4']}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={34}
            tickFormatter={(v) => `${v}s`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#8a94a6' }}
            formatter={(v) => [`${v}s`, 'Vuelta']}
            labelFormatter={(v) => `Vuelta ${v}`}
          />
          <ReferenceLine y={sec(avg)} stroke="rgba(148,163,184,.6)" strokeDasharray="4 3" label={{ value: 'media', fill: '#8a94a6', fontSize: 11, position: 'insideTopLeft' }} />
          <ReferenceLine y={sec(best)} stroke="rgba(46,158,109,.7)" strokeDasharray="4 3" label={{ value: 'mejor', fill: '#2e9e6d', fontSize: 11, position: 'insideTopLeft' }} />
          <Line type="monotone" dataKey="time" stroke="#e2a33d" strokeWidth={2.5} dot={{ r: 3, fill: '#e2a33d', strokeWidth: 0 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
