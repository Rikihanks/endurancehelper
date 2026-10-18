// Built-in tracks preloaded into the local track list.
//
// NOTE: OpenStreetMap only has a partial area mapped for Karting Canarias
// (a ~110x58 m polygon that does not match the real layout), so we preload the
// entry name only. Fill in the trace by importing a GPX/KML traced over the
// satellite image, or by creating the track from a recorded session.

export const BUILTIN_TRACKS = [
  {
    id: 'builtin:karting-canarias',
    name: 'Karting Canarias (La Esperanza)',
    builtin: true,
    source: 'Sin trazada: importa un GPX/KML o créala desde una sesión grabada',
    centerline: null,
    startFinish: null,
    splits: [],
  },
];
