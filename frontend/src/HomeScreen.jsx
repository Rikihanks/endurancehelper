import { useEffect, useState } from 'react';
import {
  listRaceConfigs,
  listRaceSessions,
  startRaceSession,
  finishRaceSession,
  deleteRaceSession,
  deleteRaceConfig,
} from './api.js';
import { AppIcon } from './components/AppIcon.jsx';
import logo from '../assets/inlap-logo-sm.png';

const STATUS_LABEL = {
  running: 'EN DIRECTO',
  idle: 'SIN CONEXIÓN',
  finished: 'FINALIZADA',
  stopped: 'DETENIDA',
  recovering: 'RECUPERANDO',
  created: 'CREADA',
};

const PLAN_LABEL = { monthly: 'MENSUAL', annual: 'ANUAL' };

// Friendlier name from a circuit URL: "…/kartcenter-campillos/index.html" -> "kartcenter campillos".
function circuitName(url) {
  if (!url) return 'Resistencia';
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() || new URL(url).hostname;
    return seg.replace(/-/g, ' ');
  } catch (_) {
    return url;
  }
}

export default function HomeScreen({ team, plan, onStartSession, onOpenSession, onOpenReport, onCreateConfig, onEditConfig, onLogout, onOpenTeam, onOpenAdmin, isAdmin, orgRole }) {
  const [configs, setConfigs] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [msg, setMsg] = useState('');
  const [starting, setStarting] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const c = await listRaceConfigs();
      setConfigs(c.configs || []);
    } catch (_) {
      setConfigs([]);
    }
    try {
      const s = await listRaceSessions();
      setSessions(s.sessions || []);
    } catch (_) {
      setSessions([]);
    }
  }

  async function start(configId) {
    setStarting(configId);
    setMsg('');
    try {
      const d = await startRaceSession(configId);
      onStartSession(d.session.id);
    } catch (e) {
      setMsg(`✗ ${e.message || 'fallo'}`);
      setStarting(null);
    }
  }

  async function removeConfig(id) {
    if (!window.confirm('¿Borrar esta configuración?')) return;
    setMsg('');
    try {
      await deleteRaceConfig(id);
      setConfigs((cs) => (cs || []).filter((c) => c.id !== id));
    } catch (e) {
      setMsg(`✗ ${e.message || 'fallo'}`);
    }
  }

  async function removeSession(id) {
    if (!window.confirm('¿Borrar esta sesión? No se podrá recuperar.')) return;
    setMsg('');
    try {
      await deleteRaceSession(id);
      setSessions((ss) => (ss || []).filter((s) => s.id !== id));
    } catch (e) {
      setMsg(`✗ ${e.message || 'fallo'}`);
    }
  }

  const fmtDateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString() : '-');
  const fmtTimeOnly = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-');

  const planText = plan ? `ACTIVA · PLAN ${PLAN_LABEL[plan] || plan}` : 'SIN LICENCIA';

  // mono data line for a config row: duration · pilots · stops
  const configMeta = (c) => {
    const r = c?.payload?.race || {};
    const parts = [];
    if (r.raceDurationMin) parts.push(`${r.raceDurationMin} min`);
    if (r.numDrivers) parts.push(`${r.numDrivers} pilotos`);
    if (r.mandatoryStops) parts.push(`${r.mandatoryStops} paradas`);
    return parts.join(' · ');
  };

  return (
    <div className="home-screen">
      <header className="home-head">
        <div className="home-head-main">
          <div className="home-team-row">
            <img className="home-logo" src={logo} alt="InLap" />
            <h1 className="home-team">{team || 'Mi equipo'}</h1>
          </div>
          <span className="home-license">
            <span className={`home-license-dot${plan ? ' on' : ''}`} />
            {planText}
          </span>
        </div>
        <div className="home-head-actions">
          {(onOpenTeam && (orgRole === 'owner' || orgRole === 'admin' || isAdmin)) && (
            <button className="home-logout ghost" onClick={onOpenTeam}>Equipo</button>
          )}
          {onOpenAdmin && isAdmin && (
            <button className="home-logout" onClick={onOpenAdmin}>Admin</button>
          )}
          {onLogout && (
            <button className="home-logout" onClick={onLogout}>Salir</button>
          )}
        </div>
      </header>

      <div className="home-board">
        {/* Configuraciones de carrera */}
        <section className="home-col">
          <h2 className="home-col-title">Configuraciones de carrera</h2>
          {configs === null ? (
            <p className="muted">Cargando configuraciones…</p>
          ) : configs.length === 0 ? (
            <div className="home-empty">
              <p className="muted">Todavía no hay configuraciones guardadas.</p>
              <button className="home-start" onClick={onCreateConfig}>Crear configuración nueva</button>
            </div>
          ) : (
            <div className="home-rows">
              {configs.map((c) => (
                <div className="home-row" key={c.id}>
                  <div className="home-row-main">
                    <span className="home-row-name">{c.name}</span>
                    <span className="home-row-meta">{configMeta(c)}</span>
                  </div>
                  <div className="home-row-actions">
                    <button className="home-edit" onClick={() => onEditConfig?.(c.id)}>Editar</button>
                    <button className="home-icon" title="Borrar configuración" onClick={() => removeConfig(c.id)}>
                      <AppIcon name="trash" size={15} />
                    </button>
                    <button className="home-start" onClick={() => start(c.id)} disabled={starting === c.id}>
                      {starting === c.id ? 'Creando…' : 'Comenzar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {configs && configs.length > 0 && (
            <button className="home-new" onClick={onCreateConfig}>+ Nueva configuración</button>
          )}
        </section>

        {/* Sesiones anteriores */}
        <section className="home-col">
          <h2 className="home-col-title">Sesiones anteriores</h2>
          {sessions === null ? (
            <p className="muted">Cargando sesiones…</p>
          ) : sessions.length === 0 ? (
            <p className="muted">No hay sesiones todavía.</p>
          ) : (
            <table className="home-sessions">
              <thead>
                <tr>
                  <th>Circuito</th>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const isLive = s.status === 'running' && s.live;
                  const isRunning = s.status === 'running';
                  return (
                    <tr
                      key={s.id}
                      title={isRunning ? 'Abrir sesión' : 'Ver análisis'}
                      onClick={() => (isRunning ? onOpenSession(s.id) : onOpenReport(s.id))}
                    >
                      <td className="home-s-circuit">{circuitName(s.circuitUrl)}</td>
                      <td className="mono">{fmtDateOnly(s.startedAt)}</td>
                      <td className="mono">{fmtTimeOnly(s.startedAt)}</td>
                      <td className={`home-s-status${isLive ? ' live' : ''}`}>
                        {isRunning ? (isLive ? 'EN DIRECTO' : 'SIN CONEXIÓN') : STATUS_LABEL[s.status] || s.status}
                      </td>
                      <td className="home-s-del">
                        <button
                          className="home-icon"
                          title="Borrar sesión"
                          onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
                        >
                          <AppIcon name="trash" size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {msg && <p className="home-msg">{msg}</p>}
    </div>
  );
}
