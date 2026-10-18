// Shared 2D projection for the track map / editor.
// Projects lat/lon into an SVG viewBox preserving aspect ratio, and provides
// the inverse so a tap on the map can be turned back into a coordinate.

export const MAP_VIEW_W = 1000;

/**
 * @param {{lat:number, lon:number}[]} points
 * @returns {null | {vw:number, vh:number, project:(p:{lat:number,lon:number})=>{x:number,y:number}, unproject:(x:number,y:number)=>{lat:number,lon:number}}}
 */
export function projectPath(points) {
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
  const meanLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const spanX = (maxLon - minLon) * cosLat || 1e-9;
  const spanY = maxLat - minLat || 1e-9;
  const vw = MAP_VIEW_W;
  const vh = Math.max(120, Math.round((MAP_VIEW_W * spanY) / spanX));

  const project = (p) => ({
    x: ((p.lon - minLon) * cosLat * vw) / spanX,
    y: ((maxLat - p.lat) * vh) / spanY,
  });
  const unproject = (x, y) => ({
    lon: minLon + (x / vw) * (spanX / cosLat),
    lat: maxLat - (y / vh) * spanY,
  });
  return { vw, vh, project, unproject };
}

/** Bearing (clockwise from north) from a projected point a to b. */
export function bearingBetween(a, b) {
  return ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
}

/**
 * Convert a pointer event into viewBox coordinates, taking the letterboxing of
 * preserveAspectRatio="xMidYMid meet" into account.
 */
export function svgPointFromEvent(event, svgEl, vw, vh) {
  const rect = svgEl.getBoundingClientRect();
  const scale = Math.min(rect.width / vw, rect.height / vh) || 1;
  const offsetX = (rect.width - vw * scale) / 2;
  const offsetY = (rect.height - vh * scale) / 2;
  return {
    x: (event.clientX - rect.left - offsetX) / scale,
    y: (event.clientY - rect.top - offsetY) / scale,
  };
}

/**
 * Snap a coordinate to the nearest point of the path and derive the heading
 * from the local path direction, so a trap is always on the track and pointing
 * the way the vehicle travels.
 */
export function snapToPath(points, proj, lat, lon) {
  const target = proj.project({ lat, lon });
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const a = proj.project(points[i - 1]);
    const b = proj.project(points[i]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((target.x - a.x) * dx + (target.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d = Math.hypot(target.x - px, target.y - py);
    if (!best || d < best.d) {
      best = { d, x: px, y: py, bearing: bearingBetween(a, b), index: i };
    }
  }
  if (!best) return null;
  const { lat: outLat, lon: outLon } = proj.unproject(best.x, best.y);
  return { lat: outLat, lon: outLon, heading: best.bearing, index: best.index };
}
