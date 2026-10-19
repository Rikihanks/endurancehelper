#!/usr/bin/env node
// Dev-only Apex live-timing raw capture.
//
// Connects (read-only) to an Apex circuit WebSocket and records:
//   - the raw protocol lines, and
//   - every change of the interesting cells for our audit: sta (estado),
//     llp (última vuelta), tlp (vueltas), otr (T.Track/Pit) and pit (paradas).
//
// It exists to answer the pending question about T.Track/Pit: which class
// (in/to) means on-track vs in-box, and what the trailing dot means. Run it
// while a race is live, then share the generated files.
//
// Usage:
//   node scripts/apex-capture.mjs <circuitUrl> [seconds] [outDir]
//   npm run apex:capture --workspace backend -- https://www.apex-timing.com/live-timing/cronosystem2/ 300

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const circuitUrl = process.argv[2];
const seconds = Number(process.argv[3] || 300);
const outDir = resolve(process.argv[4] || 'apex-captures');

if (!circuitUrl) {
  console.error('Uso: node scripts/apex-capture.mjs <circuitUrl> [seconds] [outDir]');
  process.exit(1);
}

function extractVar(text, name) {
  const match = text.match(new RegExp(`${name}\\s*=\\s*['"]?([^'";\\s]+)['"]?`));
  return match ? match[1] : '';
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function now() {
  return new Date().toISOString();
}

const clean = circuitUrl.replace(/\/index\.html?$/i, '').replace(/\/+$/, '');
const cfgText = await (await fetch(`${clean}/javascript/config.js`, { signal: AbortSignal.timeout(15000) })).text();
const host = extractVar(cfgText, 'configHost') || new URL(circuitUrl).hostname;
const port = parseInt(extractVar(cfgText, 'configPort') || '0', 10) + 3;
const wsUrl = `wss://${host}:${port}/`;
const origin = new URL(circuitUrl).origin;

mkdirSync(outDir, { recursive: true });
const id = stamp();
const rawFile = resolve(outDir, `apex-raw-${id}.log`);
const otrFile = resolve(outDir, `apex-otr-${id}.log`);
writeFileSync(rawFile, `# ${now()} ${wsUrl}\n`);
writeFileSync(otrFile, `# ${now()} T.Track/Pit transitions ${wsUrl}\n`);

const WATCH = { 1: 'sta', 5: 'llp', 6: 'tlp', 11: 'otr', 12: 'pit' };

let colType = {};
let rows = {};
let cells = {};
let mode = '?';
let closed = false;

function log(line) {
  console.log(`${now()} ${line}`);
}
function otr(line) {
  appendFileSync(otrFile, `${now()} ${line}\n`, 'utf8');
  console.log(`${now()} [otr] ${line}`);
}

function parseGrid(value) {
  colType = {};
  for (const tr of value.matchAll(/<tr\b[^>]*class="head"[^>]*>([\s\S]*?)<\/tr>/g)) {
    for (const td of tr[1].matchAll(/<td\b([^>]*)>/g)) {
      const cid = (/data-id="c(\d+)"/.exec(td[1]) || [, ''])[1];
      const type = (/data-type="([^"]*)"/.exec(td[1]) || [, ''])[1];
      if (cid) colType[cid] = type;
    }
  }

  rows = {};
  cells = {};
  for (const tr of value.matchAll(/<tr\b[^>]*data-id="(r\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const rowId = tr[1];
    const map = {};
    for (const m of tr[2].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)) {
      const cid = (/data-id="[^"]*c(\d+)"/.exec(m[1]) || [, ''])[1];
      const cls = (/class="([^"]*)"/.exec(m[1]) || [, ''])[1];
      const text = m[2].replace(/<[^>]*>/g, '').trim();
      if (cid) map[cid] = { cls, text };
    }
    if (rowId === 'r0') continue;
    rows[rowId] = { kart: map['3'] ? map['3'].text : '', team: map['4'] ? map['4'].text : '' };
    for (const [c, v] of Object.entries(map)) cells[`${rowId}|c${c}`] = v;
  }
}

function connect() {
  const ws = new WebSocket(wsUrl, { headers: { Origin: origin }, handshakeTimeout: 8000, perMessageDeflate: false });
  let buffer = '';

  ws.on('open', () => log(`OPEN ${wsUrl}`));
  ws.on('error', (err) => log(`ERROR ${err.message}`));
  ws.on('close', (code) => {
    log(`CLOSE ${code}`);
    if (!closed) {
      log('reconnect in 5s');
      setTimeout(connect, 5000);
    }
  });

  ws.on('message', (data) => {
    buffer += data.toString();
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      appendFileSync(rawFile, `${line}\n`, 'utf8');

      const parts = line.split('|');
      const key = parts[0];
      const type = parts[1] ?? '';
      const value = parts.slice(2).join('|');

      if (key === 'init') {
        mode = type;
        colType = {};
        rows = {};
        cells = {};
        log(`MODE ${mode === 'r' ? 'race' : mode === 'p' ? 'practice' : mode}`);
        continue;
      }
      if (key === 'track') {
        log(`TRACK "${value}"`);
        continue;
      }
      if (key === 'grid' && value) {
        parseGrid(value);
        const hasOtr = Object.values(colType).includes('otr');
        const hasPit = Object.values(colType).includes('pit');
        log(`GRID rows=${Object.keys(rows).length} cols=${JSON.stringify(colType)} otr=${hasOtr} pit=${hasPit}`);
        if (!hasOtr) log('AVISO: este grid no trae T.Track/Pit (probablemente modo práctica; la captura útil es en carrera).');
        continue;
      }

      const cm = /^(r\d+)c(\d+)$/.exec(key);
      if (!cm) continue;
      const rowId = cm[1];
      const col = cm[2];
      const cellKey = `${rowId}|c${col}`;
      const prev = cells[cellKey] || { cls: '', text: '' };
      const next = { cls: type || prev.cls, text: value };
      if (prev.cls === next.cls && prev.text === next.text) continue;
      cells[cellKey] = next;

      if (col === '11') {
        const row = rows[rowId] || {};
        otr(`${rowId} kart=${row.kart || '?'} team="${row.team || ''}" otr ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`);
      } else if (WATCH[col]) {
        const row = rows[rowId] || {};
        log(`${WATCH[col]} ${rowId} kart=${row.kart || '?'} ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`);
      }
    }
  });
}

connect();

setTimeout(() => {
  closed = true;
  log(`DONE (${seconds}s)`);
  log(`raw: ${rawFile}`);
  log(`otr: ${otrFile}`);
  process.exit(0);
}, seconds * 1000);

process.on('SIGINT', () => {
  closed = true;
  log('SIGINT');
  log(`raw: ${rawFile}`);
  log(`otr: ${otrFile}`);
  process.exit(0);
});
