import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
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

test('photo height zones preserve the full source footprint and raise the south end above its recessed connector', () => {
  const { plan } = building;
  const union = polygonClipping.union(...plan.zones.map(z => z.region));
  const delta = polygonClipping.xor(plan.sourceFootprint, union);
  const ringArea = ring => Math.abs(ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
  assert.ok(delta.flat().reduce((sum, ring) => sum + ringArea(ring), 0) < 1e-6, 'height partition must not redraw or truncate any source perimeter');
  const at = (longitude, latitude) => { const p = geoToLocal({ longitude, latitude, coordinateSystem: 'EPSG:4326' }, frame); return plan.heightAt(p.x, p.z); };
  assert.ok(at(114.42825, 30.50877) < at(114.42840, 30.50850), 'low south connector must rise again at the terminal');
  assert.ok(at(114.4281, 30.51035) < at(114.4288, 30.5093), 'northern wing and central high span must differ');
  assert.equal(JSON.stringify(source), before);
});

test('west undercroft is source-edge aligned and walkable below its high spanning volume', () => {
  const p = building.plan.parking;
  assert.ok(p.width > 24 && p.height > 10);
  assert.ok(Math.abs(p.tx * p.nx + p.tz * p.nz) < 1e-10);
  const sample = { x: p.x - p.nx * 5, z: p.z - p.nz * 5 };
  assert.equal(building.plan.volumes.some(v => v.minHeight < 2 && contains(sample, v)), false);
  assert.equal(building.plan.volumes.some(v => v.minHeight >= 10 && contains(sample, v)), true);
  const player = createPlayerMotion({ route, world });
  assert.equal(player.placeWalker({ x: p.x + p.nx * 3, z: p.z + p.nz * 3, yaw: Math.atan2(p.nx, p.nz) }).ok, true);
  for (let i = 0; i < 1200; i++) player.step(1 / 120, { forward: .4 });
  const inward = (player.state.x - p.x) * -p.nx + (player.state.z - p.z) * -p.nz;
  assert.ok(inward > 8, `must walk into undercroft, got ${inward}`);
  assert.ok(player.state.y < .3, 'high span must not pull a grounded walker onto the roof');
});

test('the undercroft opening has no decorative glazing or mullions across either side of the cut', () => {
  const p = building.plan.parking;
  building.group.updateMatrixWorld(true);
  // A collision-only test missed the old inner-court glass painted across an
  // otherwise walkable void. Raycast the actual render meshes at three heights.
  for (const u of [-10, -5, 0, 5, 10]) for (const y of [2.8, 5, 8]) {
    const origin = new THREE.Vector3(p.x + p.tx * u + p.nx * 3, y, p.z + p.tz * u + p.nz * 3);
    const ray = new THREE.Raycaster(origin, new THREE.Vector3(-p.nx, 0, -p.nz), 0, 25);
    const hit = ray.intersectObject(building.group, true)[0];
    assert.equal(hit, undefined, `undercroft column ${u}, height ${y} blocked by ${hit?.object.name}`);
  }
  assert.ok(building.group.getObjectByName('opto-undercroft-soffit'));
  assert.ok(building.group.getObjectByName('opto-undercroft-paving'));
});

test('both real door openings can be reached from ground approaches and crossed into their auditorium gates', () => {
  assert.equal(building.entries.length, 2);
  assert.equal(building.entry.id, 'opto-c118', 'legacy landmark arrival stays available');
  assert.match(building.entry.evidenceStatus, /unverified/);
  for (const entry of building.entries) {
    const { center, normal, halfWidth } = entry.doorGate;
    assert.ok(halfWidth >= 1.2);
    assert.equal(entry.workId, 'opto-c118'); assert.equal(entry.url, './c118.html');
    const player = createPlayerMotion({ route, world });
    assert.equal(player.placeWalker(entry.approach).ok, true, `${entry.id} road-side approach`);
    let largestRise = 0, prior = player.state.y;
    for (let i = 0; i < 2400; i++) {
      const signed = (player.state.x - center.x) * normal.x + (player.state.z - center.z) * normal.z;
      if (signed < -1.2) break;
      player.step(1 / 120, { forward: .5 });
      largestRise = Math.max(largestRise, player.state.y - prior); prior = player.state.y;
      assert.equal(player.state.blockedReason, '', `${entry.id}: ground-to-door path is blocked`);
    }
    const inside = (player.state.x - center.x) * normal.x + (player.state.z - center.z) * normal.z;
    assert.ok(inside < -1.15, `${entry.id} must cross actual open leaves, got ${inside}`);
    assert.ok(Math.abs(player.state.y - entry.y) < .03);
    assert.ok(largestRise < .3, `${entry.id}: no roof snap or inaccessible landing`);
    assert.equal(player.placeWalker(entry.returnPose).ok, true, `${entry.id} return is walkable`);
    const outside = (player.state.x - center.x) * normal.x + (player.state.z - center.z) * normal.z;
    assert.ok(outside > entry.doorGate.frontDepth, 'return is outside the automatic-entry gate');
    for (let i = 0; i < 240; i++) player.step(1 / 120, { forward: .4 });
    assert.equal(player.state.blockedReason, '', 'returned walker can retreat toward the campus');
  }
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

test('main and secondary doorway apertures are also open in visible meshes, while side windows remain solid', () => {
  building.group.updateMatrixWorld(true);
  for (const entry of building.entries) {
    const { center, normal, halfWidth } = entry.doorGate;
    const tangent = { x: -normal.z, z: normal.x };
    for (const u of [-halfWidth * .65, 0, halfWidth * .65]) {
      const origin = new THREE.Vector3(center.x + normal.x * 2 + tangent.x * u, entry.y + 1.6, center.z + normal.z * 2 + tangent.z * u);
      const ray = new THREE.Raycaster(origin, new THREE.Vector3(-normal.x, 0, -normal.z), 0, 4);
      const hit = ray.intersectObject(building.group, true)[0];
      assert.equal(hit, undefined, `${entry.id} central doorway is painted shut by ${hit?.object.name}`);
    }
    const sideU = halfWidth + 1;
    const side = { x: center.x + tangent.x * sideU, z: center.z + tangent.z * sideU };
    assert.ok(building.infrastructure.barriers.some(b => inside(side, b.polygon)), 'fixed side windows retain collision');
  }
  assert.ok(building.group.getObjectByName('opto-open-door-leaves').material.transparent);
  assert.ok(building.group.getObjectByName('opto-door-handles'));
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
  assert.ok(drawCalls <= 46, `${drawCalls} draw calls`);
  assert.ok(triangles < 150000, `${triangles} triangles`);
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
