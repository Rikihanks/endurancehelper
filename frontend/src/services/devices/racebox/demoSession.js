// Generates a synthetic driving session along a track's centerline, so the whole
// viewer (trace, charts, laps, delta) can be exercised without going to the
// circuit. It is clearly labelled as a demo and only used from the Sessions tab.
//
// Physics, not noise: the centerline is resampled at 1 m and smoothed, corner
// speed is limited by a target lateral g, and the profile is then limited by
// maximum acceleration/braking. That gives a speed trace and a G-G plot that
// look like real karting data instead of spikes at every drawn vertex.

const M_PER_DEG_LAT = 110540;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const G = 9.81;

function metersPerDegLon(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** Cumulative distance along a polyline (metres). */
function cumulative(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon));
  }
  return cum;
}

/** Point at distance s along a polyline of known cumulative distances. */
function pointAtDistance(points, cum, s) {
  const L = cum[cum.length - 1];
  const sm = ((s % L) + L) % L;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < sm) i++;
  const a = points[i - 1];
  const b = points[i];
  const d0 = cum[i - 1];
  const d1 = cum[i];
  const f = d1 > d0 ? clamp((sm - d0) / (d1 - d0), 0, 1) : 0;
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** Circular moving average over `window` samples either side. */
function smoothCircular(points, window) {
  const n = points.length;
  return points.map((_, i) => {
    let lat = 0;
    let lon = 0;
    let count = 0;
    for (let k = -window; k <= window; k++) {
      const p = points[((i + k) % n + n) % n];
      lat += p.lat;
      lon += p.lon;
      count += 1;
    }
    return { lat: lat / count, lon: lon / count };
  });
}

function bearing(a, b) {
  const dx = (b.lon - a.lon) * metersPerDegLon(a.lat);
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.atan2(dx, dy);
}

/**
 * Build a plausible session on `track.centerline`.
 * @returns {object[]|null} decoded-record-shaped array
 */
export function buildDemoSession(track, options = {}) {
  const line = track && track.centerline;
  if (!Array.isArray(line) || line.length < 4) return null;

  const laps = options.laps ?? 3;
  const hz = options.hz ?? 25;
  const vMaxKmh = options.topSpeedKmh ?? 62;
  const aLatMaxG = options.lateralG ?? 1.5;
  const aAccelG = options.accelG ?? 0.55;
  const aBrakeG = options.brakeG ?? 0.85;
  const noiseM = options.noiseM ?? 1.1;
  const startDate = options.startDate ? new Date(options.startDate) : new Date();

  // GPS error is correlated over seconds, not white per sample: a slow drift
  // keeps the trace realistic without inflating the measured distance.
  const drift = (seconds) => ({
    lat:
      noiseM *
      (0.7 * Math.sin((2 * Math.PI * seconds) / 19 + 0.7) +
        0.3 * Math.sin((2 * Math.PI * seconds) / 7.3 + 2.1)),
    lon:
      noiseM *
      (0.7 * Math.sin((2 * Math.PI * seconds) / 15 + 1.3) +
        0.3 * Math.sin((2 * Math.PI * seconds) / 6.1 + 0.4)),
  });

  // 1 m grid over the drawn line (which may have very few, widely spaced points).
  const stepM = 1;
  const cum = cumulative(line);
  const L = cum[cum.length - 1];
  if (!(L > 40)) return null;
  const N = Math.max(24, Math.round(L / stepM));
  const ds = L / N;
  const grid = [];
  for (let i = 0; i < N; i++) grid.push(pointAtDistance(line, cum, i * ds));

  // Smooth the geometry so hand-drawn vertices stop producing fake hairpins.
  const smooth = smoothCircular(grid, Math.max(5, Math.round(15 / ds)));

  const wrapIdx = (i) => ((i % N) + N) % N;
  const headingAt = (i) => bearing(smooth[wrapIdx(i - 3)], smooth[wrapIdx(i + 3)]);
  const curvatureAt = (i) => {
    let d = headingAt(i + 3) - headingAt(i - 3);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d / (6 * ds); // 1/m, signed
  };

  // Corner speed from the lateral grip limit, then limit accel/braking.
  const vMax = vMaxKmh / 3.6;
  const vTarget = new Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(curvatureAt(i));
    vTarget[i] = clamp(k > 1e-5 ? Math.sqrt((aLatMaxG * G) / k) : vMax, 6, vMax);
  }

  const v = vTarget.slice();
  const aAccel = aAccelG * G;
  const aBrake = aBrakeG * G;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < N; i++) {
      const prev = v[wrapIdx(i - 1)];
      v[i] = Math.min(v[i], Math.sqrt(prev * prev + 2 * aAccel * ds));
    }
    for (let i = N - 1; i >= 0; i--) {
      const next = v[wrapIdx(i + 1)];
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * aBrake * ds));
    }
  }
  // Small time-domain smoothing so the trace has no steps.
  const vSmooth = v.map((_, i) => {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += v[wrapIdx(i + k)];
    return sum / 5;
  });

  const d = new Date(startDate.getTime());
  const startOfWeek = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - d.getUTCDay(),
    0,
    0,
    0,
    0,
  );
  const itow0 = (d.getTime() - startOfWeek) % WEEK_MS;
  const t0 = d.getTime();

  const dtMs = 1000 / hz;
  const records = [];
  let s = -0.05 * L;
  const sEnd = (laps + 0.45) * L;
  let tMs = 0;
  let guard = 0;
  let lapIndex = 1;
  // Light exponential smoothing so the emitted IMU channels read like filtered
  // data instead of sample-to-sample noise.
  let gLatEma = null;
  let gLongEma = null;

  while (s < sEnd && guard++ < 400000) {
    const sm = ((s % L) + L) % L;
    const idx = Math.min(N - 1, Math.floor(sm / ds));
    const lapBoost = 1 + 0.015 * (lapIndex - 1);
    const speed = clamp(vSmooth[idx] * lapBoost, 5, vMax * 1.05);

    const p = pointAtDistance(line, cum, sm);
    const next = Math.min(N - 1, Math.floor((((sm + ds) % L) + L) % L / ds));
    const pNext = pointAtDistance(line, cum, sm + ds);
    const head = (bearing(p, pNext) * 180) / Math.PI;

    const k = curvatureAt(idx);
    const aLat = clamp(speed * speed * k, -aLatMaxG * G, aLatMaxG * G);
    const dv = (vSmooth[next] - vSmooth[idx]) * lapBoost;
    const aLong = clamp(speed * (dv / ds), -aBrake, aAccel);

    const now = new Date(t0 + tMs);
    const tSec = tMs / 1000;
    const dri = drift(tSec);
    const rawLat = (aLat / G) * 1000 + (Math.random() * 2 - 1) * 8;
    const rawLong = (aLong / G) * 1000 + (Math.random() * 2 - 1) * 8;
    gLatEma = gLatEma == null ? rawLat : gLatEma * 0.7 + rawLat * 0.3;
    gLongEma = gLongEma == null ? rawLong : gLongEma * 0.7 + rawLong * 0.3;
    const gLat = Math.round(gLatEma);
    const gLong = Math.round(gLongEma);

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
      latitude: p.lat + dri.lat / M_PER_DEG_LAT,
      longitude: p.lon + dri.lon / metersPerDegLon(p.lat),
      wgsAltitude: 940,
      altitude: 908,
      horizontalAccuracy: 5,
      verticalAccuracy: 8,
      speed: speed * 3.6,
      heading: ((head % 360) + 360) % 360,
      speedAccuracy: 0.5,
      headingAccuracy: 1.5,
      pdop: 180,
      latLonFlags: 0,
      gForceX: clamp(gLong, -1000, 1000),
      gForceY: clamp(gLat, -2000, 2000),
      gForceZ: 1000,
      rotRateX: 0,
      rotRateY: 0,
      rotRateZ: clamp(Math.round(((speed * k * 180) / Math.PI) * 100), -30000, 30000),
      batteryLevel: 88,
      charging: false,
      receivedAt: Date.now(),
    });

    s += speed * (dtMs / 1000);
    tMs += dtMs;
    lapIndex = Math.max(1, Math.floor(s / L) + 1);
  }

  return records;
}
