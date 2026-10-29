import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createGeoScene } from '../src/geo-scene.js';
import { createLocalFrame, geoToLocal } from '../src/geospatial.js';
import { pointInLandcover } from '../src/campus-landcover.js';
import { waterFootprint } from '../src/water-details.js';
import { createEinsteinSquare, planEinsteinSquare, EINSTEIN_SQUARE_SOURCE_ID, EINSTEIN_SQUARE_ALIGNMENT } from '../src/einstein-square.js';

function fixture() {
  const data = JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson', import.meta.url), 'utf8'));
  const frame = createLocalFrame({ longitude: 114.42123985, latitude: 30.51575845, coordinateSystem: 'EPSG:4326' });
  return { data, frame, model: createGeoScene(THREE, new THREE.Scene(), data, frame, geoToLocal) };
}

test('Einstein square uses the mapped park, retains its source data, and does not fabricate a building', () => {
  const { data, frame, model } = fixture(), original = JSON.stringify(data);
  try {
    const plan = planEinsteinSquare(model, { frame, geoToLocal });
    assert.equal(plan.sourceId, EINSTEIN_SQUARE_SOURCE_ID); assert.equal(plan.accepted, true);
    assert.equal(plan.statue.form, 'head-and-supporting-hand'); assert.equal(plan.statue.measured, false);
    assert.match(plan.evidence.uncertainty, /not a survey/);
    const r = model.records.find(r => r.id === plan.sourceId), footprint = waterFootprint(r);
    // Sample edge midpoints too: north cap and long forecourt must stay on the
    // actual park; no huge invented circular plaza or overwritten footprint.
    for (const poly of plan.polygons) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
      assert.ok(footprint.contains(x, z) || footprint.distance(x, z) < 1e-5);
    }
    assert.equal(JSON.stringify(data), original);
    assert.equal(r.category, 'green');
    assert.deepEqual(planEinsteinSquare(model, { frame, geoToLocal }), plan, 'deterministic estimates');
  } finally { model.dispose(); }
});

test('statue is on the southern court, with continuous approach and the road behind the separate pergola', () => {
  const { frame, model } = fixture();
  try {
    const plan = planEinsteinSquare(model, { frame, geoToLocal });
    const crossing = model.records.find(r => r.id === 'way/98831427').feature.geometry.coordinates;
    const a = geoToLocal({ longitude: crossing.at(-2)[0], latitude: crossing.at(-2)[1], coordinateSystem: 'EPSG:4326' }, frame), b = geoToLocal({ longitude: crossing.at(-1)[0], latitude: crossing.at(-1)[1], coordinateSystem: 'EPSG:4326' }, frame);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      assert.equal(pointInLandcover(x, z, plan.polygons), false, 'plaza paving does not cover the road centreline');
      assert.ok(plan.barriers.every(barrier => !pointInLandcover(x, z, [[barrier.polygon.map(p => [p.x, p.z])]])), 'statue, hedge and pergola do not block existing road');
    }
    for (const step of plan.steps) assert.ok(step.polygon.every(p => pointInLandcover(p.x, p.z, plan.polygons)));
    assert.ok(plan.platform.polygon.every(p => pointInLandcover(p.x, p.z, plan.polygons)));
    assert.ok(plan.statue.z > Math.max(a.z, b.z) + 30, 'statue must be south of the transverse road, never on the grass cap');
    const registered = geoToLocal({ longitude: EINSTEIN_SQUARE_ALIGNMENT.statue[0], latitude: EINSTEIN_SQUARE_ALIGNMENT.statue[1], coordinateSystem: 'EPSG:4326' }, frame);
    const front = geoToLocal({ longitude: EINSTEIN_SQUARE_ALIGNMENT.frontAxis[0], latitude: EINSTEIN_SQUARE_ALIGNMENT.frontAxis[1], coordinateSystem: 'EPSG:4326' }, frame);
    assert.equal(plan.statue.x, registered.x);
    assert.equal(plan.statue.z - registered.z, 3, 'user site correction moves only the statue three metres south');
    assert.equal(plan.statue.yaw, Math.atan2(front.x - registered.x, front.z - registered.z), 'south-facing axis must not rotate with the small adjustment');
    assert.deepEqual(plan.pavingCenter, { x: registered.x, z: registered.z }, 'round paving keeps its registered centre');
    assert.deepEqual(plan.statue.registeredCoordinate, EINSTEIN_SQUARE_ALIGNMENT.statue);
    const corrected = geoToLocal({ longitude: plan.statue.coordinate[0], latitude: plan.statue.coordinate[1], coordinateSystem: 'EPSG:4326' }, frame);
    assert.ok(Math.hypot(corrected.x - plan.statue.x, corrected.z - plan.statue.z) < 1e-6, 'reported coordinate follows the local adjustment');
    const court = geoToLocal({ longitude: EINSTEIN_SQUARE_ALIGNMENT.pergolaCourt[0], latitude: EINSTEIN_SQUARE_ALIGNMENT.pergolaCourt[1], coordinateSystem: 'EPSG:4326' }, frame);
    const worldCourt = { x: plan.statue.x + plan.pergola.x * Math.cos(plan.statue.yaw) + plan.pergola.z * Math.sin(plan.statue.yaw), z: plan.statue.z - plan.pergola.x * Math.sin(plan.statue.yaw) + plan.pergola.z * Math.cos(plan.statue.yaw) };
    assert.ok(Math.hypot(worldCourt.x - court.x, worldCourt.z - court.z) < 1e-8, 'northern corridor remains fixed in campus coordinates');
    const old = geoToLocal({ longitude: 114.4301, latitude: 30.51682, coordinateSystem: 'EPSG:4326' }, frame);
    assert.equal(pointInLandcover(old.x, old.z, plan.polygons), false, 'northern cap is restored to the original grass layer');
    assert.ok(plan.pergola.z < -18 && plan.pergola.z > -24, 'northern court has an independently registered centre');
    assert.ok(plan.pergolaColumns.some(c => c.z < -29), 'curved corridor reaches its observed northern arc');
    const arrival = plan.arrival;
    assert.ok(arrival && arrival.z > plan.statue.z && arrival.y === .16);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, x = arrival.x + (plan.statue.x - arrival.x) * t, z = arrival.z + (plan.statue.z - arrival.z) * t;
      assert.ok(pointInLandcover(x, z, plan.polygons), 'the walking approach does not cross the transverse road');
    }
    assert.ok(plan.barriers.every(b => !pointInLandcover(arrival.x, arrival.z, [[b.polygon.map(p => [p.x, p.z])]])), 'tour arrival is clear of all solid objects');
    assert.ok(Math.abs(arrival.yaw - Math.atan2(arrival.x - plan.statue.x, arrival.z - plan.statue.z)) < 1e-10);
  } finally { model.dispose(); }
});

test('stairs have walkable rises matching geometry and raised sides have barriers', () => {
  const { frame, model } = fixture();
  try {
    const layer = createEinsteinSquare(THREE, model, { frame, geoToLocal });
    assert.equal(layer.plan.steps.length, 12);
    for (const x of new Set(layer.plan.steps.map(s => s.x))) {
      const steps = layer.plan.steps.filter(s => s.x === x); let y = .16;
      for (const step of steps) { assert.ok(Math.abs(step.surfaceY - y - .12) < 1e-8); y = step.surfaceY; }
      assert.equal(y, layer.plan.platform.surfaceY);
    }
    assert.equal(layer.infrastructure.barriers.filter(b => b.id.startsWith('einstein-platform-edge-')).length, 64);
    assert.equal(layer.plan.pergolaColumns.length, 22);
    assert.ok(layer.infrastructure.walkSurfaces.some(s => s.kind === 'plaza'));
    assert.ok(layer.infrastructure.barriers.every(b => b.minHeight >= 0 && b.height > b.minHeight));
    layer.dispose();
  } finally { model.dispose(); }
});

test('close geometry is finite, batched, culled at distance, and disposes every owned resource exactly once', () => {
  const { frame, model } = fixture(); const layer = createEinsteinSquare(THREE, model, { frame, geoToLocal });
  try {
    const resources = new Set(), meshes = [];
    layer.group.traverse(o => { if (!o.isMesh) return; meshes.push(o); resources.add(o.geometry); resources.add(o.material); if (o.material.map) resources.add(o.material.map);
      for (const v of o.geometry.getAttribute('position').array) assert.ok(Number.isFinite(v));
      o.geometry.computeBoundingSphere(); assert.ok(Number.isFinite(o.geometry.boundingSphere.radius));
    });
    assert.ok(meshes.length <= 10); assert.ok(layer.counts.triangles < 45000);
    const detail = layer.group.children[0], camera = new THREE.PerspectiveCamera(); camera.position.set(10000, 30, 10000); layer.update(camera); assert.equal(detail.visible, false);
    camera.position.set(...layer.plan.inspection.position); layer.update(camera); assert.equal(detail.visible, true);
    let disposed = 0; for (const r of resources) r.addEventListener('dispose', () => disposed++);
    layer.dispose(); layer.dispose(); assert.equal(disposed, resources.size);
  } finally { layer.dispose(); model.dispose(); }
});

test('missing source or projection gives an empty layer instead of inventing a relocated square', () => {
  assert.equal(planEinsteinSquare({ records: [] }).accepted, false);
  const layer = createEinsteinSquare(THREE, { records: [] });
  assert.equal(layer.group.children.length, 0); assert.equal(layer.infrastructure.barriers.length, 0); layer.dispose(); layer.dispose();
});
