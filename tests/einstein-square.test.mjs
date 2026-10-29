import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createGeoScene } from '../src/geo-scene.js';
import { createLocalFrame, geoToLocal } from '../src/geospatial.js';
import { pointInLandcover } from '../src/campus-landcover.js';
import { waterFootprint } from '../src/water-details.js';
import { createEinsteinSquare, planEinsteinSquare, EINSTEIN_SQUARE_SOURCE_ID } from '../src/einstein-square.js';

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

test('mapped transverse road remains open and the statue is north of it', () => {
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
    assert.ok(layer.infrastructure.barriers.some(b => b.id === 'einstein-platform-edge-0--6'));
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
