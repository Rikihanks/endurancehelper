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
import { AppIcon } from './AppIcon.jsx';

const TOOLTIP_STYLE = { background: '#0c121c', border: '1px solid #2a3240', borderRadius: 8, color: '#fff', fontSize: 12 };
const TICK = { fill: '#8a94a6', fontSize: 11 };

const kpis = [
  { icon: 'activity', label: 'Vueltas', value: '482' },
  { icon: 'flag2', label: 'Mejor vuelta', value: '1:12.205' },
  { icon: 'gauge', label: 'Media', value: '1:13.0' },
  { icon: 'chart', label: 'Consistencia (σ)', value: '0.9s' },
  { icon: 'repeat', label: 'Paradas', value: '10' },
  { icon: 'clock', label: 'Tiempo en boxes', value: '5m 12s' },
];

const pilots = [
  { name: 'Alfa', laps: 128, stints: 3, best: '1:12.205', avg: '1:12.7', med: '1:12.8', cons: '0.6s', boxes: '1:02', g: 2, l: 0, net: 2 },
  { name: 'Bravo', laps: 122, stints: 3, best: '1:12.481', avg: '1:13.1', med: '1:13.0', cons: '0.8s', boxes: '1:24', g: 1, l: 1, net: 0 },
  { name: 'Charlie', laps: 119, stints: 2, best: '1:12.968', avg: '1:13.6', med: '1:13.5', cons: '1.1s', boxes: '1:38', g: 0, l: 2, net: -2 },
  { name: 'Delta', laps: 113, stints: 2, best: '1:12.603', avg: '1:13.2', med: '1:13.1', cons: '0.7s', boxes: '1:08', g: 2, l: 0, net: 2 },
];

const stops = [
  { n: 1, lap: 42, pit: '1:01.1', pos: 4, plan: 44, diff: -2, v: 'adelantada', r: 'ritmo malo' },
  { n: 2, lap: 86, pit: '0:36.2', pos: 3, plan: 84, diff: 2, v: 'alargada', r: 'kart rápido' },
  { n: 3, lap: 129, pit: '1:00.9', pos: 2, plan: 128, diff: 1, v: 'alargada', r: 'kart rápido' },
  { n: 4, lap: 175, pit: '0:35.8', pos: 2, plan: 172, diff: 3, v: 'alargada', r: 'reparto' },
  { n: 5, lap: 218, pit: '1:00.7', pos: 1, plan: 216, diff: 2, v: 'alargada', r: 'kart rápido' },
  { n: 6, lap: 262, pit: '0:36.1', pos: 1, plan: 260, diff: 2, v: 'a tiempo', r: 'reparto' },
  { n: 7, lap: 305, pit: '1:01.2', pos: 1, plan: 304, diff: 1, v: 'a tiempo', r: 'reparto' },
  { n: 8, lap: 348, pit: '0:35.5', pos: 1, plan: 348, diff: 0, v: 'a tiempo', r: 'reparto' },
];

const verdictBadge = {
  adelantada: ['badge-early', 'adelantada'],
  alargada: ['badge-late', 'alargada'],
  'a tiempo': ['badge-ontime', 'a tiempo'],
  'sin plan': ['badge-none', 'sin plan'],
};

const positionData = [
  { t: '0:00', pos: 6 }, { t: '1:00', pos: 5 }, { t: '2:00', pos: 5 }, { t: '3:00', pos: 4 },
  { t: '4:00', pos: 4 }, { t: '5:00', pos: 3 }, { t: '6:00', pos: 3 }, { t: '7:00', pos: 2 },
  { t: '8:00', pos: 2 }, { t: '9:00', pos: 1 }, { t: '10:00', pos: 1 }, { t: '11:00', pos: 1 },
];

const paceData = [65, 61, 58, 55, 52, 50, 48, 46, 44, 42, 40].map((h, i) => ({
  lap: i + 1,
  time: Number((73.1 - (h / 100) * 3 + (i % 7 === 0 ? 0.6 : 0)).toFixed(2)),
}));

export default function PostRaceDemo() {
  return (
    <div className="postrace-demo">
      <div className="kpi-grid">
        {kpis.map((k) => (
          <div className="kpi-card" key={k.label}>
            <div className="kpi-icon"><AppIcon name={k.icon} size={20} /></div>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="postrace-cols">
        <div className="postrace-card">
          <h3 className="postrace-card-title">Por piloto</h3>
          <table className="report-table">
            <thead>
              <tr><th>Piloto</th><th>Vueltas</th><th>Relevos</th><th>Mejor</th><th>Media</th><th>Boxes</th><th>Δ pos</th></tr>
            </thead>
            <tbody>
              {pilots.map((p) => (
                <tr key={p.name}>
                  <td><b>{p.name}</b>{p.name === 'Alfa' ? <span className="tag-fast">★ rápido</span> : null}</td>
                  <td>{p.laps}</td><td>{p.stints}</td><td>{p.best}</td><td>{p.avg}</td><td>{p.boxes}</td>
                  <td className={`delta-val ${p.net > 0 ? 'good' : p.net < 0 ? 'danger' : ''}`}>{p.net > 0 ? `+${p.net}` : p.net}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="postrace-card">
          <h3 className="postrace-card-title">Paradas: plan vs real</h3>
          <table className="report-table">
            <thead><tr><th>#</th><th>Vuelta</th><th>Tiempo</th><th>Dif.</th><th>Veredicto</th></tr></thead>
            <tbody>
              {stops.slice(0, 6).map((p) => {
                const [bcls, blab] = verdictBadge[p.v] || ['badge-none', p.v];
                return (
                  <tr key={p.n}>
                    <td className="muted">{p.n}</td>
                    <td className="mono">{p.lap}</td>
                    <td>{p.pit}</td>
                    <td className={`delta-val ${p.diff < 0 ? 'danger' : p.diff > 0 ? 'warn' : ''}`}>{p.diff > 0 ? `+${p.diff}` : p.diff} v</td>
                    <td><span className={`badge ${bcls}`}>{blab}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="postrace-cols">
        <div className="postrace-card">
          <h3 className="postrace-card-title">Posición en el tiempo</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={positionData} margin={{ top: 8, right: 20, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.07)" />
              <XAxis dataKey="t" tick={TICK} tickLine={false} axisLine={false} />
              <YAxis reversed allowDecimals={false} domain={[1, 6]} tick={TICK} tickLine={false} axisLine={false} width={20} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`P${v}`, 'Posición']} />
              <Line type="stepAfter" dataKey="pos" stroke="#e2a33d" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="postrace-card">
          <h3 className="postrace-card-title">Evolución del ritmo</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={paceData} margin={{ top: 8, right: 20, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.07)" />
              <XAxis dataKey="lap" tick={TICK} tickLine={false} axisLine={false} />
              <YAxis reversed domain={['dataMin - 0.3', 'dataMax + 0.3']} tick={TICK} tickLine={false} axisLine={false} width={30} tickFormatter={(v) => `${v}s`} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}s`, 'Vuelta']} labelFormatter={(v) => `Vuelta ${v}`} />
              <ReferenceLine y={Number((paceData.reduce((a, b) => a + b.time, 0) / paceData.length).toFixed(2))} stroke="rgba(148,163,184,.6)" strokeDasharray="4 3" label={{ value: 'media', fill: '#8a94a6', fontSize: 11 }} />
              <Line type="monotone" dataKey="time" stroke="#e2a33d" strokeWidth={2.5} dot={{ r: 3, fill: '#e2a33d', strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
