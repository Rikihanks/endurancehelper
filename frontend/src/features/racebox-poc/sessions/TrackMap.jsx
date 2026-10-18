import { useEffect, useMemo, useRef, useState } from 'react';
import { projectPath, rotatePoint } from '../mapGeometry.js';

// SVG racing line from GPS points, coloured by speed, with a moving marker.
// Mirrors the official app's "racing line" view: no map tiles, so it works
// offline and inside the native app.
//
// The track can be rotated so it fits the screen: a phone in landscape fits a
// tall circuit badly, so the default is to pick the orientation that fills the
// container best, and the button cycles auto -> 0 -> 90 -> 180 -> 270 -> auto.

function speedColor(speed, min, max) {
  if (!Number.isFinite(speed)) return '#888';
  const t = max > min ? (speed - min) / (max - min) : 0;
  const hue = 240 - Math.max(0, Math.min(1, t)) * 240;
  return `hsl(${hue.toFixed(0)}, 85%, 52%)`;
}

export default function TrackMap({
  points,
  markerIndex = -1,
  marker = null,
  height = 440,
  rotatable = true,
}) {
  const wrapRef = useRef(null);
  const [autoRot, setAutoRot] = useState(0);
  const [userRot, setUserRot] = useState(null); // null = auto

  const center = useMemo(() => {
    if (!points || points.length < 2) return null;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const lat = (minLat + maxLat) / 2;
    const lon = (minLon + maxLon) / 2;
    const spanY = maxLat - minLat || 1e-9;
    const spanX = (maxLon - minLon) * Math.cos((lat * Math.PI) / 180) || 1e-9;
    return { lat, lon, spanX, spanY };
  }, [points]);

  // Choose the rotation that fills the container best (only 0 or 90).
  useEffect(() => {
    if (!rotatable || userRot != null || !center) return undefined;
    const el = wrapRef.current;
    const measure = () => {
      const w = (el && el.clientWidth) || 0;
      const h = (el && el.clientHeight) || 0;
      if (!w || !h) return;
      const trackPortrait = center.spanY > center.spanX;
      const boxPortrait = h > w;
      setAutoRot(trackPortrait === boxPortrait ? 0 : 90);
    };
    if (typeof ResizeObserver === 'undefined') {
      measure();
      return undefined;
    }
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [rotatable, userRot, center]);

  const rot = userRot != null ? userRot : autoRot;

  const geom = useMemo(() => {
    if (!center || !points || points.length < 2) return null;
    const rotated = rot ? points.map((p) => rotatePoint(p, center.lat, center.lon, rot)) : points;
    const proj = projectPath(rotated);
    if (!proj) return null;
    const projected = rotated.map(proj.project);
    let minSpeed = Infinity;
    let maxSpeed = -Infinity;
    for (const p of points) {
      const s = Number(p.speed) || 0;
      if (s < minSpeed) minSpeed = s;
      if (s > maxSpeed) maxSpeed = s;
    }
    if (!Number.isFinite(minSpeed)) minSpeed = 0;
    if (!Number.isFinite(maxSpeed)) maxSpeed = 0;
    return { proj, projected, minSpeed, maxSpeed, rotated };
  }, [points, center, rot]);

  if (!geom) {
    return <p className="rb-muted">Sin puntos GPS suficientes para dibujar la trazada.</p>;
  }

  const { proj, projected, minSpeed, maxSpeed, rotated } = geom;

  const markerPos = (() => {
    if (marker && Number.isFinite(marker.lat) && Number.isFinite(marker.lon)) {
      const r = rotatePoint(marker, center.lat, center.lon, rot);
      return proj.project(r);
    }
    if (markerIndex >= 0) return projected[Math.min(markerIndex, projected.length - 1)];
    return null;
  })();

  function cycleRotation() {
    setUserRot((prev) => {
      if (prev == null) return 0;
      const next = (prev + 90) % 360;
      return next === 0 && autoRot === 0 ? 0 : next >= 360 ? 0 : next;
    });
  }

  return (
    <div className="rb-track" style={{ height }} ref={wrapRef}>
      {rotatable && (
        <button type="button" className="rb-track-rotate" onClick={cycleRotation}>
          {userRot == null ? 'Girar (auto)' : `Girar ${userRot}°`}
        </button>
      )}
      <svg
        viewBox={`0 0 ${proj.vw} ${proj.vh}`}
        preserveAspectRatio="xMidYMid meet"
        className="rb-track-svg"
      >
        <polyline
          points={projected.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="var(--border2)"
          strokeWidth={10}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.5}
        />
        {projected.slice(0, -1).map((p, i) => (
          <line
            key={i}
            x1={p.x}
            y1={p.y}
            x2={projected[i + 1].x}
            y2={projected[i + 1].y}
            stroke={speedColor(rotated[i].speed, minSpeed, maxSpeed)}
            strokeWidth={4}
            strokeLinecap="round"
          />
        ))}
        <circle cx={projected[0].x} cy={projected[0].y} r={9} fill="#fff" stroke="#111" strokeWidth={2} />
        <text x={projected[0].x} y={projected[0].y - 14} textAnchor="middle" fontSize="22" fill="#fff">
          S/F
        </text>
        {markerPos && (
          <>
            <circle cx={markerPos.x} cy={markerPos.y} r={14} fill="none" stroke="#fff" strokeWidth={3} />
            <circle cx={markerPos.x} cy={markerPos.y} r={6} fill="#fff" />
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
