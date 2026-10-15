const ms = (v) => v * 10; // centiseconds -> milliseconds

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class StrategyEngine {
  constructor(config, qualyStore) {
    this.config = config;
    this.qualyStore = qualyStore;
    this.ourLaps = [];    // last fetched lap history for our kart
    this.ourPits = [];    // pit records for our kart
    this.lastDetails = {}; // driverId -> { laps, bestLap } for rivals
    this.trafficLaps = 0; // consecutive laps fighting (traffic)
    this.lastTrafficStintLaps = null;
    this.reset();
  }

  reset() {
    this.raceStartedAt = null; // auto-detected when race laps start appearing
    this.trafficLaps = 0;
    this.lastTrafficStintLaps = null;
  }

  // Detect race start: anchor to Apex's live race countdown when it reads plausibly
  // (survives server restarts); otherwise first moment any driver shows laps.
  detectRaceStart(state) {
    const duration = this.config.race.raceDurationMin * 60000;
    const t = parseFloat(state.timer);
    // Reject tiny/erratic readings (Apex can briefly report a different countdown)
    if (Number.isFinite(t) && t > duration * 0.1 && t < duration) {
      const anchored = Date.now() - (duration - t);
      if (!this.raceStartedAt || anchored > this.raceStartedAt + 60000) {
        this.raceStartedAt = anchored;
        console.log(`[strat] race clock anchored, remaining=${Math.round(t / 60000)}min`);
      }
    }
    if (this.raceStartedAt) return;
    if (state.mode !== 'race') return;
    const anyLaps = state.drivers.some((d) => this.parseLaps(d.laps) > 0) || this.ourLaps.length > 0;
    if (anyLaps) this.raceStartedAt = Date.now();
  }

  setOurLaps(laps) {
    this.ourLaps = (laps || []).filter((l) => l.total > 0).sort((a, b) => a.lap - b.lap);
  }

  setOurPits(pits) {
    this.ourPits = pits || [];
  }

  // Real pit stops only: Apex logs a relay-start record at lap 1 (pitTime 0)
  // which is NOT an actual stop. Count/lap-split only genuine stops.
  getRealPits() {
    return this.ourPits.filter((p) => p.lap > 1 || p.pitTime > 0);
  }

  setDriverDetails(driverId, details) {
    this.lastDetails[driverId] = details;
  }

  getOurKartRow(state) {
    const kart = this.config.race.ourKart;
    if (!kart) return null;
    return state.drivers.find((d) => String(d.kart) === String(kart)) || null;
  }

  // Split lap history into stints: a stint ends when the lap counter jumps
  // (missing laps during a pit) or a pit record falls between two laps.
  computeStints() {
    const laps = this.ourLaps;
    if (!laps.length) return { stints: [], current: null };

    const pitLaps = new Set(this.getRealPits().map((p) => p.lap));
    const stints = [];
    let current = { startLap: laps[0].lap, laps: [], pit: null };

    for (let i = 0; i < laps.length; i++) {
      const l = laps[i];
      const gap = i > 0 ? l.lap - laps[i - 1].lap : 0;
      if (gap > 1 || pitLaps.has(l.lap - 1) || pitLaps.has(l.lap)) {
        // never push an empty stint (e.g. the first fetched lap right after a pit)
        if (current.laps.length) stints.push(current);
        current = { startLap: l.lap, laps: [], pit: null };
      }
      current.laps.push(l);
    }
    if (current.laps.length) stints.push(current);

    const enriched = stints.map((s) => {
      const times = s.laps.map((l) => l.total);
      const best = s.laps.length ? Math.min(...times) : 0;
      const avg = s.laps.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
      return {
        startLap: s.startLap,
        endLap: s.laps.length ? s.laps[s.laps.length - 1].lap : s.startLap,
        laps: s.laps,
        lapCount: s.laps.length,
        bestTime: best,
        avgTime: avg,
      };
    });

    return { stints: enriched, current: enriched[enriched.length - 1] || null };
  }

  rollingPace(laps, window = this.config.race.lapWindow) {
    const times = laps.slice(-window).map((l) => l.total);
    return median(times);
  }

  // Build relative pace table across the grid using our cached rival details + grid best laps.
  relativePace(state) {
    const rows = [];
    const bestOverall = state.drivers.reduce((acc, d) => {
      const t = this.parseTime(d.best_lap);
      return t > 0 && (acc === 0 || t < acc) ? t : acc;
    }, 0);

    for (const d of state.drivers) {
      const bestLap = this.parseTime(d.best_lap);
      const lastLap = this.parseTime(d.last_lap);
      const details = this.lastDetails[d.id];
      let rolling = 0;
      let recentLaps = [];
      if (details && details.laps && details.laps.length) {
        rolling = this.rollingPace(details.laps, 5);
        recentLaps = details.laps.map((l) => l.total).filter((t) => t > 0).slice(-10);
      }
      rows.push({
        id: d.id,
        position: d.position,
        kart: d.kart,
        driver: d.driver,
        laps: this.parseLaps(d.laps),
        bestLap,
        lastLap,
        rolling,
        recentLaps,
        gapToFastest: bestOverall > 0 && bestLap > 0 ? bestLap - bestOverall : 0,
      });
    }
    return { rows, bestOverall };
  }

  // Build a snapshot of qualifying data: each driver's best lap during qualy.
  captureQualy(state) {
    const drivers = state.drivers
      .map((d) => {
        const best = this.parseTime(d.best_lap);
        return {
          id: d.id,
          kart: d.kart,
          driver: d.driver,
          bestLap: best,
        };
      })
      .filter((d) => d.bestLap > 0)
      .sort((a, b) => a.bestLap - b.bestLap);
    return {
      savedAt: new Date().toISOString(),
      track: state.track,
      drivers,
    };
  }

  // Compare live race performance against the saved qualy snapshot.
  analyzeQualy(state) {
    const qualy = this.qualyStore.get();
    if (!qualy || !qualy.drivers || !qualy.drivers.length) {
      return { saved: false, rows: [] };
    }

    const byKart = new Map(qualy.drivers.map((d) => [String(d.kart), d]));
    const byName = new Map(qualy.drivers.map((d) => [String(d.driver).trim().toLowerCase(), d]));

    const rows = state.drivers
      .map((d) => {
        // Kart numbers change between sessions, so prefer matching by team name.
        const key = String(d.driver || '').trim().toLowerCase();
        const q = byName.get(key) || byKart.get(String(d.kart));
        if (!q || q.bestLap <= 0) return null;
        const raceBest = this.parseTime(d.best_lap);

        let delta = null;
        let deltaPct = 0;
        let verdict = 'pending';
        if (raceBest > 0) {
          delta = raceBest - q.bestLap; // positive = slower than qualy
          deltaPct = (delta / q.bestLap) * 100;
          if (deltaPct <= -1) verdict = 'great';       // faster than qualy
          else if (deltaPct <= 1) verdict = 'good';     // on qualy pace
          else if (deltaPct <= 3) verdict = 'watch';    // slightly slower
          else verdict = 'poor';                        // much slower than qualy
        }

        return {
          id: d.id,
          position: d.position,
          kart: d.kart,
          driver: d.driver,
          qualyLap: q.bestLap,
          raceBest: raceBest > 0 ? raceBest : null,
          delta,
          deltaPct,
          verdict,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.qualyLap - b.qualyLap);

    return { saved: true, savedAt: qualy.savedAt, track: qualy.track, rows };
  }

  // Parse a gap-to-leader value (seconds). Returns null if not numeric (e.g. lapped).
  parseGapSec(v) {
    if (!v) return 0;
    const t = String(v).trim();
    if (!t || t === '-') return 0;
    // Leader's gap column shows "Lap <n>" / "Runde <n>" / "Vuelta <n>" -> gap to leader is 0
    if (/^(lap|runde|vuelta)\s+\d+$/i.test(t)) return 0;
    // Lapped cars show "N Lap(s)" / "N Runden" -> no exact gap, rank them behind
    if (/lap|runde|vuelta/i.test(t)) return null;
    const p = t.split(':');
    let sec;
    if (p.length === 2) sec = parseInt(p[0], 10) * 60 + parseFloat(p[1]);
    else if (p.length === 3) sec = parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseFloat(p[2]);
    else sec = parseFloat(t);
    return isNaN(sec) ? null : sec;
  }

  // True when a gap string means the car is genuinely N laps down, e.g. "2 Lap(s)",
  // "1 Runde", "3 Runden" (number FIRST). The leader's own lap-count ("Runde 149",
  // "Lap 149") is NOT a lap gap — parseGapSec treats it as gap 0 to the leader.
  isLapApart(v) {
    return /^\s*\d+\s*(lap|laps|runde|runden|vuelta|vueltas)\b/i.test(String(v || '').trim());
  }

  rollingPaceFor(d) {
    const details = this.lastDetails[d.id];
    if (details && details.laps && details.laps.length) return this.rollingPace(details.laps, 5);
    return 0;
  }

  // ==== Endurance strategy calculations ====
  buildEndurance(state) {
    const race = this.config.race;
    this.detectRaceStart(state);
    const now = Date.now();
    const raceDurationMs = race.raceDurationMin * 60000;

    // Prefer Apex's live race clock (dyn1 = remaining ms) so the countdown and
    // the timeline stay correct even when the app starts mid-race. The wall-clock
    // estimate anchored on `raceStartedAt` is only a fallback.
    const apexTimer = parseFloat(state.timer);
    const apexValid = Number.isFinite(apexTimer) && apexTimer > 0 && apexTimer <= raceDurationMs;
    const elapsed = apexValid
      ? Math.max(0, raceDurationMs - apexTimer)
      : this.raceStartedAt
      ? now - this.raceStartedAt
      : 0;
    const remaining = Math.max(0, raceDurationMs - elapsed);
    const pitCloseMs = race.pitCloseMin * 60000;

    // Optional "mandatory stop every X min" format (kart change, driver stays):
    // when enabled it replaces the maximum-stint rule as the kart stint ceiling.
    // The total number of stops stays as configured (mandatoryStops).
    const hourlyStop = Number(race.mandatoryStopEveryMin) > 0;
    const effMandatoryStops = race.mandatoryStops;
    const driverSwaps = !race.kartChangeOnly && race.driverChangePerStop;

    const ourRow = this.getOurKartRow(state);

    // stops done per driver: grid "pits" column, fallback to polled .P for our kart
    const drivers = state.drivers.map((d) => {
      let stops = parseInt(d.pits, 10);
      if (isNaN(stops) || stops < 0) stops = 0;
      const realPits = this.getRealPits();
      if (ourRow && d.id === ourRow.id && realPits.length > stops) stops = realPits.length;
      return { ...d, stops, gapSec: this.parseGapSec(d.gap) };
    });

    // Lapped cars: gap column shows "N Lap(s)" for the first car of each lapped group.
    // Any car at/after the first such position is at least one lap down, even if its
    // own gap reads as a small number of seconds -> rank them all behind the leaders.
    // (Excludes the leader's own "Lap <n>" / "Runde <n>" lap-count.)
    const lappedPos = Math.min(
      ...drivers
        .filter((d) => {
          const t = String(d.gap).trim();
          return /lap|runde|vuelta/i.test(t) && !/^(lap|runde|vuelta)\s+\d+$/i.test(t);
        })
        .map((d) => d.position),
      Infinity
    );
    const isLapped = (d) => Number.isFinite(lappedPos) && d.position >= lappedPos;

    // virtual position: on-track gap + time still to lose in remaining mandatory stops
    const vrows = drivers
      .map((d) => {
        const remainingStops = Math.max(0, effMandatoryStops - d.stops);
        let effective;
        if (isLapped(d)) effective = 100000 + d.position; // keep true on-track order among lapped
        else effective = d.gapSec + remainingStops * (race.minPitTimeSec || 0);
        return { ...d, remainingStops, effective };
      })
      .sort((a, b) => a.effective - b.effective);
    vrows.forEach((r, i) => { r.virtualPos = i + 1; });

    const byId = new Map(vrows.map((r) => [r.id, r]));
    const ourV = ourRow ? byId.get(ourRow.id) : null;

    // real rivals: cars immediately ahead / behind on track (by grid position)
    const ordered = [...drivers].sort((a, b) => (a.position || 0) - (b.position || 0));
    const ourIdx = ourRow ? ordered.findIndex((d) => d.id === ourRow.id) : -1;
    const realGapSec = (d) => (d.gapSec === null ? null : d.gapSec);
    const ourGap = ourRow ? this.parseGapSec(ourRow.gap) : null;
    let rivalAhead = null;
    let rivalBehind = null;
    if (ourIdx >= 0) {
      if (ourIdx > 0) {
        const ahead = ordered[ourIdx - 1];
        const aheadGap = realGapSec(ahead);
        if (ourGap !== null && aheadGap !== null) {
          rivalAhead = { ...ahead, delta: ourGap - aheadGap }; // positive = ahead of us
        } else {
          rivalAhead = { ...ahead, delta: null, lapGap: this.isLapApart(ahead.gap) ? 1 : 0 };
        }
      }
      if (ourIdx < ordered.length - 1) {
        const behind = ordered[ourIdx + 1];
        const behindGap = realGapSec(behind);
        if (ourGap !== null && behindGap !== null) {
          rivalBehind = { ...behind, delta: behindGap - ourGap }; // positive = behind us
        } else {
          rivalBehind = { ...behind, delta: null, lapGap: this.isLapApart(behind.gap) ? 1 : 0 };
        }
      }
    }

    // target lap = pace of the rival behind on track (to hold position); fallbacks
    let targetLapMs = 0;
    if (rivalBehind) targetLapMs = this.rollingPaceFor(rivalBehind);
    if (!targetLapMs && ourV && vrows.length) targetLapMs = this.rollingPaceFor(vrows[0]);
    if (!targetLapMs && ourRow) targetLapMs = this.parseTime(ourRow.best_lap);

    const avgLapMs = this.rollingPace(this.ourLaps, race.lapWindow);
    const deltaToTargetMs = avgLapMs && targetLapMs ? avgLapMs - targetLapMs : null;

    // next stop: the app analyses the race (meteorology, pace vs target, traffic,
    // stint limits, stops left, pit-close deadline) and recommends the next stop.
    const { current } = this.computeStints();
    const stopsDone = ourV ? ourV.stops : 0;
    const stopsRemaining = Math.max(0, effMandatoryStops - stopsDone);
    // laps the current kart/driver has been out: from the lap-history stint split
    // (pit records mark the change). The Apex "on_track" time is unreliable on
    // some circuits (reports seconds, not stint minutes), so it's only a fallback.
    const lapMsEst = targetLapMs || avgLapMs || (ourRow ? this.parseTime(ourRow.best_lap) : 0) || 60000;
    const onTrackMs = ourRow ? this.parseTime(ourRow.on_track) : 0;
    const stintLaps = current && current.lapCount > 0
      ? current.lapCount
      : onTrackMs > 0 ? Math.floor(onTrackMs / lapMsEst) : 0;

    // ---- live conditions & current driver ----
    const wet = ['wet', 'puddle', 'rain', 'charco', 'mojado', 'lluvia'].includes(String(race.trackCondition).toLowerCase())
      || ['rain', 'lluvia', 'tormenta'].includes(String(race.weather).toLowerCase());
    // explicit running order (configurable, adjustable live); fallback to array order
    const nDrv = Math.max(1, race.numDrivers || 1);
    const order = (Array.isArray(race.driverOrder) && race.driverOrder.length)
      ? race.driverOrder.filter((i) => Number.isInteger(i) && i >= 0)
      : (race.drivers || []).map((_, i) => i);
    const dIdx = race.manualDriverIdx >= 0
      ? race.manualDriverIdx
      : (driverSwaps ? order[stopsDone % Math.max(1, order.length)] : (order[0] ?? 0));
    const drv = (race.drivers && race.drivers[dIdx]) || null;
    const driverCategory = drv && drv.category ? drv.category : 'avg';
    const ballastKg = drv && drv.ballastKg ? drv.ballastKg : 0;
    const driverName = (drv && drv.name) || (ourRow ? ourRow.driver : '');
    const penaltyMs = ballastKg > 0 ? ballastKg * (this.config.strategy.ballastPenaltySecPerKg || 0) * 1000 : 0;

    // ---- traffic: count CONSECUTIVE laps fighting (only advances when a lap completes) ----
    let traffic = false;
    const trafficSec = this.config.strategy.trafficGapSec || 0.5;
    traffic = (rivalAhead && rivalAhead.delta !== null && Math.abs(rivalAhead.delta) < trafficSec)
      || (rivalBehind && rivalBehind.delta !== null && Math.abs(rivalBehind.delta) < trafficSec);
    if (traffic) {
      if (this.lastTrafficStintLaps !== stintLaps) {
        this.trafficLaps = (this.trafficLaps || 0) + 1;
        this.lastTrafficStintLaps = stintLaps;
      }
    } else {
      this.trafficLaps = 0;
      this.lastTrafficStintLaps = null;
    }
    const trafficLaps = this.trafficLaps;

    let effStintMin = null;
    let effStintMax = null;

    let lapsUntilNextStop = null;
    let nextStopDueMs = null;
    let nextStopReason = '';
    let paceFactor = 1;
    let paceGapFrac = 0;
    let fieldMedianPace = 0;
    let ourPaceMs = 0;
    let targetLaps = null;
    if (ourV && stopsRemaining > 0 && remaining > 0) {
      const lapMs = lapMsEst;
      const windowEnd = Math.min(raceDurationMs, pitCloseMs || raceDurationMs);
      const span = Math.max(0, windowEnd - elapsed);

      // 0) relative-pace factor vs field median rolling pace
      ourPaceMs = avgLapMs || lapMsEst;
      const relPace = this.relativePace(state);
      const rollings = (relPace.rows || []).map((r) => r.rolling).filter((t) => t > 0);
      fieldMedianPace = rollings.length ? median(rollings) : 0;
      if (fieldMedianPace > 0 && ourPaceMs > 0) {
        paceGapFrac = (ourPaceMs - fieldMedianPace) / fieldMedianPace;
        const K = this.config.strategy.paceAdjustLaps || 25;
        paceFactor = Math.max(0.5, Math.min(1.5, 1 - paceGapFrac * K));
      }

      // base recommended TOTAL stint length (laps) from the even split.
      // min/max stints are configured in MINUTES -> convert to laps with the current lap time.
      // When a "mandatory stop every X min" rule is set it becomes the stint ceiling.
      const stintMin = Math.max(1, Math.round(((race.stintMinMin || 10) * 60000) / lapMs));
      const stintMaxMin = hourlyStop ? race.mandatoryStopEveryMin : (race.stintMaxMin || 40);
      const stintMax = Math.max(stintMin, Math.round((stintMaxMin * 60000) / lapMs));
      effStintMin = stintMin;
      effStintMax = stintMax;
      let stintLen = Math.max(stintMin, Math.min(stintMax, (span / (stopsRemaining + 1) / lapMs) * paceFactor));
      nextStopReason = 'even split';

      // weather: wet/rain -> shorten the stint (more stops while conditions are bad)
      if (wet) {
        stintLen *= (this.config.strategy.wetStopFactor || 0.8);
        nextStopReason = 'wet';
      }

      // Kart-quality verdict based on the CURRENT kart's pace. After a change we
      // may have drawn a bad kart, so judge it with a SHORT window over the laps
      // of this stint (trusted once the stint has >= 3 laps) — otherwise a slow
      // kart goes unnoticed behind the previous good kart's laps in the global
      // rolling average. Fast kart -> run it to the max; bad kart -> pit at the
      // minimum stint (or immediately if there's no minimum).
      const stintLapArr = current ? current.laps : [];
      const stintPaceMs = this.rollingPace(stintLapArr, 5);
      const stintLapCount = stintLapArr.length;
      const verdictPace = stintLapCount >= 3 && stintPaceMs > 0 ? stintPaceMs : avgLapMs;
      const stintEffDelta = targetLapMs && verdictPace > 0
        ? (verdictPace - targetLapMs) + penaltyMs
        : (deltaToTargetMs !== null ? deltaToTargetMs + penaltyMs : null);

      // pace vs target (+ ballast penalty). Positive = slower than target.
      const effDelta = deltaToTargetMs !== null ? deltaToTargetMs + penaltyMs : null;
      const pGood = (this.config.strategy.paceGoodSec || 0.3) * 1000;
      const pMed = (this.config.strategy.paceMediocreSec || 0.5) * 1000;
      const pBad = (this.config.strategy.paceBadSec || 1.0) * 1000;
      const aggressive = race.raceObjective === 'adelantar';
      if (stintEffDelta !== null) {
        if (stintEffDelta > pBad) {
          stintLen = stintMin;               // bad kart -> stop ASAP (min stint)
          nextStopReason = 'slow kart';
        } else if (stintEffDelta > pMed) {
          // mediocre -> bring the stop forward; "mantener" pulls it in harder to
          // protect the virtual position, "adelantar" tolerates a bit more risk.
          stintLen *= aggressive ? 0.8 : 0.7;
          nextStopReason = 'slower than target';
        } else if (stintEffDelta < -pGood) {
          // faster than target -> keep the kart out; "adelantar" pushes harder.
          stintLen = aggressive ? stintMax : Math.max(stintLen, stintLen * 1.15);
          nextStopReason = 'fast kart';
        }
        // else: within +/- pGood -> keep the split plan
      }

      // traffic: real stay-out vs pit decision, objective-aware.
      if (traffic) {
        if (trafficLaps > 5 && effDelta !== null && effDelta > pMed) {
          // stuck fighting for many laps with mediocre/bad pace -> stop now or soon.
          // bad pace: pit immediately (min stint); mediocre: bring the stop forward hard.
          stintLen = effDelta > pBad ? stintMin : Math.max(stintMin, stintLen * 0.5);
          nextStopReason = effDelta > pBad ? 'traffic stuck (bad, pit now)' : 'traffic stuck (mediocre, pit sooner)';
        } else if (effDelta !== null && effDelta > pMed) {
          // slower than the rival we are fighting -> bleeding time: pit to reset.
          // "mantener" reacts harder to protect the virtual position.
          stintLen = Math.min(stintLen, Math.max(stintMin, stintLen * (aggressive ? 0.6 : 0.5)));
          nextStopReason = 'traffic (slower, pit)';
        } else if (effDelta !== null && effDelta < -pGood) {
          // faster than the rival -> keep fighting: stay out to attack / hold.
          stintLen = Math.min(stintMax, stintLen + 2);
          nextStopReason = 'traffic (faster, stay out)';
        } else {
          // close pace -> the objective decides.
          if (aggressive) {
            stintLen = Math.min(stintMax, stintLen + 1);
            nextStopReason = 'traffic (attack, stay out)';
          } else {
            stintLen += 1; // play it safe, don't risk an early pit under pressure
            nextStopReason = 'traffic (hold)';
          }
        }
      }

      // driver category nudge: a fast driver can stretch a stint, a slow one shortens it.
      if (driverCategory === 'slow') stintLen *= 0.92;
      else if (driverCategory === 'fast') stintLen *= 1.08;

      // feasibility: every remaining stop needs a stint of `stintMin` laps PLUS a stop
      // that lasts at least `minPitTimeSec` (the whole pit-in->pit-out window); never
      // plan a stop that forces an extra one or a pitlane penalty.
      const stopCostMs = (race.minPitTimeSec || 0) * 1000;
      const needsLapsMs = Math.max(0, stopsRemaining - 1) * (Math.max(stintMin, 1) * lapMs + stopCostMs);
      const latestStopMs = windowEnd - needsLapsMs;
      const latestLen = Math.max(stintMin, (latestStopMs - elapsed) / lapMs);
      stintLen = Math.min(stintLen, latestLen);
      stintLen = Math.max(stintMin, Math.min(stintMax, stintLen));
      targetLaps = Math.max(0, stintLen);

      lapsUntilNextStop = Math.max(0, stintLen - stintLaps);
      nextStopDueMs = elapsed + lapsUntilNextStop * lapMs;

      // Pit-exit prediction + traffic-aware decision. Just before pitting we
      // simulate where we'll come out and whether we'd get stuck behind a
      // slower car / a battle — if so, it can be better to hold off a lap.
      if (lapsUntilNextStop <= 2) {
        const pitExit = this.predictPitExit(state, drivers);
        if (pitExit) {
          if (pitExit.trafficRisk >= 2) {
            // We'd exit right behind a slow/racing group -> delay the stop a lap
            // to let them pull clear, unless that forces us past the deadline.
            const newLaps = lapsUntilNextStop + 1;
            const newDueMs = elapsed + newLaps * lapMs;
            if (newDueMs < windowEnd && newLaps <= stintMax) {
              lapsUntilNextStop = newLaps;
              nextStopDueMs = newDueMs;
              nextStopReason = 'wait traffic exit';
            } else {
              nextStopReason = 'traffic exit (pit anyway)';
            }
          } else if (pitExit.trafficRisk === 1) {
            nextStopReason = 'traffic exit (watch)';
          }
        }
      }
    }

    // Pit-exit forecast (exposed for the UI + explanation), independent of the
    // decision adjustment so the crew always sees where we'd come out.
    const pitExit = ourRow ? this.predictPitExit(state, drivers) : null;

    // timeline of stops (done = green, projected = yellow)
    // Done stops sit at their REAL stint length: each pit record carries the lap
    // of the stop, so the marker time = stopLap × lap time (spaced by actual
    // stint length, not an even spread). Falls back to an even spread when the
    // pit records aren't available yet.
    const realStops = this.getRealPits().slice().sort((a, b) => a.lap - b.lap);
    const lapTimeEst = avgLapMs || targetLapMs || (ourRow ? this.parseTime(ourRow.best_lap) : 0) || 60000;
    const stopMarks = [];
    for (let i = 1; i <= effMandatoryStops; i++) {
      const done = i <= stopsDone;
      let atMs;
      if (done) {
        const rs = realStops[i - 1];
        if (rs && rs.lap > 0 && lapTimeEst > 0) {
          atMs = Math.min(elapsed, rs.lap * lapTimeEst);
        } else {
          atMs = (elapsed / (stopsDone + 1)) * i; // fallback: even spread
        }
      } else {
        const futureIndex = i - stopsDone;
        const windowEnd = Math.min(raceDurationMs, pitCloseMs || raceDurationMs);
        const span = Math.max(0, windowEnd - elapsed);
        atMs = elapsed + (span * futureIndex) / (stopsRemaining + 1);
      }
      stopMarks.push({ index: i, atMs, done });
    }

    // extra context for the human-readable explanation
    const ourBest = ourRow ? this.parseTime(ourRow.best_lap) : 0;
    const pitCloseRemainingMs = Math.max(0, pitCloseMs - elapsed);
    const pastWindow = this.ourLaps.slice(-(race.lapWindow * 2), -race.lapWindow);
    const pastPace = this.rollingPace(pastWindow);
    const lapTrendMs = avgLapMs && pastPace ? avgLapMs - pastPace : null;

    return {
      raceDurationMs,
      elapsedMs: elapsed,
      remainingMs: remaining,
      mandatoryStops: effMandatoryStops,
      mandatoryStopEveryMin: Number(race.mandatoryStopEveryMin) || 0,
      kartChangeOnly: !!race.kartChangeOnly,
      stopsDone,
      stopsRemaining,
      lapsUntilNextStop,
      nextStopDueMs,
      nextStopReason,
      pitExit,
      targetLapMs,
      avgLapMs,
      deltaToTargetMs,
      stintLaps,
      targetLaps,
      ourBest,
      pitCloseRemainingMs,
      lapTrendMs,
      paceFactor,
      paceGapFrac,
      fieldMedianPace,
      ourPaceMs,
      wet,
      weather: race.weather,
      trackCondition: race.trackCondition,
      raceObjective: race.raceObjective,
      traffic,
      trafficLaps,
      driverCategory,
      ballastKg,
      driverName,
      driverIdx: dIdx,
      stintMinLaps: effStintMin,
      stintMaxLaps: effStintMax,
      stintMinMin: race.stintMinMin,
      stintMaxMin: hourlyStop ? race.mandatoryStopEveryMin : race.stintMaxMin,
      minPitTimeSec: race.minPitTimeSec,
      pitCloseMs,
      penalties: 0,
      maxStintLaps: this.config.strategy.maxStintLaps,
      virtualPosition: ourV ? ourV.virtualPos : null,
      rivalAhead,
      rivalBehind,
      ourTeamName: race.ourTeamName || (ourRow ? ourRow.driver : ''),
      ourDriver: driverName || (ourRow ? ourRow.driver : ''),
      ourLastLap: ourRow ? this.parseTime(ourRow.last_lap) : 0,
      timeline: {
        durationMs: raceDurationMs,
        elapsedMs: elapsed,
        pitCloseMs,
        stops: stopMarks,
      },
      virtualRows: vrows.map((r) => ({
        kart: r.kart, driver: r.driver, virtualPos: r.virtualPos, stops: r.stops, effective: r.effective,
        gapSec: r.gapSec, lapped: r.lapped !== undefined ? r.lapped : isLapped(r),
      })),
    };
  }

  // Predict where OUR kart will be on track after the next pit stop.
  //
  // Model: while we are stopped for `minPitTimeSec` seconds (T), every rival
  // behind us whose gap to the leader is smaller than ourGap + T will overtake
  // us (we are stationary while they keep advancing). That gives the position
  // we exit in, plus the gaps to the cars immediately ahead/behind at that
  // moment. We also flag a "traffic risk": if the car we'd come out behind is
  // significantly slower than us and close, we'd get stuck losing time.
  predictPitExit(state, drivers) {
    const ourRow = this.getOurKartRow(state);
    if (!ourRow) return null;
    const T = this.config.race.minPitTimeSec || 30; // seconds we lose in the pits
    const ourGap = this.parseGapSec(ourRow.gap);
    if (ourGap === null) return null; // no numeric gap -> cannot model

    const ref = ourGap + T; // our gap-to-leader after a T-second stop

    // Cars with a numeric gap-to-leader (lapped cars report "N Lap(s)" -> null,
    // so they are simply treated as far behind and never overtake us here).
    const cars = drivers
      .map((d) => ({ d, g: this.parseGapSec(d.gap), pos: d.position }))
      .filter((c) => c.g !== null);

    // Car immediately ahead after exit = largest gap still < ref.
    let aheadCar = null;
    let bestG = -Infinity;
    for (const c of cars) {
      if (c.g < ref && c.g > bestG) { bestG = c.g; aheadCar = c; }
    }

    // Cars that were behind us (gap > ourGap) and now fall below ref -> passed us.
    const carsPassed = cars.filter((c) => c.g > ourGap && c.g < ref).length;

    // Car immediately behind after exit = smallest gap still > ref.
    let behindCar = null;
    let worstG = Infinity;
    for (const c of cars) {
      if (c.g > ref && c.g < worstG) { worstG = c.g; behindCar = c; }
    }

    const exitGapAheadSec = aheadCar ? ref - bestG : null;
    const exitGapBehindSec = behindCar ? worstG - ref : null;

    // Traffic risk: would we come out right behind a car that is much slower
    // than us (the classic "stuck behind a battle / a train" scenario)?
    let trafficRisk = 0;
    const ourPace = this.rollingPace(this.ourLaps) || this.parseTime(ourRow.best_lap) || 0;
    if (aheadCar && ourPace > 0) {
      const aheadPace = this.rollingPaceFor(aheadCar.d) || this.parseTime(aheadCar.d.best_lap) || 0;
      if (aheadPace > 0) {
        const pct = (aheadPace - ourPace) / ourPace; // >0 -> they are slower
        const close = (exitGapAheadSec ?? Infinity) < 2;
        if (pct > 0.05 && close) trafficRisk = 2;
        else if (pct > 0.03) trafficRisk = 1;
      }
    }

    return {
      exitPosition: ourRow.position + carsPassed,
      exitGapAheadMs: exitGapAheadSec != null ? Math.round(exitGapAheadSec * 1000) : null,
      exitGapBehindMs: exitGapBehindSec != null ? Math.round(exitGapBehindSec * 1000) : null,
      carsPassed,
      aheadCar: aheadCar ? { kart: aheadCar.d.kart, driver: aheadCar.d.driver } : null,
      behindCar: behindCar ? { kart: behindCar.d.kart, driver: behindCar.d.driver } : null,
      trafficRisk,
      pitTimeSec: T,
    };
  }

  parseTime(v) {
    if (!v) return 0;
    // grid times come as "1:23.688" or "23.688" or "16.368"
    const t = String(v).trim();
    if (!t || t === '-') return 0;
    const p = t.split(':');
    let sec = 0;
    if (p.length === 2) sec = parseInt(p[0], 10) * 60 + parseFloat(p[1]);
    else if (p.length === 3) sec = parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseFloat(p[2]);
    else sec = parseFloat(t);
    return isNaN(sec) ? 0 : Math.round(sec * 1000); // ms
  }

  parseLaps(v) {
    const n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }

  formatMs(v) {
    if (!v) return '-';
    const s = Math.round(v / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${String(sec).padStart(2, '0')}.${String(v % 1000).padStart(3, '0').slice(0, 3)}` : `${sec}.${String(v % 1000).padStart(3, '0')}`;
  }

  // ==== Strategy / pit suggestions ====
  buildSuggestions(state) {
    const ourRow = this.getOurKartRow(state);
    const { current } = this.computeStints();
    const ourLaps = this.ourLaps;
    const suggestions = [];
    const race = this.config.race;
    const strat = this.config.strategy;

    if (!ourRow) {
      suggestions.push({
        level: 'info',
        title: 'Set our kart',
        detail: 'Pick our kart number in the settings so we can track the stint and pace.',
      });
      return suggestions;
    }

    const bestLap = this.parseTime(ourRow.best_lap);
    const lastLap = this.parseTime(ourRow.last_lap);
    const rolling = this.rollingPace(ourLaps);
    const stintLaps = current ? current.lapCount : 0;

    // 0. Pitlane status
    if (ourRow.status === 'si') {
      suggestions.push({
        level: 'warn',
        title: `Our kart is ${ourRow.statusLabel || 'idle'}`,
        detail: 'Kart is stationary / not timing. May be in the pit or waiting.',
      });
    }

    // 1. Stint length
    if (current && stintLaps >= strat.maxStintLaps) {
      suggestions.push({
        level: 'danger',
        title: `Stint too long (${stintLaps} laps)`,
        detail: `You've been out ${stintLaps} laps. Plan a driver change / pit stop.`,
      });
    } else if (current && stintLaps >= strat.maxStintLaps - 5) {
      suggestions.push({
        level: 'warn',
        title: `Stint approaching limit (${stintLaps}/${strat.maxStintLaps})`,
        detail: 'Prepare the next driver, consider pitting in the next few laps.',
      });
    }

    // 2. Pace drop vs our best
    if (bestLap > 0 && rolling > 0) {
      const drop = ((rolling - bestLap) / bestLap) * 100;
      if (drop >= strat.paceDropPct) {
        suggestions.push({
          level: 'danger',
          title: `Kart losing pace (${drop.toFixed(1)}% slower than best)`,
          detail: `Current rolling pace ${this.formatMs(rolling)} vs best ${this.formatMs(bestLap)}. This kart may be too slow — plan a change.`,
        });
      } else if (drop >= strat.paceDropPct / 2) {
        suggestions.push({
          level: 'warn',
          title: `Pace softening (${drop.toFixed(1)}% slower than best)`,
          detail: `Watch the trend; if it keeps dropping consider changing kart.`,
        });
      }
    }

    // 3. Relative pace to leaders
    const rp = this.relativePace(state);
    if (rp.bestOverall > 0 && ourRow) {
      const ourBest = this.parseTime(ourRow.best_lap);
      if (ourBest > 0) {
        const gapPct = ((ourBest - rp.bestOverall) / rp.bestOverall) * 100;
        if (gapPct >= 5) {
          suggestions.push({
            level: 'warn',
            title: `Kart ${Math.round(gapPct)}% off the fastest`,
            detail: `Fastest kart best lap ${this.formatMs(rp.bestOverall)}, ours ${this.formatMs(ourBest)}.`,
          });
        } else {
          suggestions.push({
            level: 'good',
            title: `Pace competitive (${gapPct.toFixed(1)}% off fastest)`,
            detail: 'Keep the stint running.',
          });
        }
      }
    }

    // 4. Generic current stint summary
    if (current) {
      suggestions.push({
        level: 'info',
        title: `Stint summary — ${stintLaps} laps`,
        detail: `Best ${this.formatMs(current.bestTime)}, avg ${this.formatMs(current.avgTime)}.`,
      });
    }

    return suggestions;
  }

  // Full enriched snapshot for the frontend
  buildSnapshot(state) {
    const ourRow = this.getOurKartRow(state);
    const { stints, current } = this.computeStints();
    const ourLaps = this.ourLaps;
    const relative = this.relativePace(state);
    const qualy = this.analyzeQualy(state);
    const endurance = this.buildEndurance(state);
    const suggestions = this.buildSuggestions(state);

    // Compute best overall lap across all drivers
    const bestOverallLap = state.drivers.reduce((best, d) => {
      const t = this.parseTime(d.best_lap);
      return t > 0 && (best === 0 || t < best) ? t : best;
    }, 0);

    // Compute best overall sector times across all drivers
    const bestOverallS1 = state.drivers.reduce((best, d) => {
      const t = this.parseTime(d.s1);
      return t > 0 && (best === 0 || t < best) ? t : best;
    }, 0);
    const bestOverallS2 = state.drivers.reduce((best, d) => {
      const t = this.parseTime(d.s2);
      return t > 0 && (best === 0 || t < best) ? t : best;
    }, 0);
    const bestOverallS3 = state.drivers.reduce((best, d) => {
      const t = this.parseTime(d.s3);
      return t > 0 && (best === 0 || t < best) ? t : best;
    }, 0);

    // Helper: determine lap color class
    const lapColor = (lastLap, driverBestLap) => {
      if (!lastLap || lastLap <= 0) return 'lap-none';
      if (bestOverallLap > 0 && lastLap <= bestOverallLap) return 'lap-best-overall';
      if (driverBestLap > 0 && lastLap <= driverBestLap) return 'lap-personal-best';
      if (bestOverallLap > 0 && lastLap > bestOverallLap * 1.08) return 'lap-worst';
      return 'lap-normal';
    };

    // Helper: determine sector color class
    const sectorColor = (sectorTime, prevSectorTime, bestOverallSector) => {
      if (!sectorTime || sectorTime <= 0) return '';
      if (bestOverallSector > 0 && sectorTime <= bestOverallSector) return 'lap-best-overall';
      // Orange if worse than previous (degrading)
      if (prevSectorTime && sectorTime > prevSectorTime) return 'lap-worst';
      return 'lap-normal';
    };

    return {
      connected: state.connected,
      connectionState: state.connectionState || 'idle',
      mode: state.mode,
      track: state.track,
      title1: state.title1,
      title2: state.title2,
      message: state.message,
      comments: state.comments,
      timer: state.timer,
      light: state.light,
      weather: state.weather,
      updatedAt: state.updatedAt,
      bestOverallLap,
      ourKart: ourRow
        ? {
            id: ourRow.id,
            kart: ourRow.kart,
            driver: ourRow.driver,
            position: ourRow.position,
            laps: this.parseLaps(ourRow.laps),
            bestLap: this.parseTime(ourRow.best_lap),
            lastLap: this.parseTime(ourRow.last_lap),
            s1: this.parseTime(ourRow.s1),
            s2: this.parseTime(ourRow.s2),
            s3: this.parseTime(ourRow.s3),
            s1Color: sectorColor(this.parseTime(ourRow.s1), this.parseTime(ourRow.prevS1), bestOverallS1),
            s2Color: sectorColor(this.parseTime(ourRow.s2), this.parseTime(ourRow.prevS2), bestOverallS2),
            s3Color: sectorColor(this.parseTime(ourRow.s3), this.parseTime(ourRow.prevS3), bestOverallS3),
            stint: current,
            stintLaps: current ? current.lapCount : 0,
            rollingPace: this.rollingPace(ourLaps),
            raceElapsedMs: Date.now() - this.raceStartedAt,
            status: ourRow.status || '',
            statusLabel: ourRow.statusLabel || '',
            lapColor: lapColor(this.parseTime(ourRow.last_lap), this.parseTime(ourRow.best_lap)),
            posChange: ourRow.posChange || 0,
            on_track: ourRow.on_track || '',
            pitEntryTime: ourRow.pitEntryTime || null,
            pitExitTime: ourRow.pitExitTime || null,
            pitDuration: ourRow.pitDuration || null,
          }
        : null,
      drivers: state.drivers.map((d) => ({
        id: d.id,
        position: d.position,
        kart: d.kart,
        driver: d.driver,
        rank: d.rank,
        laps: this.parseLaps(d.laps),
        bestLap: this.parseTime(d.best_lap),
        lastLap: this.parseTime(d.last_lap),
        gap: d.gap,
        int: d.int,
        s1: d.s1,
        s2: d.s2,
        s3: d.s3,
        s1Color: sectorColor(this.parseTime(d.s1), this.parseTime(d.prevS1), bestOverallS1),
        s2Color: sectorColor(this.parseTime(d.s2), this.parseTime(d.prevS2), bestOverallS2),
        s3Color: sectorColor(this.parseTime(d.s3), this.parseTime(d.prevS3), bestOverallS3),
        status: d.status || '',
        statusLabel: d.statusLabel || '',
        posChange: d.posChange || 0,
        lapColor: lapColor(this.parseTime(d.last_lap), this.parseTime(d.best_lap)),
        on_track: d.on_track || '',
        pits: d.pits || '',
        lap_gap: d.lap_gap || '',
        pitEntryTime: d.pitEntryTime || null,
        pitExitTime: d.pitExitTime || null,
        pitDuration: d.pitDuration || null,
      })),
      relative,
      qualy,
      endurance,
      stints,
      suggestions,
    };
  }
}
