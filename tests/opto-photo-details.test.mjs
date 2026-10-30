import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createLocalFrame, geoToLocal } from '../src/geospatial.js';
import { createGeoScene } from '../src/geo-scene.js';
import { createOptoBuilding, OPTO_BUILDING_ID } from '../src/opto-building.js';
import { createPlayerWorld } from '../src/player-experience.js';
import { createPlayerMotion } from '../src/player-motion.js';
import { crossedInteriorDoor, nearbyInterior } from '../src/building-interiors.js';

const data = JSON.parse(readFileSync(new URL('../public/data/opto-southeast.geojson', import.meta.url), 'utf8'));
const frame = createLocalFrame({ longitude: 114.42123985, latitude: 30.51575845, coordinateSystem: 'EPSG:4326' });
const at = (s, u, y, v) => new THREE.Vector3(s.x + s.tx * u + s.nx * v, y, s.z + s.tz * u + s.nz * v);
function fixture({ canvas = false } = {}) {
  const raw = createGeoScene(THREE, new THREE.Scene(), { ...data, features: data.features.filter(f => f.id === OPTO_BUILDING_ID) }, frame, geoToLocal);
  const previousDocument = globalThis.document;
  if (canvas) {
    // Exercise the browser-only atlas/material path without a WebGL renderer.
    // Raster appearance is separately checked in the real local browser.
    globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, strokeRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillText() {} }) }) };
  }
  let building;
  try { building = createOptoBuilding(THREE, raw.buildings[0], { frame, geoToLocal }); }
  finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
  building.group.updateMatrixWorld(true);
  return { building, raw, dispose() { building.dispose(); raw.dispose(); } };
}

test('photo doors are opaque white at C118 and transparent framed glass at C1, leaving the clear route intact', () => {
  const f = fixture(), b = f.building;
  try {
    for (const door of [b.plan.groundFloor.hallDoor, b.plan.rearHallDoor]) {
      const ray = new THREE.Raycaster(at(door, 0, 1.7, -.69), new THREE.Vector3(door.tx, 0, door.tz), 0, 1.6);
      const hit = ray.intersectObject(b.group, true)[0];
      assert.ok(hit, 'opened hall leaf is visibly solid at the aperture edge');
      assert.equal(hit.object.material.transparent, false);
      assert.equal(hit.object.material.color.getHexString(), 'e3e7df');
      const forward = new THREE.Raycaster(at(door, 0, 1.7, 1), new THREE.Vector3(-door.nx, 0, -door.nz), 0, 1.8);
      assert.equal(forward.intersectObject(b.group, true)[0], undefined, 'solid door leaves must not close the passage');
    }
    const e = b.plan.cEntry;
    const glassHit = new THREE.Raycaster(at(e, 0, 1.7, .69), new THREE.Vector3(e.tx, 0, e.tz), 0, 1.8).intersectObject(b.group, true)[0];
    assert.ok(glassHit?.object.material.transparent, 'exterior entrance remains a glass leaf');
    assert.equal(b.entries.length, 5, 'C1/C2 circulation complements the three auditorium doors');
  } finally { f.dispose(); }
});


test('C118 opaque leaves never hide the left-hand doorway from the approaching corridor', () => {
  const f = fixture(), b = f.building;
  try {
    const e = b.plan.cEntry, door = b.plan.groundFloor.hallDoor;
    for (const depth of [4.5, 5.6, 6.3, 7.2, 8.4]) {
      const origin = at(e, 0, 1.7, -depth), target = at(door, 0, 1.7, -.12), direction = target.clone().sub(origin);
      const ray = new THREE.Raycaster(origin, direction.clone().normalize(), 0, direction.length());
      const hit = ray.intersectObject(b.group, true)[0];
      assert.equal(hit, undefined, `approaching at ${depth} m should see through the hall doorway, hit ${hit?.object.name}`);
    }
    const leaves = b.infrastructure.barriers.filter(o => o.id.includes('open-leaf'));
    assert.equal(leaves.length, 4, 'opaque leaves have matching physical barriers');
    for (const leaf of leaves) {
      const source = leaf.id.includes('left-hall') ? door : b.plan.rearHallDoor;
      assert.ok(leaf.polygon.every(p => (p.x - source.x) * source.nx + (p.z - source.z) * source.nz < 0), 'white leaf stays entirely inside the auditorium-side cut');
    }
  } finally { f.dispose(); }
});

test('the default C1 arrival can walk forward then strafe left into the real C118 trigger', () => {
  const f = fixture(), b = f.building;
  try {
    const world = createPlayerWorld({ ...f.raw, bounds: { ...f.raw.bounds, minX: 400, maxX: 1000, minZ: 300, maxZ: 1000 }, architectureInfrastructure: b.infrastructure });
    const route = { points: [{ x: 400, z: 400, y: .14 }, { x: 1000, z: 400, y: .14 }], segments: [{ startProgress: 0, endProgress: 600, width: 8 }] };
    const player = createPlayerMotion({ world, route });
    assert.equal(player.placeWalker(b.entry).ok, true);
    const heading = b.entry.yaw, e = b.plan.cEntry;
    // Same camera-relative move vector as KeyW in player-experience.js.
    for (let i = 0; i < 1000; i++) {
      const depth = (player.state.x - e.x) * -e.nx + (player.state.z - e.z) * -e.nz;
      if (depth >= 7.12) break;
      player.step(1 / 120, { moveX: -Math.sin(heading), moveZ: -Math.cos(heading), aimYaw: heading });
      assert.equal(player.state.blockedReason, '');
    }
    let entered = null, prompted = false;
    for (let i = 0; i < 400 && !entered; i++) {
      const previous = { ...player.state };
      // KeyA is a left strafe; it does not require a camera turn.
      player.step(1 / 120, { moveX: -Math.cos(heading), moveZ: Math.sin(heading), aimYaw: heading });
      assert.equal(player.state.blockedReason, '', 'the body must not cross or collide with an opaque leaf');
      prompted ||= nearbyInterior(b.entries, player.state)?.id === 'opto-c118-left-hall';
      entered = crossedInteriorDoor(b.entries, previous, player.state);
    }
    assert.ok(prompted, 'prompt becomes available before crossing');
    assert.equal(entered?.id, 'opto-c118-left-hall');
  } finally { f.dispose(); }
});

test('browser lettering shares one atlas and the terrazzo is a small authored repeating material', () => {
  const f = fixture({ canvas: true }), b = f.building;
  try {
    const atlas = b.group.getObjectByName('opto-photo-sign-atlas');
    assert.ok(atlas);
    assert.ok(atlas.userData.labels.includes('C1'));
    assert.ok(atlas.userData.labels.includes('武汉光电国家研究中心'));
    assert.ok(atlas.userData.labels.includes('C118　报告厅 C1'));
    assert.equal(atlas.geometry.attributes.position.count / 4, atlas.userData.labels.length, 'no atlas slot is silently dropped');
    assert.equal(atlas.material.map.image.width, 2048);
    const c1 = atlas.userData.labels.indexOf('C1'), uv = atlas.geometry.attributes.uv;
    assert.ok(uv.getX(c1 * 4 + 1) - uv.getX(c1 * 4) < .15, 'short C1 text samples a cropped cell instead of becoming tiny inside a wide empty slot');
    const floor = b.group.getObjectByName('opto-ground-access-paving').material;
    assert.equal(floor.map.image.width, 256);
    assert.equal(floor.map.wrapS, THREE.RepeatWrapping);
    assert.ok(floor.roughness < .35);
    let calls = 0, triangles = 0;
    b.group.traverse(o => { if (!o.isMesh) return; calls++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.count ?? 1); });
    assert.ok(calls <= 62, `browser atlas path: ${calls} draw calls`);
    assert.ok(triangles < 150000, `${triangles} triangles including photo details`);
    assert.ok(Object.values(b.photoViewpoints).every(v => [...Object.values(v.position), ...Object.values(v.target)].every(Number.isFinite)));
  } finally { f.dispose(); }
});

test('close-range photo details participate in distance LOD and all shared GPU resources are disposed once', () => {
  const f = fixture({ canvas: true }), b = f.building;
  const scene = new THREE.Scene(); scene.add(b.group);
  const textures = new Set(), geometries = new Set(), materials = new Set(), instances = new Set();
  b.group.traverse(o => { if (!o.isMesh) return; geometries.add(o.geometry); materials.add(o.material); if (o.material.map) textures.add(o.material.map); if (o.isInstancedMesh) instances.add(o); });
  const disposed = new Map();
  for (const resource of [...textures, ...geometries, ...materials, ...instances]) resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) || 0) + 1));
  const camera = new THREE.PerspectiveCamera(); camera.position.set(b.plan.bounds.minX - 450, 2, b.plan.bounds.minZ);
  b.update(camera);
  for (const name of ['opto-photo-light-stone-details', 'opto-photo-dark-details', 'opto-photo-court-shrubs']) assert.equal(b.group.getObjectByName(name).visible, false, name);
  b.update(null);
  for (const name of ['opto-photo-light-stone-details', 'opto-photo-dark-details', 'opto-photo-court-shrubs']) assert.equal(b.group.getObjectByName(name).visible, true, name);
  assert.ok(instances.size > 0, 'fixture exercises instanced rendering resources');
  assert.ok([...instances].some(o => o.instanceColor), 'per-instance shrub colors also require mesh disposal');
  f.dispose();
  b.dispose();
  b.dispose();
  assert.equal(b.update(null), false, 'disposed renderer must not continue changing mesh state');
  assert.equal(b.group.parent, null);
  for (const resource of [...textures, ...geometries, ...materials, ...instances]) assert.equal(disposed.get(resource), 1, 'shared GPU resource disposed exactly once');
});
