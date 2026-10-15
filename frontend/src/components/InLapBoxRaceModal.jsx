import { useEffect, useState } from 'react';
import { listEsp32Devices, listDeviceCommands, saveDeviceCommand, sendDeviceCommand } from '../api.js';
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

export default function InLapBoxRaceModal({ open, onClose, activeDriverName }) {
  const [devices, setDevices] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [configs, setConfigs] = useState(null);
  const [connected, setConnected] = useState(false);
  const [saving, setSaving] = useState(null);
  const [sendResult, setSendResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDevices(null);
    setSelectedDevice(null);
    setConfigs(null);
    listEsp32Devices().then((d) => {
      const list = d.devices || [];
      setDevices(list);
      if (list.length === 1) {
        setSelectedDevice(list[0]);
      } else if (list.length > 1 && activeDriverName) {
        const match = list.find((dv) => dv.pilotName === activeDriverName);
        if (match) setSelectedDevice(match);
      }
    }).catch(() => setDevices([]));
  }, [open, activeDriverName]);

  useEffect(() => {
    if (!selectedDevice) { setConfigs(null); return; }
    listDeviceCommands(selectedDevice.id).then((d) => {
      setConfigs(d.configs || []);
      setConnected(d.connected);
    }).catch(() => setConfigs([]));
  }, [selectedDevice?.id]);

  if (!open) return null;

  function getConfig(cmdType) {
    return (configs || []).find((c) => c.commandType === cmdType);
  }

  async function handleToggle(cmdDef, enabled) {
    if (!selectedDevice) return;
    const existing = getConfig(cmdDef.type);
    setSaving(cmdDef.type);
    try {
      const config = await saveDeviceCommand(selectedDevice.id, {
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
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  async function handleTextChange(cmdDef, text) {
    if (!selectedDevice) return;
    const existing = getConfig(cmdDef.type);
    setSaving(cmdDef.type);
    try {
      const config = await saveDeviceCommand(selectedDevice.id, {
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
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  async function handleIntervalChange(cmdDef, intervalMs) {
    if (!selectedDevice) return;
    const existing = getConfig(cmdDef.type);
    setSaving(cmdDef.type);
    try {
      const config = await saveDeviceCommand(selectedDevice.id, {
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
    } catch (e) { console.error(e); }
    finally { setSaving(null); }
  }

  async function handleSendNow(cmdDef) {
    if (!selectedDevice) return;
    const existing = getConfig(cmdDef.type);
    const text = existing?.commandText ?? cmdDef.defaultText;
    try {
      const result = await sendDeviceCommand(selectedDevice.id, cmdDef.type, text);
      setSendResult({ type: cmdDef.type, sent: result.sent });
      setTimeout(() => setSendResult(null), 2000);
    } catch (e) { console.error(e); }
  }

  return (
    <div className="modal-overlay modal-overlay-center" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Comandos InLapBox</h2>
          {activeDriverName && <p>Piloto activo: {activeDriverName}</p>}
          <button className="modal-x" title="Cerrar" onClick={onClose}><AppIcon name="x" size={18} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: '65vh' }}>
          {devices && devices.length > 1 && (
            <select className="a-input" style={{ marginBottom: 12 }} value={selectedDevice?.id || ''} onChange={(e) => setSelectedDevice(devices.find((d) => d.id === e.target.value))}>
              <option value="">Seleccionar dispositivo...</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.deviceName || d.uuid}{d.pilotName ? ` (${d.pilotName})` : ''}</option>
              ))}
            </select>
          )}

          {!devices && <p className="muted">Cargando dispositivos...</p>}
          {devices && devices.length === 0 && <p className="muted">No hay dispositivos registrados.</p>}
          {selectedDevice && !configs && <p className="muted">Cargando configuracion...</p>}

          {selectedDevice && configs && (
            <>
              <p className="sub" style={{ marginBottom: 10, fontSize: 12, opacity: 0.7 }}>
                {selectedDevice.deviceName || selectedDevice.uuid}
                {selectedDevice.pilotName && <span> &middot; {selectedDevice.pilotName}</span>}
                {connected ? ' - Conectado' : ' - Desconectado'}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {COMMAND_DEFS.map((cmd) => {
                  const cfg = getConfig(cmd.type);
                  const enabled = cfg?.enabled ?? false;
                  const text = cfg?.commandText ?? cmd.defaultText;
                  const interval = cfg?.intervalMs ?? null;
                  const isSaving = saving === cmd.type;
                  const justSent = sendResult?.type === cmd.type;

                  return (
                    <div key={cmd.type} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--line, #333)', flexWrap: 'wrap' }}>
                      <span style={{ minWidth: 130, fontSize: 13, whiteSpace: 'nowrap' }}>
                        <AppIcon name={cmd.icon} size={14} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                        {cmd.label}
                      </span>
                      <input type="checkbox" checked={enabled} disabled={isSaving} onChange={(e) => handleToggle(cmd, e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent, #E2A33D)' }} />
                      <input className="a-input" style={{ width: 65, fontSize: 12, padding: '4px 6px' }} value={text} disabled={!enabled || isSaving} onChange={(e) => handleTextChange(cmd, e.target.value)} />
                      <select className="a-input" style={{ width: 70, fontSize: 12, padding: '4px 6px' }} value={interval ?? ''} disabled={!enabled || isSaving} onChange={(e) => handleIntervalChange(cmd, e.target.value ? Number(e.target.value) : null)}>
                        {INTERVALS.map((iv) => (
                          <option key={String(iv.value)} value={iv.value ?? ''}>{iv.label}</option>
                        ))}
                      </select>
                      <button className={`a-btn${justSent ? ' a-btn-gold' : ''}`} disabled={!connected || isSaving} onClick={() => handleSendNow(cmd)} style={{ fontSize: 11, padding: '4px 10px' }}>
                        {justSent ? 'OK' : 'Enviar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
