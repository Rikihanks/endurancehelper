import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILTIN_TRACKS } from '../src/data/builtinTracks.js';

function distanceM(aLat, aLon, bLat, bLon) {
  const mLat = 110540;
  const mLon = 111320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot((bLon - aLon) * mLon, (bLat - aLat) * mLat);
}

test('built-in tracks are well formed', () => {
  assert.ok(BUILTIN_TRACKS.length >= 1);
  for (const track of BUILTIN_TRACKS) {
    assert.ok(track.id.startsWith('builtin:'), track.id);
    assert.ok(track.name);
    assert.ok(Array.isArray(track.centerline) && track.centerline.length > 10, track.id);
    assert.ok(track.startFinish, `${track.id} needs a start/finish`);
    assert.ok(Number.isFinite(track.startFinish.lat));
    assert.ok(Number.isFinite(track.startFinish.lon));
    assert.ok(track.startFinish.heading >= 0 && track.startFinish.heading < 360);
    assert.ok(track.startFinish.width >= 5);
    // Every point must be a valid coordinate.
    for (const p of track.centerline) {
      assert.ok(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180, JSON.stringify(p));
    }
  }
});

test('Karting Canarias trace is a closed loop of a plausible length', () => {
  const track = BUILTIN_TRACKS.find((t) => t.id === 'builtin:karting-canarias');
  assert.ok(track, 'the track is preloaded');
  const points = track.centerline;
  assert.equal(points.length, 81);

  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distanceM(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  assert.ok(length > 350 && length < 550, `lap length=${length.toFixed(1)} m`);

  const first = points[0];
  const last = points[points.length - 1];
  assert.ok(
    distanceM(first.lat, first.lon, last.lat, last.lon) < 2,
    'the trace closes on itself',
  );

  // The start/finish centre must sit on the trace (it was measured on site).
  const sf = track.startFinish;
  const d = distanceM(sf.lat, sf.lon, first.lat, first.lon);
  assert.ok(d < 5, `start/finish is ${d.toFixed(2)} m from the first point`);
});
