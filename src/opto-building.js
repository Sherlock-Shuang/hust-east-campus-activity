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
  observed: '连续W形院落，浅灰白竖向金属遮阳屏、蓝绿色玻璃横窗，局部架空，主入口有宽雨棚与白色树杈形斜撑柱、台阶。',
  uncertainty: 'OSM轮廓非测绘成果；窗格、楼层细分、南端退低、设备位置、架空洞口和入口坐标均为照片比例估计。C区次入口方位尚无可配准平面图。',
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
const projected = (c, frame, fn) => fn({ ...c, height: 0, coordinateSystem: 'EPSG:4326' }, frame);

/** A pure geometry plan shared by the renderer and collision integration. */
export function planOptoBuilding(record, { frame, geoToLocal } = {}) {
  if (record?.id !== OPTO_BUILDING_ID) return null;
  if (!record.shapes?.length || typeof geoToLocal !== 'function') throw new TypeError('Optoelectronics requires the source shapes and explicit WGS84 projection.');
  const polygons = record.shapes.map(s => [points(s), ...s.holes.map(points)]);
  const all = polygons.flat(2), xs = all.map(p => p.x), zs = all.map(p => p.z);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  const footprint = polygons.map(p => p.map(closed));
  const southBreak = projected({ longitude: 114.4286, latitude: 30.50869 }, frame, geoToLocal).z;
  const rectangle = (x0, z0, x1, z1) => [[[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]]];
  const c = projected(OPTO_ACCESS.c118, frame, geoToLocal);
  let closest;
  for (const p of polygons) for (let i = 0; i < p[0].length; i++) {
    const a = p[0][i], b = p[0][(i + 1) % p[0].length], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    if (l < .5) continue;
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / (l * l)));
    const x = a.x + dx * t, z = a.z + dz * t, distance = Math.hypot(c.x - x, c.z - z);
    if (!closest || distance < closest.distance) { const sign = Math.sign(area(p[0])); closest = { x, z, distance, tx: dx / l, tz: dz / l, nx: dz / l * sign, nz: -dx / l * sign }; }
  }
  const cEntry = { ...closest, width: 7.2, height: 4.4, depth: 6, status: OPTO_ACCESS.c118Status };
  cEntry.yaw = -Math.atan2(cEntry.tz, cEntry.tx);
  const entranceCut = streetFootprint(cEntry.x - cEntry.nx * 2.7, cEntry.z - cEntry.nz * 2.7, cEntry.width, cEntry.depth + 1, cEntry.yaw);
  const parking = projected({ longitude: 114.4277934, latitude: 30.509777 }, frame, geoToLocal);
  const parkingCut = streetFootprint(parking.x + 6.4, parking.z, 21.6, 16, cEntry.yaw);
  const cuts = [[closed(entranceCut)], [closed(parkingCut)]];
  const volumes = [], north = rectangle(bounds.minX - 1, bounds.minZ - 1, bounds.maxX + 1, southBreak), south = rectangle(bounds.minX - 1, southBreak, bounds.maxX + 1, bounds.maxZ + 1);
  for (const [zone, mask, top] of [['main', north, 32.4], ['south-low', south, 23.6]]) {
    const region = polygonClipping.intersection(footprint, mask);
    const lower = polygonClipping.difference(region, ...cuts);
    lower.forEach((p, i) => volumes.push({ id: `${OPTO_BUILDING_ID}:${zone}:ground:${i}`, sourceId: OPTO_BUILDING_ID, rings: fromClip(p), minHeight: .08, height: 8.2 }));
    region.forEach((p, i) => volumes.push({ id: `${OPTO_BUILDING_ID}:${zone}:upper:${i}`, sourceId: OPTO_BUILDING_ID, rings: fromClip(p), minHeight: 8.2, height: top }));
  }
  // The high opening is an observed undercroft; the secondary door only has
  // headroom to 4.4 m. Both voids are removed from the actual collision solids.
  polygonClipping.intersection(footprint, [closed(entranceCut)]).forEach((p, i) => volumes.push({ id: `${OPTO_BUILDING_ID}:entry-lintel:${i}`, sourceId: OPTO_BUILDING_ID, rings: fromClip(p), minHeight: cEntry.height, height: 8.2 }));
  return { polygons, bounds, volumes, cEntry, parking, southBreak, main: projected(OPTO_ACCESS.main, frame, geoToLocal), sourceFootprint: footprint };
}

export function createOptoBuilding(THREE, record, options = {}) {
  const plan = planOptoBuilding(record, options);
  if (!plan) return null;
  const group = new THREE.Group(); group.name = '光电信息大楼 · W形庭院与遮阳立面';
  group.userData = { component: 'opto-building', featureId: OPTO_BUILDING_ID, sourceId: OPTO_BUILDING_ID, category: 'building', ...OPTO_BUILDING_EVIDENCE, dimensions: 'photo-proportions-and-official-approximate-height', sourceFootprintPreserved: true };
  const geos = new Set(), mats = new Set(), batches = new Map(), dummy = new THREE.Object3D();
  const geometry = g => { geos.add(g); return g; };
  const material = (color, roughness = .82, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); mats.add(m); return m; };
  const stone = material('#a8aaa7'), screen = material('#d7dbd8', .63, .3), glass = material('#326b70', .32, .28), frameMat = material('#435354', .65, .25), roof = material('#b9b9ae'), dark = material('#67736f'), paving = material('#aeaca0'), white = material('#e3e7df', .6, .15), grass = material('#728b55');
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
  const doorLocal = (name, mat, u, y, v, sx, sy, sz) => box(name, mat, e.x + e.tx * u + e.nx * v, y, e.z + e.tz * u + e.nz * v, sx, sy, sz, e.yaw);
  floor('opto-c-secondary-landing', streetFootprint(e.x + e.nx * 1.5, e.z + e.nz * 1.5, 11.4, 3, e.yaw), .12, paving);
  floor('opto-c-secondary-vestibule-floor', streetFootprint(e.x - e.nx * 2.35, e.z - e.nz * 2.35, 7.2, 4.7, e.yaw), .12, paving);
  doorLocal('opto-c-entrance-canopy', white, 0, 4.7, .7, 9.2, .34, 3.4);
  for (const s of [-1, 1]) doorLocal('opto-c-entrance-jambs', white, s * 3.72, 2.2, -.06, .28, 4.4, .7);
  doorLocal('opto-c-entrance-glass', glass, 0, 2.05, -4.6, 6.9, 4.05, .1);
  for (const x of [-3.4, -1.7, 0, 1.7, 3.4]) doorLocal('opto-c-door-mullions', frameMat, x, 2.05, -4.53, .055, 4.05, .14);
  // A short transparent vestibule is explicitly an access proxy, not an
  // invented floorplan extending into the real C118 auditorium.
  const back = streetFootprint(e.x - e.nx * 4.7, e.z - e.nz * 4.7, 7, .24, e.yaw);
  infrastructure.barriers.push({ id: 'opto-c-proxy-vestibule-back', sourceId: OPTO_BUILDING_ID, polygon: back, minHeight: 0, height: 4.4, label: 'C区次入口玻璃' });
  for (const [polyIndex, polygon] of plan.polygons.entries()) for (const [ringIndex, ring] of polygon.entries()) {
    const sign = Math.sign(area(ring)) * (ringIndex ? -1 : 1);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz); if (len < .7) continue;
      const tx = dx / len, tz = dz / len, nx = dz / len * sign, nz = -dx / len * sign, yaw = -Math.atan2(tz, tx);
      const topAt = u => a.z + tz * u > plan.southBreak ? 23.6 : 32.4;
      const put = (name, mat, u, y, offset, w, h, depth) => box(name, mat, a.x + tx * u + nx * offset, y, a.z + tz * u + nz * offset, w, h, depth, yaw);
      const n = Math.max(1, Math.ceil(len / 3.4)), step = len / n;
      for (let j = 0; j < n; j++) {
        const u = (j + .5) * step, top = topAt(u), x = a.x + tx * u, z = a.z + tz * u;
        const nearDoor = Math.abs((x - e.x) * e.tx + (z - e.z) * e.tz) < 4.4 && Math.abs((x - e.x) * e.nx + (z - e.z) * e.nz) < 1;
        const nearParking = Math.hypot(x - plan.parking.x, z - plan.parking.z) < 13;
        for (let y = 2.8; y < top - 1; y += 4) {
          if ((nearDoor && y < 4.8) || (nearParking && y < 8.2)) continue;
          put('opto-ribbon-glass', glass, u, y, .08, step - .13, 2.55, .09);
          put('opto-window-head-sill', frameMat, u, y - 1.29, .17, step + .02, .12, .14);
          put('opto-window-head-sill', frameMat, u, y + 1.29, .17, step + .02, .12, .14);
        }
        const mullionBase = nearParking ? 8.25 : nearDoor ? 4.5 : 1.5;
        for (const shift of [-.5, 0]) put('opto-window-mullions', frameMat, u + shift * (step - .13), (mullionBase + top - .65) / 2, .16, .055, top - .65 - mullionBase, .12);
        put('opto-parapet-coping', white, u, top + .28, .10, step + .04, .56, .48);
        if (!ringIndex) {
          // Closely spaced light fins form a screen in front of recessed glazing.
          // Inset courtyards expose the horizontal ribbon instead.
          const finCount = 6, mainPortalFace = Math.hypot(x - plan.main.x, z - plan.main.z) < 21;
          for (let k = 0; k < finCount; k++) {
            if (mainPortalFace) continue;
            const fu = u + (k - 2.5) * step / finCount;
            // A visible mid-height green ribbon interrupts the west screen in
            // the completed photograph, rather than every face being blank.
            if (nx < -.65 && len > 24 && j > n * .22 && j < n * .88) {
              put('opto-vertical-sunshade-screen', screen, fu, (8.25 + 17.4) / 2, .36, .30, 17.4 - 8.25, .58);
              put('opto-vertical-sunshade-screen', screen, fu, (20.2 + top) / 2, .36, .30, top - 20.2, .58);
            } else put('opto-vertical-sunshade-screen', screen, fu, (8.25 + top) / 2, .36, .30, top - 8.25, .58);
          }
          if (j % 6 === 0) put('opto-roof-vent-plants', stone, u, top + .65, -3.6, 2.5, 1.2, 3.2);
          if (j % 6 === 1) put('opto-roof-vent-grilles', dark, u, top + .27, -3.6, 1.2, .45, 2.8);
        }
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
  mainBox('opto-main-wide-canopy', white, 0, 11.9, 8 * out, l - 2, .5, 17);
  const beam = (name, pa, pb, width, mat) => {
    const start = new THREE.Vector3(pa.x, pa.y, pa.z), end = new THREE.Vector3(pb.x, pb.y, pb.z), delta = end.clone().sub(start);
    const key = name + mat.uuid; if (!batches.has(key)) batches.set(key, { name, mat, items: [] });
    dummy.position.copy(start).add(end).multiplyScalar(.5); dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize()); dummy.scale.set(width, delta.length(), width); dummy.updateMatrix(); batches.get(key).items.push(dummy.matrix.clone());
  };
  for (const u of [-l * .29, l * .29]) for (const v of [5 * out, 13 * out]) {
    const p = entrancePoint(u, v, .1), fork = entrancePoint(u, v, 7.5); beam('opto-tree-column-stems', p, fork, .38, white);
    for (const [du, dv] of [[-3.3, 0], [3.3, 0], [0, 3.3 * out]]) beam('opto-tree-column-branches', fork, entrancePoint(u + du, v + dv, 11.65), .3, white);
    infrastructure.barriers.push({ id: `opto-main-column-${u}-${v}`, sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(p.x, p.z, .44, .44, yaw), minHeight: 0, height: 7.5, label: '光电入口雨棚柱' });
  }
  for (let j = 0; j < 18; j++) {
    const v = (4.3 + j * .31) * out, p = entrancePoint(0, v), height = .12 + (18 - j) * .15;
    mainBox('opto-main-stair-treads', paving, 0, height / 2, v, 12, height, .34);
    infrastructure.walkSurfaces.push({ id: `opto-main-step-${j}`, sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(p.x, p.z, 12, .34, yaw), surfaceY: height });
  }
  const mainLanding = entrancePoint(0, 2.05 * out);
  mainBox('opto-main-upper-landing-base', paving, 0, 1.41, 2.05 * out, 12, 2.82, 4.2);
  infrastructure.walkSurfaces.push({ id: 'opto-main-upper-landing', sourceId: OPTO_BUILDING_ID, polygon: streetFootprint(mainLanding.x, mainLanding.z, 12, 4.2, yaw), surfaceY: 2.82 });
  const courtyard = entrancePoint(0, 28.5 * out);
  floor('opto-courtyard-paved-arrival', streetFootprint(courtyard.x, courtyard.z, 33, 38, yaw), .07, paving);
  const lawn = entrancePoint(0, 34 * out);
  const turf = mesh('opto-courtyard-central-lawn', geometry(new THREE.PlaneGeometry(9, 20)), grass); turf.rotation.set(-Math.PI / 2, 0, yaw); turf.position.set(lawn.x, .1, lawn.z);
  // Only text generated from public building identity is rendered; no copied
  // institutional logo/font/image, and no guessed room-direction signage.
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
    }
  }
  for (const { name, mat, items } of batches.values()) {
    const o = new THREE.InstancedMesh(boxGeo, mat, items.length); o.name = name; items.forEach((m, i) => o.setMatrixAt(i, m)); o.instanceMatrix.needsUpdate = true; o.computeBoundingBox(); o.computeBoundingSphere(); o.castShadow = true; o.receiveShadow = true; o.renderOrder = 204; o.userData = { ...group.userData, component: name, instanceCount: items.length }; group.add(o);
  }
  const entry = { id: 'opto-c118', name: 'C118报告厅', label: '光电信息大楼 · C118 报告厅', x: e.x + e.nx * 2.9, y: .12, z: e.z + e.nz * 2.9, yaw: Math.atan2(e.nx, e.nz), radius: 8, evidenceStatus: e.status, coordinate: { ...OPTO_ACCESS.c118 } };
  const viewpoints = { exterior: { x: m.x + nx * out * 92, z: m.z + nz * out * 92, y: 2, yaw: Math.atan2(nx * out, nz * out), pitch: -.16 }, c118: { x: e.x + e.nx * 15, z: e.z + e.nz * 15, y: 1.7, yaw: Math.atan2(e.nx, e.nz), pitch: -.08 } };
  // Hide entire instanced detail batches before both color and shadow passes.
  // The source solids, roof silhouette and broad glazing remain visible. Use
  // distance to the nearest point of the 278 m-long building, not its centre.
  const fineNames = new Set(['opto-window-head-sill', 'opto-window-mullions', 'opto-vertical-sunshade-screen', 'opto-roof-vent-plants', 'opto-roof-vent-grilles']);
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
  return { group, infrastructure, entry, viewpoints, plan, update, dispose() { const textures = new Set(); mats.forEach(m => { if (m.map) textures.add(m.map); m.dispose(); }); textures.forEach(t => t.dispose()); geos.forEach(g => g.dispose()); group.removeFromParent(); } };
}
