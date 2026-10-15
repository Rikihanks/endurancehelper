import { Fragment, useState } from 'react';
import { onboardOrg } from './api.js';
import { AppIcon } from './components/AppIcon.jsx';
import logo from '../assets/inlap-logo-sm.png';

// Onboarding wizard (breadcrumb steps): Equipo -> Pilotos -> Circuito ->
// Estrategia. Ends by creating the org + a default race_config with everything.
const MAX_DRIVERS = 10;

const CATEGORIES = [
  { value: 'fast', label: 'Rápido' },
  { value: 'avg', label: 'Promedio' },
  { value: 'slow', label: 'Lento' },
];

const STEPS = ['Equipo', 'Pilotos', 'Circuito', 'Estrategia'];

const STRATEGY_FIELDS = [
  { key: 'paceGoodSec', label: 'Ritmo bueno (±s)', step: 0.1 },
  { key: 'paceMediocreSec', label: 'Ritmo mediocre (+s)', step: 0.1 },
  { key: 'paceBadSec', label: 'Ritmo malo (+s)', step: 0.1 },
  { key: 'trafficGapSec', label: 'Distancia de tráfico (s)', step: 0.1 },
  { key: 'wetStopFactor', label: 'Factor mojado (×)', step: 0.05 },
  { key: 'ballastPenaltySecPerKg', label: 'Penalización lastre (s/kg)', step: 0.001 },
  { key: 'paceAdjustLaps', label: 'Ajuste ritmo relativo', step: 1 },
  { key: 'paceDropPct', label: 'Caída de ritmo (%)', step: 0.5 },
];

function emptyDrivers() {
  return Array.from({ length: MAX_DRIVERS }, (_, i) => ({
    idx: i,
    name: '',
    weightKg: 75,
    ballastKg: 0,
    category: 'avg',
  }));
}

function defaultStrategy() {
  return {
    paceGoodSec: 0.3,
    paceMediocreSec: 0.5,
    paceBadSec: 1.0,
    trafficGapSec: 0.5,
    wetStopFactor: 0.8,
    ballastPenaltySecPerKg: 0.012,
    paceAdjustLaps: 25,
    paceDropPct: 4,
  };
}

export default function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [drivers, setDrivers] = useState(emptyDrivers());
  const [circuitUrl, setCircuitUrl] = useState('');
  const [strategy, setStrategy] = useState(defaultStrategy());
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  function setDriver(idx, field, val) {
    setDrivers((rows) => rows.map((d) => (d.idx === idx ? { ...d, [field]: val } : d)));
  }
  function setStrategyField(key, val) {
    setStrategy((s) => ({ ...s, [key]: val }));
  }

  function validate(current) {
    if (current === 0) return name.trim() ? '' : '✗ Introduce el nombre del equipo';
    if (current === 1) return drivers.some((d) => d.name.trim()) ? '' : '✗ Añade al menos un piloto';
    return '';
  }

  function next() {
    const err = validate(step);
    if (err) return setMsg(err);
    setMsg('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setMsg('');
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    const err = validate(step);
    if (err) return setMsg(err);
    const clean = drivers
      .map(({ idx, ...d }) => ({ name: d.name.trim(), weightKg: Number(d.weightKg) || 75, ballastKg: Number(d.ballastKg) || 0, category: d.category }))
      .filter((d) => d.name);
    setLoading(true);
    setMsg('');
    try {
      await onboardOrg({ name: name.trim(), drivers: clean, circuitUrl: circuitUrl.trim(), strategy });
      onComplete();
    } catch (e) {
      setMsg(`✗ ${e.message || 'fallo'}`);
      setLoading(false);
    }
  }

  const last = step === STEPS.length - 1;

  return (
    <div className="login-screen">
      <div className="onboarding-card">
        <div className="ob-header">
          <div className="login-logo"><img className="login-logo-img" src={logo} alt="InLap Karting" /></div>
          <h1 className="ob-title">Crea tu equipo</h1>
          <p className="ob-sub">Sigue los pasos para preparar tu configuración inicial. Podrás cambiarlo más tarde.</p>
        </div>

        <nav className="steps">
          {STEPS.map((label, i) => (
            <Fragment key={label}>
              {i > 0 && <span className="step-sep" />}
              <button
                type="button"
                className={`step${i === step ? ' current' : ''}${i < step ? ' done' : ''}`}
                onClick={() => i < step && setStep(i)}
              >
                <span className="step-dot">{i < step ? '✓' : i + 1}</span>
                <span className="step-label">{label}</span>
              </button>
            </Fragment>
          ))}
        </nav>

        {step === 0 && (
          <section className="ob-section">
            <h2 className="ob-section-title">Nombre del equipo</h2>
            <label className="ob-field">
              <span>Nombre</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="p.ej. CANARY KARTING" autoFocus />
            </label>
          </section>
        )}

        {step === 1 && (
          <section className="ob-section">
            <div className="ob-section-head">
              <h2 className="ob-section-title">Pilotos</h2>
              <span className="ob-limit">Hasta {MAX_DRIVERS} pilotos</span>
            </div>
            <div className="ob-drivers">
              <div className="ob-row ob-row-head">
                <span className="ob-idx">#</span>
                <span className="ob-name">Nombre</span>
                <span className="ob-weight">Peso</span>
                <span className="ob-ballast">Lastre</span>
                <span className="ob-cat">Nivel</span>
              </div>
              {drivers.map((d, i) => (
                <div className="ob-row" key={d.idx}>
                  <span className="ob-idx">{i + 1}</span>
                  <input className="ob-name ob-input" type="text" placeholder={`Piloto ${i + 1}`} value={d.name} onChange={(e) => setDriver(d.idx, 'name', e.target.value)} />
                  <input className="ob-weight ob-input" type="number" min="40" placeholder="kg" value={d.weightKg} onChange={(e) => setDriver(d.idx, 'weightKg', e.target.value)} />
                  <input className="ob-ballast ob-input" type="number" min="0" placeholder="kg" value={d.ballastKg} onChange={(e) => setDriver(d.idx, 'ballastKg', e.target.value)} />
                  <select className="ob-cat ob-input" value={d.category} onChange={(e) => setDriver(d.idx, 'category', e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="ob-section">
            <div className="ob-section-head">
              <h2 className="ob-section-title">Circuito Apex</h2>
              <span className="ob-limit">Opcional</span>
            </div>
            <label className="ob-field">
              <span>URL del live timing de Apex</span>
              <input type="text" value={circuitUrl} onChange={(e) => setCircuitUrl(e.target.value)} placeholder="https://.../index.html" autoFocus />
            </label>
            <p className="ob-note">No es obligatorio: puedes dejarlo vacío y añadir el circuito cuando vayas a correr.</p>
          </section>
        )}

        {step === 3 && (
          <section className="ob-section">
            <h2 className="ob-section-title">Umbrales de estrategia por defecto</h2>
            <p className="ob-note">Los puedes ajustar en cualquier momento. Valores orientativos para una resistencia.</p>
            <div className="ob-grid">
              {STRATEGY_FIELDS.map((f) => (
                <label className="ob-field" key={f.key}>
                  <span>{f.label}</span>
                  <input
                    type="number"
                    step={f.step}
                    value={strategy[f.key]}
                    onChange={(e) => setStrategyField(f.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        <div className="ob-nav">
          {step > 0 && (
            <button className="home-btn" onClick={back}>← Atrás</button>
          )}
          {last ? (
            <button className="home-btn home-btn-primary" onClick={submit} disabled={loading}>
              {loading ? 'Creando equipo…' : 'Crear equipo →'}
            </button>
          ) : (
            <button className="home-btn home-btn-primary" onClick={next}>Siguiente →</button>
          )}
        </div>

        {msg && <p className="login-error">{msg}</p>}
      </div>
    </div>
  );
}
