// Presenter: converts the raw strategy snapshot + config into a display-ready
// "view model". All business formatting (times, gaps, deltas) and the
// human-readable strategy explanations are computed HERE, so the frontend only
// receives strings and pre-computed values to render. No logic leaks to the UI.

// ---- formatting helpers (ms -> display strings) ----
function fmtMs(v) {
  if (!v || v <= 0) return '-';
  const t = Math.round(v);
  const s = Math.floor(t / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const frac = String(t % 1000).padStart(3, '0');
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}.${frac}` : `${sec}.${frac}`;
}

function fmtSec(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return '-';
  const sign = ms < 0 ? '-' : '+';
  return `${sign}${Math.abs(ms / 1000).toFixed(3)}s`;
}

function fmtCountdown(ms) {
  if (!ms || ms <= 0) return '0:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// remaining time of the current driver's stint, e.g. "-20:17s-"
function fmtTurn(ms) {
  if (!ms || ms <= 0) return '-';
  const s = Math.round(ms / 1000);
  return `-${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}s-`;
}

// gap to leader, e.g. "+5.021" / "+12'34.567"
function fmtGap(raw) {
  if (!raw) return '-';
  if (/lap/i.test(String(raw))) return String(raw);
  const m = /(\d+):(\d+(?:\.\d+)?)/.exec(String(raw));
  const secs = m ? parseInt(m[1], 10) * 60 + parseFloat(m[2]) : parseFloat(raw);
  if (isNaN(secs)) return String(raw);
  if (secs < 60) return `+${secs.toFixed(3)}`;
  return `+${Math.floor(secs / 60)}'${(secs % 60).toFixed(3).padStart(6, '0')}`;
}

function fmtLap(v) {
  if (!v || v === '-' || v === '0') return '-';
  return fmtMs(v);
}

function statusClass(s) {
  if (s === 'in' || s === 'ti' || s === 'sr') return 'status-track';
  if (s === 'si') return 'status-stationary';
  if (s === 'sf') return 'status-finished';
  if (s === 'so') return 'status-pit-out';
  if (s === 'su') return 'status-lap-complete';
  return 'status-unknown';
}

function statusText(s, label) {
  if (s === 'in' || s === 'ti' || s === 'sr' || s === 'su') return 'RACING';
  if (s === 'si') return 'STOP';
  if (s === 'sf') return 'FIN';
  if (s === 'so') return 'PIT OUT';
  return (label || s || '—').toString().toUpperCase().slice(0, 10);
}

function verdictLabel(v) {
  switch (v) {
    case 'pending': return '⏳ Waiting';
    case 'great': return '★ Faster';
    case 'good': return 'On pace';
    case 'watch': return '⚠ Slower';
    case 'poor': return '✗ Much slower';
    default: return '-';
  }
}

// Human-readable explanation of the strategy / pit recommendation.
// This is the IP the frontend must never know about: generated only here.
function buildExplanation(e, s) {
  const items = [];
  if (!e) return items;
  const min = (ms) => (ms ? Math.max(1, Math.round(ms / 60000)) : 0);
  const pct = (ms) => Math.max(0, Math.min(100, Math.round((ms / e.raceDurationMs) * 100)));
  const when = (laps) => (laps === null || laps === undefined ? '-' : laps <= 0 ? 'ahora mismo' : `en unos ${Math.max(1, Math.ceil(laps))} vueltas`);

  // 1. Race clock
  items.push({
    tag: 'reloj',
    text: `Quedan ${min(e.remainingMs)} min de ${min(e.raceDurationMs)} de carrera (${pct(e.remainingMs)}% por disputar).`,
  });

  // 2. Position
  if (e.virtualPosition) {
    items.push({
      tag: 'pos',
      text: `Vamos en la posición virtual ${e.virtualPosition} de ${(s.drivers || []).length}.`,
    });
  }

  // Reduced mode: all mandatory stops done -> only pace, trend and rivals matter.
  if (e.stopsRemaining === 0) {
    if (e.avgLapMs) {
      items.push({
        tag: 'ritmo',
        text: `Ritmo medio de las últimas vueltas: ${fmtMs(e.avgLapMs)}. Mejor vuelta del kart: ${fmtMs(e.ourBest)}.`,
      });
    }
    if (e.lapTrendMs !== null && e.lapTrendMs !== undefined) {
      const t = e.lapTrendMs > 200 ? 'estamos perdiendo ritmo (fatiga, neumáticos o tráfico)'
             : e.lapTrendMs < -200 ? 'estamos ganando ritmo'
             : 'el ritmo se mantiene estable';
      items.push({
        tag: 'tend',
        text: `Comparado con hace unas vueltas, ${t} (${fmtSec(e.lapTrendMs)}).`,
      });
    }
    items.push({ tag: 'porque', text: 'Paradas obligatorias completadas: solo hay que llegar a la meta manteniendo el ritmo.' });
    return items;
  }

  // 3. Our pace
  if (e.avgLapMs) {
    items.push({
      tag: 'ritmo',
      text: `Ritmo medio de las últimas vueltas: ${fmtMs(e.avgLapMs)}. Mejor vuelta del kart: ${fmtMs(e.ourBest)}.`,
    });
  }

  // 4. Kart pace vs the field
  if (e.paceFactor && e.ourPaceMs && e.fieldMedianPace) {
    const diff = e.ourPaceMs - e.fieldMedianPace;
    const faster = diff < 0;
    const rawPct = Math.abs((diff / e.fieldMedianPace) * 100);
    const pctVal = rawPct < 1 ? rawPct.toFixed(1) : String(Math.round(rawPct));
    const action = faster ? 'hemos alargado' : 'hemos adelantado';
    items.push({
      tag: 'kart',
      text: `Ritmo relativo del kart: la media del grid es ${fmtMs(e.fieldMedianPace)} y la nuestra es ${fmtMs(e.ourPaceMs)} (${pctVal}% ${faster ? 'más rápido' : 'más lento'} que la media). Por eso ${action} la ventana de parada recomendada.`,
    });
  }

  // 5. Target pace (pace of the rival chasing us)
  if (e.avgLapMs && e.targetLapMs && e.deltaToTargetMs !== null) {
    const q = e.deltaToTargetMs <= 0 ? 'más rápido' : 'más lento';
    const rivalName = e.rivalBehind ? e.rivalBehind.driver : 'el rival que nos persigue';
    items.push({
      tag: 'ritmo',
      text: `Para no perder posición con ${rivalName} haría falta ir a unos ${fmtMs(e.targetLapMs)} por vuelta; ahora vamos ${fmtMs(Math.abs(e.deltaToTargetMs))} ${q} que ese ritmo.`,
    });
  }

  // 5. General speed of the field
  if (s.bestOverallLap && e.ourBest) {
    const d = e.ourBest - s.bestOverallLap;
    items.push({
      tag: 'vel',
      text: `Referencia de la parrilla: el mejor tiempo absoluto es ${fmtMs(s.bestOverallLap)}; nuestro mejor está a ${d >= 0 ? '+' : '−'}${fmtMs(Math.abs(d))} de ese punto de referencia.`,
    });
  }

  // 6. Pace trend
  if (e.lapTrendMs !== null && e.lapTrendMs !== undefined) {
    const t = e.lapTrendMs > 200 ? 'estamos perdiendo ritmo (fatiga, neumáticos o tráfico)'
           : e.lapTrendMs < -200 ? 'estamos ganando ritmo'
           : 'el ritmo se mantiene estable';
    items.push({
      tag: 'tend',
      text: `Comparado con hace unas vueltas, ${t} (${fmtSec(e.lapTrendMs)}).`,
    });
  }

  // 7. Stops done / remaining
  if (e.mandatoryStopEveryMin > 0) {
    const tipo = e.kartChangeOnly ? 'cambio de kart (el piloto continúa)' : 'cambio de kart';
    items.push({
      tag: 'pits',
      text: `Formato: parada obligatoria cada ${e.mandatoryStopEveryMin} min (${tipo}). Llevamos ${e.stopsDone} de ${e.mandatoryStops} paradas, quedan ${e.stopsRemaining}.`,
    });
  } else {
    items.push({
      tag: 'pits',
      text: `Paradas obligatorias: ${e.stopsDone} hechas de ${e.mandatoryStops}, quedan ${e.stopsRemaining}.`,
    });
  }

  // 8. Pit-close deadline
  if (e.pitCloseRemainingMs !== undefined) {
    items.push({
      tag: 'cierre',
      text: `El carril de pits cierra en el minuto ${Math.round(e.pitCloseMs / 60000)} (dentro de ${min(e.pitCloseRemainingMs)} min). Las ${e.stopsRemaining} paradas que faltan hay que encajarlas antes de esa hora, o habrá penalización.`,
    });
  }

  // 9. THE REASON for the pit recommendation
  if (e.lapsUntilNextStop !== null) {
    const reason = e.nextStopReason || 'even split';
    let why;
    if (reason === 'wet') {
      why = `POR QUÉ PARAR (mojado/lluvia): con pista mojada se pierde menos tiempo relativo en cada parada (vuelta más larga). La estrategia adelanta las paradas para aprovechar la ventana de condiciones malas. Entrar ${when(e.lapsUntilNextStop)}.`;
    } else if (reason === 'slow kart') {
      why = `POR QUÉ PARAR (ritmo malo): vamos +1,0s o más lentos que el tiempo objetivo${e.ballastKg ? ` (con ${e.ballastKg} kg de lastre)` : ''}. Cada vuelta nos cuesta posición, así que adelantamos la parada al mínimo de stint (${e.stintMinMin} min) para no hacer una parada extra. Entrar ${when(e.lapsUntilNextStop)}.`;
    } else if (reason === 'slower than target') {
      why = `POR QUÉ PARAR (ritmo mediocre): vamos +0,5s más lentos que el objetivo/${e.driverName || 'el perseguidor'}. Adelantamos la parada unas vueltas para no perder la posición virtual. Entrar ${when(e.lapsUntilNextStop)}.`;
    } else if (reason === 'fast kart') {
      why = e.mandatoryStopEveryMin > 0
        ? `POR QUÉ PARAR (ritmo muy bueno): vamos más rápidos que el tiempo objetivo, así que aguantamos con este kart hasta el límite de la parada obligatoria (${e.stintMaxMin} min). Entrar ${when(e.lapsUntilNextStop)}.`
        : `POR QUÉ PARAR (ritmo muy bueno): vamos más rápidos que el tiempo objetivo, así que aguantamos con este kart/piloto el máximo del stint (${e.stintMaxMin} min) para sacar partido. Entrar ${when(e.lapsUntilNextStop)}.`;
    } else if (reason.includes('traffic stuck')) {
      const laps = e.trafficLaps || 0;
      if (reason.includes('bad')) {
        why = `POR QUÉ PARAR (atascado en tráfico, ritmo malo): llevamos ${laps} vueltas peleando y vamos muy lentos, perdiendo tiempo en cada vuelta. Paramos de inmediato. Entrar ${when(e.lapsUntilNextStop)}.`;
      } else {
        why = `POR QUÉ PARAR (atascado en tráfico, ritmo mediocre): llevamos ${laps} vueltas peleando sin poder pasar, con ritmo inferior al objetivo. Adelantamos la parada para no seguir perdiendo posición. Entrar ${when(e.lapsUntilNextStop)}.`;
      }
    } else if (reason.includes('traffic')) {
      if (reason.includes('slower')) {
        why = `POR QUÉ PARAR (lucha, ritmo inferior): estamos peleando y vamos más lentos que el rival, perdiendo tiempo en cada vuelta. ${e.raceObjective === 'mantener' ? 'Para proteger la posición virtual' : 'Para no gastar el kart'} adelantamos la parada. Entrar ${when(e.lapsUntilNextStop)}.`;
      } else if (reason.includes('faster')) {
        why = `POR QUÉ PARAR (lucha, ritmo superior): estamos en pelea pero somos más rápidos que el rival, así que nos mantenemos en pista para atacar/defender. Entrar ${when(e.lapsUntilNextStop)}.`;
      } else if (reason.includes('attack')) {
        why = `POR QUÉ PARAR (lucha, objetivo adelantar): con ritmo parejo y objetivo de adelantar, seguimos en pista peleando. Entrar ${when(e.lapsUntilNextStop)}.`;
      } else if (reason === 'wait traffic exit') {
        why = `POR QUÉ PARAR (evitar tráfico a la salida): si entráramos ahora saldríamos justo detrás de un piloto lento o de una pelea y perderíamos tiempo cada vuelta. Aguantamos una vuelta más para que el grupo se abra y salir con espacio. Entrar ${when(e.lapsUntilNextStop)}.`;
      } else if (reason === 'traffic exit (watch)') {
        why = `POR QUÉ PARAR (ojo con la salida): al salir de boxes nos quedaría un rival lento cerca delante. Entrar con cuidado ${when(e.lapsUntilNextStop)}.`;
      } else if (reason === 'traffic exit (pit anyway)') {
        why = `POR QUÉ PARAR (tráfico a la salida, sin margen): saldríamos detrás de un rival lento, pero no podemos retrasar más la parada por el cierre de pitlane. Entrar ${when(e.lapsUntilNextStop)}.`;
      } else {
        why = `POR QUÉ PARAR (lucha, mantener): en pelea con ritmo parejo y objetivo de mantener, aguantamos en pista sin arriesgar una parada bajo presión. Entrar ${when(e.lapsUntilNextStop)}.`;
      }
    } else {
      const perStint = e.targetLapMs ? Math.round((e.pitCloseRemainingMs / (e.stopsRemaining + 1) / e.targetLapMs) * (e.paceFactor || 1)) : 0;
      why = e.mandatoryStopEveryMin > 0
        ? `POR QUÉ PARAR (parada cada ${e.mandatoryStopEveryMin} min): toca entrar por el cambio de kart obligatorio${e.kartChangeOnly ? ' (sin cambio de piloto)' : ''}. Entrar ${when(e.lapsUntilNextStop)}.`
        : `POR QUÉ PARAR (reparto): para encajar las ${e.stopsRemaining} paradas antes del cierre hay que parar aproximadamente cada ${perStint} vueltas. Llevamos ${e.stintLaps} en este relevo, así que toca entrar ${when(e.lapsUntilNextStop)}.`;
    }
    if (reason.includes('traffic')) why += ' [Decisión tráfico]';
    items.push({ tag: 'porque', text: why });
  } else if (e.stopsRemaining > 0) {
    items.push({
      tag: 'porque',
      text: 'Todavía no hay recomendación de parada: faltan datos de ritmo o el reloj no está en marcha.',
    });
  } else {
    items.push({ tag: 'porque', text: 'Paradas obligatorias completadas: solo hay que llegar a la meta manteniendo el ritmo.' });
  }

  // 10. Pit-exit forecast (only when it matters: stop is near).
  if (e.pitExit && e.lapsUntilNextStop !== null && e.lapsUntilNextStop <= 2) {
    const pe = e.pitExit;
    const aheadName = pe.aheadCar ? ` (${pe.aheadCar.driver})` : '';
    const behindName = pe.behindCar ? ` (${pe.behindCar.driver})` : '';
    const passed = pe.carsPassed ? ` Nos pasarán ${pe.carsPassed} antes de salir.` : '';
    const risk =
      pe.trafficRisk >= 2
        ? ' Riesgo alto de quedarnos atascados: el piloto de delante es más lento que nosotros.'
        : pe.trafficRisk === 1
        ? ' Cuidado: el piloto de delante es algo más lento que nosotros.'
        : '';
    items.push({
      tag: 'kart',
      text: `Predicción salida de pits: saldremos en la posición ${pe.exitPosition}, a ${fmtSec(pe.exitGapAheadMs)}${aheadName} del de delante y ${fmtSec(pe.exitGapBehindMs)}${behindName} del de detrás.${passed}${risk}`,
    });
  }

  return items;
}

function buildPilotOptions(config) {
  const rc = config.race;
  const n = Math.max(1, rc.numDrivers || (rc.drivers && rc.drivers.length) || 1);
  const drvs = rc.drivers || [];
  const order = (Array.isArray(rc.driverOrder) && rc.driverOrder.length) ? rc.driverOrder : drvs.map((_, i) => i);
  const seq = order.filter((i) => i >= 0 && i < n).slice(0, n);
  return seq.map((i, k) => ({
    value: i,
    label: (drvs[i] && drvs[i].name) || `Piloto ${i + 1}` + (k === 0 ? ' · salida' : ''),
  }));
}

// Build the full display-ready view model from the snapshot + config.
export function buildView(snapshot, config) {
  const e = snapshot.endurance || {};

  // Not connected to any circuit (and not explicitly in offline mode): show a
  // completely blank screen so no stale data is displayed.
  const cs = snapshot.connectionState || 'idle';
  if (cs !== 'connected' && !snapshot.offline) {
    return {
      offline: !!snapshot.offline,
      connected: false,
      connectionState: cs,
      circuitUrl: (config.apex && config.apex.circuitUrl) || '',
      track: '',
      topbar: {
        countdown: '0:00:00',
        teamName: '',
        driverPos: '',
        driverName: '',
        driverDelta: '',
        surfaceBadge: { text: '', wet: false },
        stopsDetail: [],
        stopsLabel: '',
        nextStop: { value: '', base: 0, urgent: false },
        weatherValue: 'soleado',
        trackConditionValue: 'dry',
        raceObjectiveValue: 'adelantar',
        pilotOptions: buildPilotOptions(config),
        manualDriverIdx: config.race.manualDriverIdx,
      },
      strategy: { rows: [] },
      pace: { rows: [] },
      explanation: [],
      standings: [],
      relative: [],
      qualy: { saved: false },
      stints: [],
      comments: [],
      timeline: { progressPct: 0, stops: [], pitClose: null },
      spark: true,
    };
  }

  const ourKart = snapshot.ourKart ? String(snapshot.ourKart.kart) : null;

  // ---- comments ----
  // A comment mentioning OUR dorsal counts as one sanction; those rows are
  // highlighted in red in the UI.
  const comments = (snapshot.comments || []).map((c) => ({
    time: c.time || '',
    flags: c.flags || [],
    karts: c.karts || [],
    text: c.text || '',
    isOurs: !!(ourKart && (c.karts || []).includes(String(ourKart))),
  }));
  const penalties = comments.filter((c) => c.isOurs).length;

  // ---- topbar ----
  const realPos = snapshot.ourKart?.position || e.virtualPosition;
  const lapMs = e.avgLapMs || e.targetLapMs;
  let remMs = null;
  if (e.lapsUntilNextStop !== null && lapMs) remMs = e.lapsUntilNextStop * lapMs;
  const recommended = e.lapsUntilNextStop;
  const base = recommended === null ? 0 : Math.round(recommended);

  const stopsDetail = (e.timeline?.stops || []).map((s) => ({
    index: s.index,
    done: s.done,
    atMin: Math.round(s.atMs / 60000),
  }));

  // ---- strategy panel rows ----
  const stratRows = [
    { icon: 'clock', label: 'Tiempo objetivo', value: fmtMs(e.targetLapMs), css: 'strat-target' },
    { icon: 'gauge', label: 'Tiempo medio', value: e.deltaToTargetMs === null ? fmtMs(e.avgLapMs) : `${fmtMs(e.avgLapMs)} ${fmtSec(e.deltaToTargetMs)}`, css: '' },
    { icon: 'trophy', label: 'Posición virtual', value: e.virtualPosition ? `${e.virtualPosition}º` : '-', css: 'strat-virtual' },
    { icon: 'weather', label: 'Condición', value: e.wet ? 'Mojado / Lluvia' : 'Seco', css: '' },
    { icon: 'repeat', label: e.mandatoryStopEveryMin > 0 ? 'Stint kart' : 'Stint actual', value: e.stintLaps !== null && e.stintLaps !== undefined ? e.mandatoryStopEveryMin > 0 ? `${e.stintLaps} vueltas · kart cada ${e.stintMaxMin} min` : `${e.stintLaps} vueltas · máx ${e.stintMaxMin} min` : '-', css: '' },
    { icon: 'swords', label: 'Tráfico / lucha', value: e.traffic ? `En lucha (${e.trafficLaps || 0}v)` : 'Libre', css: '' },
  ];

  // rival ahead / behind (real standings, not virtual deltas)
  if (e.rivalAhead) {
    stratRows.push({
      icon: 'swords',
      label: `Rival delante: ${e.rivalAhead.driver}`,
      value: e.rivalAhead.delta != null ? fmtSec(-Math.abs(e.rivalAhead.delta) * 1000) : (e.rivalAhead.lapGap ? '1 v.' : '-'),
      css: 'strat-ahead',
    });
  }
  if (e.rivalBehind) {
    stratRows.push({
      icon: 'swords',
      label: `Rival detrás: ${e.rivalBehind.driver}`,
      value: e.rivalBehind.delta != null ? fmtSec(Math.abs(e.rivalBehind.delta) * 1000) : (e.rivalBehind.lapGap ? '1 v.' : '-'),
      css: 'strat-behind',
    });
  }

  // deltas to rivals ahead / behind + leader
  const vrows = e.virtualRows || [];
  const ourIdx = vrows.findIndex((r) => r.kart === String(snapshot.ourKart || ''));
  if (ourIdx >= 0) {
    const ahead = vrows[ourIdx - 1];
    const behind = vrows[ourIdx + 1];
    const leader = vrows[0];
    if (ahead) {
      stratRows.push({ icon: 'arrow-up', label: `Delta ${ahead.virtualPos || ourIdx}º`, value: ahead.gapSec != null ? `-${fmtMs(ahead.gapSec * 1000)}` : '-', css: 'strat-ahead' });
    } else {
      stratRows.push({ icon: 'arrow-up', label: 'Delta delante', value: '-', css: 'strat-ahead' });
    }
    if (behind) {
      stratRows.push({ icon: 'arrow-down', label: `Delta ${behind.virtualPos || (ourIdx + 2)}º`, value: behind.gapSec != null ? `-${fmtMs(behind.gapSec * 1000)}` : '-', css: 'strat-behind' });
    } else {
      stratRows.push({ icon: 'arrow-down', label: 'Delta detrás', value: '-', css: 'strat-behind' });
    }
    if (leader && ourIdx > 0) {
      stratRows.push({ icon: 'flag2', label: 'Delta líder', value: leader.gapSec != null ? `+${fmtMs(leader.gapSec * 1000)}` : '-', css: '' });
    }
  }
  if (e.pitExit && e.lapsUntilNextStop !== null && e.lapsUntilNextStop <= 5) {
    const pe = e.pitExit;
    const gapStr = (v) => (v == null ? '-' : v === 0 ? '0.000' : fmtMs(v));
    const ga = gapStr(pe.exitGapAheadMs);
    const gb = gapStr(pe.exitGapBehindMs);
    stratRows.push({
      icon: 'route',
      label: `Previsión al salir de pit · <b>P${pe.exitPosition}</b>`,
      value: `+${ga} delante · −${gb} detrás`,
      title: `Saldrás en la posición ${pe.exitPosition}: ${ga} por detrás del coche de delante y con el de detrás a ${gb} por detrás de ti.`,
      css: pe.trafficRisk >= 2 ? 'strat-penalties' : 'strat-ahead',
    });
  }
  stratRows.push({ icon: 'scale', label: 'Sanciones', value: penalties > 0 ? penalties : (e.penalties ?? 0), css: 'strat-penalties' });

  // ---- standings ----
  const relByKart = {};
  for (const r of (snapshot.relative?.rows || [])) relByKart[String(r.kart)] = r;
  const standings = (snapshot.drivers || []).map((d) => {
    const isOurs = ourKart && String(d.kart) === ourKart;
    const posArrow = d.posChange > 0 ? `<span class="pos-up">▲${d.posChange}</span>`
                   : d.posChange < 0 ? `<span class="pos-down">▼${Math.abs(d.posChange)}</span>` : '';
    const relRow = relByKart[String(d.kart)];
    return {
      position: d.position || '-',
      posArrow,
      kart: d.kart || '',
      driver: d.driver || '',
      gap: fmtGap(d.gap),
      lastLap: fmtLap(d.lastLap),
      bestLap: fmtMs(d.bestLap),
      bestLapClass: snapshot.bestOverallLap > 0 && d.bestLap === snapshot.bestOverallLap ? 'lap-best-overall' : '',
      isFastest: snapshot.bestOverallLap > 0 && d.bestLap === snapshot.bestOverallLap,
      sparkLaps: relRow ? relRow.recentLaps : null,
      statusClass: statusClass(d.status),
      statusText: statusText(d.status, d.statusLabel),
      pits: d.pits || '0',
      isOurs,
      lastLapClass: d.lapColor || '',
    };
  });

  // ---- relative pace ----
  const relRows = snapshot.relative?.rows || [];
  const bestOverall = snapshot.bestOverallLap || snapshot.relative?.bestOverall || 0;
  const oursRel = relRows.find((r) => ourKart && String(r.kart) === ourKart);
  let paceRows = [];
  if (oursRel) {
    // Count karts faster/slower than us by CURRENT pace (rolling), which moves
    // during an endurance race. Falls back to best lap when our rolling pace is
    // not available yet.
    const useRolling = oursRel.rolling > 0;
    const op = useRolling ? oursRel.rolling : oursRel.bestLap;
    const rp = (r) => (useRolling ? r.rolling : r.bestLap);
    const faster = relRows.filter((r) => op > 0 && rp(r) > 0 && rp(r) < op).length;
    const slower = relRows.filter((r) => op > 0 && rp(r) > 0 && rp(r) > op).length;
    const dBest = oursRel.bestLap > 0 && bestOverall > 0 ? oursRel.bestLap - bestOverall : 0;
    paceRows = [
      { label: 'Posición', value: `${oursRel.position} / ${relRows.length}`, css: '' },
      { label: 'Karts más rápidos', value: String(faster), css: 'danger' },
      { label: 'Karts más lentos', value: String(slower), css: 'good' },
      { label: 'Ritmo actual', value: fmtMs(oursRel.rolling), css: '' },
      { label: 'Delta al más rápido', value: `${dBest > 0 ? '+' : ''}${fmtMs(dBest)}`, css: dBest <= 0 ? 'good' : dBest < 2000 ? 'warn' : 'danger' },
    ];
  } else {
    paceRows = [{ label: 'Selecciona tu kart en la clasificación para ver el resumen.', value: '', css: 'muted' }];
  }

  const relative = relRows.map((r) => {
    const isOurs = ourKart && String(r.kart) === ourKart;
    const delta = bestOverall > 0 && r.bestLap > 0 ? r.bestLap - bestOverall : 0;
    let gapAhead = '-';
    const ahead = relRows.find((x) => x.position === r.position - 1);
    if (ahead && r.lastLap > 0 && ahead.lastLap > 0) {
      const g = r.lastLap - ahead.lastLap;
      gapAhead = `${g > 0 ? '+' : ''}${fmtMs(Math.abs(g))}`;
    }
    return {
      position: r.position || '-',
      kart: r.kart || '',
      driver: r.driver || '',
      bestLap: fmtMs(r.bestLap),
      rolling: fmtMs(r.rolling),
      delta: `${delta > 0 ? '+' : ''}${fmtMs(delta)}`,
      deltaClass: delta <= 0 ? 'good' : delta < 2000 ? 'warn' : 'danger',
      sparkLaps: (r.recentLaps && r.recentLaps.length >= 2) ? r.recentLaps : null,
      gapAhead,
      isOurs,
    };
  });

  // ---- qualy ----
  const q = snapshot.qualy;
  let qualy = { saved: !!(q && q.saved) };
  if (q && q.saved) {
    const pending = q.rows.filter((r) => r.verdict === 'pending').length;
    const fastest = q.rows.slice(0, 3);
    const slowest = q.rows.slice(-3).reverse();
    qualy = {
      saved: true,
      savedAtText: new Date(q.savedAt).toLocaleString(),
      status: pending ? '⏳ Waiting for race laps' : '⚡ Comparing with race',
      fastest: fastest.map((f) => f.driver).join(' · '),
      slowest: slowest.map((s) => s.driver).join(' · '),
      rows: q.rows.map((r, i) => ({
        rank: i + 1,
        rankSuffix: `${i < 3 ? ' ⭐' : ''}${i >= q.rows.length - 3 ? ' ⬇' : ''}`,
        kart: r.kart || '',
        driver: r.driver || '',
        qualyLap: fmtMs(r.qualyLap),
        raceBest: r.raceBest ? fmtMs(r.raceBest) : '—',
        delta: r.delta === null ? '—' : r.delta > 0 ? `+${fmtMs(r.delta)}` : `-${fmtMs(Math.abs(r.delta))}`,
        verdict: verdictLabel(r.verdict),
        verdictClass: r.verdict,
        isOurs: ourKart && String(r.kart) === ourKart,
      })),
    };
  }

  // ---- stints ----
  const stints = (snapshot.stints || []).map((s, idx, arr) => ({
    startLap: s.startLap,
    endLap: s.endLap,
    lapCount: s.lapCount,
    bestTime: fmtMs(s.bestTime),
    avgTime: fmtMs(s.avgTime),
    isCurrent: idx === arr.length - 1,
  }));

  // ---- timeline ----
  const t = e.timeline;
  const dur = t?.durationMs || 1;
  const tlPct = (ms) => Math.max(0, Math.min(100, (ms / dur) * 100));
  const timeline = {
    progressPct: tlPct(t?.elapsedMs),
    stops: (t?.stops || []).map((s) => ({ index: s.index, leftPct: tlPct(s.atMs), done: s.done })),
    pitClose: t?.pitCloseMs && t.pitCloseMs < dur ? { leftPct: tlPct(t.pitCloseMs) } : null,
  };

  return {
    offline: !!snapshot.offline,
    connected: snapshot.connected,
    track: snapshot.track,
    topbar: {
      countdown: fmtCountdown(e.remainingMs),
      teamName: e.ourTeamName || snapshot.track || '',
      driverPos: realPos ? `${realPos}º` : '',
      driverName: e.ourDriver ? `· ${e.ourDriver}` : '',
      driverDelta: fmtTurn(remMs),
      surfaceBadge: { text: e.wet ? 'MOJADO' : 'SECO', wet: !!e.wet },
      stopsDetail,
      stopsLabel: `${e.stopsDone} / ${e.mandatoryStops}`,
      nextStop: { value: recommended === null ? '' : Math.max(0, base), base, urgent: recommended !== null && Math.max(0, base) < 2 },
      weatherValue: e.weather || 'soleado',
      trackConditionValue: e.trackCondition || 'dry',
      raceObjectiveValue: e.raceObjective || 'adelantar',
      pilotOptions: buildPilotOptions(config),
      manualDriverIdx: config.race.manualDriverIdx,
    },
    strategy: { rows: stratRows },
    pace: { rows: paceRows },
    connectionState: snapshot.connectionState || 'idle',
    circuitUrl: (config.apex && config.apex.circuitUrl) || '',
    explanation: buildExplanation(e, snapshot),
    standings,
    relative,
    qualy,
    stints,
    comments,
    timeline,
    // raw lap series for sparklines (pure presentation, no business logic)
    spark: true,
  };
}

export const formatters = { fmtMs, fmtSec, fmtCountdown, fmtTurn, fmtGap, fmtLap };
