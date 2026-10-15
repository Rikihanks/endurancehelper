// Post-race postmortem. Everything is derived from the persisted telemetry:
//   race_laps      — every lap (time, sectors, position, gap, driver)
//   race_events    — pit stops (+ strategy plan captured live) and position changes
//   race_snapshots — periodic time-series (position, pace, virtual position, plan)
// plus the frozen race config (for driver order / stint rules).
//
// The report answers the crew's questions: how many stints, who was fastest,
// when did we have to stop earlier / stretch a stint, with whom we gained/lost
// positions, how much time we lost in the pits.

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);
const stdDev = (arr) => {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / (arr.length - 1));
};
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
// Lap times below this are not full racing laps (pit-in / partial laps), so they
// pollute the fastest-lap statistics. Used as a sanity floor for the report.
const VALID_MIN_MS = 45000;
const validTimes = (arr) => arr.filter((t) => t != null && t > VALID_MIN_MS);

// Map a stint number (1-based) to the pilot who drives it, following the frozen
// config: pilot changes every stop unless the format is kart-change-only.
function pilotForStint(race, stintIndex) {
  const drivers = race.drivers || [];
  const n = Math.max(1, race.numDrivers || drivers.length || 1);
  const order = (Array.isArray(race.driverOrder) && race.driverOrder.length)
    ? race.driverOrder.filter((i) => Number.isInteger(i) && i >= 0)
    : drivers.map((_, i) => i);
  const swaps = !race.kartChangeOnly && race.driverChangePerStop;
  const idx = swaps ? order[(stintIndex - 1) % Math.max(1, order.length)] : (order[0] ?? 0);
  return drivers[idx] && drivers[idx].name ? drivers[idx].name : `Piloto ${idx + 1}`;
}

export async function buildRaceReport(repos, session) {
  const [laps, events, snapshots] = await Promise.all([
    repos.getRaceLapsForSession(session.id),
    repos.getRaceEventsForSession(session.id),
    repos.getRaceSnapshotsForSession(session.id),
  ]);

  let config = null;
  try {
    config = typeof session.configJson === 'string' ? JSON.parse(session.configJson) : (session.configJson || null);
  } catch (_) {
    config = null;
  }
  const race = (config && config.race) || {};

  const times = validTimes(laps.map((l) => l.lapTimeMs));
  const rawStops = events
    .filter((e) => e.type === 'pit_stop')
    .map((e) => ({ ...e.payloadJson }))
    .filter((p) => p && typeof p.lap === 'number');
  // A physical stop can have been persisted more than once (older telemetry
  // varied the payload, defeating dedupe). Keep the most complete record (the
  // one with the largest lap, i.e. the post-fix correct parsing).
  const stops = [...new Map(rawStops.map((p) => [p.pitNumber, p])).values()]
    .map((p) => rawStops.filter((q) => q.pitNumber === p.pitNumber).sort((a, b) => b.lap - a.lap)[0])
    .sort((a, b) => a.lap - b.lap);
  const posChanges = events
    .filter((e) => e.type === 'position_change')
    .map((e) => e.payloadJson);

  // ---- general ----
  const maxLap = laps.reduce((m, l) => Math.max(m, l.lapNumber || 0), 0);
  const totalPitTimeMs = sum(stops.map((s) => s.pitTimeMs).filter((t) => t != null));

  // ---- stints (split at pit-stop laps) ----
  const stints = [];
  let stintStart = 1;
  for (let i = 0; i < stops.length; i++) {
    const stopLap = stops[i].lap;
    stints.push({ index: i + 1, startLap: stintStart, endLap: stopLap, pitTimeMs: stops[i].pitTimeMs ?? null });
    stintStart = stopLap + 1;
  }
  stints.push({ index: stints.length + 1, startLap: stintStart, endLap: maxLap, pitTimeMs: null });

  const lapsForStint = (s) => laps.filter((l) => l.lapNumber >= s.startLap && l.lapNumber <= s.endLap);
  for (const s of stints) {
    const sl = lapsForStint(s);
    const ts = validTimes(sl.map((l) => l.lapTimeMs));
    s.laps = sl.length;
    s.driver = pilotForStint(race, s.index);
    s.bestLap = ts.length ? Math.min(...ts) : null;
    s.avgLap = ts.length ? avg(ts) : null;
    s.consistencyMs = ts.length ? stdDev(ts) : null;
  }

  // ---- position at a given race lap (nearest snapshot) ----
  const snapByLap = (lap) => {
    if (!snapshots.length) return null;
    let best = snapshots[0];
    for (const sn of snapshots) {
      if (sn.laps == null) continue;
      if (best.laps == null || Math.abs(sn.laps - lap) < Math.abs(best.laps - lap)) best = sn;
    }
    return best;
  };
  for (const s of stints) {
    const st = snapByLap(s.startLap);
    const en = snapByLap(s.endLap);
    s.positionStart = st && st.position != null ? st.position : null;
    s.positionEnd = en && en.position != null ? en.position : null;
    s.netPosition = s.positionStart != null && s.positionEnd != null ? s.positionStart - s.positionEnd : null; // >0 = gained
  }

  // ---- per pilot ----
  const pilotAgg = new Map();
  const aggFor = (name) => {
    if (!pilotAgg.has(name)) {
      pilotAgg.set(name, { name, laps: [], stints: 0, pitTimeMs: 0, gained: 0, lost: 0 });
    }
    return pilotAgg.get(name);
  };
  for (const s of stints) {
    const agg = aggFor(s.driver);
    agg.stints += 1;
    for (const l of lapsForStint(s)) agg.laps.push(l.lapTimeMs);
    if (s.pitTimeMs != null) agg.pitTimeMs += s.pitTimeMs;
  }
  const perPilot = [...pilotAgg.values()].map((a) => {
    const ts = validTimes(a.laps);
    return {
      name: a.name,
      laps: a.laps.length,
      stints: a.stints,
      bestLap: ts.length ? Math.min(...ts) : null,
      avgLap: ts.length ? avg(ts) : null,
      medianLap: ts.length ? median(ts) : null,
      consistencyMs: ts.length ? stdDev(ts) : null,
      pitTimeMs: a.pitTimeMs,
    };
  });

  // Positions gained/lost attributed to the pilot on track at the change
  // (from position_change events, falling back to the snapshot series).
  for (const pc of posChanges) {
    if (pc.from == null || pc.to == null || pc.from === pc.to) continue;
    const name = pc.driver || '?';
    const agg = aggFor(name);
    if (pc.to < pc.from) agg.gained += pc.from - pc.to;
    else agg.lost += pc.to - pc.from;
  }
  if (perPilot.length) {
    for (const p of perPilot) {
      const agg = pilotAgg.get(p.name);
      p.positionsGained = agg.gained;
      p.positionsLost = agg.lost;
      p.netPositions = agg.gained - agg.lost;
    }
  }

  // ---- pit stops: plan vs actual ----
  // The strategy recommendation that was live just BEFORE the stop is the best
  // "plan": look up the latest snapshot with laps <= stop lap; fall back to the
  // context captured when the stop was first persisted.
  const planBefore = (stopLap) => {
    let best = null;
    for (const s of snapshots) {
      if (s.laps == null) continue;
      if (s.laps <= stopLap && (!best || s.laps > best.laps)) best = s;
    }
    return best;
  };
  const pitStops = stops.map((s, i) => {
    const before = planBefore(s.lap);
    const plannedLap = before && before.lapsUntilNextStop != null
      ? before.laps + Math.round(before.lapsUntilNextStop)
      : (s.plannedStopLap ?? null);
    const plannedReason = before ? (before.nextStopReason || null) : (s.plannedReason || null);
    const diffLaps = plannedLap != null ? s.lap - plannedLap : null;
    let verdict = 'sin plan';
    if (diffLaps != null) {
      if (diffLaps < -0.5) verdict = 'adelantada';       // had to stop earlier
      else if (diffLaps > 0.5) verdict = 'alargada';     // stretched the stint
      else verdict = 'a tiempo';
    }
    return {
      pitNumber: s.pitNumber ?? i + 1,
      lap: s.lap,
      pitTimeMs: s.pitTimeMs ?? null,
      driver: s.driverId != null ? `P${s.driverId}` : null,
      position: s.position ?? null,
      plannedLap,
      plannedReason,
      diffLaps: diffLaps != null ? Math.round(diffLaps * 10) / 10 : null,
      verdict,
    };
  });

  // ---- time series for charts ----
  const positionSeries = snapshots
    .filter((s) => s.position != null)
    .map((s) => ({
      elapsedMs: s.elapsedMs,
      position: s.position,
      virtualPosition: s.virtualPosition,
      lap: s.laps,
      driver: s.driverName,
      gapLiderMs: s.gapLiderMs,
      avgPaceMs: s.avgPaceMs,
      deltaToTargetMs: s.deltaToTargetMs,
      nextStopReason: s.nextStopReason,
      lapsUntilNextStop: s.lapsUntilNextStop,
    }));

  const paceEvolution = [...laps]
    .sort((a, b) => (a.lapNumber || 0) - (b.lapNumber || 0))
    .filter((l) => l.lapTimeMs != null && l.lapTimeMs > 0)
    .map((l) => ({ lap: l.lapNumber, timeMs: l.lapTimeMs, driver: l.driverId }));

  const fastestPilot = perPilot.length
    ? perPilot.reduce((a, b) => ((b.avgLap ?? Infinity) < (a.avgLap ?? Infinity) ? b : a)).name
    : null;

  return {
    sessionId: session.id,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    circuitUrl: session.circuitUrl,
    config: {
      raceDurationMin: race.raceDurationMin ?? null,
      mandatoryStops: race.mandatoryStops ?? null,
      mandatoryStopEveryMin: race.mandatoryStopEveryMin ?? 0,
      kartChangeOnly: !!race.kartChangeOnly,
      numDrivers: race.numDrivers ?? null,
    },
    totalLaps: laps.length,
    bestLap: times.length ? Math.min(...times) : null,
    avgLap: times.length ? avg(times) : null,
    consistencyMs: times.length ? stdDev(times) : null,
    stopCount: stops.length,
    totalPitTimeMs,
    fastestPilot,
    perPilot,
    stints,
    pitStops,
    positionSeries,
    paceEvolution,
    positionChanges: posChanges,
  };
}
