import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createGeoScene } from '../src/geo-scene.js';
import { createLocalFrame, geoToLocal } from '../src/geospatial.js';
import { pointInLandcover } from '../src/campus-landcover.js';
import { createCampusGates, planCampusGates, CAMPUS_GATE_SOURCES } from '../src/campus-gates.js';

function fixture() {
  const main = JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson', import.meta.url))), southeast = JSON.parse(readFileSync(new URL('../public/data/opto-southeast.geojson', import.meta.url)));
  const records = new Map([...main.features, ...southeast.features].map(f => [f.id, f]));
  const data = { type: 'FeatureCollection', features: [...records.values()] };
  const frame = createLocalFrame({ longitude: 114.42123985, latitude: 30.51575845, coordinateSystem: 'EPSG:4326' });
  return { data, frame, model: createGeoScene(THREE, new THREE.Scene(), data, frame, geoToLocal) };
}
const point = (gate, x, z) => ({ x: gate.x + x * Math.cos(gate.yaw) + z * Math.sin(gate.yaw), z: gate.z - x * Math.sin(gate.yaw) + z * Math.cos(gate.yaw) });
const contains = (barrier, p) => pointInLandcover(p.x, p.z, [[barrier.polygon.map(p => [p.x, p.z])]]);

test('gates use the real southern gate footprint and residential barrier, without mutating GIS', () => {
  const { data, frame, model } = fixture(), before = JSON.stringify(data);
  try {
    const p = planCampusGates(model, { frame, geoToLocal });
    assert.equal(p.gates.length, 2); assert.equal(p.accepted, true);
    assert.deepEqual(p.replacedBuildingIds, [CAMPUS_GATE_SOURCES.east]);
    const east = p.gates.find(g => g.id === 'east-campus-main-gate'), residential = p.gates.find(g => g.id === 'yunyuan-residential-gate');
    assert.equal(east.sourceId, 'way/104350466'); assert.equal(east.roadSourceId, 'way/478977155');
    assert.ok(east.coordinate[0] > 114.4273 && east.coordinate[0] < 114.4275 && east.coordinate[1] < 30.5084);
    assert.notEqual(east.sourceId, 'way/1009118314', 'Northeast Gate must not be substituted');
    assert.equal(residential.sourceId, 'node/1194858814');
    assert.deepEqual(residential.coordinate, [114.4267576, 30.5164782]);
    assert.ok(!residential.parts.some(part => part.kind === 'lintel' || part.kind === 'guardhouse'), 'no invented residential arch or guardhouse');
    assert.ok(east.width > 17 && east.width < 20); assert.equal(east.estimated, true);
    assert.equal(JSON.stringify(data), before);
    assert.deepEqual(planCampusGates(model, { frame, geoToLocal }), p);
  } finally { model.dispose(); }
});

test('all entry apertures stay open at ground level; the lintel only obstructs above its clearance', () => {
  const { frame, model } = fixture();
  try {
    const p = planCampusGates(model, { frame, geoToLocal });
    for (const gate of p.gates) {
      const solids = p.barriers.filter(b => b.sourceId === gate.sourceId && b.minHeight < 1.9);
      for (const opening of gate.openings) for (let i = 0; i <= 16; i++) {
        const z = -opening.depth / 2 + opening.depth * i / 16;
        for (const fraction of [-.35, 0, .35]) {
          const at = point(gate, opening.x + opening.width * fraction, z);
          assert.ok(solids.every(b => !contains(b, at)), `${gate.id}/${opening.id} must be traversable`);
        }
      }
      // Cars pass on either side of centre and pedestrians use both side gaps.
      for (let z = -14; z <= 12; z += .5) for (const x of [-2.5, 0, 2.5]) assert.ok(solids.every(b => !contains(b, point(gate, x, z))), 'road-through corridor remains open');
      assert.ok(solids.every(b => !contains(b, gate.arrival)), 'arrival stays outside columns and rails');
      assert.ok(p.walkSurfaces.some(s => s.sourceId === gate.sourceId && contains(s, gate)), 'gate threshold has a ground walk surface');
    }
    const roof = p.barriers.find(b => b.id === 'east-campus-main-gate-lintel');
    assert.equal(roof.minHeight, 5.35); assert.ok(roof.height > roof.minHeight);
  } finally { model.dispose(); }
});

test('residential arrival follows the actual curved approach and main-road coordinate is not relocated', () => {
  const { frame, model } = fixture();
  try {
    const p = planCampusGates(model, { frame, geoToLocal }), gate = p.gates.find(g => g.id === 'yunyuan-residential-gate');
    const road = model.records.find(r => r.id === 'way/97057001').feature.geometry.coordinates;
    const toLocal = c => geoToLocal({ longitude: c[0], latitude: c[1], coordinateSystem: 'EPSG:4326' }, frame), a = toLocal(road[0]), b = toLocal(road[1]);
    const cross = (gate.arrival.x - a.x) * (b.z - a.z) - (gate.arrival.z - a.z) * (b.x - a.x);
    assert.ok(Math.abs(cross) < 1e-8); assert.ok(Math.abs(Math.hypot(gate.arrival.x - gate.x, gate.arrival.z - gate.z) - 9) < 1e-8);
  } finally { model.dispose(); }
});

test('gates stay light, cull independently, generate finite meshes and release resources once', () => {
  const { frame, model } = fixture(), layer = createCampusGates(THREE, model, { frame, geoToLocal });
  try {
    const resources = new Set();
    layer.group.traverse(o => { if (!o.isMesh) return; resources.add(o.geometry); resources.add(o.material); if (o.material.map) resources.add(o.material.map); for (const v of o.geometry.attributes.position.array) assert.ok(Number.isFinite(v)); });
    assert.ok(layer.counts.drawCalls <= 18); assert.ok(layer.counts.triangles < 8000);
    const cam = new THREE.PerspectiveCamera(), east = layer.plan.gates[0]; cam.position.set(east.x, 2, east.z); layer.update(cam);
    assert.equal(layer.group.children[0].visible, true); assert.equal(layer.group.children[1].visible, false);
    cam.position.set(10000, 4, 10000); layer.update(cam); assert.ok(layer.group.children.every(g => !g.visible));
    assert.ok(layer.viewpoints['east-gate'].arrival); assert.ok(layer.viewpoints['yunyuan-gate'].arrival);
    assert.equal(layer.infrastructure.buildings.length, 0);
    let count = 0; for (const r of resources) r.addEventListener('dispose', () => count++);
    layer.dispose(); layer.dispose(); assert.equal(count, resources.size);
  } finally { layer.dispose(); model.dispose(); }
});

test('missing evidence creates no invented gate or replacement footprint', () => {
  assert.equal(planCampusGates({ records: [] }).accepted, false);
  const layer = createCampusGates(THREE, { records: [] });
  assert.equal(layer.plan.gates.length, 0); assert.equal(layer.infrastructure.replacedBuildingIds.length, 0); layer.dispose();
});
