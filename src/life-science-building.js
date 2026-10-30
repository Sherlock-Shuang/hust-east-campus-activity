import { getRoadProfile } from './building-profiles.js';
import { polygonsOverlap, streetFootprint } from './street-clearance.js';

export const LIFE_SCIENCE_BUILDING_ID = 'way/98867881';
export const LIFE_SCIENCE_BUILDING_EVIDENCE = Object.freeze({
  sourceId: LIFE_SCIENCE_BUILDING_ID,
  sourceName: '东十一教学楼',
  name: '生命科学与技术学院',
  identityEvidence: '源 OSM way/98867881 的 name:zh=生命科学学院，与用户实拍红色院名相对应。',
  photographs: ['855d12918616c22bfa754efca3114c28.jpg', '94b12217ae596b32e285e2d13f5d9247.jpg', '3e324279dfc5a5d7dd862560f6f26b9c.jpg', '33294aeb149111cc2f9a4bf0b6172fc7.jpg', '2fac496edef6ae629a20a10494cbf28e.jpg'],
  observed: '米灰长楼、七条可见白框窗带、密集空调外机、平屋顶厚檐口；红中文院名、英文门楣、方柱门廊与宽台阶；近楼电动车及修剪绿篱。',
  sourceLevels: 10,
  visibleWindowBands: 7,
  height: 27.4,
  dimensionsStatus: 'estimated-from-user-photos',
  uncertainty: '源标签为10层，实拍正面可辨认七条窗带；不修改源楼层或轮廓，展示七条窗带与27.4米高度均为照片比例估计。门廊位置、六根方柱、门窗/空调/绿化/停车数量和尺寸非测绘。左侧新楼及楼间通道身份未可靠匹配，本模块不重画它们。',
});

const ringPoints = shape => {
  const ring = shape.getPoints().map(p => ({ x: p.x, z: -p.y }));
  if (ring.length > 1 && Math.hypot(ring[0].x - ring.at(-1).x, ring[0].z - ring.at(-1).z) < 1e-6) ring.pop();
  return ring;
};
const area = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.z - q.x * p.z; }, 0) / 2;
const close = ring => [...ring.map(p => [p.x, p.z]), [ring[0].x, ring[0].z]];
const pointAt = (edge, u, v) => ({ x: edge.x + edge.tx * u + edge.nx * v, z: edge.z + edge.tz * u + edge.nz * v });

function roadPolygons(roads, frame, geoToLocal) {
  if (!roads?.length) return [];
  if (typeof geoToLocal !== 'function' || !frame) throw new TypeError('Road clearance needs an explicit WGS84 projection.');
  const out = [];
  const project = ([longitude, latitude]) => geoToLocal({ longitude, latitude, height: 0, coordinateSystem: 'EPSG:4326' }, frame);
  for (const record of roads) {
    const feature = record.feature || record, geometry = feature.geometry, profile = getRoadProfile(feature);
    if (!geometry || profile.tunnel || Math.abs(profile.elevation) > .5) continue;
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      polygons.forEach(p => out.push({ id: feature.id, polygon: p[0].map(project) }));
      continue;
    }
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const line of lines) {
      const points = line.map(project);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
        if (length > .01) out.push({ id: feature.id, polygon: streetFootprint((a.x + b.x) / 2, (a.z + b.z) / 2, length + .5, profile.width + .8, -Math.atan2(dz, dx)) });
      }
    }
  }
  return out;
}

/** Source-exact footprint. Facade dimensions are isolated from source tags. */
export function planLifeScienceBuilding(record, { roads = [], frame, geoToLocal } = {}) {
  if (record?.id !== LIFE_SCIENCE_BUILDING_ID) return null;
  if (!record.shapes?.length) throw new TypeError('Life Science needs the original source shapes.');
  const polygons = record.shapes.map(shape => [ringPoints(shape), ...shape.holes.map(ringPoints)]);
  const all = polygons.flat(2);
  const bounds = { minX: Math.min(...all.map(p => p.x)), maxX: Math.max(...all.map(p => p.x)), minZ: Math.min(...all.map(p => p.z)), maxZ: Math.max(...all.map(p => p.z)) };
  const edges = [];
  for (const polygon of polygons) {
    const ring = polygon[0], sign = Math.sign(area(ring));
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (length < .5) continue;
      edges.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, tx: dx / length, tz: dz / length, nx: dz / length * sign, nz: -dx / length * sign, yaw: -Math.atan2(dz, dx), length });
    }
  }
  // The original long south face fronts the source service road and lawn.
  // The exact portal location is not in OSM; the offset is a photo estimate.
  const front = edges.filter(edge => edge.nz > .5).sort((a, b) => b.length - a.length)[0];
  if (!front) throw new TypeError('Life Science source must include a south-facing facade.');
  const entrance = { ...front, ...pointAt(front, front.length * .13, 0), width: 16, depth: 5.8, floorY: 1.68, canopyY: 7.8, status: 'source-south-edge-photo-position-estimated' };
  const clearRoads = roadPolygons(roads, frame, geoToLocal);
  const free = polygon => !clearRoads.some(road => polygonsOverlap(polygon, road.polygon));
  while (entrance.depth > 3.4) {
    const p = pointAt(entrance, 0, entrance.depth / 2);
    if (free(streetFootprint(p.x, p.z, entrance.width, entrance.depth, entrance.yaw))) break;
    entrance.depth -= .3;
  }
  const apronCenter = pointAt(entrance, 0, entrance.depth / 2);
  entrance.apron = streetFootprint(apronCenter.x, apronCenter.z, entrance.width, entrance.depth, entrance.yaw);
  // In a partial or changed map, omit external additions instead of narrowing
  // a mapped pedestrian route. The facade itself can still be reconstructed.
  entrance.externalDetails = free(entrance.apron);
  entrance.clearPassageWidth = 2.9;
  const parking = [], planting = [];
  for (let u = -front.length / 2 + 5; u < front.length / 2 - 3; u += 2.7) {
    if (Math.abs(u - front.length * .13) < entrance.width / 2 + 2) continue;
    const p = pointAt(front, u, 1.7), polygon = streetFootprint(p.x, p.z, .85, 1.9, front.yaw);
    if (free(polygon) && !polygonsOverlap(polygon, entrance.apron)) parking.push({ ...p, yaw: front.yaw, polygon });
  }
  for (let u = -front.length / 2 + 7; u < front.length / 2 - 3; u += 8.5) {
    if (Math.abs(u - front.length * .13) < entrance.width / 2 + 3) continue;
    const p = pointAt(front, u, 4.6), polygon = streetFootprint(p.x, p.z, 3.1, 1.7, front.yaw);
    if (free(polygon) && !polygonsOverlap(polygon, entrance.apron)) planting.push({ ...p, yaw: front.yaw, polygon });
  }
  const height = LIFE_SCIENCE_BUILDING_EVIDENCE.height;
  const volumes = polygons.map((rings, i) => ({ id: `${LIFE_SCIENCE_BUILDING_ID}:photo-main:${i}`, sourceId: LIFE_SCIENCE_BUILDING_ID, rings, minHeight: .08, height }));
  return { polygons, sourceFootprint: polygons.map(p => p.map(close)), bounds, edges, front, entrance, parking, planting, clearRoads, height, volumes,
    sourceLevels: Number(record.feature?.properties?.levels ?? record.feature?.properties?.tags?.['building:levels']) || null, visibleWindowBands: 7, dimensionsStatus: 'estimated-from-user-photos' };
}

export function createLifeScienceBuilding(THREE, record, options = {}) {
  const plan = planLifeScienceBuilding(record, options);
  if (!plan) return null;
  const group = new THREE.Group(); group.name = '生命科学与技术学院 · 实拍窗带与方柱门廊';
  group.userData = { ...LIFE_SCIENCE_BUILDING_EVIDENCE, component: 'life-science-building', sourceFootprintPreserved: true };
  const geometries = new Set(), materials = new Set(), textures = new Set(), batches = new Map();
  const geometry = geo => { geometries.add(geo); return geo; };
  const material = (color, roughness = .88, metalness = 0) => { const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness }); materials.add(mat); return mat; };
  const wall = material('#bcb8a9'), trim = material('#d4cdbb'), white = material('#e4e4dc', .58, .12), frameMat = material('#9da8a7', .52, .22), glass = material('#5c7379', .33, .2), dark = material('#444b4c'), ac = material('#d1ccb9'), rubber = material('#303735'), paving = material('#afb1a8'), green = material('#617650'), soil = material('#848577'), scooterBody = material('#ffffff', .6, .1);
  const boxGeo = geometry(new THREE.BoxGeometry(1, 1, 1)), sphereGeo = geometry(new THREE.IcosahedronGeometry(1, 1)), wheelGeo = geometry(new THREE.CylinderGeometry(.24, .24, .13, 10));
  wheelGeo.rotateZ(Math.PI / 2);
  const dummy = new THREE.Object3D();
  function item(name, mat, x, y, z, sx, sy, sz, yaw = 0, geo = boxGeo, color = null, fine = false) {
    const key = `${name}/${mat.uuid}/${geo.uuid}`;
    if (!batches.has(key)) batches.set(key, { name, mat, geo, items: [], fine });
    dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
    batches.get(key).items.push({ matrix: dummy.matrix.clone(), color });
  }
  function at(edge, name, mat, u, y, v, sx, sy, sz, fine = false, geo = boxGeo, color = null) {
    const p = pointAt(edge, u, v); item(name, mat, p.x, y, p.z, sx, sy, sz, edge.yaw, geo, color, fine);
  }
  const shapeFor = rings => { const shape = new THREE.Shape(rings[0].map(p => new THREE.Vector2(p.x, -p.z))); shape.holes = rings.slice(1).map(ring => new THREE.Path(ring.map(p => new THREE.Vector2(p.x, -p.z)))); return shape; };
  function mesh(name, geo, mat) { const object = new THREE.Mesh(geo, mat); object.name = name; object.castShadow = true; object.receiveShadow = true; object.renderOrder = 203; object.userData = { featureId: LIFE_SCIENCE_BUILDING_ID, component: name }; group.add(object); return object; }
  for (const volume of plan.volumes) {
    const geo = geometry(new THREE.ExtrudeGeometry(shapeFor(volume.rings), { depth: volume.height - volume.minHeight, bevelEnabled: false, steps: 1, curveSegments: 1 }));
    const body = mesh(volume.id, geo, wall); body.rotation.x = -Math.PI / 2; body.position.y = volume.minHeight; body.userData.collisionVolumeId = volume.id;
    const roof = mesh('life-flat-roof', geometry(new THREE.ShapeGeometry(shapeFor(volume.rings))), trim); roof.rotation.x = -Math.PI / 2; roof.position.y = plan.height + .015;
  }
  const infrastructure = { replacedBuildingIds: [LIFE_SCIENCE_BUILDING_ID], buildings: plan.volumes, barriers: [], walkSurfaces: [] };
  const e = plan.entrance;
  // A full seven-row facade, with white aluminium frames and frequent small
  // outdoor condenser units, replaces the generic lab-window preset.
  for (const edge of plan.edges) {
    if (edge.length < 2) continue;
    at(edge, 'life-flat-eaves', trim, 0, plan.height - .42, .08, edge.length, .84, .38);
    const count = Math.max(1, Math.floor(edge.length / 3.8)), pitch = edge.length / count;
    for (let floor = 0; floor < 7; floor++) {
      const cy = 2.1 + floor * 3.65;
      for (let col = 0; col < count; col++) {
        const u = -edge.length / 2 + (col + .5) * pitch, p = pointAt(edge, u, 0);
        const nearDoor = edge === plan.front && Math.abs((p.x - e.x) * e.tx + (p.z - e.z) * e.tz) < 8.3 && floor < 2;
        if (nearDoor) continue;
        const width = Math.min(3.15, pitch - .42);
        at(edge, 'life-window-reveals', dark, u, cy, .035, width + .18, 1.99, .12);
        at(edge, 'life-white-window-frames', white, u, cy, .102, width, 1.82, .08);
        at(edge, 'life-blue-grey-glazing', glass, u, cy, .151, width - .15, 1.63, .025);
        at(edge, 'life-window-mullions', white, u, cy, .18, .065, 1.7, .06, true);
        at(edge, 'life-window-mullions', white, u + width * .27, cy, .18, .045, 1.7, .06, true);
        at(edge, 'life-window-mullions', white, u - width * .27, cy, .18, .045, 1.7, .06, true);
        at(edge, 'life-window-mullions', white, u, cy + .47, .18, width - .06, .045, .06, true);
        if ((col + floor * 3) % 5 !== 0 && edge.length > 15) {
          const au = u + width / 2 - .16;
          at(edge, 'life-air-conditioners', ac, au, cy - .48, .46, .82, .62, .48, true);
          at(edge, 'life-ac-front-grilles', frameMat, au, cy - .48, .711, .6, .43, .025, true);
          for (let line = -2; line <= 2; line++) at(edge, 'life-ac-front-grilles', dark, au, cy - .48 + line * .07, .732, .55, .02, .018, true);
        }
      }
    }
  }
  // Recessed-looking glazing sits behind the external colonnade. It is a
  // closed exterior facade: this module does not invent an indoor destination.
  at(e, 'life-entrance-dark-recess', dark, 0, 3.85, .07, 14.5, 6.8, .1);
  at(e, 'life-entrance-glazing', glass, 0, 3.7, .13, 11, 4.4, .08);
  for (let u = -5.5; u <= 5.5; u += 1.1) at(e, 'life-entrance-metal-frames', white, u, 3.7, .2, .07, 4.5, .08);
  if (e.externalDetails) {
    const run = Math.min(2.6, e.depth * .48), landingDepth = e.depth - run, steps = 10;
    const landing = pointAt(e, 0, landingDepth / 2);
    at(e, 'life-porch-stone-landing', paving, 0, e.floorY / 2, landingDepth / 2, e.width, e.floorY, landingDepth);
    infrastructure.walkSurfaces.push({ id: 'life-porch-landing', sourceId: LIFE_SCIENCE_BUILDING_ID, polygon: streetFootprint(landing.x, landing.z, e.width, landingDepth, e.yaw), surfaceY: e.floorY });
    for (let i = 0; i < steps; i++) {
      const y = e.floorY * (steps - i) / steps, v = landingDepth + (i + .5) * run / steps, p = pointAt(e, 0, v);
      at(e, 'life-wide-stair-treads', paving, 0, y / 2, v, e.width, y, run / steps + .005);
      infrastructure.walkSurfaces.push({ id: `life-stair-${i}`, sourceId: LIFE_SCIENCE_BUILDING_ID, polygon: streetFootprint(p.x, p.z, e.width, run / steps, e.yaw), surfaceY: y });
    }
    at(e, 'life-portal-flat-canopy', trim, 0, e.canopyY, landingDepth / 2 + .13, e.width + .4, .7, landingDepth + .26);
    const canopyCenter = pointAt(e, 0, landingDepth / 2 + .13);
    infrastructure.barriers.push({ id: 'life-portal-flat-canopy', sourceId: LIFE_SCIENCE_BUILDING_ID,
      polygon: streetFootprint(canopyCenter.x, canopyCenter.z, e.width + .4, landingDepth + .26, e.yaw), minHeight: e.canopyY - .35, height: e.canopyY + .35 });
    for (const u of [-6.75, -4.25, -1.7, 1.7, 4.25, 6.75]) {
      const v = landingDepth - .5, p = pointAt(e, u, v), height = e.canopyY - .35 - e.floorY;
      at(e, 'life-portal-square-columns', trim, u, e.floorY + height / 2, v, .5, height, .54);
      infrastructure.barriers.push({ id: `life-portal-column-${u}`, sourceId: LIFE_SCIENCE_BUILDING_ID, polygon: streetFootprint(p.x, p.z, .5, .54, e.yaw), minHeight: e.floorY, height: e.canopyY - .35 });
    }
    at(e, 'life-english-name-fascia', trim, 0, e.canopyY + .02, landingDepth + .28, e.width + .4, .62, .16);
    const sign = (name, text, color, y, v, width, height, fontSize) => {
      if (typeof document === 'undefined') return;
      const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 160;
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 ${fontSize}px sans-serif`; ctx.fillStyle = color; ctx.fillText(text, 1024, 82, 2020);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
      const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }); materials.add(mat);
      const label = mesh(name, geometry(new THREE.PlaneGeometry(width, height)), mat), p = pointAt(e, 0, v); label.position.set(p.x, y, p.z); label.rotation.y = Math.atan2(e.nx, e.nz); label.castShadow = false;
    };
    sign('life-red-chinese-college-sign', '生命科学与技术学院', '#c51e26', e.canopyY + 1.08, landingDepth + .31, 15.4, 1.12, 126);
    sign('life-english-college-sign', 'COLLEGE OF LIFE SCIENCE AND TECHNOLOGY, HUST', '#35454a', e.canopyY + .02, landingDepth + .37, 15.7, .43, 78);
  }
  for (const p of plan.planting) {
    item('life-front-planter-edging', soil, p.x, .16, p.z, 3.1, .26, 1.7, p.yaw);
    for (const u of [-1, 0, 1]) {
      const q = pointAt({ ...plan.front, x: p.x, z: p.z }, u, 0);
      item('life-clipped-hedges', green, q.x, .7, q.z, .65, .63, .72, p.yaw, sphereGeo);
    }
    infrastructure.barriers.push({ id: `life-planter-${p.x.toFixed(2)}`, sourceId: LIFE_SCIENCE_BUILDING_ID, polygon: p.polygon, minHeight: 0, height: 1.1 });
  }
  const colors = ['#d2d5cd', '#769792', '#d1b9a1', '#5d6f79', '#bbb7ce'];
  for (const [i, parked] of plan.parking.entries()) {
    const p = { ...plan.front, ...parked };
    for (const v of [-.58, .58]) at(p, 'life-parked-scooter-wheels', rubber, 0, .26, v, 1, 1, 1, true, wheelGeo);
    at(p, 'life-parked-scooter-bodies', scooterBody, 0, .52, -.18, .48, .52, .95, true, boxGeo, colors[i % colors.length]);
    at(p, 'life-parked-scooter-bodies', scooterBody, 0, .78, .46, .5, .76, .23, true, boxGeo, colors[i % colors.length]);
    at(p, 'life-parked-scooter-seats', dark, 0, .86, -.23, .56, .12, .7, true);
    at(p, 'life-parked-scooter-seats', dark, 0, 1.18, .48, .7, .065, .06, true);
    infrastructure.barriers.push({ id: `life-parked-scooter-${i}`, sourceId: LIFE_SCIENCE_BUILDING_ID, polygon: parked.polygon, minHeight: 0, height: 1.2 });
  }
  const fineMeshes = [];
  for (const batch of batches.values()) {
    const object = new THREE.InstancedMesh(batch.geo, batch.mat, batch.items.length); object.name = batch.name;
    batch.items.forEach((entry, i) => { object.setMatrixAt(i, entry.matrix); if (entry.color) object.setColorAt(i, new THREE.Color(entry.color)); });
    object.instanceMatrix.needsUpdate = true; object.computeBoundingBox(); object.computeBoundingSphere(); object.castShadow = true; object.receiveShadow = true; object.renderOrder = 204;
    object.userData = { featureId: LIFE_SCIENCE_BUILDING_ID, component: batch.name, detail: batch.fine, instanceCount: batch.items.length }; group.add(object); if (batch.fine) fineMeshes.push(object);
  }
  const pose = (distance, y, pitch) => { const p = pointAt(e, 0, distance); return { ...p, y, yaw: Math.atan2(e.nx, e.nz), pitch }; };
  const viewpoints = { exterior: pose(38, 1.7, -.22), entrance: pose(e.depth + 1.4, 1.7, -.1) };
  let fineVisible = true, disposed = false;
  const cameraPosition = new THREE.Vector3();
  function update(camera, { detailDistanceScale = 1 } = {}) {
    if (!camera?.position) return false;
    if (typeof camera.getWorldPosition === 'function') camera.getWorldPosition(cameraPosition); else cameraPosition.copy(camera.position);
    const b = plan.bounds, dx = Math.max(b.minX - cameraPosition.x, 0, cameraPosition.x - b.maxX), dz = Math.max(b.minZ - cameraPosition.z, 0, cameraPosition.z - b.maxZ), dy = Math.max(0, cameraPosition.y - plan.height, -cameraPosition.y);
    const scale = Number.isFinite(detailDistanceScale) ? Math.max(.35, Math.min(1.5, detailDistanceScale)) : 1, cutoff = (fineVisible ? 230 : 190) * scale;
    const visible = dx * dx + dy * dy + dz * dz < cutoff * cutoff;
    if (visible === fineVisible) return false;
    fineVisible = visible; fineMeshes.forEach(object => { object.visible = visible; }); return true;
  }
  return { group, plan, infrastructure, viewpoints, update,
    dispose() { if (disposed) return; disposed = true; group.traverse(object => { if (object.isInstancedMesh) object.dispose(); }); geometries.forEach(geo => geo.dispose()); materials.forEach(mat => mat.dispose()); textures.forEach(texture => texture.dispose()); group.removeFromParent(); } };
}
