import Explanation from './Explanation.jsx';
import RelativePace from './RelativePace.jsx';
import Stints from './Stints.jsx';
import Qualy from './Qualy.jsx';
import Comments from './Comments.jsx';

// Segunda demo de la landing: los paneles REALES que no salen en LiveDemo
// (Por qué paramos, Ritmo relativo, Stints, Qualy, Comentarios). Misma marca,
// mismos componentes, datos de ejemplo.
const noop = () => {};

const explanationItems = [
  { tag: 'porque', text: 'POR QUÉ PARAR (ritmo mediocre): vamos +0,5s más lentos que el objetivo. Adelantamos la parada unas vueltas para no perder la posición virtual. Entrar en unos 2 vueltas.' },
  { tag: 'reloj', text: 'Quedan 68 min de 480 min de carrera (14% por disputar).' },
  { tag: 'pos', text: 'Vamos en la posición virtual 3 de 24.' },
  { tag: 'ritmo', text: 'Ritmo medio de las últimas vueltas: 1:23.752. Mejor vuelta del kart: 1:23.055.' },
  { tag: 'kart', text: 'Ritmo relativo del kart: la media del grid es 1:24.110 y la nuestra es 1:23.752 (0.5% más rápido que la media). Por eso hemos alargado la ventana de parada recomendada.' },
  { tag: 'tend', text: 'Comparado con hace unas vueltas, el ritmo se mantiene estable (+0.010s).' },
  { tag: 'cierre', text: 'El carril de pits cierra en el minuto 440 (dentro de 68 min). La parada que falta hay que encajarla antes de esa hora, o habrá penalización.' },
];

const paceRows = [
  { label: 'Posición', value: '3 / 24', css: '' },
  { label: 'Karts más rápidos', value: '2', css: 'danger' },
  { label: 'Karts más lentos', value: '21', css: 'good' },
  { label: 'Ritmo actual', value: '1:23.752', css: '' },
  { label: 'Delta al más rápido', value: '+0.757', css: 'warn' },
];

const relativeRows = [
  { position: '1', kart: '7', driver: 'Racing Team', bestLap: '1:22.998', rolling: '1:23.600', delta: '+0.000', deltaClass: 'good', sparkLaps: [83602, 83588, 83620, 83599, 83655], gapAhead: '-', isOurs: false },
  { position: '2', kart: '42', driver: 'Kartplanet Pro', bestLap: '1:23.204', rolling: '1:23.800', delta: '+0.206', deltaClass: 'good', sparkLaps: [83911, 83802, 83944, 83877, 83920], gapAhead: '+4.118', isOurs: false },
  { position: '3', kart: '10', driver: 'VUESTRO EQUIPO', bestLap: '1:23.055', rolling: '1:23.752', delta: '+0.057', deltaClass: 'warn', sparkLaps: [83455, 83402, 83377, 83488, 83410], gapAhead: '-5.285', isOurs: true },
  { position: '4', kart: '23', driver: 'Delta Racing', bestLap: '1:23.411', rolling: '1:24.100', delta: '+0.413', deltaClass: 'warn', sparkLaps: [84102, 83999, 84144, 84020, 84100], gapAhead: '+1.604', isOurs: false },
];

const stints = [
  { startLap: 1, endLap: 22, lapCount: 22, bestTime: '1:23.102', avgTime: '1:23.810', isCurrent: false },
  { startLap: 23, endLap: 41, lapCount: 19, bestTime: '1:23.055', avgTime: '1:23.600', isCurrent: false },
  { startLap: 42, endLap: 60, lapCount: 19, bestTime: '1:23.118', avgTime: '1:23.880', isCurrent: false },
  { startLap: 61, endLap: 79, lapCount: 19, bestTime: '1:23.240', avgTime: '1:23.752', isCurrent: true },
];

const qualy = {
  saved: true,
  savedAtText: 'hoy, 18:42',
  status: 'Comparando con la carrera',
  fastest: 'Racing Team · Kartplanet Pro · VUESTRO EQUIPO',
  slowest: 'Delta Racing',
  rows: [
    { rank: 1, rankSuffix: '', kart: '7', driver: 'Racing Team', qualyLap: '1:22.998', raceBest: '1:23.002', delta: '+0.004', verdict: 'En ritmo', verdictClass: 'good', isOurs: false },
    { rank: 2, rankSuffix: '', kart: '10', driver: 'VUESTRO EQUIPO', qualyLap: '1:23.055', raceBest: '1:23.055', delta: '+0.000', verdict: 'En ritmo', verdictClass: 'good', isOurs: true },
    { rank: 3, rankSuffix: '', kart: '42', driver: 'Kartplanet Pro', qualyLap: '1:23.204', raceBest: '1:23.204', delta: '+0.000', verdict: 'En ritmo', verdictClass: 'good', isOurs: false },
    { rank: 4, rankSuffix: '', kart: '23', driver: 'Delta Racing', qualyLap: '1:23.411', raceBest: '1:24.000', delta: '+0.589', verdict: 'Más lento', verdictClass: 'watch', isOurs: false },
  ],
};

const comments = [
  { time: '18:22', flags: [], text: 'Última vuelta 1:23.455 — mejor del equipo en este stint.' },
  { time: '18:31', flags: ['YELLOW'], text: 'Bandera amarilla en curva 5, kart parado fuera.' },
  { time: '18:44', flags: [], text: 'Kart 23 entra en boxes — posible doble stint con 9 pilotos.' },
];

export default function LivePanels() {
  return (
    <div className="pitboard band">
      <div id="mid-area" className="live-mid">
        <section id="our-panel" className="card">
          <h2>Razonamiento de parada</h2>
          <div id="explanation"><Explanation items={explanationItems} /></div>
        </section>
        <RelativePace paceRows={paceRows} rows={relativeRows} onSelect={noop} />
      </div>
      <div id="below-area" className="live-below">
        <section className="card"><h2>Our Stints</h2><div id="stints"><Stints stints={stints} /></div></section>
        <section className="card"><h2>Qualifying Analysis</h2><Qualy qualy={qualy} message="" onCapture={noop} onClear={noop} /></section>
        <section className="card"><h2>Race Comments</h2><div id="comments"><Comments comments={comments} /></div></section>
      </div>
    </div>
  );
}
