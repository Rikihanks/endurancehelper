import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGpx,
  parseKml,
  parseTrackFile,
  downsamplePoints,
} from '../src/utils/trackFiles.js';

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
 <trk><name>Karting</name><trkseg>
  <trkpt lat="28.4667000" lon="-16.3483000"><ele>900</ele></trkpt>
  <trkpt lon="-16.3484000" lat="28.4668000"></trkpt>
  <trkpt lat="28.4669000" lon="-16.3485000"/>
 </trkseg></trk>
</gpx>`;

const KML = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
<LineString><coordinates>
-16.3483,28.4667,0 -16.3484,28.4668,0
-16.3485,28.4669,0
</coordinates></LineString></Placemark></Document></kml>`;

test('parseGpx reads track points regardless of attribute order', () => {
  const points = parseGpx(GPX);
  assert.equal(points.length, 3);
  assert.ok(Math.abs(points[0].lat - 28.4667) < 1e-9);
  assert.ok(Math.abs(points[0].lon + 16.3483) < 1e-9);
  assert.ok(Math.abs(points[1].lat - 28.4668) < 1e-9, 'lon-first attribute order');
  assert.ok(Math.abs(points[2].lon + 16.3485) < 1e-9);
});

test('parseKml reads lon,lat tuples', () => {
  const points = parseKml(KML);
  assert.equal(points.length, 3);
  assert.ok(Math.abs(points[0].lat - 28.4667) < 1e-9);
  assert.ok(Math.abs(points[0].lon + 16.3483) < 1e-9);
  assert.ok(Math.abs(points[2].lat - 28.4669) < 1e-9);
});

test('parseTrackFile detects the format and downsamples', () => {
  const gpx = parseTrackFile(GPX);
  assert.equal(gpx.format, 'gpx');
  assert.equal(gpx.points.length, 3);
  assert.equal(gpx.total, 3);

  const kml = parseTrackFile(KML);
  assert.equal(kml.format, 'kml');
  assert.equal(kml.points.length, 3);

  // Downsampling keeps the first and last point.
  const many = Array.from({ length: 5000 }, (_, i) => ({ lat: 28 + i * 1e-5, lon: -16.35 }));
  const capped = parseTrackFile(
    `<gpx>${many.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"/>`).join('')}</gpx>`,
  );
  assert.ok(capped.points.length <= 801, `len=${capped.points.length}`);
  assert.deepEqual(capped.points[0], many[0]);
  assert.deepEqual(capped.points[capped.points.length - 1], many[many.length - 1]);
});

test('parseTrackFile fails clearly on unusable input', () => {
  assert.throws(() => parseTrackFile(''), /vacío/i);
  assert.throws(() => parseTrackFile('<html><body>nada</body></html>'), /No se encontraron puntos/i);
});

test('downsamplePoints returns a copy and bounds the length', () => {
  const points = [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }];
  const copy = downsamplePoints(points, 100);
  assert.notEqual(copy, points);
  assert.deepEqual(copy, points);
  const capped = downsamplePoints(Array.from({ length: 100 }), 10);
  assert.ok(capped.length <= 11);
});
