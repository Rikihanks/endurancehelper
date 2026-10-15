import { load } from 'cheerio';

function requestUrl(apex) {
  return apex.requestUrl.replace(/\/?$/, '/') + 'request.php';
}

async function post(request, apex) {
  const res = await fetch(requestUrl(apex), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ port: String(apex.basePort), request }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`request.php HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (text === 'error') throw new Error('Apex returned error');
  return text;
}

// Extract a `var name = value` from an Apex config.js file.
// Handles quoted strings ('...' or "...") AND bare numbers (configPort = 10220).
function extractVar(text, name) {
  const re = new RegExp(`${name}\\s*=\\s*['"]?([^'";\\s]+)['"]?`);
  const m = text.match(re);
  return m ? m[1] : '';
}

// Given a circuit live-timing page URL (e.g. https://www.apex-timing.com/live-timing/kartcenter-campillos/index.html)
// fetch that circuit's config.js and resolve host/port/requestUrl.
export async function resolveCircuit(circuitUrl) {
  const url = new URL(circuitUrl);
  const clean = circuitUrl.replace(/\/index\.html?$/i, '').replace(/\/+$/, '');
  const configJsUrl = `${clean}/javascript/config.js`;

  const res = await fetch(configJsUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`config.js HTTP ${res.status}`);
  const text = await res.text();

  const host = extractVar(text, 'configHost') || url.hostname;
  const basePort = parseInt(extractVar(text, 'configPort') || '9370', 10);
  let reqBase = extractVar(text, 'configRequestUrl');

  if (reqBase) {
    // configRequestUrl may be relative (../commonv2/functions/) -> resolve against circuit dir
    reqBase = new URL(reqBase, `${url.origin}${url.pathname.replace(/\/[^/]*$/, '/')}`).href;
  } else {
    reqBase = `https://${host}/live-timing/commonv2/functions/`;
  }

  return {
    host,
    basePort,
    wssPort: basePort + 3,
    requestUrl: reqBase,
    origin: url.origin,
    circuitUrl: circuitUrl.trim(),
  };
}

// strip trailing letters/color markers, keep numbers -> centiseconds
function num(v) {
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// D9575.L0059#|||48828   (lap number lives in the key; s1|s2|s3|total after '#', times in ms)
function parseLapLine(line, driverId) {
  const key = line.split('#')[0] || '';
  const lapMatch = /\.L(\d+)/.exec(key);
  const lap = lapMatch ? parseInt(lapMatch[1], 10) : 0;
  const cells = (line.split('#')[1] || '').split('|');
  const [s1, s2, s3, total] = cells;
  return {
    driverId,
    lap,
    s1: num(s1),
    s2: num(s2),
    s3: num(s3),
    total: num(total),
    s1Color: String(s1).replace(/[0-9]/g, ''),
    s2Color: String(s2).replace(/[0-9]/g, ''),
    s3Color: String(s3).replace(/[0-9]/g, ''),
    totalColor: String(total).replace(/[0-9]/g, ''),
  };
}

// D9575.P01#1|<lap>|<in>|<out>|<pit_time>|<track_time>|<relay_laps>|<driver_id>|<total>
function parsePitLine(line, driverId) {
  const key = line.split('#')[0] || '';
  const pitMatch = /\.P(\d+)/.exec(key);
  const pit = pitMatch ? parseInt(pitMatch[1], 10) : 0;
  const parts = line.split('#');
  const cells = (parts[parts.length - 1] || '').split('|');
  return {
    driverId,
    pit,
    lap: num(cells[1]), // cell[0] is the pit number again, cell[1] is the race lap of the stop
    inHour: num(cells[2]),
    outHour: num(cells[3]),
    pitTime: num(cells[4]),
    trackTime: num(cells[5]),
    relayLaps: num(cells[6]),
    pitDriverId: num(cells[7]),
    driverTotalTime: num(cells[8]),
  };
}

// D26.BL#s1|s2|s3|total
function parseBestLine(line, driverId) {
  const body = (line.split('#')[1] || '').split('|');
  return {
    driverId,
    s1: num(body[0]),
    s2: num(body[1]),
    s3: num(body[2]),
    total: num(body[3] ?? body[2]),
  };
}

// D26.BS#s1|s2|s3
function parseBestSectorsLine(line, driverId) {
  const body = (line.split('#')[1] || '').split('|');
  return { driverId, s1: num(body[0]), s2: num(body[1]), s3: num(body[2]) };
}

// D26.INF#<driver ...></driver>
function parseInfosLine(line, driverId) {
  const html = line.slice(line.indexOf('<'));
  const $ = load(html);
  const $d = $('driver').first();
  if (!$d.length) return { driverId };
  const info = {
    driverId,
    id: $d.attr('id') || '',
    memberId: $d.attr('member') || '',
    centerId: $d.attr('center') || '',
    kartNumber: $d.attr('num') || '',
    driverName: $d.attr('name') || '',
    nationality: $d.attr('nat') || '',
    color: $d.attr('color') || '',
    infos: [],
    drivers: [],
  };
  $d.find('inf').each((_, el) => {
    const $el = $(el);
    info.infos.push({
      type: $el.attr('type') || '',
      flag: $el.attr('nat') || '',
      title: $el.attr('title') || '',
      value: $el.attr('value') || '',
    });
  });
  $d.find('driver').each((_, el) => {
    const $el = $(el);
    info.drivers.push({
      id: $el.attr('id') || '',
      memberId: $el.attr('member') || '',
      number: $el.attr('num') || '',
      color: $el.attr('color') || '',
      flag: $el.attr('nat') || '',
      name: $el.attr('name') || '',
      isCurrent: $el.attr('current') === '1',
    });
  });
  return info;
}

export function buildRequest(driverId, opts = {}) {
  const { laps = 30, pits = false, best = false, infos = false } = opts;
  // Grid row ids come as "r9575" but request.php wants the numeric driver id (9575)
  const d = String(driverId).replace(/\D/g, '') || String(driverId);
  const parts = [];
  if (laps > 0) parts.push(`D#-${laps}#D${d}.L`);
  if (pits) parts.push(`D#-999#D${d}.P`);
  if (best) parts.push(`D#2#D${d}.B`);
  if (infos) parts.push(`D#1#D${d}.INF`);
  return parts.join('#');
}

export async function fetchDriverDetails(driverId, opts = {}, apex) {
  const { laps = 30, pits = false, best = false, infos = false } = opts;
  // Grid row ids come as "r9575" but request.php wants the numeric driver id (9575)
  const d = String(driverId).replace(/\D/g, '') || String(driverId);
  const result = { laps: [], pits: [], bestLap: null, bestSectors: null, infos: null };

  // request.php accepts ONE sub-request per call, so issue them separately.
  const reqs = [];
  if (laps > 0) reqs.push(`D#-${laps}#D${d}.L`);
  if (pits) reqs.push(`D#-999#D${d}.P`);
  if (best) reqs.push(`D#2#D${d}.B`);
  if (infos) reqs.push(`D#1#D${d}.INF`);

  for (const req of reqs) {
    let text;
    try {
      text = await post(req, apex);
    } catch (_) {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      if (line.startsWith(`D${d}.L`)) result.laps.push(parseLapLine(line, driverId));
      else if (line.startsWith(`D${d}.P`)) result.pits.push(parsePitLine(line, driverId));
      else if (line.startsWith(`D${d}.BL`)) result.bestLap = parseBestLine(line, driverId);
      else if (line.startsWith(`D${d}.BS`)) result.bestSectors = parseBestSectorsLine(line, driverId);
      else if (line.startsWith(`D${d}.INF`)) result.infos = parseInfosLine(line, driverId);
    }
  }
  result.laps.sort((a, b) => a.lap - b.lap);
  return result;
}

export async function listSessions(apex) {
  const text = await post('S#', apex);
  return text
    .split('\n')
    .map((l) => {
      const [id, name] = l.split('#');
      return { id, name };
    })
    .filter((s) => s.id);
}

// Load an archived session's snapshot (grid + fields)
export async function loadSession(sessionId, apex) {
  const text = await post(`S#${sessionId}`, apex);
  const idx = text.indexOf('@');
  if (idx === -1) return null;
  return text.slice(idx + 1);
}
