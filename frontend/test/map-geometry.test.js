import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectPath,
  bearingBetween,
  snapToPath,
  rotatePoint,
} from '../src/features/racebox-poc/mapGeometry.js';

test('projectPath is invertible (round trip lat/lon)', () => {
  const points = [
    { lat: 28.4668, lon: -16.3485 },
    { lat: 28.4677, lon: -16.3484 },
    { lat: 28.4671, lon: -16.3487 },
  ];
  const proj = projectPath(points);
  assert.ok(proj);
  for (const p of points) {
    const xy = proj.project(p);
    const back = proj.unproject(xy.x, xy.y);
    assert.ok(Math.abs(back.lat - p.lat) < 1e-9, `lat ${back.lat} vs ${p.lat}`);
    assert.ok(Math.abs(back.lon - p.lon) < 1e-9, `lon ${back.lon} vs ${p.lon}`);
  }
});

test('projectPath keeps the aspect ratio (viewBox height)', () => {
  // ~110 m north-south and ~220 m east-west -> height ~ half the width
  const mLat = 110540;
  const mLon = 111320 * Math.cos((28.46 * Math.PI) / 180);
  const points = [
    { lat: 28.46, lon: -16.35 },
    { lat: 28.46 + 110 / mLat, lon: -16.35 },
    { lat: 28.46 + 110 / mLat, lon: -16.35 + 220 / mLon },
    { lat: 28.46, lon: -16.35 + 220 / mLon },
  ];
  const proj = projectPath(points);
  assert.ok(Math.abs(proj.vh - 500) < 15, `vh=${proj.vh}`);
});

test('bearingBetween returns compass bearings', () => {
  assert.ok(Math.abs(bearingBetween({ x: 0, y: 0 }, { x: 0, y: 10 }) - 0) < 1e-9); // north
  assert.ok(Math.abs(bearingBetween({ x: 0, y: 0 }, { x: 10, y: 0 }) - 90) < 1e-9); // east
});

test('snapToPath snaps to the track and derives the heading', () => {
  const points = [
    { lat: 28.46, lon: -16.36 },
    { lat: 28.46, lon: -16.355 },
  ];
  const proj = projectPath(points);
  // Tap slightly north of the line: it must snap onto it.
  const snapped = snapToPath(points, proj, 28.46015, -16.3575);
  assert.ok(snapped);
  assert.ok(Math.abs(snapped.lat - 28.46) < 1e-4, `lat=${snapped.lat}`);
  assert.ok(Math.abs(snapped.heading - 90) < 1, `heading=${snapped.heading}`);
});

test('projectPath returns null for a degenerate path', () => {
  assert.equal(projectPath([{ lat: 1, lon: 1 }]), null);
  assert.equal(projectPath(null), null);
});

test('rotatePoint preserves the distance to the centre', () => {
  const center = { lat: 28.46, lon: -16.35 };
  const p = { lat: 28.461, lon: -16.348 };
  for (const deg of [0, 90, 180, 270, 360]) {
    const r = rotatePoint(p, center.lat, center.lon, deg);
    const mLat = 110540;
    const mLon = 111320 * Math.cos((center.lat * Math.PI) / 180);
    const d0 = Math.hypot((p.lon - center.lon) * mLon, (p.lat - center.lat) * mLat);
    const d1 = Math.hypot((r.lon - center.lon) * mLon, (r.lat - center.lat) * mLat);
    assert.ok(Math.abs(d0 - d1) < 0.5, `deg=${deg} d0=${d0} d1=${d1}`);
  }
  const same = rotatePoint(p, center.lat, center.lon, 0);
  assert.equal(same, p, '0 degrees returns the same object');
});

test('rotatePoint 90 degrees turns a tall track into a wide one', () => {
  const center = { lat: 28.47, lon: -16.35 };
  // 100 m north of the centre.
  const north = { lat: center.lat + 100 / 110540, lon: center.lon };
  const r = rotatePoint(north, center.lat, center.lon, 90);
  const mLon = 111320 * Math.cos((center.lat * Math.PI) / 180);
  const east = (r.lon - center.lon) * mLon;
  const northM = (r.lat - center.lat) * 110540;
  assert.ok(Math.abs(northM) < 1, `after 90 deg the point should be level: north=${northM}`);
  assert.ok(Math.abs(Math.abs(east) - 100) < 1, `east=${east}`);
});

test('rotatePoint four times returns to the start', () => {
  const center = { lat: 28.47, lon: -16.35 };
  let p = { lat: 28.4705, lon: -16.3495 };
  for (let i = 0; i < 4; i++) p = rotatePoint(p, center.lat, center.lon, 90);
  assert.ok(Math.abs(p.lat - 28.4705) < 1e-9, `lat=${p.lat}`);
  assert.ok(Math.abs(p.lon + 16.3495) < 1e-9, `lon=${p.lon}`);
});
