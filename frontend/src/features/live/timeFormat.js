function pad2(n) {
  return String(Math.floor(Math.abs(n))).padStart(2, '0');
}

function pad3(n) {
  return String(Math.floor(Math.abs(n))).padStart(3, '0');
}

export function formatRaceRemaining(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--:--';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function formatStint(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

export function formatLap(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '--:---';
  const total = Math.round(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const frac = total % 1000;
  if (m > 0) return `${m}:${pad2(s)}:${pad3(frac)}`;
  return `${pad2(s)}:${pad3(frac)}`;
}

export function formatDelta(seconds) {
  if (!Number.isFinite(seconds)) return '--,--';
  const sign = seconds < 0 ? '-' : '+';
  return `${sign}${Math.abs(seconds).toFixed(2).replace('.', ',')}`;
}

export function formatPosition(position) {
  if (!Number.isFinite(position) || position <= 0) return '--';
  return `P${Math.round(position)}`;
}
