import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultConfig } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'config.json');

// Build a fresh default config and merge the previously saved setup into it.
// This is bootstrap state (loaded once at startup), NOT runtime race state —
// every race session gets its own deep-cloned copy from the returned object.
export function loadSettings() {
  const config = createDefaultConfig();
  try {
    if (fs.existsSync(FILE)) {
      const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (saved.race) Object.assign(config.race, saved.race);
      if (saved.strategy) Object.assign(config.strategy, saved.strategy);
      if (saved.apex) Object.assign(config.apex, saved.apex);
      if (saved.ui) Object.assign(config.ui, saved.ui);
      delete config.race.pitLossSec; // removed field (minPitTimeSec covers the whole pit window)
      delete config.race.stintMinLaps; // renamed to stintMinMin (minutes)
      delete config.race.stintMaxLaps; // renamed to stintMaxMin (minutes)
      console.log(`[settings] Loaded setup for "${config.race.ourTeamName || '-'}" (kart ${config.race.ourKart || '-'})`);
    }
  } catch (e) {
    console.log('[settings] load error:', e.message);
  }
  return config;
}

// Persist the race + strategy + apex circuit configuration of ONE session.
// Legacy single-file store; replaced by PostgreSQL (race_configs) in Fase 1.
export function saveSettings(config) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const out = {
      race: JSON.parse(JSON.stringify(config.race)),
      strategy: JSON.parse(JSON.stringify(config.strategy)),
      ui: JSON.parse(JSON.stringify(config.ui)),
      apex: {
        circuitUrl: config.apex.circuitUrl,
        host: config.apex.host,
        basePort: config.apex.basePort,
        wssPort: config.apex.wssPort,
        requestUrl: config.apex.requestUrl,
        origin: config.apex.origin,
      },
    };
    fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
  } catch (e) {
    console.log('[settings] save error:', e.message);
  }
}
