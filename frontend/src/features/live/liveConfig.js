export const CELL_CONTENTS = {
  race_remaining: {
    id: 'race_remaining',
    label: 'Tiempo restante',
    bg: '#F5A023',
    fg: '#FFFFFF',
  },
  position: {
    id: 'position',
    label: 'Posición',
    bg: '#0A6FD6',
    fg: '#FFFFFF',
  },
  target_time: {
    id: 'target_time',
    label: 'Tiempo objetivo',
    bg: '#FF8A1A',
    fg: '#FFFFFF',
  },
  stint_time: {
    id: 'stint_time',
    label: 'Stint',
    bg: '#000000',
    fg: '#FFFFFF',
    dynamic: true,
  },
  rival_ahead: {
    id: 'rival_ahead',
    label: 'Rival delante',
    bg: '#033B75',
    accent: '#064C94',
    fg: '#FFFFFF',
  },
  rival_behind: {
    id: 'rival_behind',
    label: 'Rival detrás',
    bg: '#00003D',
    accent: '#00006E',
    fg: '#FFFFFF',
  },
  current_lap_delta: {
    id: 'current_lap_delta',
    label: 'Delta de vuelta',
    bg: '#15181d',
    fg: '#FFFFFF',
    dynamic: true,
  },
  sectors: {
    id: 'sectors',
    label: 'Sectores',
    bg: '#101318',
    fg: '#FFFFFF',
  },
  best_lap: {
    id: 'best_lap',
    label: 'Mejor vuelta',
    bg: '#5E00A0',
    fg: '#FFFFFF',
  },
  last_lap: {
    id: 'last_lap',
    label: 'Última vuelta',
    bg: '#0A6FD6',
    fg: '#FFFFFF',
  },
};

export const CONTENT_IDS = Object.keys(CELL_CONTENTS);

export const PRESETS = {
  full: {
    id: 'full',
    name: 'Completo',
    cells: [
      { content: 'race_remaining', c: 0, r: 0, w: 3, h: 2 },
      { content: 'position', c: 3, r: 0, w: 3, h: 2 },
      { content: 'target_time', c: 6, r: 0, w: 3, h: 2 },
      { content: 'stint_time', c: 9, r: 0, w: 3, h: 2 },
      { content: 'rival_ahead', c: 0, r: 2, w: 6, h: 2 },
      { content: 'rival_behind', c: 0, r: 4, w: 6, h: 2 },
      { content: 'best_lap', c: 0, r: 6, w: 6, h: 3 },
      { content: 'current_lap_delta', c: 6, r: 2, w: 6, h: 3 },
      { content: 'sectors', c: 6, r: 5, w: 6, h: 1 },
      { content: 'last_lap', c: 6, r: 6, w: 6, h: 3 },
    ],
  },
  balanced: {
    id: 'balanced',
    name: 'Equilibrado',
    cells: [
      { content: 'position', c: 0, r: 0, w: 6, h: 4 },
      { content: 'stint_time', c: 0, r: 4, w: 6, h: 5 },
      { content: 'current_lap_delta', c: 6, r: 0, w: 6, h: 5 },
      { content: 'sectors', c: 6, r: 5, w: 6, h: 1 },
      { content: 'best_lap', c: 6, r: 6, w: 3, h: 3 },
      { content: 'last_lap', c: 9, r: 6, w: 3, h: 3 },
    ],
  },
  essential: {
    id: 'essential',
    name: 'Esencial',
    cells: [
      { content: 'current_lap_delta', c: 0, r: 0, w: 6, h: 9 },
      { content: 'stint_time', c: 6, r: 0, w: 6, h: 3 },
      { content: 'position', c: 6, r: 3, w: 6, h: 3 },
      { content: 'last_lap', c: 6, r: 6, w: 6, h: 3 },
    ],
  },
  focus: {
    id: 'focus',
    name: 'Foco',
    cells: [
      { content: 'current_lap_delta', c: 0, r: 0, w: 6, h: 9 },
      { content: 'stint_time', c: 6, r: 0, w: 6, h: 9 },
    ],
  },
};

export const PRESET_ORDER = ['full', 'balanced', 'essential', 'focus'];

export function getPreset(id) {
  return PRESETS[id] || PRESETS.full;
}
