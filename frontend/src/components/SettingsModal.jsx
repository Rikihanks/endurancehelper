import { useEffect, useState } from 'react';
import { AppIcon } from './AppIcon.jsx';

// Settings modal: a dumb form. It fetches the current config from the backend
// to populate the fields, lets the user edit them, and POSTs the values back.
// No strategy is computed here.
export default function SettingsModal({ open, config, onSave, onClose, onReconnect }) {
  const [form, setForm] = useState(() => emptyForm(config));
  const [msg, setMsg] = useState('');
  const [circuitMsg, setCircuitMsg] = useState('');
  const [circuitBusy, setCircuitBusy] = useState(false);
  const [numDrivers, setNumDrivers] = useState(config?.race?.numDrivers || 4);

  useEffect(() => {
    if (open) {
      setForm(emptyForm(config));
      setNumDrivers(config?.race?.numDrivers || 4);
      setMsg('');
      setCircuitMsg('');
      setCircuitBusy(false);
    }
  }, [open, config]);

  if (!open) return null;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function collectDrivers() {
    return form.driverRows.map((r) => ({
      order: parseInt(r.order, 10) || 0,
      name: r.name,
      weightKg: parseInt(r.weightKg, 10) || 0,
      ballastKg: parseInt(r.ballastKg, 10) || 0,
      category: r.category,
    }));
  }

  async function handleSave() {
    const driverOrder = [...form.driverRows]
      .sort((a, b) => (parseInt(a.order, 10) || 0) - (parseInt(b.order, 10) || 0))
      .map((d) => d.idx);
    const payload = {
      ourKart: form.ourKart,
      ourTeamName: form.ourTeamName,
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
      drivers: collectDrivers(),
      driverOrder,
      paceGoodSec: form.paceGoodSec,
      paceMediocreSec: form.paceMediocreSec,
      paceBadSec: form.paceBadSec,
      trafficGapSec: form.trafficGapSec,
      wetStopFactor: form.wetStopFactor,
      ballastPenaltySecPerKg: form.ballastPenaltySecPerKg,
      paceAdjustLaps: form.paceAdjustLaps,
      paceDropPct: form.paceDropPct,
      theme: form.theme,
    };
    setMsg('Guardando configuración…');
    try {
      await onSave(payload);
    } catch (e) {
      setMsg(`✗ ${e.message || 'no se pudo guardar'}`);
    }
  }

  async function handleReconnect() {
    if (!form.circuitUrl.trim()) {
      setCircuitMsg('✗ Introduce la URL del circuito');
      return;
    }
    setCircuitBusy(true);
    setCircuitMsg('Conectando…');
    try {
      await onReconnect(form.circuitUrl.trim());
      setCircuitMsg('✓ Circuito conectado');
      setTimeout(() => setCircuitMsg(''), 4000);
    } catch (e) {
      setCircuitMsg(`✗ ${e.message || 'no se pudo conectar'}`);
    } finally {
      setCircuitBusy(false);
    }
  }

  const driverRows = form.driverRows || [];
  const maxDrivers = Math.max(1, numDrivers);

  return (
    <div id="settings-modal" className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card">
        <div className="modal-head">
          <h2><AppIcon name="settings" size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Configuración</h2>
          <button className="modal-x" title="Cerrar" onClick={onClose}><AppIcon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="theme-row">
            <span className="theme-label">Tema</span>
            <div className="theme-toggle">
              <span className={`theme-opt${form.theme === 'dark' ? ' active' : ''}`} data-theme-val="dark" onClick={() => setForm((f) => ({ ...f, theme: 'dark' }))}><AppIcon name="moon" size={16} /></span>
              <span className={`theme-opt${form.theme === 'light' ? ' active' : ''}`} data-theme-val="light" onClick={() => setForm((f) => ({ ...f, theme: 'light' }))}><AppIcon name="sun" size={16} /></span>
            </div>
          </div>

          <details id="pre-race" className="pre-race-details" open>
            <summary>Configuración de carrera</summary>
            <div className="pre-race-body">
              <div className="pre-grid">
                <label>Circuit URL<input id="circuit-input" className="wide" type="text" value={form.circuitUrl} onChange={set('circuitUrl')} placeholder="https://.../index.html" /></label>
                   <button type="button" className="btn-sec" onClick={handleReconnect} disabled={circuitBusy}>
                  {circuitBusy ? 'Conectando…' : 'Conectar circuito'}
                </button>
                
                <span className="circuit-msg" data-state={circuitBusy ? 'busy' : ''}>{circuitMsg}</span>
             
                <label>Nombre del equipo<input id="teamname-input" type="text" value={form.ourTeamName} onChange={set('ourTeamName')} /></label>
                <label>Dorsal<input id="kart-input" type="number" value={form.ourKart} onChange={set('ourKart')} /></label>
                <label>Duración (min)<input id="duration-input" type="number" value={form.raceDurationMin} onChange={set('raceDurationMin')} /></label>
                <label>Paradas obligatorias<input id="stops-input" type="number" value={form.mandatoryStops} onChange={set('mandatoryStops')} /></label>
                <label>Tiempo mínimo de parada (s)<input id="minpittime-input" type="number" value={form.minPitTimeSec} onChange={set('minPitTimeSec')} /></label>
                <label>Pitlane cierra (min)<input id="pitclose-input" type="number" value={form.pitCloseMin} onChange={set('pitCloseMin')} /></label>
                <label>Previsión de tiempo<select id="forecast-select" value={form.weatherForecast} onChange={set('weatherForecast')}>
                  <option value="dry">Seco</option><option value="damp">Húmedo</option><option value="wet">Mojado</option><option value="rain">Lluvia</option>
                </select></label>
                <label>Nº de pilotos<input id="numdrivers-input" type="number" min="1" max="8" value={numDrivers} onChange={(e) => setNumDrivers(Math.max(1, parseInt(e.target.value, 10) || 1))} /></label>
                <label>Cambio de piloto por parada<select id="driverchange-select" value={form.driverChangePerStop} onChange={set('driverChangePerStop')}>
                  <option value="true">Sí</option><option value="false">No</option>
                </select></label>
                <label>Stint mínimo (min)<input id="stintmin-input" type="number" value={form.stintMinMin} onChange={set('stintMinMin')} /></label>
                <label>Stint máximo (min)<input id="stintmax-input" type="number" value={form.stintMaxMin} onChange={set('stintMaxMin')} /></label>
                <label>Parada obligatoria cada (min)<input id="stopsevery-input" type="number" min="0" value={form.mandatoryStopEveryMin} onChange={set('mandatoryStopEveryMin')} placeholder="0 = desactivado" /></label>
                <label>Cambio de kart sin cambio de piloto<select id="kartchange-select" value={form.kartChangeOnly} onChange={set('kartChangeOnly')}>
                  <option value="true">Sí</option><option value="false">No</option>
                </select></label>
                <label>Objetivo de carrera<select id="objective-select" value={form.raceObjective} onChange={set('raceObjective')}>
                  <option value="adelantar">Adelantar</option><option value="mantener">Mantener posición</option>
                </select></label>
              </div>
              <div className="drivers-head">
                <span>Pilotos del equipo </span>
              </div>
              <div className="driver-head"><span>Orden</span><span>Nombre</span><span>Peso</span><span>Lastre</span><span>Nivel</span></div>
              {Array.from({ length: maxDrivers }).map((_, i) => {
                const d = driverRows[i] || { idx: i, order: i + 1, name: '', weightKg: 75, ballastKg: 0, category: 'avg' };
                return (
                  <div className="driver-row" key={i} data-idx={i}>
                    <input className="drv-order" type="number" min="1" max={maxDrivers} value={d.order}
                      onChange={(e) => updateDriver(i, 'order', e.target.value)} />
                    <input className="drv-name" type="text" placeholder={`Piloto ${i + 1}`} value={d.name}
                      onChange={(e) => updateDriver(i, 'name', e.target.value)} />
                    <input className="drv-weight" type="number" min="40" placeholder="kg" value={d.weightKg}
                      onChange={(e) => updateDriver(i, 'weightKg', e.target.value)} />
                    <input className="drv-ballast" type="number" min="0" placeholder="lastre" value={d.ballastKg}
                      onChange={(e) => updateDriver(i, 'ballastKg', e.target.value)} />
                    <select className="drv-cat" value={d.category} onChange={(e) => updateDriver(i, 'category', e.target.value)}>
                      <option value="fast">Rápido</option><option value="avg">Promedio</option><option value="slow">Lento</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </details>

          <details id="strategy-settings" className="pre-race-details" open>
            <summary>Umbrales de estrategia</summary>
            <div className="pre-race-body">
              <div className="pre-grid">
                <label><span>Ritmo bueno (±s vs objetivo) <i className="tip" title="Si nuestro ritmo medio está dentro de ±X s del tiempo objetivo, mantenemos el plan de parada sin cambios.">?</i></span><input id="pacegood-input" type="number" step="0.1" value={form.paceGoodSec} onChange={set('paceGoodSec')} /></label>
                <label><span>Ritmo mediocre (+s) <i className="tip" title="Si vamos +X s o más lentos que el objetivo, adelantamos la próxima parada unas vueltas para no perder la posición virtual.">?</i></span><input id="pacemediocre-input" type="number" step="0.1" value={form.paceMediocreSec} onChange={set('paceMediocreSec')} /></label>
                <label><span>Ritmo malo (+s) <i className="tip" title="Si vamos +X s o más lentos que el objetivo, paramos lo antes posible (stint mínimo) para no acabar haciendo una parada extra.">?</i></span><input id="pacebad-input" type="number" step="0.1" value={form.paceBadSec} onChange={set('paceBadSec')} /></label>
                <label><span>Distancia de tráfico (s) <i className="tip" title="Distancia al rival por debajo de la cual consideramos que estamos en lucha/tráfico.">?</i></span><input id="trafficgap-input" type="number" step="0.1" value={form.trafficGapSec} onChange={set('trafficGapSec')} /></label>
                <label><span>Factor mojado (×) <i className="tip" title="Multiplicador del stint cuando la pista está mojada o lluviosa.">?</i></span><input id="wetstop-input" type="number" step="0.05" value={form.wetStopFactor} onChange={set('wetStopFactor')} /></label>
                <label><span>Penalización lastre (s/kg) <i className="tip" title="Segundos por kg de lastre que se suman al tiempo por vuelta.">?</i></span><input id="ballastpenalty-input" type="number" step="0.001" value={form.ballastPenaltySecPerKg} onChange={set('ballastPenaltySecPerKg')} /></label>
                <label><span>Ajuste ritmo relativo <i className="tip" title="Con qué fuerza desplaza el ritmo relativo del kart la ventana de parada.">?</i></span><input id="paceadjust-input" type="number" step="1" value={form.paceAdjustLaps} onChange={set('paceAdjustLaps')} /></label>
                <label><span>Caída de ritmo (%) <i className="tip" title="Si el ritmo medio cae más de este % respecto a la mejor vuelta, lo marcamos como perdiendo ritmo.">?</i></span><input id="pacedrop-input" type="number" step="0.5" value={form.paceDropPct} onChange={set('paceDropPct')} /></label>
              </div>
            </div>
          </details>
        </div>
        <div className="modal-footer">
          <span id="save-msg">{msg}</span>
          <button id="save-settings" onClick={handleSave}>Guardar configuración</button>
        </div>
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

function emptyForm(config) {
  const rc = config?.race || {};
  const drvs = rc.drivers || [];
  const n = Math.max(1, rc.numDrivers || drvs.length || 4);
  const order =
    Array.isArray(rc.driverOrder) && rc.driverOrder.length
      ? rc.driverOrder
      : drvs.map((_, i) => i);
  const driverRows = [];
  for (let i = 0; i < n; i++) {
    const d = drvs[i] || {};
    driverRows.push({
      idx: i,
      order: (order.indexOf(i) + 1) || (i + 1),
      name: d.name || '',
      weightKg: d.weightKg || 75,
      ballastKg: d.ballastKg || 0,
      category: d.category || 'avg',
    });
  }
  const st = config?.strategy || {};
  return {
    circuitUrl: config?.apex?.circuitUrl || '',
    ourKart: rc.ourKart || '',
    ourTeamName: rc.ourTeamName || '',
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
    theme: config?.ui?.theme || 'dark',
  };
}
