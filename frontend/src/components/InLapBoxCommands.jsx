import { useEffect, useState } from 'react';
import { listDeviceCommands, saveDeviceCommand, deleteDeviceCommand, sendDeviceCommand, listDeviceLogs } from '../api.js';
import { AppIcon } from './AppIcon.jsx';

const COMMAND_DEFS = [
  { type: 'box', label: 'BOX', defaultText: 'BOX', icon: 'flag' },
  { type: 'pos', label: 'Posicion', defaultText: '3o', icon: 'target' },
  { type: 'lapsRace', label: 'Vueltas carrera', defaultText: '3/5', icon: 'route' },
  { type: 'lapsUntilBox', label: 'Vueltas para BOX', defaultText: '3 L', icon: 'clock' },
  { type: 'deltaObjetiveTimeIntermediate', label: 'Delta intermedio', defaultText: '+ 0.172', icon: 'activity' },
  { type: 'deltaObjetiveTimeBad', label: 'Delta malo', defaultText: '+ 1.500', icon: 'arrow-down' },
  { type: 'deltaObjetiveTimeGood', label: 'Delta bueno', defaultText: '- 0.300', icon: 'arrow-up' },
  { type: 'distanceToPilotBehind', label: 'Distancia atras', defaultText: '+ 2.100', icon: 'arrow-down' },
  { type: 'distanceToPilotInFront', label: 'Distancia delante', defaultText: '- 0.800', icon: 'arrow-up' },
];

const INTERVALS = [
  { value: null, label: 'Manual' },
  { value: 1000, label: '1s' },
  { value: 2000, label: '2s' },
  { value: 5000, label: '5s' },
  { value: 10000, label: '10s' },
  { value: 30000, label: '30s' },
  { value: 60000, label: '1 min' },
];

export default function InLapBoxCommands({ deviceId, deviceName, pilotName, connected: initialConnected, onBack }) {
  const [configs, setConfigs] = useState(null);
  const [saving, setSaving] = useState(null);
  const [sendResult, setSendResult] = useState(null);
  const [logs, setLogs] = useState(null);
  const [logsOpen, setLogsOpen] = useState(false);

  useEffect(() => {
    if (!deviceId) return;
    listDeviceCommands(deviceId).then((d) => {
      setConfigs(d.configs || []);
    }).catch(() => setConfigs([]));
  }, [deviceId]);

  function getConfig(cmdType) {
    return (configs || []).find((c) => c.commandType === cmdType);
  }

  async function handleTextChange(cmdDef, text) {
    const existing = getConfig(cmdDef.type);
    setSaving(cmdDef.type);
    try {
      const config = await saveDeviceCommand(deviceId, {
        commandType: cmdDef.type,
        commandText: text,
        intervalMs: existing?.intervalMs ?? null,
        enabled: existing?.enabled ?? true,
      });
      setConfigs((prev) => {
        const list = (prev || []).filter((c) => c.commandType !== cmdDef.type);
        list.push(config.config);
        return list;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  }

  async function handleIntervalChange(cmdDef, intervalMs) {
    const existing = getConfig(cmdDef.type);
    setSaving(cmdDef.type);
    try {
      const config = await saveDeviceCommand(deviceId, {
        commandType: cmdDef.type,
        commandText: existing?.commandText ?? cmdDef.defaultText,
        intervalMs,
        enabled: existing?.enabled ?? true,
      });
      setConfigs((prev) => {
        const list = (prev || []).filter((c) => c.commandType !== cmdDef.type);
        list.push(config.config);
        return list;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  }

  async function handleToggle(cmdDef, enabled) {
    const existing = getConfig(cmdDef.type);
    setSaving(cmdDef.type);
    try {
      const config = await saveDeviceCommand(deviceId, {
        commandType: cmdDef.type,
        commandText: existing?.commandText ?? cmdDef.defaultText,
        intervalMs: existing?.intervalMs ?? null,
        enabled,
      });
      setConfigs((prev) => {
        const list = (prev || []).filter((c) => c.commandType !== cmdDef.type);
        list.push(config.config);
        return list;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  }

  async function handleSendNow(cmdDef) {
    const existing = getConfig(cmdDef.type);
    const text = existing?.commandText ?? cmdDef.defaultText;
    try {
      const result = await sendDeviceCommand(deviceId, cmdDef.type, text);
      setSendResult({ type: cmdDef.type, sent: result.sent });
      setTimeout(() => setSendResult(null), 2000);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDelete(cmdDef) {
    await deleteDeviceCommand(deviceId, cmdDef.type);
    setConfigs((prev) => (prev || []).filter((c) => c.commandType !== cmdDef.type));
  }

  async function loadLogs() {
    try {
      const d = await listDeviceLogs(deviceId, { limit: 30 });
      setLogs(d.logs || []);
    } catch (_) {
      setLogs([]);
    }
  }

  const EVENT_COLORS = {
    connected: 'var(--a-green)',
    disconnected: 'var(--a-muted)',
    auth_failed: 'var(--a-red)',
    device_revoked: 'var(--a-red)',
    command_sent: 'var(--a-gold)',
  };

  return (
    <section className="a-card">
      <div className="a-card-head">
        <div>
          <h2 className="a-card-title">Comandos InLapBox</h2>
          <p className="a-card-sub">
            {deviceName || 'Sin nombre'}
            {pilotName && <span> &middot; Piloto: {pilotName}</span>}
            <span className={`a-dot${initialConnected ? ' ok' : ''}`} style={{ marginLeft: 8 }} />
            {initialConnected ? ' Conectado' : ' Desconectado'}
          </p>
        </div>
        <button className="a-btn" onClick={onBack}><AppIcon name="back" size={14} /> Volver</button>
      </div>

      {!configs && <p className="a-muted">Cargando configuracion...</p>}

      {configs && (
        <div className="a-list">
          {COMMAND_DEFS.map((cmd) => {
            const cfg = getConfig(cmd.type);
            const enabled = cfg?.enabled ?? false;
            const text = cfg?.commandText ?? cmd.defaultText;
            const interval = cfg?.intervalMs ?? null;
            const isSaving = saving === cmd.type;
            const justSent = sendResult?.type === cmd.type;

            return (
              <div className="a-row" key={cmd.type} style={{ flexWrap: 'wrap', gap: 12 }}>
                <div className="a-row-main" style={{ flex: '0 0 auto', minWidth: 160 }}>
                  <span className="a-name">
                    <AppIcon name={cmd.icon} size={16} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                    {cmd.label}
                  </span>
                  <span className="a-sub mono">{cmd.type}</span>
                </div>

                <div className="a-row-actions" style={{ flex: '1 1 auto', flexWrap: 'wrap', gap: 8 }}>
                  <label className="a-toggle-wrap" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={isSaving}
                      onChange={(e) => handleToggle(cmd, e.target.checked)}
                    />
                    <span className="a-sub">{enabled ? 'Activo' : 'Inactivo'}</span>
                  </label>

                  <input
                    className="a-input sm"
                    style={{ width: 100 }}
                    value={text}
                    disabled={!enabled || isSaving}
                    placeholder="texto"
                    onChange={(e) => handleTextChange(cmd, e.target.value)}
                  />

                  <select
                    className="a-input sm"
                    style={{ width: 90 }}
                    value={interval ?? ''}
                    disabled={!enabled || isSaving}
                    onChange={(e) => handleIntervalChange(cmd, e.target.value ? Number(e.target.value) : null)}
                  >
                    {INTERVALS.map((iv) => (
                      <option key={String(iv.value)} value={iv.value ?? ''}>{iv.label}</option>
                    ))}
                  </select>

                  <button
                    className={`a-btn sm${justSent ? ' a-btn-gold' : ''}`}
                    disabled={!initialConnected || isSaving}
                    onClick={() => handleSendNow(cmd)}
                  >
                    <AppIcon name="play" size={13} /> {justSent ? 'Enviado' : 'Enviar'}
                  </button>

                  {cfg && (
                    <button
                      className="a-btn sm a-btn-danger-ghost"
                      disabled={isSaving}
                      onClick={() => handleDelete(cmd)}
                    >
                      <AppIcon name="trash" size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <details style={{ marginTop: 16 }}>
        <summary
          style={{ cursor: 'pointer', color: 'var(--a-muted)', fontSize: 12, userSelect: 'none' }}
          onClick={(e) => {
            if (!logsOpen) loadLogs();
            setLogsOpen(!logsOpen);
          }}
        >
          Logs del dispositivo ({logs?.length ?? 0})
        </summary>
        {logsOpen && (
          <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
            {!logs && <p className="a-muted">Cargando...</p>}
            {logs && logs.length === 0 && <p className="a-muted">Sin eventos registrados</p>}
            {logs && logs.map((l) => (
              <div key={l.id} style={{ padding: '3px 0', borderBottom: '1px solid var(--a-line)', display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--a-muted)', whiteSpace: 'nowrap' }}>
                  {new Date(l.createdAt).toLocaleTimeString()}
                </span>
                <span style={{
                  color: EVENT_COLORS[l.event] || 'var(--a-text)',
                  fontWeight: 600,
                  minWidth: 100,
                }}>
                  {l.event}
                </span>
                <span style={{ color: 'var(--a-text)' }}>{l.detail || ''}</span>
              </div>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}
