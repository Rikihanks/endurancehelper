// Generates a synthetic driving session along a track's centerline, so the whole
// viewer (trace, charts, laps, delta) can be exercised without going to the
// circuit. It is clearly labelled as a demo and only used from the Sessions tab.

const M_PER_DEG_LAT = 110540;
const WEEK_MS = 7 * 24 * 3600 * 1000;

function metersPerDegLon(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Build a plausible session on `track.centerline`.
 * @param {{centerline: {lat:number, lon:number}[], startFinish?: object}} track
 * @returns {object[]|null} decoded-record-shaped array
 */
export function buildDemoSession(track, options = {}) {
  const line = track && track.centerline;
  if (!Array.isArray(line) || line.length < 4) return null;

  const laps = options.laps ?? 3;
  const baseKmh = options.baseSpeedKmh ?? 48;
  const hz = options.hz ?? 25;
  const noiseM = options.noiseM ?? 1.2;
  const startDate = options.startDate ? new Date(options.startDate) : new Date();

  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(
      cum[i - 1] +
        haversine(line[i - 1].lat, line[i - 1].lon, line[i].lat, line[i].lon),
    );
  }
  const L = cum[cum.length - 1];
  if (!(L > 20)) return null;

  const wrap = (s) => ((s % L) + L) % L;

  const pointAt = (s) => {
    const sm = wrap(s);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < sm) i++;
    const a = line[i - 1];
    const b = line[i] || line[0];
    const d0 = cum[i - 1];
    const d1 = i < cum.length ? cum[i] : L;
    const f = d1 > d0 ? clamp((sm - d0) / (d1 - d0), 0, 1) : 0;
    return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
  };

  const headingAt = (s) => {
    const a = pointAt(s - 2);
    const b = pointAt(s + 2);
    const dx = (b.lon - a.lon) * metersPerDegLon(a.lat);
    const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  };

  // Three slow zones per lap + a small per-lap variation so lap times differ.
  const speedAt = (s, lap) => {
    const phase = (wrap(s) / L) * Math.PI * 2 * 3;
    const cornerFactor = 0.62 + 0.38 * (0.5 + 0.5 * Math.cos(phase));
    const lapFactor = 1 + 0.025 * (lap - 1);
    return (baseKmh / 3.6) * cornerFactor * lapFactor;
  };

  const d = new Date(startDate.getTime());
  const dow = d.getUTCDay();
  const startOfWeek = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow, 0, 0, 0, 0);
  const itow0 = (d.getTime() - startOfWeek) % WEEK_MS;
  const t0 = d.getTime();

  const dtMs = 1000 / hz;
  const records = [];
  let s = -0.05 * L; // start just before the line so lap 1 counts
  const sEnd = (laps + 0.45) * L;
  let tMs = 0;
  let guard = 0;

  while (s < sEnd && guard++ < 300000) {
    const sm = wrap(s);
    const lap = Math.max(1, Math.floor(s / L) + 1);
    const v = speedAt(sm, lap);
    const p = pointAt(sm);
    const head = headingAt(sm);

    const vNext = speedAt(sm + 1, lap);
    const aLong = v * (vNext - v); // m/s^2
    const h1 = headingAt(sm - 2);
    const h2 = headingAt(sm + 2);
    const dhDeg = ((h2 - h1 + 540) % 360) - 180;
    const curvature = ((dhDeg * Math.PI) / 180) / 4; // 1/m
    const aLat = v * v * curvature; // m/s^2

    const now = new Date(t0 + tMs);
    const noiseLat = ((Math.random() * 2 - 1) * noiseM) / M_PER_DEG_LAT;
    const noiseLon =
      ((Math.random() * 2 - 1) * noiseM) / metersPerDegLon(p.lat);

    records.push({
      iTOW: Math.round((itow0 + tMs) % WEEK_MS),
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      day: now.getUTCDate(),
      hour: now.getUTCHours(),
      minute: now.getUTCMinutes(),
      second: now.getUTCSeconds(),
      validityFlags: 0xf7,
      timeAccuracyNs: 1000,
      nanoseconds: 0,
      fixStatus: 3,
      fixFlags: 1,
      dateTimeFlags: 0xe6,
      numSVs: 9,
      latitude: p.lat + noiseLat,
      longitude: p.lon + noiseLon,
      wgsAltitude: 940,
      altitude: 908,
      horizontalAccuracy: 5,
      verticalAccuracy: 8,
      speed: v * 3.6,
      heading: head,
      speedAccuracy: 0.5,
      headingAccuracy: 1.5,
      pdop: 180,
      latLonFlags: 0,
      gForceX: clamp(Math.round((aLong / 9.81) * 1000), -2500, 2500),
      gForceY: clamp(Math.round((aLat / 9.81) * 1000), -2500, 2500),
      gForceZ: 1000,
      rotRateX: 0,
      rotRateY: 0,
      rotRateZ: clamp(Math.round(((v * curvature * 180) / Math.PI) * 100), -20000, 20000),
      batteryLevel: 88,
      charging: false,
      receivedAt: Date.now(),
    });

    s += v * (dtMs / 1000);
    tMs += dtMs;
  }

  return records;
}
