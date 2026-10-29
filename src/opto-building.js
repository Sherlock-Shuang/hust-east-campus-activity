import polygonClipping from 'polygon-clipping';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { streetFootprint } from './street-clearance.js';

/** The new optoelectronics building lies south of the original capture extent.
 * Its identity is relation/13705821, not the unnamed relation/20970638.
 * Geometry is taken from its source polygon, including all three courtyards.
 * No photograph is distributed as a material. All facade details are authored.
 */
export const OPTO_BUILDING_ID = 'relation/13705821';
export const OPTO_BUILDING_EVIDENCE = Object.freeze({
  sourceId: OPTO_BUILDING_ID,
  sourceUrl: 'https://www.openstreetmap.org/relation/13705821',
  name: '光电信息大楼',
  height: 33,
  heightEvidence: '2018-09-26 校方装饰装修现场报道：建筑总高度约33米；不是测绘标高。',
  heightSource: 'https://wnlo.hust.edu.cn/info/1104/5092.htm',
  photographSource: 'https://www.hbkx.org.cn/ztzl/2024/cg/cgjj?columnid=3d351ed4891e43168623b6a613bacf53',
  photographs: [
    'https://hbkx.org.cn/attached/image/20240716/1721113702065049616.png',
    'https://hbkx.org.cn/attached/image/2024/08/19/3db0335373e2466a91d3cd33a687c388.png',
  ],
  observed: '连续W形院落、错落翼楼、南翼中段退低而端部升高；竖向金属遮阳屏、蓝绿玻璃带、灰石基座窄窗与宽架空口；主入口格网雨棚、分叉斜撑柱与侧墙台阶。',
  uncertainty: 'OSM轮廓非测绘成果；窗格、分区高度、南翼中段退台、设备位置、架空洞口和入口坐标均为照片比例估计。C118两条进入路线由用户现场描述确认；入口坐标、走廊尺寸及C区边界仍为源轮廓上的展示估计，并非测绘平面。',
  c118Evidence: 'https://wnlo.hust.edu.cn/info/1374/4231.htm',
});

// The user confirmed the access topology: ground door to the left of the main
// steps, straight corridor then an auditorium door on the left; a second door
// enters directly from the east. Coordinates remain source-edge estimates.
export const OPTO_ACCESS = Object.freeze({
  main: Object.freeze({ longitude: 114.42860685, latitude: 30.5093796 }),
  c118: Object.freeze({ longitude: 114.428111, latitude: 30.508983 }),
  east: Object.freeze({ longitude: 114.42887397, latitude: 30.50894790 }),
  northPassage: Object.freeze({ longitude: 114.42784825, latitude: 30.51076485 }),
  rear: Object.freeze({ longitude: 114.42831535, latitude: 30.51058795 }),
  collegeSteps: Object.freeze({ longitude: 114.42818118, latitude: 30.50878107 }),
  c118Status: 'user-confirmed-route-coordinate-estimated',
});

const points = path => {
  const r = path.getPoints().map(p => ({ x: p.x, z: -p.y }));
  if (r.length > 1 && Math.hypot(r[0].x - r.at(-1).x, r[0].z - r.at(-1).z) < 1e-5) r.pop();
  return r;
};
const area = r => r.reduce((sum, a, i) => { const b = r[(i + 1) % r.length]; return sum + a.x * b.z - b.x * a.z; }, 0) / 2;
const closed = r => [...r.map(p => [p.x, p.z]), [r[0].x, r[0].z]];
const fromClip = p => p.map(r => r.slice(0, -1).map(([x, z]) => ({ x, z })));
const insideRing = (p, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
};
const insidePolygon = (p, polygon) => insideRing(p, polygon[0]) && !polygon.slice(1).some(r => insideRing(p, r));
const projected = (c, frame, fn) => fn({ ...c, height: 0, coordinateSystem: 'EPSG:4326' }, frame);

/** A pure geometry plan shared by the renderer and collision integration. */
export function planOptoBuilding(record, { frame, geoToLocal } = {}) {
  if (record?.id !== OPTO_BUILDING_ID) return null;
  if (!record.shapes?.length || typeof geoToLocal !== 'function') throw new TypeError('Optoelectronics requires the source shapes and explicit WGS84 projection.');
  const polygons = record.shapes.map(s => [points(s), ...s.holes.map(points)]);
  const all = polygons.flat(2), xs = all.map(p => p.x), zs = all.map(p => p.z);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const footprint = polygons.map(p => p.map(closed));
  const nearestEdge = c => {
    let closest;
    for (const p of polygons) for (let i = 0; i < p[0].length; i++) {
      const a = p[0][i], b = p[0][(i + 1) % p[0].length], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      if (l < .5) continue;
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / (l * l)));
      const x = a.x + dx * t, z = a.z + dz * t, distance = Math.hypot(c.x - x, c.z - z);
      if (!closest || distance < closest.distance) {
        const sign = Math.sign(area(p[0]));
        closest = { x, z, distance, tx: dx / l, tz: dz / l, nx: dz / l * sign, nz: -dx / l * sign };
      }
    }
    return closest;
  };
  const cEntry = { ...nearestEdge(projected(OPTO_ACCESS.c118, frame, geoToLocal)), width: 4.8, height: 4.4, depth: 9.8, status: OPTO_ACCESS.c118Status };
  cEntry.yaw = -Math.atan2(cEntry.tz, cEntry.tx);
  const eastEntry = { ...nearestEdge(projected(OPTO_ACCESS.east, frame, geoToLocal)), width: 4.8, height: 4.4, depth: 5.6, status: OPTO_ACCESS.c118Status };
  eastEntry.yaw = -Math.atan2(eastEntry.tz, eastEntry.tx);
  // Looking inward, -tangent is the player's left. Only the side door, not
  // the exterior college door, activates the auditorium runtime.
  const turn = { x: cEntry.x - cEntry.nx * 7.2, z: cEntry.z - cEntry.nz * 7.2 };
  const hallDoor = { x: turn.x - cEntry.tx * 2.4, z: turn.z - cEntry.tz * 2.4,
    nx: cEntry.tx, nz: cEntry.tz, tx: -cEntry.nx, tz: -cEntry.nz, width: 3.2, height: 3.4, status: cEntry.status };
  hallDoor.yaw = -Math.atan2(hallDoor.tz, hallDoor.tx);
  const corridorCut = streetFootprint(cEntry.x - cEntry.nx * 4.7, cEntry.z - cEntry.nz * 4.7, cEntry.width, 10.2, cEntry.yaw);
  const hallCut = streetFootprint(hallDoor.x - hallDoor.nx * 1.7, hallDoor.z - hallDoor.nz * 1.7, 3.6, 4.4, hallDoor.yaw);
  const eastCut = streetFootprint(eastEntry.x - eastEntry.nx * 2.6, eastEntry.z - eastEntry.nz * 2.6, eastEntry.width, 6, eastEntry.yaw);
  const collegeSteps = { ...nearestEdge(projected(OPTO_ACCESS.collegeSteps, frame, geoToLocal)) };
  collegeSteps.yaw = -Math.atan2(collegeSteps.tz, collegeSteps.tx);
  const groundFloor = { college: cEntry, collegeSteps, skylight: polygons[0][3], east: eastEntry, hallDoor, turn, cuts: [corridorCut, hallCut, eastCut],
    floorY: .12, ceilingY: 4.4, evidenceStatus: cEntry.status,
    routeEvidence: '用户现场说明：学院标识与台阶前左侧地面门，直走后左手报告厅；另有东侧直入门。' };
  // This opening belongs to the long west face, not to the oblique C door.
  // The measured source edge defines its yaw; photo proportions define its size.
  const parking = { ...nearestEdge(projected({ longitude: 114.4277934, latitude: 30.509777 }, frame, geoToLocal)), width: 25.8, depth: 28, height: 10.4 };
  parking.yaw = -Math.atan2(parking.tz, parking.tx);
  const parkingCut = streetFootprint(parking.x - parking.nx * 12, parking.z - parking.nz * 12, parking.width, parking.depth, parking.yaw);
  const main = { ...nearestEdge(projected(OPTO_ACCESS.main, frame, geoToLocal)), width: 16, depth: 9.2, height: 10.4 };
  main.yaw = -Math.atan2(main.tz, main.tx);
  const mainCut = streetFootprint(main.x - main.nx * 4, main.z - main.nz * 4, main.width, main.depth, main.yaw);
  // The user's two ground screenshots identify the NORTHWEST recess, 110 m
  // north of the photographed central parking span. Keep those two voids
  // separate. Only this end of the northern wing has a ground passage.
  const northPassage = { ...nearestEdge(projected(OPTO_ACCESS.northPassage, frame, geoToLocal)), width: 25.4, depth: 22, height: 4.4,
    status: 'user-confirmed-passage-dimensions-estimated' };
  northPassage.yaw = -Math.atan2(northPassage.tz, northPassage.tx);
  const northCut = streetFootprint(northPassage.x - northPassage.nx * 9, northPassage.z - northPassage.nz * 9, northPassage.width, northPassage.depth, northPassage.yaw);
  const rear = { ...nearestEdge(projected(OPTO_ACCESS.rear, frame, geoToLocal)), width: 5.8, depth: 9.2, height: 4.4,
    status: 'user-screenshot-rear-door-coordinate-estimated' };
  rear.yaw = -Math.atan2(rear.tz, rear.tx);
  const rearCut = streetFootprint(rear.x - rear.nx * 4.4, rear.z - rear.nz * 4.4, rear.width, rear.depth, rear.yaw);
  // A bounded, physical foyer. Its connection to C118 has not been verified;
  // it must not masquerade as a third auditorium teleport.
  const lowOpenings = [...groundFloor.cuts, northCut, rearCut];
  const cuts = [...lowOpenings.map(r => [closed(r)]), [closed(parkingCut)], [closed(mainCut)]];
  const geoMask = coordinates => [closed(coordinates.map(([longitude, latitude]) => projected({ longitude, latitude }, frame, geoToLocal)))];
  // Roof changes are aligned with the oblique wing cross sections. These are
  // photo-proportion zones, NOT claimed surveyed A–H structural boundaries.
  // In particular, the recessed middle of the south wing is lower, while its
  // terminal block rises again: do not flatten the entire southern end.
  const profiles = [
    { id: 'south-recessed-link', top: 17.2, mask: geoMask([[114.42810, 30.50866], [114.42845, 30.50863], [114.42839, 30.50894], [114.42810, 30.50885]]) },
    { id: 'south-terminal', top: 28.4, mask: geoMask([[114.42815, 30.50829], [114.42920, 30.50829], [114.42902, 30.50865], [114.42820, 30.50872]]) },
    { id: 'north-wing', top: 28.4, mask: geoMask([[114.42760, 30.51008], [114.42880, 30.51035], [114.42880, 30.51100], [114.42760, 30.51100]]) },
  ];
  let remaining = footprint;
  const zones = [];
  for (const profile of profiles) {
    const region = polygonClipping.intersection(remaining, profile.mask);
    zones.push({ id: profile.id, top: profile.top, polygons: region.map(fromClip), region });
    remaining = polygonClipping.difference(remaining, profile.mask);
  }
  zones.push({ id: 'central-high', top: 32.4, polygons: remaining.map(fromClip), region: remaining });
  const heightAt = (x, z) => zones.find(zone => zone.polygons.some(p => insidePolygon({ x, z }, p)))?.top ?? 32.4;
  const volumes = [];
  for (const zone of zones) {
    const lower = polygonClipping.difference(zone.region, ...cuts);
    lower.forEach((p, i) => volumes.push({ id: `${OPTO_BUILDING_ID}:${zone.id}:ground:${i}`, sourceId: OPTO_BUILDING_ID, rings: fromClip(p), minHeight: .08, height: 8.2 }));
    const hasTallVoid = polygonClipping.intersection(zone.region, polygonClipping.union([closed(parkingCut)], [closed(mainCut)])).length > 0;
    if (hasTallVoid) {
      const middle = polygonClipping.difference(zone.region, [closed(parkingCut)], [closed(mainCut)]);
      middle.forEach((p, i) => volumes.push({ id: `${OPTO_BUILDING_ID}:${zone.id}:middle:${i}`, sourceId: OPTO_BUILDING_ID, rings: fromClip(p), minHeight: 8.2, height: parking.height }));
    }
    zone.region.forEach((p, i) => volumes.push({ id: `${OPTO_BUILDING_ID}:${zone.id}:upper:${i}`, sourceId: OPTO_BUILDING_ID, rings: fromClip(p), minHeight: hasTallVoid ? parking.height : 8.2, height: zone.top }));
  }
  const lowCuts = polygonClipping.union(...lowOpenings.map(r => [closed(r)]));
  polygonClipping.intersection(footprint, lowCuts).forEach((p, i) => volumes.push({ id: `${OPTO_BUILDING_ID}:entry-lintel:${i}`, sourceId: OPTO_BUILDING_ID, rings: fromClip(p), minHeight: groundFloor.ceilingY, height: 8.2 }));
  return { polygons, bounds, volumes, zones, heightAt, cEntry, groundFloor, parking, parkingCut, mainCut, main,
    northPassage, northCut, rear, rearCut, lowOpenings, sourceFootprint: footprint };
}

export function createOptoBuilding(THREE, record, options = {}) {
  const plan = planOptoBuilding(record, options);
  if (!plan) return null;
  const group = new THREE.Group(); group.name = '光电信息大楼 · W形庭院与遮阳立面';
  group.userData = { component: 'opto-building', featureId: OPTO_BUILDING_ID, sourceId: OPTO_BUILDING_ID, category: 'building', ...OPTO_BUILDING_EVIDENCE, dimensions: 'photo-proportions-and-official-approximate-height', sourceFootprintPreserved: true };
  const geos = new Set(), mats = new Set(), batches = new Map(), dummy = new THREE.Object3D();
  const geometry = g => { geos.add(g); return g; };
  const material = (color, roughness = .82, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); mats.add(m); return m; };
  const stone = material('#929895'), screen = material('#d7dbd8', .63, .3), glass = material('#326b70', .32, .28), frameMat = material('#435354', .65, .25), roof = material('#b9b9ae'), dark = material('#56615d'), paving = material('#aeaca0'), white = material('#e3e7df', .6, .15), grass = material('#728b55');
  const openDoorGlass = material('#98c4c6', .2, .1);
  openDoorGlass.transparent = true; openDoorGlass.opacity = .3; openDoorGlass.depthWrite = false; openDoorGlass.side = THREE.DoubleSide;
  const wayfinding = material('#166c70', .7, .1);
  const boxGeo = geometry(new THREE.BoxGeometry(1, 1, 1));
  function mesh(name, geo, mat) { const o = new THREE.Mesh(geo, mat); o.name = name; o.castShadow = true; o.receiveShadow = true; o.renderOrder = 203; o.userData = { ...group.userData, component: name }; group.add(o); return o; }
  function box(name, mat, x, y, z, sx, sy, sz, yaw = 0, roll = 0) {
    if (Math.min(sx, sy, sz) <= 0) return;
    const key = name + mat.uuid;
    if (!batches.has(key)) batches.set(key, { name, mat, items: [] });
    dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, roll); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); batches.get(key).items.push(dummy.matrix.clone());
  }
  const shapeFor = rings => { const s = new THREE.Shape(rings[0].map(p => new THREE.Vector2(p.x, -p.z))); s.holes = rings.slice(1).map(r => new THREE.Path(r.map(p => new THREE.Vector2(p.x, -p.z)))); return s; };
  for (const v of plan.volumes) {
    const geo = geometry(new THREE.ExtrudeGeometry(shapeFor(v.rings), { depth: v.height - v.minHeight, steps: 1, bevelEnabled: false, curveSegments: 1 }));
    const o = mesh(v.id, geo, v.minHeight >= 8 ? screen : stone); o.rotation.x = -Math.PI / 2; o.position.y = v.minHeight;
    o.userData.collisionVolumeId = v.id;
    if (v.id.includes(':upper:')) {
      const cap = mesh('opto-flat-roof', geometry(new THREE.ShapeGeometry(shapeFor(v.rings))), roof); cap.rotation.x = -Math.PI / 2; cap.position.y = v.height + .012;
    }
  }
  const { cEntry: e } = plan;
  const infrastructure = { buildings: plan.volumes, barriers: [], walkSurfaces: [], replacedBuildingIds: [OPTO_BUILDING_ID] };
  function floor(name, polygon, y, mat) {
    const o = mesh(name, geometry(new THREE.ShapeGeometry(shapeFor([polygon]))), mat); o.rotation.x = -Math.PI / 2; o.position.y = y;
    infrastructure.walkSurfaces.push({ id: name, sourceId: OPTO_BUILDING_ID, polygon, surfaceY: y }); return o;
  }
  // The undercroft is deeply recessed. Its interior soffit/floor use the
  // exact same clipped void as physics; a dark finish makes that depth readable
  // even in the preview's strong ambient light. No new wall closes the opening.
  const undercroftFinish = material('#596159', .96);
  undercroftFinish.side = THREE.DoubleSide;
  for (const [i, polygon] of polygonClipping.intersection(plan.sourceFootprint, [closed(plan.parkingCut)]).entries()) {
    const rings = fromClip(polygon);
    const soffit = mesh('opto-undercroft-soffit', geometry(new THREE.ShapeGeometry(shapeFor(rings))), undercroftFinish);
    soffit.rotation.x = -Math.PI / 2; soffit.position.y = plan.parking.height - .015;
    const base = mesh('opto-undercroft-paving', geometry(new THREE.ShapeGeometry(shapeFor(rings))), dark);
    base.rotation.x = -Math.PI / 2; base.position.y = .07;
    infrastructure.walkSurfaces.push({ id: `opto-undercroft-floor-${i}`, sourceId: OPTO_BUILDING_ID, polygon: rings[0], holes: rings.slice(1), surfaceY: .07 });
  }
  const ground = plan.groundFloor;
  const entranceLocal = (source, name, mat, u, y, v, sx, sy, sz) => box(name, mat,
    source.x + source.tx * u + source.nx * v, y, source.z + source.tz * u + source.nz * v, sx, sy, sz, source.yaw);
  // These are bounded cuts in the real footprint, never an open entire floor.
  const accessPaving = [];
  for (const [i, rings] of polygonClipping.union(...plan.lowOpenings.map(r => [closed(r)])).map(fromClip).entries()) {
    const geo = new THREE.ShapeGeometry(shapeFor(rings)); geo.rotateX(-Math.PI / 2); geo.translate(0, ground.floorY, 0); accessPaving.push(geo);
    infrastructure.walkSurfaces.push({ id: `opto-c-ground-floor-${i}`, sourceId: OPTO_BUILDING_ID, polygon: rings[0], holes: rings.slice(1), surfaceY: ground.floorY });
  }
  for (const [key, source] of [['college', e], ['east', ground.east], ['rear', plan.rear]]) {
    const polygon = streetFootprint(source.x + source.nx * 1.5, source.z + source.nz * 1.5, 6.2, 3, source.yaw);
    const geo = new THREE.ShapeGeometry(shapeFor([polygon])); geo.rotateX(-Math.PI / 2); geo.translate(0, ground.floorY, 0); accessPaving.push(geo);
    infrastructure.walkSurfaces.push({ id: `opto-c-${key}-landing`, sourceId: OPTO_BUILDING_ID, polygon, surfaceY: ground.floorY });
    entranceLocal(source, 'opto-c-entrance-canopy', white, 0, 4.7, .7, 6, .34, 2.8);
    entranceLocal(source, 'opto-door-wayfinding-band', wayfinding, 0, 4.07, .20, 4.7, .40, .12);
  }
  mesh('opto-ground-access-paving', geometry(mergeGeometries(accessPaving, false)), paving);
  accessPaving.forEach(g => g.dispose());
  function openGroundDoor(source, key, halfWidth, totalWidth, height, mat = glass) {
    const panelWidth = (totalWidth - 2 * halfWidth) / 2;
    for (const side of [-1, 1]) {
      const sideU = side * (halfWidth + panelWidth / 2);
      entranceLocal(source, 'opto-c-entrance-glass', mat, sideU, .12 + height / 2, 0, panelWidth, height, .10);
      entranceLocal(source, 'opto-c-door-mullions', frameMat, side * halfWidth, .12 + height / 2, .03, .09, height, .14);
      entranceLocal(source, 'opto-open-door-leaves', openDoorGlass, side * (halfWidth + .08), .12 + height / 2, .69, .075, height - .12, 1.3);
      entranceLocal(source, 'opto-door-handles', white, side * (halfWidth - .02), 1.35, 1.12, .08, .55, .045);
      infrastructure.barriers.push({ id: `opto-c-${key}-side-${side}`, sourceId: OPTO_BUILDING_ID,
        polygon: streetFootprint(source.x + source.tx * sideU, source.z + source.tz * sideU, panelWidth, .14, source.yaw), minHeight: .12, height: height + .12, label: '报告厅入口固定侧窗' });
    }
    entranceLocal(source, 'opto-c-door-mullions', frameMat, 0, height + .18, 0, totalWidth, .12, .14);
    entranceLocal(source, 'opto-c-entrance-glass', mat, 0, (height + .24 + 4.4) / 2, 0, totalWidth, 4.4 - height - .24, .10);
  }
  openGroundDoor(e, 'college', 1.6, 4.8, 3.2);
  openGroundDoor(ground.hallDoor, 'left-hall', 1.3, 3.6, 3.1, dark);
  openGroundDoor(ground.east, 'east', 1.6, 4.8, 3.2);
  openGroundDoor(plan.rear, 'rear', 1.9, 5.8, 3.2);
  // The same clipped footprint supplies a dark soffit and a continuous ground
  // slab on both open faces, so there is no painted wall or hidden curb.
  for (const rings of polygonClipping.intersection(plan.sourceFootprint, [closed(plan.northCut)]).map(fromClip)) {
    const soffit = mesh('opto-north-passage-soffit', geometry(new THREE.ShapeGeometry(shapeFor(rings))), undercroftFinish);
    soffit.rotation.x = -Math.PI / 2; soffit.position.y = plan.northPassage.height - .015;
  }
  // Slender edge supports leave both the west approach and the north/south
  // crossing clear. Locations are a visual estimate, not a structural survey.
  for (const u of [-8.4, 8.4]) for (const v of [-2, -17]) {
    const p = plan.northPassage, x = p.x + p.tx * u + p.nx * v, z = p.z + p.tz * u + p.nz * v;
    entranceLocal(p, 'opto-north-passage-columns', stone, u, 2.25, v, .55, 4.26, .55);
    infrastructure.barriers.push({ id: `opto-north-support-${u}-${v}`, sourceId: OPTO_BUILDING_ID,
      polygon: streetFootprint(x, z, .55, .55, p.yaw), minHeight: .12, height: 4.4, label: '北翼架空通道边柱' });
  }
  entranceLocal(plan.rear, 'opto-ground-corridor-ceiling', white, 0, 4.35, -4.4, 5.76, .08, 9.1);
  for (const side of [-1, 1]) entranceLocal(plan.rear, 'opto-ground-corridor-skirt', dark, side * 2.86, .27, -4.4, .06, .3, 9.1);
  const ceilingLight = material('#f5f0da', .6); ceilingLight.emissive.set('#d9ddcf'); ceilingLight.emissiveIntensity = .65;
  for (const v of [-2.2, -6.4]) entranceLocal(plan.rear, 'opto-rear-foyer-light', ceilingLight, 0, 4.29, v, 1.5, .045, .4);
  // A short straight hall has a left-hand opening. Its closed far wall is
  // intentional: no unverified all-floor circulation is implied.
  entranceLocal(e, 'opto-ground-corridor-ceiling', white, 0, 4.35, -4.8, 4.76, .08, 9.6);
  entranceLocal(e, 'opto-ground-corridor-skirt', dark, 2.36, .27, -4.8, .06, .3, 9.5);
  entranceLocal(e, 'opto-ground-corridor-skirt', dark, -2.36, .27, -2.5, .06, .3, 4.8);
  entranceLocal(e, 'opto-door-wayfinding-band', wayfinding, 0, 2.8, -9.73, 3.2, .50, .08);
  for (const [polyIndex, polygon] of plan.polygons.entries()) for (const [ringIndex, ring] of polygon.entries()) {
    const sign = Math.sign(area(ring)) * (ringIndex ? -1 : 1);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz); if (len < .7) continue;
      const tx = dx / len, tz = dz / len, nx = dz / len * sign, nz = -dx / len * sign, yaw = -Math.atan2(tz, tx);
      const topAt = u => plan.heightAt(a.x + tx * u - nx * .03, a.z + tz * u - nz * .03);
      const put = (name, mat, u, y, offset, w, h, depth) => box(name, mat, a.x + tx * u + nx * offset, y, a.z + tz * u + nz * offset, w, h, depth, yaw);
      const n = Math.max(1, Math.ceil(len / 3.4)), step = len / n;
      for (let j = 0; j < n; j++) {
        const u = (j + .5) * step, top = topAt(u), x = a.x + tx * u, z = a.z + tz * u;
        const nearDoor = [0, -step / 2, step / 2].some(du => plan.lowOpenings.some(cut => insideRing({ x: x + tx * du, z: z + tz * du }, cut)));
        const parking = plan.parking;
        const nearParking = [0, -step / 2, step / 2].some(du => insideRing({ x: x + tx * du, z: z + tz * du }, plan.parkingCut));
        const mainPortalFace = Math.hypot(x - plan.main.x, z - plan.main.z) < 21;
        const nearMainOpening = mainPortalFace && Math.hypot(x - plan.main.x, z - plan.main.z) < 8.5;
        const stonePlinth = !ringIndex && !mainPortalFace;
        const glassCore = !ringIndex && nx < -.8 && z > parking.z - 30 && z < parking.z - 20;
        for (let y = 2.8; y < top - 1; y += 4) {
          if ((nearDoor && y < 4.8) || (nearParking && y - 1.3 < parking.height) || (nearMainOpening && y - 1.3 < plan.main.height)) continue;
          if (stonePlinth && y < 8 && !glassCore) {
            // Punched openings in the stone plinth replace the former all-glass ground floor.
            put('opto-ribbon-glass', glass, u, y, .08, .68, 1.75, .09);
            continue;
          }
          put('opto-ribbon-glass', glass, u, y, glassCore ? .65 : .08, step - .13, 2.55, glassCore ? 1.15 : .09);
          put('opto-window-head-sill', frameMat, u, y - 1.29, .17, step + .02, .12, .14);
          put('opto-window-head-sill', frameMat, u, y + 1.29, .17, step + .02, .12, .14);
        }
        const mullionBase = nearParking ? parking.height + .1 : nearMainOpening ? plan.main.height + .1 : stonePlinth && !glassCore ? 8.2 : nearDoor ? 4.5 : 1.5;
        for (const shift of [-.5, 0]) put('opto-window-mullions', frameMat, u + shift * (step - .13), (mullionBase + top - .65) / 2, .16, .055, top - .65 - mullionBase, .12);
        put('opto-parapet-coping', white, u, top + .28, .10, step + .04, .56, .48);
        if (!ringIndex) {
          // Closely spaced light fins form a screen in front of recessed glazing.
          // Inset courtyards expose the horizontal ribbon instead.
          const finCount = 5, finBase = nearParking ? parking.height : 8.25;
          for (let k = 0; k < finCount; k++) {
            if (mainPortalFace || glassCore) continue;
            const fu = u + (k - 2) * step / finCount;
            // A visible mid-height green ribbon interrupts the west screen in
            // the completed photograph, rather than every face being blank.
            if (nx < -.65 && len > 24 && top > 22 && j > n * .22 && j < n * .88) {
              put('opto-vertical-sunshade-screen', screen, fu, (finBase + 17.4) / 2, .36, .28, 17.4 - finBase, .58);
              put('opto-vertical-sunshade-screen', screen, fu, (20.2 + top) / 2, .36, .28, top - 20.2, .58);
            } else put('opto-vertical-sunshade-screen', screen, fu, (finBase + top) / 2, .36, .28, top - finBase, .58);
          }
          if (len > 18 && j % 13 >= 3 && j % 13 <= 5) put('opto-roof-vent-plants', stone, u, top + .65, -3.6, 2.5, 1.2, 3.2);
          if (len > 18 && j % 13 === 6) put('opto-roof-vent-grilles', dark, u, top + .27, -3.6, 1.2, .45, 2.8);
        }
      }
    }
  }
  // Roof terrace edges follow each clipped wing, including the exposed step
  // where the south connector drops. Insets are checked against the true roof
  // polygon so thin or angled wings do not grow equipment outside their shell.
  for (const zone of plan.zones) for (const polygon of zone.polygons) for (const [ri, ring] of polygon.entries()) {
    const sign = Math.sign(area(ring)) * (ri ? -1 : 1);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1) continue;
      const tx = dx / len, tz = dz / len, nx = dz / len * sign, nz = -dx / len * sign, yaw = -Math.atan2(tz, tx);
      // Low parapet walls are visible from above; the old model only had a flat cap.
      box('opto-roof-parapet-walls', screen, (a.x + b.x) / 2 - nx * .27, zone.top + .25, (a.z + b.z) / 2 - nz * .27, len, .50, .32, yaw);
      if (len < 12) continue;
      const n = Math.ceil(len / 8), step = len / n;
      for (let j = 0; j < n; j++) {
        const x = a.x + tx * (j + .5) * step - nx * 2, z = a.z + tz * (j + .5) * step - nz * 2;
        const pad = streetFootprint(x, z, step - .1, 1.25, yaw);
        if (pad.every(p => insidePolygon(p, polygon))) box('opto-roof-maintenance-strips', dark, x, zone.top + .045, z, step - .1, .035, 1.25, yaw);
      }
    }
  }
  // Main entrance: broad canopy and branching columns are directly visible in
  // the official completed photograph. Its placement is source-edge aligned.
  const a = projected({ longitude: 114.428671, latitude: 30.5092256 }, options.frame, options.geoToLocal), b = projected({ longitude: 114.4285427, latitude: 30.5095336 }, options.frame, options.geoToLocal);
  const l = Math.hypot(b.x - a.x, b.z - a.z), tx = (b.x - a.x) / l, tz = (b.z - a.z) / l, nx = tz, nz = -tx, yaw = -Math.atan2(tz, tx), m = plan.main;
  const entrancePoint = (u, v, y = 0) => ({ x: m.x + tx * u + nx * v, y, z: m.z + tz * u + nz * v });
  const mainBox = (name, mat, u, y, v, sx, sy, sz) => { const p = entrancePoint(u, v); box(name, mat, p.x, y, p.z, sx, sy, sz, yaw); };
  // Select the west-facing side; source edge order runs northward here.
  const out = nx < 0 ? 1 : -1;
  mainBox('opto-main-wide-canopy', white, 0, 11.9, 8 * out, l - 2, .72, 17);
  // The close photograph shows an underside grid, not a featureless white lid.
  for (let u = -l / 2 + 1.3; u < l / 2 - 1; u += 1.5) mainBox('opto-window-head-sill', frameMat, u, 11.51, 8 * out, .035, .055, 16.8);
  for (let v = .1; v < 16.5; v += 1.35) mainBox('opto-window-head-sill', frameMat, 0, 11.51, v * out, l - 2.1, .055, .035);
  const beam = (name, pa, pb, width, mat) => {
    const start = new THREE.Vector3(pa.x, pa.y, pa.z), end = new THREE.Vector3(pb.x, pb.y, pb.z), delta = end.clone().sub(start);
    const key = name + mat.uuid; if (!batches.has(key)) batches.set(key, { name, mat, items: [] });
    dummy.position.copy(start).add(end).multiplyScalar(.5); dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()); dummy.scale.set(width, delta.length(), width); dummy.updateMatrix(); batches.get(key).items.push(dummy.matrix.clone());
  };
  for (const u of [-l * .29, l * .29]) for (const v of [5 * out, 13 * out]) {
    const p = entrancePoint(u, v, .1), fork = entrancePoint(u, v, 7.2); beam('opto-tree-column-stems', p, fork, .48, white);
    for (const [du, dv] of [[-3.5, -1.5 * out], [3.5, 1.5 * out]]) beam('opto-tree-column-branches', fork, entrancePoint(u + du, v + dv, 11.5), .34, white);
    infrastructure.barriers.push({ id: `opto-main-column-${u}-${v}`, sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(p.x, p.z, .44, .44, yaw), minHeight: 0, height: 7.2, label: '光电入口雨棚柱' });
  }
  for (let j = 0; j < 18; j++) {
    const v = (4.3 + j * .31) * out, p = entrancePoint(0, v), height = .12 + (18 - j) * .15;
    mainBox('opto-main-stair-treads', paving, 0, height / 2, v, 12, height, .34);
    infrastructure.walkSurfaces.push({ id: `opto-main-step-${j}`, sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(p.x, p.z, 12, .34, yaw), surfaceY: height });
  }
  const mainLanding = entrancePoint(0, 2.05 * out);
  mainBox('opto-main-upper-landing-base', paving, 0, 1.41, 2.05 * out, 12, 2.82, 4.2);
  infrastructure.walkSurfaces.push({ id: 'opto-main-upper-landing', sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(mainLanding.x, mainLanding.z, 12, 4.2, yaw), surfaceY: 2.82 });
  const vestibule = entrancePoint(0, -4.25 * out);
  mainBox('opto-main-upper-landing-base', paving, 0, 1.41, -4.25 * out, 15.8, 2.82, 8.5);
  infrastructure.walkSurfaces.push({ id: 'opto-main-vestibule-floor', sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(vestibule.x, vestibule.z, 15.8, 8.5, yaw), surfaceY: 2.82 });
  // Main doors keep the photographed tall glazed entrance, split around a
  // 4.8 m clear opening. The raised lobby floor now continues past the leaves.
  for (const side of [-1, 1]) {
    mainBox('opto-ribbon-glass', glass, side * 5.15, 6.55, -4.35 * out, 5.3, 7.4, .14);
    mainBox('opto-window-mullions', frameMat, side * 2.45, 4.48, -4.2 * out, .1, 3.3, .14);
    mainBox('opto-open-door-leaves', openDoorGlass, side * 2.48, 4.42, -3.2 * out, .08, 3.18, 2.25);
    mainBox('opto-door-handles', white, side * 2.39, 4.14, -2.3 * out, .09, .58, .05);
    const p = entrancePoint(side * 5.15, -4.35 * out);
    infrastructure.barriers.push({ id: `opto-main-door-side-${side}`, sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(p.x, p.z, 5.3, .2, yaw), minHeight: 2.82, height: 10.4, label: '主入口侧窗' });
  }
  mainBox('opto-ribbon-glass', glass, 0, 8.3, -4.35 * out, 4.9, 4.1, .14);
  for (let u = -7.8; u < 8; u += 1.3) {
    if (Math.abs(u) < 2.55) continue;
    mainBox('opto-window-mullions', frameMat, u, 6.55, -4.2 * out, .07, 7.4, .12);
  }
  for (const y of [7.7, 10.2]) mainBox('opto-window-head-sill', frameMat, 0, y, -4.2 * out, 15.7, .08, .12);
  mainBox('opto-window-head-sill', frameMat, 0, 6.16, -4.2 * out, 5, .12, .14);
  // The raised central entrance is an ordinary building lobby, not C118.
  for (const side of [-1, 1]) {
    const u = side * 6.45;
    beam('opto-main-stair-cheek-walls', entrancePoint(u, 3.7 * out, 3.1), entrancePoint(u, 10.2 * out, .75), .76, stone);
    beam('opto-main-stair-handrails', entrancePoint(side * 5.65, 3.7 * out, 3.82), entrancePoint(side * 5.65, 10.2 * out, 1.48), .055, frameMat);
    for (let j = 0; j < 5; j++) {
      const v = (4 + j * 1.4) * out, y = 2.82 - j * .505;
      beam('opto-main-stair-handrails', entrancePoint(side * 5.65, v, y), entrancePoint(side * 5.65, v, y + .95), .045, frameMat);
    }
    const cheek = entrancePoint(u, 6.95 * out);
    infrastructure.barriers.push({ id: `opto-main-stair-side-${side}`, sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(cheek.x, cheek.z, .75, 6.8, yaw), minHeight: 0, height: 3.4 });
  }
  // The aerial shows a long tapering island between two arrival lanes, not a
  // small rectangular lawn laid across an otherwise empty plaza.
  const courtyard = entrancePoint(0, 36 * out);
  floor('opto-courtyard-paved-arrival', streetFootprint(courtyard.x, courtyard.z, 36, 62, yaw), .07, paving);
  const islandLocal = [[-3, 19], [3, 19], [5, 22], [8.7, 58], [8, 61], [-8, 61], [-8.7, 58], [-5, 22]];
  const island = islandLocal.map(([u, v]) => entrancePoint(u, v * out));
  const turf = mesh('opto-courtyard-central-lawn', geometry(new THREE.ShapeGeometry(shapeFor([island]))), grass); turf.rotation.x = -Math.PI / 2; turf.position.y = .16;
  for (let i = 0; i < island.length; i++) {
    const a = island[i], b = island[(i + 1) % island.length], dx = b.x - a.x, dz = b.z - a.z;
    box('opto-courtyard-curbs', stone, (a.x + b.x) / 2, .14, (a.z + b.z) / 2, Math.hypot(dx, dz), .16, .18, -Math.atan2(dz, dx));
  }
  for (const side of [-1, 1]) for (let v = 23; v < 63; v += 7) mainBox('opto-courtyard-lane-markings', white, side * 12.8, .085, v * out, .12, .012, 3.8);
  // The college atrium is the SOUTH courtyard, distinct from the national
  // research centre portal. Public ground photos and an orthophoto repost show
  // a grid of low glass pyramids; source-hole proportions locate the roof.
  // This is a thin canopy layer, not invented solid rooms inside the courtyard.
  const cs = ground.collegeSteps;
  for (let j = 0; j < 12; j++) {
    const offset = 3.8 + j * .28, height = .12 + (12 - j) * .15;
    entranceLocal(cs, 'opto-college-stair-treads', paving, 0, height / 2, offset, 12, height, .3);
    infrastructure.walkSurfaces.push({ id: `opto-college-step-${j}`, sourceId: OPTO_BUILDING_ID,
      polygon: streetFootprint(cs.x + cs.nx * offset, cs.z + cs.nz * offset, 12, .3, cs.yaw), surfaceY: height });
  }
  entranceLocal(cs, 'opto-college-stair-treads', paving, 0, .96, 1.9, 12, 1.92, 3.9);
  infrastructure.walkSurfaces.push({ id: 'opto-college-upper-landing', sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(cs.x + cs.nx * 1.9, cs.z + cs.nz * 1.9, 12, 3.9, cs.yaw), surfaceY: 1.92 });
  entranceLocal(cs, 'opto-college-canopy-frame', white, 0, 8.6, 2.3, 21, .45, 6);
  entranceLocal(cs, 'opto-college-name-band', wayfinding, 0, 8.9, 1.2, 20, 1.2, .18);
  for (const side of [-1, 1]) {
    const foot = { x: cs.x + cs.tx * side * 8.8 + cs.nx * 4, z: cs.z + cs.tz * side * 8.8 + cs.nz * 4, y: .12 };
    const top = { x: cs.x + cs.tx * side * 8.8 + cs.nx * 1.8, z: cs.z + cs.tz * side * 8.8 + cs.nz * 1.8, y: 8.5 };
    beam('opto-college-canopy-braces', foot, top, .26, white);
  }
  const skylight = ground.skylight;
  if (skylight?.length === 4) {
    const leftTop = skylight[3], leftBottom = skylight[2], rightTop = skylight[0], rightBottom = skylight[1];
    const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    const point = (u, v) => lerp(lerp(leftTop, leftBottom, v), lerp(rightTop, rightBottom, v), u);
    const positions = [];
    for (let col = 0; col < 5; col++) for (let row = 0; row < (col === 4 ? 10 : 9); row++) {
      const count = col === 4 ? 10 : 9;
      const u0 = (col + .06) / 5, u1 = (col + .94) / 5, v0 = (row + .06) / count, v1 = (row + .94) / count;
      const corners = [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)], mid = point((col + .5) / 5, (row + .5) / count);
      const apex = { ...mid, y: 6.0 };
      for (let i = 0; i < 4; i++) {
        const a = { ...corners[i], y: 4.85 }, b = { ...corners[(i + 1) % 4], y: 4.85 };
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, apex.x, apex.y, apex.z);
        beam('opto-college-pyramid-frames', a, apex, .065, white);
      }
    }
    const geo = geometry(new THREE.BufferGeometry()); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.computeVertexNormals();
    const glazing = mesh('opto-college-pyramid-skylights', geo, openDoorGlass); glazing.castShadow = false;
    glazing.userData.provenance = 'Public college atrium photographs and author-reported 46 pyramids; per-column placement and roof elevation are schematic, not a survey';
  }
  // Only text generated from public building identity is rendered; no copied
  // institutional logo/font/image. The added C118 labels are activity guides,
  // explicitly distinct from surveyed room-direction signage.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 1536, 160); ctx.font = 'bold 100px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#5288a4'; ctx.fillText('武汉光电国家研究中心', 768, 82);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const signMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }); mats.add(signMat);
      const sign = mesh('opto-main-name-sign', geometry(new THREE.PlaneGeometry(28, 2.9)), signMat), p = entrancePoint(0, 16.55 * out, 13.55);
      sign.position.set(p.x, p.y, p.z); sign.rotation.y = Math.atan2(nx * out, nz * out);
      group.userData.labelContent = '武汉光电国家研究中心';
      const signSpecs = [
        ['college', ground.collegeSteps, -1.3, 8.9, 18, 1.0, '光学与电子信息学院'],
        ['college-route', e, -.29, 4.07, 4.5, .32, '进入后直走 · 左手 C118'],
        ['left-guide', e, 9.67, 2.8, 3.0, .36, '← C118 报告厅'],
        ['left-hall', ground.hallDoor, -.16, 3.65, 3.2, .32, 'C118 报告厅'],
        ['east', ground.east, -.29, 4.07, 4.5, .32, 'C118 报告厅 · 东侧入口'],
        ['rear', plan.rear, -.29, 4.07, 4.5, .32, '光电大楼 · 北侧入口'],
      ];
      for (const [key, source, offset, y, width, height, text] of signSpecs) {
        const board = document.createElement('canvas'); board.width = 1280; board.height = 150;
        const paint = board.getContext('2d'); if (!paint) continue;
        paint.font = '600 94px sans-serif'; paint.textAlign = 'center'; paint.textBaseline = 'middle'; paint.fillStyle = '#effff4';
        paint.fillText(text, 640, 77);
        const map = new THREE.CanvasTexture(board); map.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide }); mats.add(mat);
        const label = mesh(`opto-${key}-interior-guide`, geometry(new THREE.PlaneGeometry(width, height)), mat);
        label.position.set(source.x - source.nx * offset, y, source.z - source.nz * offset); label.rotation.y = Math.atan2(source.nx, source.nz);
        label.userData.signPurpose = 'user-confirmed-route-game-wayfinding-not-surveyed-signage';
      }
    }
  }
  for (const { name, mat, items } of batches.values()) {
    const o = new THREE.InstancedMesh(boxGeo, mat, items.length); o.name = name; items.forEach((m, i) => o.setMatrixAt(i, m)); o.instanceMatrix.needsUpdate = true; o.computeBoundingBox(); o.computeBoundingSphere(); o.castShadow = true; o.receiveShadow = true; o.renderOrder = 204; o.userData = { ...group.userData, component: name, instanceCount: items.length }; group.add(o);
  }
  const outsidePose = source => ({ x: source.x + source.nx * 3, y: .12, z: source.z + source.nz * 3, yaw: Math.atan2(-source.nx, -source.nz), pitch: 0 });
  const entry = { id: 'opto-c118', name: 'C118报告厅', label: '学院门 · 直走后左转至 C118',
    ...outsidePose(e), yaw: Math.atan2(e.nx, e.nz), radius: 8, evidenceStatus: e.status, coordinate: { ...OPTO_ACCESS.c118 } };
  const makeInteriorEntry = (source, id, halfWidth, entranceName, exterior) => {
    const center = { x: source.x, z: source.z }, normal = { x: source.nx, z: source.nz };
    return { id, name: 'C118报告厅', label: entranceName, workId: 'opto-c118', url: `./c118.html?view=${source === ground.hallDoor ? 'westEntry' : 'eastEntry'}`,
      x: center.x - normal.x * .65, y: .12, z: center.z - normal.z * .65, yaw: Math.atan2(normal.x, normal.z), radius: 2,
      evidenceStatus: source.status, doorGate: { center, normal, halfWidth, frontDepth: 1.3, backDepth: 1.7 },
      returnPose: outsidePose(exterior),
      approach: { ...outsidePose(exterior), yaw: Math.atan2(exterior.nx, exterior.nz) },
    };
  };
  const entries = [makeInteriorEntry(ground.hallDoor, 'opto-c118-left-hall', 1.3, '左手门 · C118 报告厅', e), makeInteriorEntry(ground.east, 'opto-c118-east', 1.6, '东侧门 · C118 报告厅', ground.east)];
  entries[0].returnPose = { x: ground.hallDoor.x + ground.hallDoor.nx * 2.6, y: .12, z: ground.hallDoor.z + ground.hallDoor.nz * 2.6, yaw: Math.atan2(-ground.hallDoor.nx, -ground.hallDoor.nz), pitch: 0 };
  entries[0].approachRoute = [entries[0].approach, { ...ground.turn, y: .12 }, { x: ground.hallDoor.x - ground.hallDoor.nx * 1.3, z: ground.hallDoor.z - ground.hallDoor.nz * 1.3, y: .12 }];
  entries[0].accessPath = [entries[0].approach, { x: e.x - e.nx * 1.2, y: .12, z: e.z - e.nz * 1.2 }, ...entries[0].approachRoute.slice(1)];
  entries[1].approachRoute = [entries[1].approach, { x: ground.east.x - ground.east.nx * 1.3, z: ground.east.z - ground.east.nz * 1.3, y: .12 }];
  entries[1].accessPath = entries[1].approachRoute;
  const northStart = { x: plan.northPassage.x + plan.northPassage.nx * 12, z: plan.northPassage.z + plan.northPassage.nz * 12, y: .14,
    yaw: Math.atan2(plan.northPassage.nx, plan.northPassage.nz), pitch: -.05 };
  const rearStart = { x: 650, z: 576, y: .14, yaw: Math.atan2(650 - plan.rear.x, 576 - plan.rear.z), pitch: -.04 };
  const viewpoints = { exterior: { x: m.x + nx * out * 92, z: m.z + nz * out * 92, y: 2, yaw: Math.atan2(nx * out, nz * out), pitch: -.16 },
    northPassage: northStart, rearEntrance: rearStart,
    c118: { ...entry, y: 1.7, pitch: -.08 }, collegeEntrance: { ...entry, y: 1.7, pitch: -.08 },
    east: { ...entries[1].approach, y: 1.7, pitch: -.08 }, eastEntrance: { ...entries[1].approach, y: 1.7, pitch: -.08 } };
  // Hide entire instanced detail batches before both color and shadow passes.
  // The source solids, roof silhouette and broad glazing remain visible. Use
  // distance to the nearest point of the 278 m-long building, not its centre.
  const fineNames = new Set(['opto-window-head-sill', 'opto-window-mullions', 'opto-vertical-sunshade-screen', 'opto-roof-vent-plants', 'opto-roof-vent-grilles', 'opto-roof-maintenance-strips', 'opto-main-stair-handrails', 'opto-college-pyramid-frames']);
  const fineMeshes = group.children.filter(o => fineNames.has(o.name));
  const cameraPoint = new THREE.Vector3(), lodBounds = plan.bounds;
  let fineVisible = true;
  function update(camera, { detailDistanceScale = 1 } = {}) {
    let visible = true;
    if (camera?.position) {
      if (typeof camera.getWorldPosition === 'function') camera.getWorldPosition(cameraPoint);
      else cameraPoint.copy(camera.position);
      if ([cameraPoint.x, cameraPoint.y, cameraPoint.z].every(Number.isFinite)) {
        const dx = Math.max(lodBounds.minX - cameraPoint.x, 0, cameraPoint.x - lodBounds.maxX);
        const dy = Math.max(-cameraPoint.y, 0, cameraPoint.y - OPTO_BUILDING_EVIDENCE.height);
        const dz = Math.max(lodBounds.minZ - cameraPoint.z, 0, cameraPoint.z - lodBounds.maxZ);
        const scale = Number.isFinite(detailDistanceScale) ? Math.max(.35, Math.min(1.5, detailDistanceScale)) : 1;
        // Hysteresis keeps the many thin rods from flickering at one boundary.
        const cutoff = (fineVisible ? 380 : 310) * scale;
        visible = dx * dx + dy * dy + dz * dz <= cutoff * cutoff;
      }
    }
    if (visible === fineVisible) return false;
    fineVisible = visible;
    for (const mesh of fineMeshes) mesh.visible = visible;
    return true;
  }
  return { group, infrastructure, entry, entries, viewpoints, plan, update, dispose() { const textures = new Set(); mats.forEach(m => { if (m.map) textures.add(m.map); m.dispose(); }); textures.forEach(t => t.dispose()); geos.forEach(g => g.dispose()); group.removeFromParent(); } };
}
