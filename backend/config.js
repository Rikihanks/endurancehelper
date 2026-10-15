// Default configuration factory.
//
// Every race session gets its OWN config object (deep clone of these defaults,
// optionally merged with persisted settings). There is NO shared mutable
// "config" singleton for race state — that would break multi-tenancy.
//
// Server-level settings that are NOT race-scoped (HTTP listen port) live in
// `httpConfig`.

const DEFAULTS = {
  // Apex Timing live data backend (resolved from a circuit URL at runtime)
  apex: {
    circuitUrl: 'https://www.apex-timing.com/live-timing/kartcenter-campillos/index.html',
    host: 'live-data.apex-timing.com',
    basePort: 9370,
    wssPort: 9373,
    requestUrl: 'https://live-data.apex-timing.com/live-timing/commonv2/functions/',
    origin: 'https://www.apex-timing.com',
    connectTimeoutMs: 10000,
    reconnectDelayMs: 5000,
    clientId: Math.floor(1e9 * Math.random()) || 1,
  },

  // Race / team configuration (tune per event)
  race: {
    setupDone: false,       // true once the pre-race setup screen has been completed
    ourKart: null,          // dorsal (kart number) of OUR kart, e.g. "78" (null = pick in UI)
    ourDriverId: null,      // internal apex driver id once resolved (e.g. 26)
    ourTeamName: '',        // team name, filled when you select your team
    raceDurationMin: 120,   // total endurance length in minutes

    // pre-race inputs
    weatherForecast: 'dry', // previsión: dry | damp | wet | rain
    mandatoryStops: 8,      // required pit stops for the whole race
    minPitTimeSec: 30,      // minimum time a pit stop must last (seconds)
    numDrivers: 4,          // number of drivers on the team
    driverChangePerStop: true, // do we change driver on every mandatory stop
    stintMinMin: 10,       // minimum stint length (minutes)
    stintMaxMin: 40,       // maximum stint length (minutes)
    mandatoryStopEveryMin: 0,  // >0: parada obligatoria cada X min (cambio de kart), en vez de stint máximo
    kartChangeOnly: false,     // las paradas cambian kart pero no piloto
    minWeightKg: 75,        // minimum allowed weight (kg)
    raceObjective: 'adelantar', // adelantar | mantener
    drivers: [              // team drivers, in running order (index = order)
      { name: '', weightKg: 75, ballastKg: 0, category: 'avg' },
      { name: '', weightKg: 75, ballastKg: 0, category: 'avg' },
      { name: '', weightKg: 75, ballastKg: 0, category: 'avg' },
      { name: '', weightKg: 75, ballastKg: 0, category: 'avg' },
    ],
    manualDriverIdx: -1,    // if >=0, force the "driver on track" index (live override)
    driverOrder: [],        // explicit running order as indices into `drivers` (e.g. [2,0,1,3]); empty = natural order

    // live adjustments (mid-race)
    weather: 'dry',         // meteorología: soleado | nublado | lluvia | tormenta
    trackCondition: 'dry',  // pista: dry | damp | wet | puddle

    pollLapsMs: 15000,      // how often we re-fetch our kart lap history
    pollRivalsMs: 45000,    // how often we re-fetch rival (grid) lap times
    pollSnapshotsMs: 30000, // how often we persist a postmortem time-series snapshot
    lapWindow: 8,           // laps used for rolling current-pace
    stintEndBufferPct: 0.12, // pit window opens when race fraction remaining is this

    // Endurance strategy
    pitCloseMin: 110,       // minute of the race when pit lane closes
  },

  // UI preferences
  ui: {
    theme: 'dark',            // dark | light
  },

  // Strategy thresholds
  strategy: {
    maxStintLaps: 40,          // legacy alias (kept for fallback)
    paceDropPct: 4,            // pit if current pace > best pace * (1 + this/100)
    paceAdjustLaps: 25,        // how strongly a relative-pace gap shifts the stop (1% gap ~ +-0.25)
    paceGoodSec: 0.3,          // within +/- this of target -> keep stop plan
    paceMediocreSec: 0.5,      // slower than this vs target -> bring stop forward
    paceBadSec: 1.0,           // slower than this vs target -> stop ASAP (min stint)
    trafficGapSec: 0.5,        // distance to rival below this = fighting/traffic (seconds)
    wetStopFactor: 0.8,        // multiply base stint by this when wet/rain (more stops)
    ballastPenaltySecPerKg: 0.012, // approx lap-time penalty per kg over reference weight
  },
};

// Fresh deep clone for one race session. Callers own the returned object.
export function createDefaultConfig() {
  return structuredClone(DEFAULTS);
}

// Build a full config from a persisted payload (race_configs.config_json /
// race_sessions.configJson). Missing sections fall back to defaults so stored
// configs stay forward-compatible.
export function mergeConfigPayload(payload) {
  const cfg = createDefaultConfig();
  if (!payload || typeof payload !== 'object') return cfg;
  if (payload.race) Object.assign(cfg.race, payload.race);
  if (payload.strategy) Object.assign(cfg.strategy, payload.strategy);
  if (payload.ui) Object.assign(cfg.ui, payload.ui);
  if (payload.apex) Object.assign(cfg.apex, payload.apex);
  return cfg;
}

// Sanitize + apply a client-supplied patch onto a race config object.
// Numbers/booleans/enums are coerced defensively. The config is always owned
// by the calling race session runtime — never a shared singleton.
export function applyConfigPatch(config, body = {}) {
  const num = (v) => (v === undefined ? undefined : Number(v));
  const race = config.race;
  if (body.ourKart !== undefined) race.ourKart = String(body.ourKart);
  if (body.raceDurationMin !== undefined) race.raceDurationMin = num(body.raceDurationMin);
  if (body.mandatoryStops !== undefined) race.mandatoryStops = num(body.mandatoryStops);
  if (body.pitCloseMin !== undefined) race.pitCloseMin = num(body.pitCloseMin);
  if (body.ourTeamName !== undefined) race.ourTeamName = String(body.ourTeamName);
  if (body.weatherForecast !== undefined) race.weatherForecast = String(body.weatherForecast);
  if (body.weather !== undefined) race.weather = String(body.weather);
  if (body.trackCondition !== undefined) race.trackCondition = String(body.trackCondition);
  if (body.minPitTimeSec !== undefined) race.minPitTimeSec = num(body.minPitTimeSec);
  if (body.numDrivers !== undefined) race.numDrivers = num(body.numDrivers);
  if (body.driverChangePerStop !== undefined) race.driverChangePerStop = !!body.driverChangePerStop;
  if (body.stintMinMin !== undefined) race.stintMinMin = num(body.stintMinMin);
  if (body.stintMaxMin !== undefined) race.stintMaxMin = num(body.stintMaxMin);
  if (body.mandatoryStopEveryMin !== undefined) race.mandatoryStopEveryMin = num(body.mandatoryStopEveryMin);
  if (body.kartChangeOnly !== undefined) race.kartChangeOnly = !!body.kartChangeOnly;
  if (body.raceObjective !== undefined) race.raceObjective = String(body.raceObjective);
  if (body.manualDriverIdx !== undefined) race.manualDriverIdx = num(body.manualDriverIdx);
  if (Array.isArray(body.driverOrder)) {
    race.driverOrder = body.driverOrder.map((i) => parseInt(i, 10)).filter((i) => Number.isInteger(i) && i >= 0);
  }
  if (Array.isArray(body.drivers)) {
    race.drivers = body.drivers.map((d) => ({
      name: d.name || '',
      weightKg: num(d.weightKg) || 0,
      ballastKg: num(d.ballastKg) || 0,
      category: ['fast', 'avg', 'slow'].includes(d.category) ? d.category : 'avg',
    }));
    while (race.drivers.length < race.numDrivers) {
      race.drivers.push({ name: '', weightKg: 75, ballastKg: 0, category: 'avg' });
    }
  }
  // UI preferences
  if (body.theme !== undefined) config.ui.theme = ['dark', 'light'].includes(body.theme) ? body.theme : 'dark';
  // strategy thresholds (editable in setup and live)
  const s = config.strategy;
  if (body.paceGoodSec !== undefined) s.paceGoodSec = num(body.paceGoodSec);
  if (body.paceMediocreSec !== undefined) s.paceMediocreSec = num(body.paceMediocreSec);
  if (body.paceBadSec !== undefined) s.paceBadSec = num(body.paceBadSec);
  if (body.trafficGapSec !== undefined) s.trafficGapSec = num(body.trafficGapSec);
  if (body.wetStopFactor !== undefined) s.wetStopFactor = num(body.wetStopFactor);
  if (body.ballastPenaltySecPerKg !== undefined) s.ballastPenaltySecPerKg = num(body.ballastPenaltySecPerKg);
  if (body.paceAdjustLaps !== undefined) s.paceAdjustLaps = num(body.paceAdjustLaps);
  if (body.paceDropPct !== undefined) s.paceDropPct = num(body.paceDropPct);
  return config;
}

// Server-level HTTP settings (not race-scoped).
export const httpConfig = {
  port: Number(process.env.PORT) || 8080,
  host: '0.0.0.0',
};
