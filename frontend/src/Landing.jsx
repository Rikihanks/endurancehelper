import { useEffect, useState } from 'react';
import { AppIcon } from './components/AppIcon.jsx';
import logoSm from '../assets/inlap-logo-sm.png';
import LiveDemo from './components/LiveDemo.jsx';
import LivePanels from './components/LivePanels.jsx';
import PostRaceDemo from './components/PostRaceDemo.jsx';

// Landing page — misma marca que la app (asfalto · ámbar · tiza, Big Shoulders /
// IBM Plex / Archivo). Copy del dolor real del endurance: paradas, pitlane
// cerrado, posición virtual. Ruta "/" ; la app vive en "/app".

// The RaceBox PoC link is only exposed during development or inside the native
// Capacitor container, so the public landing page is unchanged for users.
function showPocLink() {
  if (import.meta.env.DEV) return true;
  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  try {
    return !!cap && (cap.isNativePlatform ? cap.isNativePlatform() : cap.getPlatform?.() !== 'web');
  } catch (_) {
    return false;
  }
}

// Teaser compacto para el hero: cuenta atrás + delta + mini carril de pits.
function HeroLive() {
  const [sec, setSec] = useState(4 * 3600 + 12 * 60 + 47);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => (s <= 0 ? 4 * 3600 : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  const stops = [12, 24, 36, 48, 60, 72, 84, 96];

  return (
    <div className="hero-live">
      <div className="hero-live-top">
        <div>
          <span className="hero-live-cap">Tiempo restante</span>
          <div className="hero-live-clock">{h}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</div>
        </div>
        <div className="hero-live-stops">
          <span className="hero-live-cap">Paradas</span>
          <span>7 / 8</span>
        </div>
      </div>
      <div className="hero-live-delta">VUESTRO EQUIPO · 3º · 2 vueltas para parar</div>
      <div className="tl-track hero-live-track">
        <div className="tl-progress" style={{ width: '42%' }} />
        {stops.map((l, i) => (
          <div className="tl-stop" key={i} style={{ left: `${l}%` }} title={`Parada ${i + 1}`}>
            <span className={`tl-cone ${i < 7 ? 'done' : 'todo'}`} />
          </div>
        ))}
        <span className="tl-flag tl-flag-start" />
        <span className="tl-flag tl-flag-end" />
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="/"><img className="landing-logo" src={logoSm} alt="InLap Karting" /> InLap Karting</a>
        <a className="landing-cta-sm" href="/app">Login</a>
      </header>

      {/* HERO — el momento exacto, no la app */}
      <section className="landing-hero">
        <div className="landing-hero-inner">
          <h1 className="landing-title">
            <span className="landing-accent">Porque en una resistencia de 12 horas es complicado tenerlo todo en cuenta.</span>
          </h1>
          <p className="landing-sub">
            InLap, calculado para ti: cuándo entrar, cuántas vueltas quedan,
            el rival que te persigue y si el carril de pits sigue abierto. Sin Excel, sin cálculo mental bajo presión.
          </p>
          <div className="landing-cta-row">
            <a className="landing-cta" href="/app">Ver InLap en acción <AppIcon name="play" size={16} style={{ verticalAlign: '-3px', marginLeft: 6 }} /></a>
            <a className="landing-cta-ghost" href="#como">Cómo funciona</a>
          </div>
        </div>
        <div className="landing-hero-shot">
          <HeroLive />
        </div>
      </section>

      {/* EL PROBLEMA */}
      <section className="landing-section" id="problema">
        <h2 className="landing-h2">Una parada mal calculada cuesta una posición, o un podio.</h2>
        <p className="landing-body">
          A las 10 de la noche, con el cansancio de llevar corriendo 11 horas, nadie calcula en la cabeza qué parada conviene:
          si entras una vuelta antes regalas un stint al de detrás; si entras una vuelta después, sales detrás de
          un grupo y pierdes diez segundos en tráfico. Y si el <strong>pitlane cierra</strong> con la parada sin
          hacer, son sanciones y posición regalada.
        </p>
        <p className="landing-body">
          Los equipos de resistencia llevan años haciendo este cálculo en papel, entre parada y parada, bajo presión.
          Eso es exactamente lo que InLap hace por ti, en vivo.
        </p>
      </section>

      {/* CÓMO FUNCIONA */}
      <section className="landing-section" id="como">
        <h2 className="landing-h2">Tres pasos, y tu pit-board está en marcha</h2>
        <div className="landing-steps">
          <div className="landing-step">
            <span className="landing-step-num">1</span>
            <h3>Elige el circuito</h3>
            <p className="landing-body">Selecciona tu circuito de entre los disponibles</p>
            <div className="landing-step-shot">
              <span className="landing-fakecap">-</span>
              <span className="landing-fakeinput">kartcenter-campillos</span>
              <span className="landing-fakeinput">kartcenter-campillos</span>
            </div>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">2</span>
            <h3>Configura tu carrera</h3>
            <p className="landing-body">Duración, paradas obligatorias, pilotos y su orden. Guardado por equipo para la siguiente carrera.</p>
            <div className="landing-step-shot">
              <div className="landing-drivers">
                <span>P1 · Alfa</span><span>P2 · Bravo</span><span>P3 · Charlie</span><span>P4 · Delta</span>
              </div>
              <span className="landing-fakecap">Paradas obligatorias: 8 · Duración: 8 h</span>
            </div>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">3</span>
            <h3>La app calcula la parada, en vivo</h3>
            <p className="landing-body">Ritmo del kart, tráfico, meteorología y ventana de pitlane: el porqué de cada parada, explicado.</p>
            <div className="landing-step-shot">
              <span className="landing-fakereason">POR QUÉ PARAR: ritmo mediocre frente al objetivo. Entrar en 2 vueltas.</span>
            </div>
          </div>
        </div>
      </section>

      {/* LA PANTALLA EN ACCIÓN */}
      <section className="landing-section landing-action" id="pantalla">
        <h2 className="landing-h2">Así se ve una carrera en InLap</h2>
        <p className="landing-body">
          Números grandes para leer de lejos, datos en mono como un cronómetro real, y la línea de carrera
          dibujada como un carril de pits. Nuestro kart marcado a mano, como un pit-board.
        </p>
        <div className="demo-wrap">
          <LiveDemo />
        </div>
        <div className="expl-wrap">
          <h3 className="landing-h3">El porqué de cada parada, explicado</h3>
          <p className="landing-body">
            Y el resto de InLap: por qué paramos con números, el ritmo relativo del grid, los stints,
            el análisis de la qualy y los comentarios de carrera. La app no se limita a decir "para ya":
            explica por qué, en cada momento.
          </p>
          <div className="demo-wrap">
            <LivePanels />
          </div>
        </div>
      </section>

      {/* ANÁLISIS POST-CARRERA */}
      <section className="landing-section" id="postcarrera">
        <h2 className="landing-h2">La carrera termina. El análisis, no.</h2>
        <p className="landing-body">
          Al acabar, InLap te deja el postmortem de la resistencia: quién fue el más rápido, en qué relevos
          se ganaron o perdieron posiciones, si cada parada se hizo a tiempo, antes o después de lo previsto,
          cuánto tiempo se perdió en boxes y la evolución de la posición y del ritmo. Todo guardado para
          comparar temporadas.
        </p>
        <div className="postrace-wrap">
          <PostRaceDemo />
        </div>
      </section>

      {/* PLANES */}
      <section className="landing-section" id="planes">
        <h2 className="landing-h2">Nada de tres modalidades diferentes, aquí está todo incluido. Eliges cómo pagas.</h2>
        <p className="landing-body">Hecho por pilotos, para pilotos.</p>
        <div className="landing-plans">
          <div className="landing-plan">
            <h3>Mensual (7€)</h3>
            <span className="landing-price">Mes a mes </span>
            <ul>
              <li>Hasta 10 pilotos</li>
              <li>Análisis post-carrera</li>
              <li>Telemetría por sesión</li>
              <li>Distintas configuraciones para cada resistencia</li>
            </ul>
            <a className="landing-cta-ghost" href="/app">Empezar</a>
          </div>
          <div className="landing-plan landing-plan-feat">
            <span className="landing-tag">MÁS BARATO</span>
            <h3>Anual (76.89)</h3>
            <span className="landing-price">Paga una vez al año · 1 mes de regalo</span>
            <ul>
              <li>Todo lo del plan mensual</li>
              <li>Mejor precio por carrera</li>
              <li>Histórico de todas tus temporadas</li>
            </ul>
            <a className="landing-cta" href="/app">Empezar</a>
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="landing-section landing-final">
        <h2 className="landing-title landing-final-title">
          Céntrate en conducir,
          <br />
          <span className="landing-accent">con InLap sabrás exactamente cuándo parar.</span>
        </h2>
        <a className="landing-cta landing-cta-big" href="/app">Ver InLap en acción <AppIcon name="play" size={18} style={{ verticalAlign: '-3px', marginLeft: 8 }} /></a>
      </section>

      <footer className="landing-footer">
        <span>InLap Karting</span>
        <a href="/app">Login</a>
        <span>Por pilotos y para pilotos.</span>
        {showPocLink() && (
          <a href="#racebox" title="Diagnóstico BLE RaceBox (PoC)">
            RaceBox PoC
          </a>
        )}
      </footer>
    </div>
  );
}
