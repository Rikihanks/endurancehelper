// Track file import: GPX and KML -> list of { lat, lon }.
// Lets the user trace the circuit in Google Earth / any tool and bring the exact
// centerline into the app instead of relying on a rough database.

/** Keep first, last and an even sample, capped at `max` points. */
export function downsamplePoints(points, max = 800) {
  if (!points || points.length <= max) return points ? points.slice() : [];
  const stride = Math.ceil(points.length / max);
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** GPX track/route/waypoints -> [{lat, lon}] (attribute order independent). */
export function parseGpx(text) {
  const points = [];
  const tagRe = /<(?:trkpt|rtept|wpt)\b[^>]*>/gi;
  let match;
  while ((match = tagRe.exec(text))) {
    const tag = match[0];
    const lat = /\blat\s*=\s*"([-0-9.eE+]+)"/.exec(tag);
    const lon = /\blon\s*=\s*"([-0-9.eE+]+)"/.exec(tag);
    if (!lat || !lon) continue;
    const la = num(lat[1]);
    const lo = num(lon[1]);
    if (la !== null && lo !== null) points.push({ lat: la, lon: lo });
  }
  return points;
}

/** KML <coordinates> blocks -> [{lat, lon}] (KML stores lon,lat[,alt]). */
export function parseKml(text) {
  const points = [];
  const blockRe = /<coordinates>([\s\S]*?)<\/coordinates>/gi;
  let match;
  while ((match = blockRe.exec(text))) {
    for (const tuple of match[1].trim().split(/\s+/)) {
      if (!tuple) continue;
      const [lonStr, latStr] = tuple.split(',');
      const la = num(latStr);
      const lo = num(lonStr);
      if (la !== null && lo !== null) points.push({ lat: la, lon: lo });
    }
  }
  return points;
}

/**
 * Detect the format and parse. Returns { format, points } or throws with a
 * clear message.
 */
export function parseTrackFile(text, { max = 800 } = {}) {
  if (!text || typeof text !== 'string') {
    throw new Error('El archivo está vacío o no se pudo leer.');
  }
  const head = text.slice(0, 2000);
  let format = null;
  let points = [];
  if (/<gpx\b/i.test(head) || /<trkpt\b/i.test(text)) {
    format = 'gpx';
    points = parseGpx(text);
  }
  if ((!points.length) && (/<kml\b/i.test(head) || /<coordinates>/i.test(text))) {
    format = 'kml';
    points = parseKml(text);
  }
  if (!points.length) {
    // Last resort: try both parsers.
    points = parseGpx(text);
    if (!points.length) points = parseKml(text);
    format = format || (points.length ? 'desconocido' : null);
  }
  if (!points.length) {
    throw new Error('No se encontraron puntos de trazada (¿es un GPX o KML de una ruta?).');
  }
  return { format, points: downsamplePoints(points, max), total: points.length };
}
