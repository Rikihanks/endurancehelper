import { useState } from 'react';
import Explanation from './Explanation.jsx';

// Carrusel del "Por qué paramos": dos paneles con los mismos strings que genera
// el backend. Panel 1 = la decisión de parada actual; panel 2 = todo lo demás
// (ritmo relativo, tendencia, cierre de pitlane, rivales, referencias).
const PANELS = [
  {
    key: 'decision',
    label: 'Decisión de parada',
    items: [
      { tag: 'porque', text: 'POR QUÉ PARAR (ritmo mediocre): vamos +0,5s más lentos que el objetivo. Adelantamos la parada unas vueltas para no perder la posición virtual. Entrar en unos 2 vueltas.' },
      { tag: 'reloj', text: 'Quedan 68 min de 480 min de carrera (14% por disputar).' },
      { tag: 'ritmo', text: 'Ritmo medio de las últimas vueltas: 1:23.752. Mejor vuelta del kart: 1:23.055.' },
      { tag: 'rival', text: 'Rival detrás: Kartplanet Pro a +1.6s.' },
    ],
  },
  {
    key: 'rest',
    label: 'Todo lo demás',
    items: [
      { tag: 'pos', text: 'Vamos en la posición virtual 3 de 24.' },
      { tag: 'kart', text: 'Ritmo relativo del kart: la media del grid es 1:24.110 y la nuestra es 1:23.752 (0.5% más rápido que la media). Por eso hemos alargado la ventana de parada recomendada.' },
      { tag: 'vel', text: 'Referencia de la parrilla: el mejor tiempo absoluto es 1:22.998; nuestro mejor está a +0.057 de ese punto de referencia.' },
      { tag: 'tend', text: 'Comparado con hace unas vueltas, el ritmo se mantiene estable (+0.010s).' },
      { tag: 'pits', text: 'Paradas obligatorias: 7 hechas de 8, queda 1.' },
      { tag: 'cierre', text: 'El carril de pits cierra en el minuto 440 (dentro de 68 min). La parada que falta hay que encajarla antes de esa hora, o habrá penalización.' },
      { tag: 'rival', text: 'Rival delante: Racing Team a -4.7s.' },
    ],
  },
];

export default function ExplanationCarousel() {
  const [active, setActive] = useState(0);
  const panel = PANELS[active];
  return (
    <div className="expl-carousel">
      <div className="expl-tabs">
        {PANELS.map((p, i) => (
          <button
            key={p.key}
            className={`expl-tab${i === active ? ' active' : ''}`}
            onClick={() => setActive(i)}
          >
            {i === active ? '▸' : ''} {p.label}
          </button>
        ))}
      </div>
      <div className="expl-panel" key={panel.key}>
        <Explanation items={panel.items} />
      </div>
    </div>
  );
}
