import polygonClipping from 'polygon-clipping';
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
  uncertainty: 'OSM轮廓非测绘成果；窗格、分区高度、南翼中段退台、设备位置、架空洞口和入口坐标均为照片比例估计。C区次入口方位尚无可配准平面图。',
  c118Evidence: 'https://wnlo.hust.edu.cn/info/1374/4231.htm',
});

// Main portal is aligned to the source courtyard's back edge. The C118 access
// point remains explicitly provisional until a ground-floor plan is available.
export const OPTO_ACCESS = Object.freeze({
  main: Object.freeze({ longitude: 114.42860685, latitude: 30.5093796 }),
  c118: Object.freeze({ longitude: 114.428111, latitude: 30.508983 }),
  c118Status: 'display-estimate-unverified-secondary-entrance',
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
  const cEntry = { ...nearestEdge(projected(OPTO_ACCESS.c118, frame, geoToLocal)), width: 7.2, height: 4.4, depth: 8.6, status: OPTO_ACCESS.c118Status };
  cEntry.yaw = -Math.atan2(cEntry.tz, cEntry.tx);
  const entranceCut = streetFootprint(cEntry.x - cEntry.nx * 4.2, cEntry.z - cEntry.nz * 4.2, cEntry.width, 9, cEntry.yaw);
  // This opening belongs to the long west face, not to the oblique C door.
  // The measured source edge defines its yaw; photo proportions define its size.
  const parking = { ...nearestEdge(projected({ longitude: 114.4277934, latitude: 30.509777 }, frame, geoToLocal)), width: 25.8, depth: 28, height: 10.4 };
  parking.yaw = -Math.atan2(parking.tz, parking.tx);
  const parkingCut = streetFootprint(parking.x - parking.nx * 12, parking.z - parking.nz * 12, parking.width, parking.depth, parking.yaw);
  const main = { ...nearestEdge(projected(OPTO_ACCESS.main, frame, geoToLocal)), width: 16, depth: 9.2, height: 10.4 };
  main.yaw = -Math.atan2(main.tz, main.tx);
  const mainCut = streetFootprint(main.x - main.nx * 4, main.z - main.nz * 4, main.width, main.depth, main.yaw);
  const cuts = [[closed(entranceCut)], [closed(parkingCut)], [closed(mainCut)]];
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
  polygonClipping.intersection(footprint, [closed(entranceCut)]).forEach((p, i) => volumes.push({ id: `${OPTO_BUILDING_ID}:entry-lintel:${i}`, sourceId: OPTO_BUILDING_ID, rings: fromClip(p), minHeight: cEntry.height, height: 8.2 }));
  return { polygons, bounds, volumes, zones, heightAt, cEntry, parking, parkingCut, mainCut, main, sourceFootprint: footprint };
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
  const doorLocal = (name, mat, u, y, v, sx, sy, sz) => box(name, mat, e.x + e.tx * u + e.nx * v, y, e.z + e.tz * u + e.nz * v, sx, sy, sz, e.yaw);
  floor('opto-c-secondary-landing', streetFootprint(e.x + e.nx * 1.5, e.z + e.nz * 1.5, 11.4, 3, e.yaw), .12, paving);
  floor('opto-c-secondary-vestibule-floor', streetFootprint(e.x - e.nx * 4.3, e.z - e.nz * 4.3, 7.2, 8.6, e.yaw), .12, paving);
  doorLocal('opto-c-entrance-canopy', white, 0, 4.7, .7, 9.2, .34, 3.4);
  for (const s of [-1, 1]) doorLocal('opto-c-entrance-jambs', white, s * 3.72, 2.2, -.06, .28, 4.4, .7);
  // Open double doors: keep glazed side panels, but leave 3.2 m of real clear
  // passage. The old full-width glass/back collider made this a dead-end niche.
  for (const side of [-1, 1]) {
    doorLocal('opto-c-entrance-glass', glass, side * 2.57, 2.05, -4.6, 1.75, 4.05, .1);
    doorLocal('opto-c-door-mullions', frameMat, side * 1.64, 1.66, -4.53, .09, 3.1, .14);
    doorLocal('opto-open-door-leaves', openDoorGlass, side * 1.68, 1.64, -3.86, .075, 3, 1.48);
    doorLocal('opto-door-handles', white, side * 1.60, 1.35, -3.28, .08, .55, .045);
    const panel = streetFootprint(e.x + e.tx * side * 2.57 - e.nx * 4.6, e.z + e.tz * side * 2.57 - e.nz * 4.6, 1.75, .14, e.yaw);
    infrastructure.barriers.push({ id: `opto-c-door-side-${side}`, sourceId: OPTO_BUILDING_ID, polygon: panel, minHeight: .12, height: 4.08, label: '次入口侧窗' });
  }
  doorLocal('opto-c-entrance-glass', glass, 0, 3.72, -4.6, 3.3, .72, .1);
  doorLocal('opto-c-door-mullions', frameMat, 0, 3.32, -4.53, 3.38, .1, .14);
  doorLocal('opto-door-wayfinding-band', wayfinding, 0, 4.07, -4.48, 3.8, .34, .09);
  // This short lobby is a playable transition, not a claimed surveyed C118
  // corridor. Its inner marker hands off to the existing auditorium runtime.
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
        const nearDoor = Math.abs((x - e.x) * e.tx + (z - e.z) * e.tz) < 4.4 && Math.abs((x - e.x) * e.nx + (z - e.z) * e.nz) < 1;
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
        const mullionBase = nearParking ? parking.height + .1 : nearMainOpening ? plan.main.height + .1 : nearDoor ? 4.5 : stonePlinth && !glassCore ? 8.2 : 1.5;
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
  mainBox('opto-door-wayfinding-band', wayfinding, 0, 6.44, -4.1 * out, 6.8, .48, .12);
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
      for (const [key, source, offset, y, width, height] of [['main', plan.main, 4.02, 6.44, 6.4, .43], ['secondary', e, 4.39, 4.07, 3.65, .29]]) {
        const board = document.createElement('canvas'); board.width = 1280; board.height = 150;
        const paint = board.getContext('2d'); if (!paint) continue;
        paint.font = '600 94px sans-serif'; paint.textAlign = 'center'; paint.textBaseline = 'middle'; paint.fillStyle = '#effff4';
        paint.fillText('报告厅导览 · C118', 640, 77);
        const map = new THREE.CanvasTexture(board); map.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide }); mats.add(mat);
        const label = mesh(`opto-${key}-interior-guide`, geometry(new THREE.PlaneGeometry(width, height)), mat);
        label.position.set(source.x - source.nx * offset, y, source.z - source.nz * offset); label.rotation.y = Math.atan2(source.nx, source.nz);
        label.userData.signPurpose = 'activity-wayfinding-not-surveyed-building-signage';
      }
    }
  }
  for (const { name, mat, items } of batches.values()) {
    const o = new THREE.InstancedMesh(boxGeo, mat, items.length); o.name = name; items.forEach((m, i) => o.setMatrixAt(i, m)); o.instanceMatrix.needsUpdate = true; o.computeBoundingBox(); o.computeBoundingSphere(); o.castShadow = true; o.receiveShadow = true; o.renderOrder = 204; o.userData = { ...group.userData, component: name, instanceCount: items.length }; group.add(o);
  }
  const entry = { id: 'opto-c118', name: 'C118报告厅', label: '光电信息大楼 · C118 报告厅', x: e.x + e.nx * 2.9, y: .12, z: e.z + e.nz * 2.9, yaw: Math.atan2(e.nx, e.nz), radius: 8, evidenceStatus: e.status, coordinate: { ...OPTO_ACCESS.c118 } };
  const makeInteriorEntry = (source, id, offset, floorY, halfWidth, entranceName) => {
    const center = { x: source.x - source.nx * offset, z: source.z - source.nz * offset };
    const normal = { x: source.nx, z: source.nz };
    return { id, name: 'C118报告厅', label: `${entranceName} · 报告厅导览 C118`, workId: 'opto-c118', url: './c118.html',
      x: center.x - normal.x * .65, y: floorY, z: center.z - normal.z * .65, yaw: Math.atan2(normal.x, normal.z), radius: 2,
      evidenceStatus: source === e ? e.status : 'photo-aligned-main-entrance-interior-route-estimated',
      doorGate: { center, normal, halfWidth, frontDepth: 2.4, backDepth: 2.4 },
      returnPose: { x: center.x + normal.x * 3, y: floorY, z: center.z + normal.z * 3, yaw: Math.atan2(-normal.x, -normal.z), pitch: 0 },
      // The secondary footpath hugs this wall; a generic 12 m setback would
      // place its tour start in the watercourse beyond the path.
      approach: { x: source.x + normal.x * (source === e ? 3 : 12), y: .14, z: source.z + normal.z * (source === e ? 3 : 12), yaw: Math.atan2(normal.x, normal.z) },
    };
  };
  const entries = [makeInteriorEntry(plan.main, 'opto-c118-main', 4.35, 2.82, 2.4, '主入口'), makeInteriorEntry(e, 'opto-c118', 4.6, .12, 1.6, '次入口')];
  const viewpoints = { exterior: { x: m.x + nx * out * 92, z: m.z + nz * out * 92, y: 2, yaw: Math.atan2(nx * out, nz * out), pitch: -.16 }, c118: { x: e.x + e.nx * 15, z: e.z + e.nz * 15, y: 1.7, yaw: Math.atan2(e.nx, e.nz), pitch: -.08 } };
  // Hide entire instanced detail batches before both color and shadow passes.
  // The source solids, roof silhouette and broad glazing remain visible. Use
  // distance to the nearest point of the 278 m-long building, not its centre.
  const fineNames = new Set(['opto-window-head-sill', 'opto-window-mullions', 'opto-vertical-sunshade-screen', 'opto-roof-vent-plants', 'opto-roof-vent-grilles', 'opto-roof-maintenance-strips', 'opto-main-stair-handrails']);
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
