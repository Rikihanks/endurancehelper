// Topbar: renders the pre-formatted strings from the backend view model and
// forwards user input (weather, surface, pilot, stops, stepper) to the backend.
// In the authed/desktop layout the gear + offline controls live in the MenuBar
// (showControls=false); legacy mode keeps them here.
import { AppIcon } from './AppIcon.jsx';
import logo from '../../assets/inlap-logo-sm.png';

export default function Topbar({ view, config, onWeather, onSurface, onPilot, onObjective, onNextStop, onCallPitStop = () => {}, onOpenSettings, onToggleOffline, showControls = true }) {
  const t = view.topbar;
  return (
    <header id="topbar">
      <div className="tb-seg tb-clock">
        <span className="tb-cap">Tiempo restante</span>
        <div id="countdown">{t.countdown}</div>
      </div>

      <div className="tb-seg tb-cond">
        <span className="tb-cap">Condición</span>
        <select
          id="weather-select"
          className="tb-select"
          value={t.weatherValue}
          onChange={(e) => onWeather(e.target.value)}
        >
          <option value="soleado">Soleado</option>
          <option value="nublado">Nublado</option>
          <option value="lluvia">Lluvia</option>
          <option value="tormenta">Tormenta</option>
        </select>
        <br />
        <span className="tb-cap">Superficie</span>
        <select
          id="surface-select"
          className="tb-select"
          value={t.trackConditionValue}
          onChange={(e) => onSurface(e.target.value)}
        >
          <option value="dry">Seco</option>
          <option value="damp">Húmedo</option>
          <option value="wet">Mojado</option>
          <option value="puddle">Charco</option>
        </select>
      </div>

      <div className="tb-seg tb-team" style={{ '--tb-logo': `url(${logo})` }}>
        <div id="team-name">{t.teamName}</div>
        <div id="driver-line">
          <span id="driver-pos">{t.driverPos}</span> <span id="driver-name">{t.driverName}</span>
        </div>
        <div id="driver-delta">{t.driverDelta}</div>
        <div id="surface-badge" className={`surface-badge${t.surfaceBadge.wet ? ' wet' : ''}`}>
          {t.surfaceBadge.text}
        </div>
        <div className="tb-pilot">
          <label>Piloto</label>
          <select
            id="pilot-select"
            className="tb-select sm"
            value={String(t.manualDriverIdx >= 0 ? t.manualDriverIdx : -1)}
            onChange={(e) => onPilot(e.target.value)}
          >
            <option value="-1">Auto (orden)</option>
            {t.pilotOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tb-seg tb-stops">
        <span className="tb-cap">Paradas</span>
        <div className="tb-stops-row">
          <select id="stops-detail" className="tb-select stops" title="Detalle de paradas">
            <option>{t.stopsLabel}</option>
            {t.stopsDetail.map((s) => (
              <option key={s.index}>
                P{s.index} {s.done ? '✓ hecha' : '▶ prevista'} · min {s.atMin}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tb-seg tb-next">
        <span className="tb-cap">Vueltas para parar</span>
        <div id="stepper" className="stepper">
          <button id="nextstop-minus" className="topbar-adj" onClick={() => onNextStop(-1)}>−</button>
          <input
            id="nextstop-input"
            type="number"
            min="0"
            step="1"
            value={t.nextStop.value}
            className={t.nextStop.urgent ? 'urgent' : ''}
            onChange={(e) => onNextStop(e.target.value)}
          />
          <button id="nextstop-plus" className="topbar-adj" onClick={() => onNextStop(1)}>+</button>
        </div>
        <button id="call-pitstop" className="topbar-call" title="Poner el contador a 0 y avisar de la parada" onClick={onCallPitStop}>
          Llamar a parada
        </button>
      </div>

      <div className="tb-seg tb-status" title={view.track ? `Circuito: ${view.track}` : view.circuitUrl ? `Circuito: ${view.circuitUrl}` : 'Sin circuito configurado'}>
        <span className="tb-cap">Conexión</span>
        <div
          className={`conn-pill ${view.offline ? 'offline' : view.connected ? 'live' : view.connectionState === 'connecting' || view.connectionState === 'reconnecting' ? 'connecting' : 'dead'}${!view.connected && !view.offline ? ' clickable' : ''}`}
          role={!view.connected && !view.offline ? 'button' : undefined}
          tabIndex={!view.connected && !view.offline ? 0 : undefined}
          title={!view.connected && !view.offline ? 'Abrir configuración del circuito' : undefined}
          onClick={!view.connected && !view.offline ? onOpenSettings : undefined}
          onKeyDown={!view.connected && !view.offline ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') onOpenSettings();
          } : undefined}
        >
          <span className="conn-dot" />
          {view.offline ? 'OFFLINE' : view.connected ? 'EN VIVO' : view.connectionState === 'connecting' || view.connectionState === 'reconnecting' ? 'CONECTANDO' : view.connectionState === 'idle' ? 'NO CONECTADO' : 'SIN SEÑAL'}
        </div>
      </div>

      {showControls && (
        <div className="tb-seg tb-gear">
          <button id="open-settings" className="gear-btn" title="Configuración" onClick={onOpenSettings}><AppIcon name="settings" size={20} /></button>
          <button id="offline-btn" className={`offline-chip${view.offline ? ' on' : ''}`} title="Modo offline" onClick={onToggleOffline}>
            {view.offline ? 'Back to live' : 'Offline'}
          </button>
        </div>
      )}
    </header>
  );
}
