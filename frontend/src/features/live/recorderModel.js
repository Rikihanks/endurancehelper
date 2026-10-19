export function buildSessionHeader({
  track = null,
  kart = null,
  raceboxModel = null,
  raceboxId = null,
  preset = null,
  appVersion = null,
  startedAt = null,
  driver = null,
} = {}) {
  return {
    circuitId: track ? track.id : null,
    circuitName: track ? track.name : null,
    kart: kart ?? null,
    raceboxModel: raceboxModel ?? null,
    raceboxId: raceboxId ?? null,
    preset: preset ?? null,
    appVersion: appVersion ?? null,
    startedAt: startedAt ?? null,
    driver: driver ?? null,
  };
}

export function addGap(gaps, at, reason, windowMs = 2000) {
  const list = Array.isArray(gaps) ? gaps : [];
  const last = list[list.length - 1];
  if (last && last.reason === reason && at - last.at < windowMs) return list;
  return [...list, { at, reason }];
}

export function recordsDurationS(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const first = records[0].receivedAt;
  const last = records[records.length - 1].receivedAt;
  if (Number.isFinite(first) && Number.isFinite(last) && last >= first) return (last - first) / 1000;
  return null;
}

export function appVersion() {
  return typeof __INLAP_VERSION__ === 'string' ? __INLAP_VERSION__ : 'dev';
}
