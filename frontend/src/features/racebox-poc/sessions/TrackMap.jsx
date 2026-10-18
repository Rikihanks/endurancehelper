import { useMemo } from 'react';

// SVG racing line from GPS points, coloured by speed, with a moving marker.
// Mirrors the official app's "racing line" view: no map tiles, so it works
// offline and inside the native app.

const VIEW_W = 1000;

function speedColor(speed, min, max) {
  if (!Number.isFinite(speed)) return '#888';
  const t = max > min ? (speed - min) / (max - min) : 0;
  // blue -> cyan -> green -> yellow -> red
  const hue = 240 - Math.max(0, Math.min(1, t)) * 240;
  return `hsl(${hue.toFixed(0)}, 85%, 52%)`;
}

export default function TrackMap({ points, markerIndex = -1, height = 440 }) {
  const geom = useMemo(() => {
    if (!points || points.length < 2) return null;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minSpeed = Infinity;
    let maxSpeed = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
      const s = p.speed || 0;
      if (s < minSpeed) minSpeed = s;
      if (s > maxSpeed) maxSpeed = s;
    }
    const meanLat = (minLat + maxLat) / 2;
    const cosLat = Math.cos((meanLat * Math.PI) / 180);
    const spanX = (maxLon - minLon) * cosLat || 1e-9;
    const spanY = maxLat - minLat || 1e-9;
    const viewH = Math.max(120, Math.round((VIEW_W * spanY) / spanX));
    const project = (p) => ({
      x: ((p.lon - minLon) * cosLat * VIEW_W) / spanX,
      y: ((maxLat - p.lat) * viewH) / spanY,
    });
    const projected = points.map(project);
    return { projected, viewH, minSpeed, maxSpeed };
  }, [points]);

  if (!geom) {
    return <p className="rb-muted">Sin puntos GPS suficientes para dibujar la trazada.</p>;
  }

  const { projected, viewH, minSpeed, maxSpeed } = geom;
  const marker = markerIndex >= 0 ? projected[Math.min(markerIndex, projected.length - 1)] : null;

  return (
    <div className="rb-track" style={{ height }}>
      <svg viewBox={`0 0 ${VIEW_W} ${viewH}`} preserveAspectRatio="xMidYMid meet" className="rb-track-svg">
        <polyline
          points={projected.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="var(--border2)"
          strokeWidth={10}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.5}
        />
        {projected.slice(0, -1).map((p, i) => {
          const q = projected[i + 1];
          const speed = points[i].speed || 0;
          return (
            <line
              key={i}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke={speedColor(speed, minSpeed, maxSpeed)}
              strokeWidth={4}
              strokeLinecap="round"
            />
          );
        })}
        {/* start / finish */}
        <circle cx={projected[0].x} cy={projected[0].y} r={9} fill="#fff" stroke="#111" strokeWidth={2} />
        <text x={projected[0].x} y={projected[0].y - 14} textAnchor="middle" fontSize="22" fill="#fff">
          S/F
        </text>
        {marker && (
          <>
            <circle cx={marker.x} cy={marker.y} r={14} fill="none" stroke="#fff" strokeWidth={3} />
            <circle cx={marker.x} cy={marker.y} r={6} fill="#fff" />
          </>
        )}
      </svg>
      <div className="rb-track-scale">
        <span>{minSpeed.toFixed(0)} km/h</span>
        <span className="rb-track-gradient" />
        <span>{maxSpeed.toFixed(0)} km/h</span>
      </div>
    </div>
  );
}
