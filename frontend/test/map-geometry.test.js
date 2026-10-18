import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectPath,
  bearingBetween,
  snapToPath,
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
