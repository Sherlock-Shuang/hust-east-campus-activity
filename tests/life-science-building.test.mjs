import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { createLocalFrame, geoToLocal } from '../src/geospatial.js';
import { createGeoScene } from '../src/geo-scene.js';
import { createCampus3D } from '../src/campus-3d.js';
import { createPlayerWorld } from '../src/player-experience.js';
import { createPlayerMotion } from '../src/player-motion.js';
import { polygonsOverlap, streetFootprint } from '../src/street-clearance.js';
import { createLifeScienceBuilding, planLifeScienceBuilding, LIFE_SCIENCE_BUILDING_ID } from '../src/life-science-building.js';

const source = JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson', import.meta.url), 'utf8'));
const before = JSON.stringify(source), feature = source.features.find(f => f.id === LIFE_SCIENCE_BUILDING_ID);
const frame = createLocalFrame({ longitude: 114.42123985, latitude: 30.51575845, coordinateSystem: 'EPSG:4326' });
const raw = createGeoScene(THREE, new THREE.Scene(), { ...source, features: [feature] }, frame, geoToLocal);
const options = { frame, geoToLocal, roads: source.features.filter(f => f.properties.category === 'road') };
const building = createLifeScienceBuilding(THREE, raw.buildings[0], options);
const closed = ring => [...ring.map(p => [p.x, p.z]), [ring[0].x, ring[0].z]];
after(() => { building.dispose(); raw.dispose(); });

test('only the source Life Science outline is specialized; conflicting source levels remain intact', () => {
  assert.equal(feature.properties.name, '东十一教学楼');
  assert.equal(feature.properties.tags['name:zh'], '生命科学学院');
  assert.equal(building.plan.sourceLevels, 10);
  assert.equal(building.plan.visibleWindowBands, 7);
  assert.match(building.group.userData.uncertainty, /10层.*七条窗带/);
  assert.equal(planLifeScienceBuilding({ ...raw.buildings[0], id: 'way/98867853' }, options), null, 'adjacent library cannot inherit the photo facade');
  assert.equal(JSON.stringify(source), before);
});

test('photo reconstruction preserves the complete original floor footprint and matching collision solids', () => {
  const { plan, infrastructure } = building;
  const modelFootprint = infrastructure.buildings.map(volume => volume.rings.map(closed));
  assert.deepEqual(polygonClipping.xor(plan.sourceFootprint, modelFootprint), []);
  assert.deepEqual(infrastructure.replacedBuildingIds, [LIFE_SCIENCE_BUILDING_ID]);
  for (const volume of infrastructure.buildings) {
    assert.ok(building.group.getObjectByName(volume.id));
    assert.equal(volume.height, plan.height);
  }
  assert.ok(plan.front.nz > .9, 'main facade fronts the existing southern court and service lane');
  assert.ok(plan.front.length > 80 && plan.front.length < 90);
});

test('wide stair and parking respect source road clearances and leave a continuous central approach', () => {
  const { plan, infrastructure } = building, e = plan.entrance;
  assert.ok(e.externalDetails, 'source map leaves space for the photographed porch');
  assert.ok(plan.clearRoads.some(road => road.id === 'way/103495015'));
  const furniture = [...plan.parking.map(p => p.polygon), ...plan.planting.map(p => p.polygon), e.apron];
  assert.ok(plan.parking.length > 12 && plan.planting.length > 3);
  for (const polygon of furniture) for (const road of plan.clearRoads) {
    assert.equal(polygonsOverlap(polygon, road.polygon), false, `photo detail must not obstruct ${road.id}`);
  }
  const centralApproach = streetFootprint(e.x + e.nx * e.depth / 2, e.z + e.nz * e.depth / 2, 2.5, e.depth, e.yaw);
  assert.equal(infrastructure.barriers.some(barrier => barrier.minHeight < 3.5 && polygonsOverlap(centralApproach, barrier.polygon)), false, 'columns, planters and scooters leave the entrance centre open');
  const treads = infrastructure.walkSurfaces.filter(surface => surface.id.startsWith('life-stair-')).sort((a, b) => b.surfaceY - a.surfaceY);
  assert.equal(treads.length, 10);
  for (let i = 1; i < treads.length; i++) assert.ok(treads[i - 1].surfaceY - treads[i].surfaceY < .18);
});

test('repeated frames and air conditioners are instanced and coarse views suppress fine detail', () => {
  const meshes = []; building.group.traverse(object => { if (object.isMesh) meshes.push(object); });
  assert.ok(meshes.length < 30, `bounded building draw calls: ${meshes.length}`);
  const condensers = building.group.getObjectByName('life-air-conditioners');
  assert.ok(condensers.isInstancedMesh && condensers.count > 150);
  assert.ok(building.group.getObjectByName('life-window-mullions').isInstancedMesh);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(building.plan.bounds.minX - 1000, 20, building.plan.bounds.minZ - 1000);
  assert.equal(building.update(camera), true); assert.equal(condensers.visible, false);
  assert.equal(building.group.getObjectByName(building.plan.volumes[0].id).visible, true);
  camera.position.copy(new THREE.Vector3(building.viewpoints.entrance.x, 1.7, building.viewpoints.entrance.z));
  assert.equal(building.update(camera), true); assert.equal(condensers.visible, true);
});

test('dispose releases shared resources once, including repeated calls', () => {
  const sample = createLifeScienceBuilding(THREE, raw.buildings[0], options), geos = new Set(), mats = new Set(), instances = new Set();
  sample.group.traverse(object => { if (object.geometry) geos.add(object.geometry); if (object.material) mats.add(object.material); if (object.isInstancedMesh) instances.add(object); });
  let disposedGeometries = 0, disposedMaterials = 0, disposedInstances = 0;
  geos.forEach(geo => geo.addEventListener('dispose', () => disposedGeometries++));
  mats.forEach(mat => mat.addEventListener('dispose', () => disposedMaterials++));
  instances.forEach(object => object.addEventListener('dispose', () => disposedInstances++));
  sample.dispose(); sample.dispose();
  assert.equal(disposedGeometries, geos.size); assert.equal(disposedMaterials, mats.size);
  assert.equal(disposedInstances, instances.size);
});

test('campus integration lets a real walker climb the broad stair to the same height as the visible stone', () => {
  const features = source.features.filter(f => f.id === LIFE_SCIENCE_BUILDING_ID || f.id === 'way/103495015');
  const model = createGeoScene(THREE, new THREE.Scene(), { ...source, features }, frame, geoToLocal);
  const campus = createCampus3D(THREE, model, { frame, geoToLocal });
  try {
    assert.equal(campus.records.get(LIFE_SCIENCE_BUILDING_ID).displayMode, 'life-science-user-photo-informed');
    const plan = campus.lifeSciencePlan, e = plan.entrance, world = createPlayerWorld(model);
    assert.equal(world.buildings.some(volume => volume.id === LIFE_SCIENCE_BUILDING_ID), false, 'generic source 10-storey collision must be replaced');
    const solids = world.buildings.filter(volume => volume.sourceId === LIFE_SCIENCE_BUILDING_ID);
    assert.equal(solids.length, plan.volumes.length);
    assert.ok(solids.every(volume => volume.height === plan.height && volume.minHeight === .08));
    const route = { points: [{ x: e.x - 30, y: .16, z: e.z + 10 }, { x: e.x + 30, y: .16, z: e.z + 10 }], segments: [{ startProgress: 0, endProgress: 60, width: 4.5 }] };
    const motion = createPlayerMotion({ route, world });
    const at = v => ({ x: e.x + e.nx * v, z: e.z + e.nz * v });
    assert.equal(motion.placeWalker({ ...at(e.depth + .7), yaw: Math.atan2(e.nx, e.nz) }).ok, true);
    const target = at(.9); let largestRise = 0, priorY = motion.state.y;
    for (let i = 0; i < 2000; i++) {
      const dx = target.x - motion.state.x, dz = target.z - motion.state.z, distance = Math.hypot(dx, dz);
      if (distance < .06) break;
      motion.step(1 / 120, { moveX: dx / distance * .35, moveZ: dz / distance * .35 });
      assert.equal(motion.state.blockedReason, '', 'central stair route stays clear');
      largestRise = Math.max(largestRise, motion.state.y - priorY); priorY = motion.state.y;
    }
    assert.ok(Math.hypot(motion.state.x - target.x, motion.state.z - target.z) < .08, 'walker reaches the porch');
    assert.ok(Math.abs(motion.state.y - e.floorY) < .01);
    assert.ok(largestRise < .18, `no invisible collider jump, largest rise ${largestRise}`);
    campus.group.updateMatrixWorld(true);
    const stairMeshes = [campus.group.getObjectByName('life-wide-stair-treads'), campus.group.getObjectByName('life-porch-stone-landing')];
    for (const surface of world.walkSurfaces.filter(surface => surface.sourceId === LIFE_SCIENCE_BUILDING_ID)) {
      const center = surface.polygon.reduce((p, q) => ({ x: p.x + q.x / surface.polygon.length, z: p.z + q.z / surface.polygon.length }), { x: 0, z: 0 });
      const hit = new THREE.Raycaster(new THREE.Vector3(center.x, 3, center.z), new THREE.Vector3(0, -1, 0), 0, 4).intersectObjects(stairMeshes, false)[0];
      assert.ok(hit && Math.abs(hit.point.y - surface.surfaceY) < 1e-4, `${surface.id}: rendered tread and player support agree`);
    }
    const canopy = world.barriers.find(barrier => barrier.id === 'life-portal-flat-canopy');
    assert.equal(canopy.minHeight, e.canopyY - .35); assert.equal(canopy.height, e.canopyY + .35);
    assert.equal(motion.canPlaceMode({ ...at(-1), y: e.floorY, yaw: 0 }, 'walk').reason, '建筑边界', 'decorative entrance does not invent walkable indoor space');
  } finally { campus.dispose(); model.dispose(); }
});
