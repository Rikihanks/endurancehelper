import { useEffect, useState } from 'react';
import Topbar from './Topbar.jsx';
import Standings from './Standings.jsx';
import Strategy from './Strategy.jsx';
import Timeline from './Timeline.jsx';

// Demo de la landing: renderiza los COMPONENTES REALES de la app (Topbar,
// Standings, Strategy, Timeline) con datos de ejemplo, para que se vea
// literalmente igual que en una carrera. La cuenta atrás corre de verdad.
const noop = () => {};

function buildView(secondsLeft) {
  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  const countdown = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const stops = [
    { index: 1, leftPct: 11, done: true },
    { index: 2, leftPct: 23, done: true },
    { index: 3, leftPct: 35, done: true },
    { index: 4, leftPct: 47, done: true },
    { index: 5, leftPct: 59, done: true },
    { index: 6, leftPct: 71, done: true },
    { index: 7, leftPct: 83, done: true },
    { index: 8, leftPct: 95, done: false },
  ];

  return {
    topbar: {
      countdown,
      teamName: 'VUESTRO EQUIPO',
      driverPos: '3º',
      driverName: '· Carlos',
      driverDelta: '-20:17s-',
      surfaceBadge: { text: 'SECO', wet: false },
      stopsDetail: stops.map((st) => ({ index: st.index, done: st.done, atMin: st.leftPct * 3.4 })),
      stopsLabel: '7 / 8',
      nextStop: { value: 2, base: 2, urgent: true },
      weatherValue: 'soleado',
      trackConditionValue: 'dry',
      raceObjectiveValue: 'adelantar',
      pilotOptions: [
        { value: 0, label: 'P1 · Alfa' },
        { value: 1, label: 'P2 · Bravo' },
        { value: 2, label: 'P3 · Charlie' },
        { value: 3, label: 'P4 · Delta' },
      ],
      manualDriverIdx: 1,
    },
    standings: [
      { position: '1', posArrow: '', kart: '7', driver: 'Racing Team', gap: '+0.000', lastLap: '1:23.602', lastLapClass: 'lap-normal', bestLap: '1:22.998', bestLapClass: 'lap-best-overall', sparkLaps: [83202, 83188, 83220, 83199, 83255], statusClass: 'status-track', statusText: 'RACING', pits: '8', isOurs: false },
      { position: '2', posArrow: '', kart: '42', driver: 'Kartplanet Pro', gap: '+4.118', lastLap: '1:23.911', lastLapClass: 'lap-normal', bestLap: '1:23.204', bestLapClass: 'lap-personal-best', sparkLaps: [83911, 83802, 83944, 83877, 83920], statusClass: 'status-track', statusText: 'RACING', pits: '8', isOurs: false },
      { position: '3', posArrow: '', kart: '10', driver: 'VUESTRO EQUIPO', gap: '+9.403', lastLap: '1:23.455', lastLapClass: 'lap-personal-best', bestLap: '1:23.055', bestLapClass: 'lap-normal', sparkLaps: [83455, 83402, 83377, 83488, 83410], statusClass: 'status-track', statusText: 'RACING', pits: '7', isOurs: true },
      { position: '4', posArrow: '', kart: '23', driver: 'Delta Racing', gap: '+11.007', lastLap: '1:24.102', lastLapClass: 'lap-worst', bestLap: '1:23.411', bestLapClass: 'lap-normal', sparkLaps: [84102, 83999, 84144, 84020, 84100], statusClass: 'status-track', statusText: 'RACING', pits: '8', isOurs: false },
    ],
    strategy: {
      rows: [
        { icon: 'clock', label: 'Tiempo objetivo', value: '1:23.4', css: 'strat-target' },
        { icon: 'gauge', label: 'Tiempo medio', value: '1:23.752 +0.3s', css: '' },
        { icon: 'trophy', label: 'Posición virtual', value: '3º', css: 'strat-virtual' },
        { icon: 'weather', label: 'Condición', value: 'Seco', css: '' },
        { icon: 'repeat', label: 'Stint actual', value: '21 vueltas · máx 40 min', css: '' },
        { icon: 'swords', label: 'Tráfico / lucha', value: 'En lucha (3v)', css: '' },
        { icon: 'arrow-up', label: 'Delta 2º', value: '-4.7s', css: 'strat-ahead' },
        { icon: 'arrow-down', label: 'Delta 4º', value: '+1.6s', css: 'strat-behind' },
        { icon: 'flag2', label: 'Delta líder', value: '+9.403', css: '' },
        { icon: 'route', label: 'Previsión al salir de pit · <b>P3</b>', value: '+1.2s delante · −2.0s detrás', css: 'strat-ahead' },
        { icon: 'scale', label: 'Sanciones', value: '0', css: 'strat-penalties' },
      ],
    },
    timeline: { progressPct: 42, stops, pitClose: { leftPct: 96 } },
  };
}

export default function LiveDemo() {
  const [sec, setSec] = useState(4 * 3600 + 12 * 60 + 47);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => (s <= 0 ? 4 * 3600 : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const view = buildView(sec);

  return (
    <div className="pitboard band">
      <Topbar
        view={view}
        config={{}}
        onWeather={noop}
        onSurface={noop}
        onPilot={noop}
        onObjective={noop}
        onNextStop={noop}
        onOpenSettings={noop}
        onToggleOffline={noop}
        showControls={false}
      />
      <div id="main-area" className="live-area">
        <div id="standings-section">
          <Standings rows={view.standings} onSelect={noop} />
        </div>
        <Strategy rows={view.strategy.rows} objectiveValue="adelantar" onObjective={noop} />
      </div>
      <div id="timeline-section">
        <Timeline timeline={view.timeline} />
      </div>
    </div>
  );
}
