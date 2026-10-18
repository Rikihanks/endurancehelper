import {
  hasFix,
  hasValidTime,
  isPositionValid,
} from '../../services/devices/racebox/RaceBoxTypes.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function num(value, digits = 1, suffix = '') {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fixLabel(status) {
  if (status == null) return '—';
  if (status === 0) return 'Sin fix';
  if (status === 2) return 'Fix 2D';
  if (status === 3) return 'Fix 3D';
  return `Fix tipo ${status}`;
}

function deviceTime(record) {
  if (!record) return '—';
  if (!hasValidTime(record)) return '— (sin hora GNSS)';
  return `${record.year}-${pad2(record.month)}-${pad2(record.day)} ${pad2(record.hour)}:${pad2(
    record.minute,
  )}:${pad2(record.second)} UTC`;
}

function ageText(lastPacketAt, now) {
  if (!lastPacketAt) return '—';
  const seconds = Math.max(0, (now - lastPacketAt) / 1000);
  return `${seconds.toFixed(1)} s`;
}

function flags(byte) {
  return `0x${(byte & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
}

function Field({ label, value, hint }) {
  return (
    <div className="rb-field">
      <span className="rb-field-label">{label}</span>
      <span className="rb-field-value">{value}</span>
      {hint && <span className="rb-field-hint">{hint}</span>}
    </div>
  );
}

export default function RaceBoxDataPanel({ snapshot, now }) {
  const r = snapshot.latest;
  const positionValid = isPositionValid(r);
  const coordinatesInvalid = r ? (r.latLonFlags & 0x01) === 1 : false;

  return (
    <section className="rb-card">
      <div className="rb-card-head">
        <h2>Datos RaceBox</h2>
        <span className={`rb-pill ${snapshot.receiving ? 'rb-pill-receiving' : 'rb-pill-idle'}`}>
          {snapshot.receiving ? 'recepción activa' : 'sin suscripción'}
        </span>
      </div>

      <div className="rb-metrics">
        <div className="rb-metric">
          <span>Paquetes</span>
          <b>{snapshot.packets}</b>
        </div>
        <div className="rb-metric">
          <span>Tramas</span>
          <b>{snapshot.frames}</b>
        </div>
        <div className="rb-metric">
          <span>Errores de decodificación</span>
          <b className={snapshot.decodeErrors > 0 ? 'rb-off' : ''}>{snapshot.decodeErrors}</b>
        </div>
        <div className="rb-metric">
          <span>Frecuencia aprox.</span>
          <b>{snapshot.packetsPerSecond ? `${snapshot.packetsPerSecond.toFixed(1)} Hz` : '—'}</b>
        </div>
        <div className="rb-metric">
          <span>Desde el último paquete</span>
          <b>{ageText(snapshot.lastPacketAt, now)}</b>
        </div>
        <div className="rb-metric">
          <span>Bytes pendientes</span>
          <b>{snapshot.pendingBytes}</b>
        </div>
      </div>

      {!r ? (
        <p className="rb-muted">
          Sin datos todavía. Conecta la RaceBox Mini S, pulsa «Iniciar recepción» y espera a que
          haya fix GPS al aire libre.
        </p>
      ) : (
        <>
          {!positionValid && (
            <div className="rb-alert rb-alert-warn">
              <b>Sin solución GNSS (sin fix).</b> La RaceBox todavía no ha fijado satélites, por eso
              latitud, longitud, velocidad y rumbo llegan a cero y la fecha aparece como
              2020-08-02. Esto es lo que reporta el propio dispositivo, no un fallo de InLap: la app
              oficial muestra exactamente lo mismo. Sal al aire libre con vista despejada del cielo
              y espera unos segundos hasta que el fix sea 3D (≥4 satélites).
              <div className="rb-hint">
                fixStatus={fixLabel(r.fixStatus)} · satélites={r.numSVs} · {flags(r.fixFlags)} ·{' '}
                coordenadas {coordinatesInvalid ? 'marcadas como NO válidas' : 'válidas'}
              </div>
            </div>
          )}

          <div className="rb-data-grid">
            <Field
              label="Latitud"
              value={`${num(r.latitude, 7)}°`}
              hint={coordinatesInvalid ? 'WGS84 · no válida (sin fix)' : 'WGS84'}
            />
            <Field
              label="Longitud"
              value={`${num(r.longitude, 7)}°`}
              hint={coordinatesInvalid ? 'WGS84 · no válida (sin fix)' : 'WGS84'}
            />
            <Field label="Velocidad" value={num(r.speed, 1, ' km/h')} hint="ground speed" />
            <Field label="Rumbo" value={num(r.heading, 1, '°')} />
            <Field
              label="Aceleración"
              value={`${num(r.gForceX, 0)}, ${num(r.gForceY, 0)}, ${num(r.gForceZ, 0)}`}
              hint="mG · X/Y/Z"
            />
            <Field
              label="Giro"
              value={`${num(r.rotRateX / 100, 1)}, ${num(r.rotRateY / 100, 1)}, ${num(
                r.rotRateZ / 100,
                1,
              )}`}
              hint="deg/s · roll/pitch/yaw"
            />
            <Field label="Hora del dispositivo" value={deviceTime(r)} hint="UTC" />
            <Field label="iTOW" value={num(r.iTOW, 0, ' ms')} hint="GPS time of week" />
            <Field
              label="GPS"
              value={`${fixLabel(r.fixStatus)} · ${r.numSVs} sat`}
              hint={hasFix(r.fixStatus) ? 'posición utilizable' : 'sin posición utilizable'}
            />
            <Field
              label="Altitud"
              value={num(r.altitude, 1, ' m')}
              hint={coordinatesInvalid ? 'no válida (sin fix)' : 'sobre nivel del mar'}
            />
            <Field label="Precisión horizontal" value={num(r.horizontalAccuracy, 1, ' m')} />
            <Field label="Precisión de velocidad" value={num(r.speedAccuracy, 1, ' km/h')} />
            <Field label="PDOP" value={num(r.pdop / 100, 2)} hint="×100 en el payload" />
            <Field
              label="Batería"
              value={`${r.batteryLevel} %`}
              hint={r.charging ? 'cargando' : 'descargando'}
            />
          </div>

          <h3>Flags del dispositivo</h3>
          <div className="rb-flags">
            <span>Fix Status Flags <b>{flags(r.fixFlags)}</b> · valid fix {r.fixFlags & 1} · valid heading {(r.fixFlags >> 5) & 1}</span>
            <span>Lat/Lon Flags <b>{flags(r.latLonFlags)}</b> · {coordinatesInvalid ? 'coordenadas inválidas' : 'coordenadas válidas'}</span>
            <span>Validity Flags <b>{flags(r.validityFlags)}</b> · fecha válida {r.validityFlags & 1} · hora válida {(r.validityFlags >> 1) & 1}</span>
            <span>Date/Time Flags <b>{flags(r.dateTimeFlags)}</b></span>
          </div>

          {snapshot.latestFrameHex && (
            <>
              <h3>Último frame (diagnóstico)</h3>
              <p className="rb-hint">
                Frame UBX completo (88 bytes): sync + clase + id + longitud + payload (80) +
                checksum Fletcher-16. Compáralo con el ejemplo oficial de la revisión 9.
              </p>
              <pre className="rb-hex">{snapshot.latestFrameHex}</pre>
            </>
          )}

          {snapshot.recent.length > 1 && (
            <>
              <h3>Últimos registros</h3>
              <div className="rb-table-wrap">
                <table className="rb-table">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Lat</th>
                      <th>Lon</th>
                      <th>km/h</th>
                      <th>Fix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.recent
                      .slice(-8)
                      .reverse()
                      .map((rec, idx) => (
                        <tr key={`${rec.iTOW}-${idx}`}>
                          <td className="rb-mono">
                            {hasValidTime(rec)
                              ? `${pad2(rec.hour)}:${pad2(rec.minute)}:${pad2(rec.second)}`
                              : '—'}
                          </td>
                          <td className="rb-mono">{num(rec.latitude, 7)}</td>
                          <td className="rb-mono">{num(rec.longitude, 7)}</td>
                          <td className="rb-mono">{num(rec.speed, 1)}</td>
                          <td>{fixLabel(rec.fixStatus)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
