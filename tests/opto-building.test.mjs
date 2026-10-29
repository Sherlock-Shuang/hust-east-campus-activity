import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createLocalFrame, geoToLocal } from '../src/geospatial.js';
import { createGeoScene } from '../src/geo-scene.js';
import { createOptoBuilding, OPTO_BUILDING_ID, planOptoBuilding } from '../src/opto-building.js';
import { createPlayerWorld } from '../src/player-experience.js';
import { createPlayerMotion } from '../src/player-motion.js';

const source = JSON.parse(readFileSync(new URL('../public/data/opto-southeast.geojson', import.meta.url), 'utf8'));
const before = JSON.stringify(source), feature = source.features.find(f => f.id === OPTO_BUILDING_ID);
const frame = createLocalFrame({ longitude: 114.42123985, latitude: 30.51575845, coordinateSystem: 'EPSG:4326' });
const raw = createGeoScene(THREE, new THREE.Scene(), { ...source, features: [feature] }, frame, geoToLocal);
const record = raw.buildings[0], building = createOptoBuilding(THREE, record, { frame, geoToLocal });
const world = createPlayerWorld({ ...raw, bounds: { ...raw.bounds, minX: 400, maxX: 1000, minZ: 300, maxZ: 1000 }, architectureInfrastructure: building.infrastructure });
const route = { points: [{ x: 400, z: 400, y: .14 }, { x: 1000, z: 400, y: .14 }], segments: [{ startProgress: 0, endProgress: 600, width: 8 }] };
const center = polygon => polygon.reduce((p, q) => ({ x: p.x + q.x / polygon.length, z: p.z + q.z / polygon.length }), { x: 0, z: 0 });
const inside = (p, ring) => { let hit = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) hit = !hit; } return hit; };
const contains = (p, v) => inside(p, v.rings[0]) && !v.rings.slice(1).some(r => inside(p, r));
after(() => { building.dispose(); raw.dispose(); });

test('only the named new optoelectronics relation is reconstructed, south of the original extent', () => {
  assert.equal(feature.properties.name, '新光电信息大楼');
  assert.ok(feature.bbox[3] < 30.512);
  assert.equal(planOptoBuilding({ ...record, id: 'relation/20970638' }, { frame, geoToLocal }), null);
  assert.equal(record.shapes[0].holes.length, 3);
  assert.ok(source.features.some(f => f.properties.category === 'road'));
  assert.ok(source.features.some(f => f.properties.category === 'water'));
  assert.equal(JSON.stringify(source), before);
});

test('all three source courtyards remain open in both visible geometry and collision volumes', () => {
  for (const hole of building.plan.polygons[0].slice(1)) {
    const sample = center(hole);
    assert.equal(building.infrastructure.buildings.some(v => contains(sample, v)), false);
  }
  assert.deepEqual(building.infrastructure.replacedBuildingIds, [OPTO_BUILDING_ID]);
  for (const v of building.infrastructure.buildings) {
    assert.ok(v.height <= 33 && v.height > v.minHeight);
    assert.ok(building.group.getObjectByName(v.id), `collision ${v.id} must have the matching rendered volume`);
  }
});

test('C118 access faces the building, keeps a real ground void, and is explicitly provisional', () => {
  const { entry, plan } = building, e = plan.cEntry;
  assert.match(entry.evidenceStatus, /unverified/);
  assert.ok((-Math.sin(entry.yaw)) * -e.nx + (-Math.cos(entry.yaw)) * -e.nz > .999);
  const player = createPlayerMotion({ route, world });
  assert.equal(player.placeWalker(entry).ok, true);
  for (let i = 0; i < 600; i++) player.step(1 / 120, { forward: .4 });
  const inward = (player.state.x - e.x) * -e.nx + (player.state.z - e.z) * -e.nz;
  assert.ok(inward > .3, `walker must enter the 7.2 m opening, distance ${inward}`);
  assert.ok(inward < 4.9, 'glass vestibule wall remains solid');
  assert.ok(player.state.y < .3, 'entry cannot launch walker onto the 33 m roof');
});

test('main stair flight reaches its upper landing without a collider jump', () => {
  const steps = building.infrastructure.walkSurfaces.filter(s => s.id.startsWith('opto-main-step-')).sort((a, b) => a.surfaceY - b.surfaceY);
  const first = center(steps[0].polygon), last = center(steps.at(-1).polygon), length = Math.hypot(last.x - first.x, last.z - first.z), dx = (last.x - first.x) / length, dz = (last.z - first.z) / length;
  const player = createPlayerMotion({ route, world });
  assert.equal(player.placeWalker({ x: first.x - dx * .6, z: first.z - dz * .6, yaw: Math.atan2(-dx, -dz) }).ok, true);
  const target = { x: last.x + dx * .8, z: last.z + dz * .8 };
  let largestRise = 0, previous = player.state.y;
  for (let i = 0; i < 1800; i++) {
    if (Math.hypot(player.state.x - target.x, player.state.z - target.z) < .06) break;
    player.step(1 / 120, { forward: .3 }); largestRise = Math.max(largestRise, player.state.y - previous); previous = player.state.y;
    if ((player.state.x - target.x) * dx + (player.state.z - target.z) * dz > 0) break;
  }
  assert.ok(Math.hypot(player.state.x - target.x, player.state.z - target.z) < .12);
  assert.ok(Math.abs(player.state.y - 2.82) < .02, `landing height ${player.state.y}`);
  assert.ok(largestRise < .3, `largest step must be modest, got ${largestRise}`);
});

test('facade detail is instanced, finite and below a bounded geometry budget', () => {
  let triangles = 0, drawCalls = 0;
  building.group.traverse(o => {
    if (!o.isMesh) return;
    drawCalls++;
    const p = o.geometry.attributes.position;
    for (const n of p.array) assert.ok(Number.isFinite(n));
    if (o.isInstancedMesh) for (const n of o.instanceMatrix.array) assert.ok(Number.isFinite(n));
    triangles += (o.geometry.index?.count ?? p.count) / 3 * (o.count ?? 1);
  });
  assert.ok(building.group.getObjectByName('opto-vertical-sunshade-screen').isInstancedMesh);
  assert.ok(building.group.getObjectByName('opto-tree-column-branches').isInstancedMesh);
  assert.ok(drawCalls <= 35, `${drawCalls} draw calls`);
  assert.ok(triangles < 200000, `${triangles} triangles`);
  assert.equal(JSON.stringify(source), before);
});

test('distance LOD keeps the shell and glazing, uses the nearest bound, and restores all detail for export', () => {
  const b = building.plan.bounds, camera = new THREE.PerspectiveCamera();
  const fins = building.group.getObjectByName('opto-vertical-sunshade-screen');
  const frames = building.group.getObjectByName('opto-window-mullions');
  const glass = building.group.getObjectByName('opto-ribbon-glass');
  const visibleTriangles = () => {
    let total = 0;
    building.group.traverseVisible(o => { if (o.isMesh) total += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.count ?? 1); });
    return total;
  };
  building.update(null);
  const fullTriangles = visibleTriangles();
  camera.position.set(b.minX - 450, 2, (b.minZ + b.maxZ) / 2);
  assert.equal(building.update(camera), true);
  assert.equal(fins.visible, false); assert.equal(frames.visible, false); assert.equal(glass.visible, true);
  for (const v of building.plan.volumes) assert.equal(building.group.getObjectByName(v.id).visible, true);
  assert.ok(visibleTriangles() < fullTriangles * .4, 'far view should submit less than 40% of the detailed triangles');
  camera.position.x = b.minX - 350;
  assert.equal(building.update(camera), false, 'inside the hysteresis band retains the prior low detail state');
  assert.equal(fins.visible, false);
  camera.position.set(b.minX - 300, 2, b.maxZ);
  assert.equal(building.update(camera), true, 'nearest edge is 300 m away even though centre is farther');
  assert.equal(fins.visible, true);
  assert.equal(building.update(camera, { detailDistanceScale: .5 }), true);
  assert.equal(fins.visible, false, 'lower quality shortens detail distance');
  assert.equal(building.update(null), true);
  assert.equal(fins.visible, true); assert.equal(frames.visible, true);
  assert.equal(visibleTriangles(), fullTriangles, 'export restores every detail batch');
  assert.equal(building.update(null), false);
});
