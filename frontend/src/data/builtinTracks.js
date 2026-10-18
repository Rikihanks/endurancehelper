// Built-in tracks preloaded into the local track list.
//
// Data source: OpenStreetMap (ODbL) — attribution required. The OSM data gives
// the circuit centerline; it does NOT include a Start/Finish line, so we place a
// *suggested* one in the middle of the longest straight (bidirectional, so lap
// timing works whichever way you drive). Fix or re-mark it in the app.

import { suggestTrapFromCenterline } from '../services/devices/racebox/RaceBoxTrack.js';

// OSM way 78336797 — "Karting Canarias", Carretera de La Esperanza (La Laguna).
const KARTING_CANARIAS_CENTERLINE = [
  { lat: 28.4667726, lon: -16.3482867 },
  { lat: 28.4676583, lon: -16.3483681 },
  { lat: 28.4676913, lon: -16.3484807 },
  { lat: 28.4676088, lon: -16.3486904 },
  { lat: 28.4674795, lon: -16.3487498 },
  { lat: 28.4670614, lon: -16.3487248 },
  { lat: 28.4670504, lon: -16.3486434 },
  { lat: 28.4671577, lon: -16.3485652 },
  { lat: 28.4674602, lon: -16.3486246 },
  { lat: 28.4675428, lon: -16.3485746 },
  { lat: 28.4675317, lon: -16.3484776 },
  { lat: 28.4671577, lon: -16.348415 },
  { lat: 28.4668331, lon: -16.3486747 },
  { lat: 28.4667644, lon: -16.3486653 },
  { lat: 28.4667286, lon: -16.3485996 },
  { lat: 28.4667589, lon: -16.3485339 },
  { lat: 28.4668139, lon: -16.3485183 },
  { lat: 28.4669157, lon: -16.348512 },
  { lat: 28.4669267, lon: -16.3484401 },
  { lat: 28.4668964, lon: -16.3483806 },
  { lat: 28.4668441, lon: -16.34839 },
  { lat: 28.4667176, lon: -16.3484463 },
  { lat: 28.4666709, lon: -16.3483963 },
  { lat: 28.4667011, lon: -16.3482961 },
  { lat: 28.4667726, lon: -16.3482867 },
];

export const BUILTIN_TRACKS = [
  {
    id: 'builtin:karting-canarias',
    name: 'Karting Canarias (La Esperanza)',
    builtin: true,
    source: 'OpenStreetMap © colaboradores (ODbL) · way 78336797',
    centerline: KARTING_CANARIAS_CENTERLINE,
    startFinish: suggestTrapFromCenterline(KARTING_CANARIAS_CENTERLINE, { width: 30 }),
    splits: [],
  },
];
