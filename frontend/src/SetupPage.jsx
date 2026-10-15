import { useEffect, useState } from 'react';
import {
  getConfig,
  saveSetup,
  createRaceConfig,
  updateRaceConfig,
  getRaceConfig,
  startRaceSession,
} from './api.js';
import { AppIcon } from './components/AppIcon.jsx';
import logo from '../assets/inlap-logo-sm.png';

// Setup page: collects all pre-race data.
//  - Legacy mode (no auth): POSTs to /api/setup (resolves circuit + connects).
//  - Authed mode (SaaS): creates a race_config and starts a DB race session.
export default function SetupPage({ authed = false, configId = null, onDone, onCancel }) {
  const [form, setForm] = useState(emptyForm());
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('eh-theme') || 'dark');
  const [configName, setConfigName] = useState('');
  const [configMsg, setConfigMsg] = useState('');
  const [editId, setEditId] = useState(configId); // race_config being edited (null = new)
  const [originalName, setOriginalName] = useState(''); // name of the config being edited

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        setForm(loadFromConfig(cfg));
      } catch (_) {
        /* keep defaults */
      }
    })();
  }, []);

  // Edit mode (authed): prefill from an existing race_config.
  useEffect(() => {
    if (!authed || !configId) return;
    (async () => {
      try {
        const d = await getRaceConfig(configId);
        if (d.config) {
          setForm(loadFromConfig(d.config.payload));
          setConfigName(d.config.name);
          setOriginalName(d.config.name);
        }
      } catch (_) {
        /* keep defaults */
      }
    })();
  }, [authed, configId]);

  // A changed name means a NEW config: saving creates a fresh one and switches
  // the editor to it (the original config is left untouched).
  async function saveConfig(name) {
    if (editId && name === originalName) {
      return (await updateRaceConfig(editId, { name, payload: collectConfig() })).config;
    }
    const created = await createRaceConfig({ name, payload: collectConfig() });
    setEditId(created.config.id);
    setOriginalName(name);
    return created.config;
  }

  async function handleSaveConfig() {
    const name = configName.trim();
    if (!name) return setConfigMsg('✗ Ponle un nombre a la configuración');
    try {
      await saveConfig(name);
      setConfigMsg(editId ? '✓ Configuración actualizada' : '✓ Configuración guardada');
    } catch (e) {
      setConfigMsg(`✗ ${e.message || 'fallo'}`);
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function handleNumDrivers(e) {
    const n = Math.max(1, parseInt(e.target.value, 10) || 1);
    setForm((f) => ({
      ...f,
      numDrivers: n,
      driverRows: Array.from({ length: n }).map((_, i) => f.driverRows[i] || { idx: i, order: i + 1, name: '', weightKg: 75, ballastKg: 0, category: 'avg' }),
    }));
  }

  function collectSetup() {
    const driverOrder = [...form.driverRows]
      .sort((a, b) => (parseInt(a.order, 10) || 0) - (parseInt(b.order, 10) || 0))
      .map((d) => d.idx);
    return {
      circuitUrl: form.circuitUrl.trim(),
      ourTeamName: form.ourTeamName,
      ourKart: form.ourKart,
      raceDurationMin: form.raceDurationMin,
      mandatoryStops: form.mandatoryStops,
      minPitTimeSec: form.minPitTimeSec,
      pitCloseMin: form.pitCloseMin,
      weatherForecast: form.weatherForecast,
      numDrivers: form.numDrivers,
      driverChangePerStop: form.driverChangePerStop === 'true',
      stintMinMin: form.stintMinMin,
      stintMaxMin: form.stintMaxMin,
      mandatoryStopEveryMin: Number(form.mandatoryStopEveryMin) || 0,
      kartChangeOnly: form.kartChangeOnly === 'true',
      raceObjective: form.raceObjective,
      drivers: form.driverRows.map(({ order, ...rest }) => rest),
      driverOrder,
      paceGoodSec: form.paceGoodSec,
      paceMediocreSec: form.paceMediocreSec,
      paceBadSec: form.paceBadSec,
      trafficGapSec: form.trafficGapSec,
      wetStopFactor: form.wetStopFactor,
      ballastPenaltySecPerKg: form.ballastPenaltySecPerKg,
      paceAdjustLaps: form.paceAdjustLaps,
      paceDropPct: form.paceDropPct,
      theme,
    };
  }

  // Full config-shaped payload for race_configs (sections), frozen on race start.
  function collectConfig() {
    return {
      race: {
        ourTeamName: form.ourTeamName,
        ourKart: form.ourKart,
        raceDurationMin: form.raceDurationMin,
        mandatoryStops: form.mandatoryStops,
        minPitTimeSec: form.minPitTimeSec,
        pitCloseMin: form.pitCloseMin,
        weatherForecast: form.weatherForecast,
        numDrivers: form.numDrivers,
        driverChangePerStop: form.driverChangePerStop === 'true',
        stintMinMin: form.stintMinMin,
        stintMaxMin: form.stintMaxMin,
        mandatoryStopEveryMin: Number(form.mandatoryStopEveryMin) || 0,
        kartChangeOnly: form.kartChangeOnly === 'true',
        raceObjective: form.raceObjective,
        drivers: form.driverRows.map(({ order, ...rest }) => rest),
        driverOrder: [...form.driverRows]
          .sort((a, b) => (parseInt(a.order, 10) || 0) - (parseInt(b.order, 10) || 0))
          .map((d) => d.idx),
      },
      strategy: {
        paceGoodSec: form.paceGoodSec,
        paceMediocreSec: form.paceMediocreSec,
        paceBadSec: form.paceBadSec,
        trafficGapSec: form.trafficGapSec,
        wetStopFactor: form.wetStopFactor,
        ballastPenaltySecPerKg: form.ballastPenaltySecPerKg,
        paceAdjustLaps: form.paceAdjustLaps,
        paceDropPct: form.paceDropPct,
      },
      ui: { theme },
      apex: { circuitUrl: form.circuitUrl.trim() },
    };
  }

  async function handleStart() {
    // Authed mode: save/update a race_config and start a DB race session.
    if (authed) {
      if (!form.ourTeamName.trim()) return setMsg('✗ Introduce el nombre del equipo');
      if (!form.ourKart) return setMsg('✗ Introduce el dorsal');
      const name = configName.trim();
      if (!name) return setMsg('✗ Ponle un nombre a la configuración');
      setLoading(true);
      setMsg('Guardando configuración y creando la sesión...');
      try {
        const cfg = await saveConfig(name);
        const started = await startRaceSession(cfg.id);
        onDone?.(started.session.id);
      } catch (e) {
        setMsg(`✗ ${e.message || 'fallo'}`);
        setLoading(false);
      }
      return;
    }

    // Legacy mode.
    if (!form.ourTeamName.trim()) return setMsg('✗ Introduce el nombre del equipo');
    if (!form.ourKart) return setMsg('✗ Introduce el dorsal');
    if (!form.circuitUrl.trim()) return setMsg('✗ Introduce la URL del circuito');
    setLoading(true);
    setMsg('Conectando...');
    try {
      const d = await saveSetup(collectSetup());
      if (d && d.ok) {
        setMsg('✓ Setup guardado. Cargando la app...');
        setTimeout(() => (window.location.href = '/'), 800);
      } else {
        setMsg('✗ Fallo al guardar el setup');
      }
    } catch (e) {
      setMsg(`✗ ${e.message || 'fallo'}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="setup-page">
      <div id="setup-card">
        <div className="setup-title">
          <h1><img className="setup-logo" src={logo} alt="InLap" /> Endurance Helper</h1>
          <p>Configura la carrera antes de empezar</p>
          <div className="theme-row">
            <span className="theme-label">Tema</span>
            <div className="theme-toggle">
              <span className={`theme-opt${theme === 'dark' ? ' active' : ''}`} onClick={() => { setTheme('dark'); localStorage.setItem('eh-theme', 'dark'); }}><AppIcon name="moon" size={16} /></span>
              <span className={`theme-opt${theme === 'light' ? ' active' : ''}`} onClick={() => { setTheme('light'); localStorage.setItem('eh-theme', 'light'); }}><AppIcon name="sun" size={16} /></span>
            </div>
          </div>
        </div>

        {authed && onCancel && (
          <div className="setup-back">
            <button className="home-btn home-btn-ghost" onClick={onCancel}><AppIcon name="back" size={16} style={{ verticalAlign: '-3px', marginRight: 4 }} /> Volver al inicio</button>
          </div>
        )}

        {authed && (
          <section className="setup-section">
            <h2>1 · Configuración</h2>
            <div className="setup-grid">
              <label className="field">
                <span>Nombre de la configuración</span>
                <input
                  type="text"
                  value={configName}
                  onChange={(e) => setConfigName(e.target.value)}
                  placeholder="p.ej. K1 8H"
                />
              </label>
              <div className="field setup-save">
                <span>Guardar sin empezar</span>
                <button id="save-config-btn" className="setup-btn" onClick={handleSaveConfig}>
                  {editId ? 'Guardar cambios' : 'Guardar configuración'}
                </button>
              </div>
            </div>
            <div id="config-msg">{configMsg}</div>
          </section>
        )}

        <section className="setup-section">
          <h2>{authed ? '2 ·' : '1 ·'} Circuito</h2>
          <label className="field">
            <span>URL del live timing de Apex</span>
            <input id="circuit-input" type="text" value={form.circuitUrl} onChange={set('circuitUrl')} placeholder="https://.../index.html" />
          </label>
        </section>

        <section className="setup-section">
          <h2>3 · Equipo</h2>
          <div className="setup-grid">
            <label className="field"><span>Nombre del equipo</span><input id="teamname-input" type="text" value={form.ourTeamName} onChange={set('ourTeamName')} placeholder="p.ej. CANARY KARTING" /></label>
            <label className="field"><span>Dorsal</span><input id="kart-input" type="number" value={form.ourKart} onChange={set('ourKart')} placeholder="p.ej. 78" /></label>
          </div>
        </section>

        <section className="setup-section">
          <h2>4 · Carrera</h2>
          <div className="setup-grid">
            <label className="field"><span>Duración (min)</span><input id="duration-input" type="number" value={form.raceDurationMin} onChange={set('raceDurationMin')} /></label>
            <label className="field"><span>Paradas obligatorias</span><input id="stops-input" type="number" value={form.mandatoryStops} onChange={set('mandatoryStops')} /></label>
            <label className="field"><span>Tiempo mínimo de parada (s)</span><input id="minpittime-input" type="number" value={form.minPitTimeSec} onChange={set('minPitTimeSec')} /></label>
            <label className="field"><span>Pitlane cierra (min)</span><input id="pitclose-input" type="number" value={form.pitCloseMin} onChange={set('pitCloseMin')} /></label>
            <label className="field"><span>Previsión de tiempo</span>
              <select id="forecast-select" value={form.weatherForecast} onChange={set('weatherForecast')}>
                <option value="dry">Seco</option><option value="damp">Húmedo</option><option value="wet">Mojado</option><option value="rain">Lluvia</option>
              </select>
            </label>
          </div>
        </section>

        <section className="setup-section">
          <h2>5 · Pilotos y estrategia</h2>
          <div className="setup-grid">
            <label className="field"><span>Nº de pilotos</span><input id="numdrivers-input" type="number" min="1" max="10" value={form.numDrivers} onChange={handleNumDrivers} /></label>
            <label className="field"><span>Cambio de piloto por parada</span>
              <select id="driverchange-select" value={form.driverChangePerStop} onChange={set('driverChangePerStop')}>
                <option value="true">Sí</option><option value="false">No</option>
              </select>
            </label>
            <label className="field"><span>Stint mínimo (min)</span><input id="stintmin-input" type="number" value={form.stintMinMin} onChange={set('stintMinMin')} /></label>
            <label className="field"><span>Stint máximo (min)</span><input id="stintmax-input" type="number" value={form.stintMaxMin} onChange={set('stintMaxMin')} /></label>
            <label className="field"><span>Parada obligatoria cada (min) <i className="tip" title="Formato de resistencia con cambio de kart programado: el kart debe entrar cada X minutos (0 = desactivado).">?</i></span><input id="stopsevery-input" type="number" min="0" value={form.mandatoryStopEveryMin} onChange={set('mandatoryStopEveryMin')} placeholder="0 = desactivado" /></label>
            <label className="field"><span>Cambio de kart sin cambio de piloto</span>
              <select id="kartchange-select" value={form.kartChangeOnly} onChange={set('kartChangeOnly')}>
                <option value="true">Sí</option><option value="false">No</option>
              </select>
            </label>
            <label className="field"><span>Objetivo de carrera</span>
              <select id="objective-select" value={form.raceObjective} onChange={set('raceObjective')}>
                <option value="adelantar">Adelantar</option><option value="mantener">Mantener posición</option>
              </select>
            </label>
          </div>
          <div className="drivers-head"><span>Pilotos del equipo </span></div>
          <div className="driver-head"><span>Orden</span><span>Nombre</span><span>Peso</span><span>Lastre</span><span>Nivel</span></div>
          {form.driverRows.map((d, i) => (
            <div className="driver-row" key={i} data-idx={i}>
              <input className="drv-order" type="number" min="1" max={form.numDrivers} value={d.order} onChange={(e) => updateDriver(i, 'order', e.target.value)} />
              <input className="drv-name" type="text" placeholder={`Piloto ${i + 1}`} value={d.name} onChange={(e) => updateDriver(i, 'name', e.target.value)} />
              <input className="drv-weight" type="number" min="40" placeholder="kg" value={d.weightKg} onChange={(e) => updateDriver(i, 'weightKg', e.target.value)} />
              <input className="drv-ballast" type="number" min="0" placeholder="lastre" value={d.ballastKg} onChange={(e) => updateDriver(i, 'ballastKg', e.target.value)} />
              <select className="drv-cat" value={d.category} onChange={(e) => updateDriver(i, 'category', e.target.value)}>
                <option value="fast">Rápido</option><option value="avg">Promedio</option><option value="slow">Lento</option>
              </select>
            </div>
          ))}
        </section>

        <section className="setup-section">
          <h2>6 · Umbrales de Estrategia </h2>
          <div className="setup-grid">
            <label className="field"><span>Ritmo bueno (±s vs objetivo) <i className="tip" title="Si nuestro ritmo medio está dentro de ±X s del tiempo objetivo, mantenemos el plan de parada sin cambios.">?</i></span><input id="pacegood-input" type="number" step="0.1" value={form.paceGoodSec} onChange={set('paceGoodSec')} /></label>
            <label className="field"><span>Ritmo mediocre (+s) <i className="tip" title="Si vamos +X s o más lentos que el objetivo, adelantamos la próxima parada.">?</i></span><input id="pacemediocre-input" type="number" step="0.1" value={form.paceMediocreSec} onChange={set('paceMediocreSec')} /></label>
            <label className="field"><span>Ritmo malo (+s) <i className="tip" title="Si vamos +X s o más lentos que el objetivo, paramos lo antes posible.">?</i></span><input id="pacebad-input" type="number" step="0.1" value={form.paceBadSec} onChange={set('paceBadSec')} /></label>
            <label className="field"><span>Distancia de tráfico (s) <i className="tip" title="Distancia al rival por debajo de la cual estamos en lucha/tráfico.">?</i></span><input id="trafficgap-input" type="number" step="0.1" value={form.trafficGapSec} onChange={set('trafficGapSec')} /></label>
            <label className="field"><span>Factor mojado (×) <i className="tip" title="Multiplicador del stint cuando la pista está mojada.">?</i></span><input id="wetstop-input" type="number" step="0.05" value={form.wetStopFactor} onChange={set('wetStopFactor')} /></label>
            <label className="field"><span>Penalización lastre (s/kg) <i className="tip" title="Segundos por kg de lastre que se suman al tiempo por vuelta.">?</i></span><input id="ballastpenalty-input" type="number" step="0.001" value={form.ballastPenaltySecPerKg} onChange={set('ballastPenaltySecPerKg')} /></label>
            <label className="field"><span>Ajuste ritmo relativo <i className="tip" title="Con qué fuerza desplaza el ritmo relativo la ventana de parada.">?</i></span><input id="paceadjust-input" type="number" step="1" value={form.paceAdjustLaps} onChange={set('paceAdjustLaps')} /></label>
            <label className="field"><span>Caída de ritmo (%) <i className="tip" title="Si el ritmo medio cae más de este % respecto a la mejor vuelta.">?</i></span><input id="pacedrop-input" type="number" step="0.5" value={form.paceDropPct} onChange={set('paceDropPct')} /></label>
          </div>
        </section>

        <button id="start-btn" onClick={handleStart} disabled={loading}>
          {loading ? 'Guardando...' : authed ? 'Guardar y comenzar →' : 'Comenzar carrera →'}
        </button>
        <div id="setup-msg">{msg}</div>
      </div>
    </div>
  );

  function updateDriver(idx, field, val) {
    setForm((f) => ({
      ...f,
      driverRows: f.driverRows.map((d) => (d.idx === idx ? { ...d, [field]: val } : d)),
    }));
  }
}

function emptyForm() {
  return {
    circuitUrl: '',
    ourTeamName: '',
    ourKart: '',
    raceDurationMin: 120,
    mandatoryStops: 8,
    minPitTimeSec: 30,
    pitCloseMin: 110,
    weatherForecast: 'dry',
    numDrivers: 4,
    driverChangePerStop: 'true',
    stintMinMin: 10,
    stintMaxMin: 40,
    mandatoryStopEveryMin: 0,
    kartChangeOnly: 'false',
    raceObjective: 'adelantar',
    driverRows: Array.from({ length: 4 }).map((_, i) => ({ idx: i, order: i + 1, name: '', weightKg: 75, ballastKg: 0, category: 'avg' })),
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

function loadFromConfig(cfg) {
  const rc = cfg?.race || {};
  const drvs = rc.drivers || [];
  const n = Math.max(1, rc.numDrivers || drvs.length || 4);
  const order = Array.isArray(rc.driverOrder) && rc.driverOrder.length ? rc.driverOrder : drvs.map((_, i) => i);
  const driverRows = [];
  for (let i = 0; i < n; i++) {
    const d = drvs[i] || {};
    driverRows.push({ idx: i, order: (order.indexOf(i) + 1) || (i + 1), name: d.name || '', weightKg: d.weightKg || 75, ballastKg: d.ballastKg || 0, category: d.category || 'avg' });
  }
  const st = cfg?.strategy || {};
  return {
    circuitUrl: cfg?.apex?.circuitUrl || '',
    ourTeamName: rc.ourTeamName || '',
    ourKart: rc.ourKart || '',
    raceDurationMin: rc.raceDurationMin ?? 120,
    mandatoryStops: rc.mandatoryStops ?? 8,
    minPitTimeSec: rc.minPitTimeSec ?? 30,
    pitCloseMin: rc.pitCloseMin ?? 110,
    weatherForecast: rc.weatherForecast || 'dry',
    numDrivers: n,
    driverChangePerStop: rc.driverChangePerStop ? 'true' : 'false',
    stintMinMin: rc.stintMinMin ?? 10,
    stintMaxMin: rc.stintMaxMin ?? 40,
    mandatoryStopEveryMin: rc.mandatoryStopEveryMin ?? 0,
    kartChangeOnly: rc.kartChangeOnly ? 'true' : 'false',
    raceObjective: rc.raceObjective || 'adelantar',
    driverRows,
    paceGoodSec: st.paceGoodSec ?? 0.3,
    paceMediocreSec: st.paceMediocreSec ?? 0.5,
    paceBadSec: st.paceBadSec ?? 1.0,
    trafficGapSec: st.trafficGapSec ?? 0.5,
    wetStopFactor: st.wetStopFactor ?? 0.8,
    ballastPenaltySecPerKg: st.ballastPenaltySecPerKg ?? 0.012,
    paceAdjustLaps: st.paceAdjustLaps ?? 25,
    paceDropPct: st.paceDropPct ?? 4,
  };
}
