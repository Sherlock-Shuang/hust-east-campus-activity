import polygonClipping from 'polygon-clipping';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { getRoadProfile } from './building-profiles.js';
import { getReconstructionBuildings } from './campus-feature-selection.js';
import { applyWorldUV } from './surface-materials.js';
import { pointInLandcover } from './campus-landcover.js';

const PHOTOS = ['/references/local-campus/street-corner-lawn.webp', '/references/local-campus/campus-stone-lawn.webp', '/references/local-campus/east-nine-lawn-tent.webp'];
const YUNYUAN_LAWN = 'way/98867860';
const STONE_SOURCE = 'https://edf.hust.edu.cn/info/1149/3714.htm';
const STONE_CONTOUR = [[-3.1, 0], [-2.9, 1.1], [-2.3, 1.8], [-1.8, 2.2], [-1.45, 3.65], [-.75, 4.55], [.3, 4.85], [1.1, 5.1], [1.65, 4.87], [2.2, 3.9], [2.7, 2.45], [3.1, .15]];
const fract = v => v - Math.floor(v);
const random = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453123);
function rockNoise(x,y){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const a=random(ix,iy)*(1-sx)+random(ix+1,iy)*sx,b=random(ix,iy+1)*(1-sx)+random(ix+1,iy+1)*sx;
  return a*(1-sy)+b*sy;
}
const asPolygons = r => (r.shapes || []).map(s => [s.getPoints().map(p => [p.x, -p.y]), ...s.holes.map(h => h.getPoints().map(p => [p.x, -p.y]))]);
function capsule(a, b, radius) {
  const angle = Math.atan2(b.z - a.z, b.x - a.x), ring = [];
  for (let i = 0; i <= 8; i++) { const t = angle - Math.PI / 2 + i * Math.PI / 8; ring.push([b.x + Math.cos(t) * radius, b.z + Math.sin(t) * radius]); }
  for (let i = 0; i <= 8; i++) { const t = angle + Math.PI / 2 + i * Math.PI / 8; ring.push([a.x + Math.cos(t) * radius, a.z + Math.sin(t) * radius]); }
  ring.push(ring[0]); return [ring];
}
function polygonBounds(polygons) {
  const p = polygons.flat(2);
  return { minX: Math.min(...p.map(q => q[0])), maxX: Math.max(...p.map(q => q[0])), minZ: Math.min(...p.map(q => q[1])), maxZ: Math.max(...p.map(q => q[1])) };
}
function insideDisc(x, z, radius, polygons) {
  if (!pointInLandcover(x, z, polygons)) return false;
  for (let i = 0; i < 32; i++) { const angle = i * Math.PI / 16; if (!pointInLandcover(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius, polygons)) return false; }
  return true;
}

/** Registered candidates, not surveyed landmarks. The stone is placed only in
 * the canteen/athletics-ground lawn visible together in the user's wide photo.
 * The lake lawn has no grass polygon: its limited footprint is explicitly a
 * photograph-derived patch clipped around source water, roads and buildings. */
export function planCampusLawnLandmarks(model, { frame, geoToLocal } = {}) {
  const plan = { lawns: [], stones: [], canopies: [], tufts: [], rejected: [], inspections: {}, photographs: PHOTOS,
    placementStatus: 'photo-registered candidates; position, size and current permanence not surveyed',
    inscription: { columns: ['敢担大任', '勇攀高峰'], carvedColumns: ['敢擔大任', '勇攀高峰'], complete: true, basis: 'User photograph and official stone photograph identify traditional carved 擔; HUST Education Development Foundation 2022-08-30 report uses simplified 担 in its text', sourceUrl: STONE_SOURCE, siteName: '韵苑花田', officialMotto: false } };
  if (!frame || typeof geoToLocal !== 'function') return plan;
  const local = coordinate => geoToLocal({ longitude: coordinate[0], latitude: coordinate[1], height: 0, coordinateSystem: 'EPSG:4326' }, frame);
  const buildingIds = new Set(getReconstructionBuildings(model).map(r => r.id));
  const obstacles = [];
  for (const record of model.records || []) {
    const tags = record.feature?.properties?.tags || {};
    if (buildingIds.has(record.id) || ['water', 'sports', 'road'].includes(record.category) || ['parking', 'bicycle_parking'].includes(tags.amenity)) obstacles.push(...asPolygons(record));
    if (record.category !== 'road' || record.shapes?.length) continue;
    const geometry = record.feature?.geometry;
    const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const line of lines) { const p = line.map(local); for (let i = 1; i < p.length; i++) obstacles.push(capsule(p[i - 1], p[i], getRoadProfile(record.feature).width / 2 + .65)); }
  }
  const source = (model.records || []).find(r => r.id === YUNYUAN_LAWN);
  if (source?.shapes?.length) {
    const polygons = polygonClipping.difference(asPolygons(source), ...obstacles);
    if (polygons.length) plan.lawns.push({ id: 'yunyuan-lawn', sourceId: YUNYUAN_LAWN, polygons, footprintBasis: 'source grass polygon minus mapped obstacles', photo: PHOTOS[0], bounds: polygonBounds(polygons) });
  }
  // Located between the user-confirmed lake road and the existing water outline.
  // Do not substitute the two established B/C forecourt hedge polygons.
  if ((model.roads || []).some(r => r.id === 'way/97080595') && (model.water || []).some(r => r.id === 'relation/13705236')) {
    const ring = [[114.42288, 30.51618], [114.42322, 30.51624], [114.42380, 30.51623], [114.42385, 30.51591], [114.42322, 30.51572], [114.42288, 30.51578]].map(c => { const p = local(c); return [p.x, p.z]; }); ring.push(ring[0]);
    const polygons = polygonClipping.difference([[ring]], ...obstacles);
    if (polygons.length) plan.lawns.push({ id: 'east-nine-lake-lawn', sourceId: null, contextSourceIds: ['way/97080595', 'relation/13705236'], polygons, footprintBasis: 'limited photo-derived candidate lawn; no OSM grass outline, clipped against source obstacles', photo: PHOTOS[2], bounds: polygonBounds(polygons) });
  }
  const accept = (kind, lawnId, coordinate, details) => {
    const lawn = plan.lawns.find(p => p.id === lawnId), centre = local(coordinate);
    const p = { ...details, x: centre.x, z: centre.z, y: .06, lawnId, sourceId: lawn?.sourceId ?? null, coordinateEstimate: coordinate,
      positionStatus: 'photo-registered-estimate', dimensionsStatus: 'photo-scale estimate', footprintRadius: details.radius };
    if (!lawn || !insideDisc(p.x, p.z, p.radius + .4, lawn.polygons)) { plan.rejected.push({ id: p.id, reason: 'candidate footprint intersects source obstacle or lawn boundary' }); return; }
    if ([...plan.stones, ...plan.canopies].some(q => Math.hypot(p.x - q.x, p.z - q.z) < p.radius + q.radius + 1)) { plan.rejected.push({ id: p.id, reason: 'candidate footprints overlap' }); return; }
    plan[kind].push(p);
  };
  accept('stones', 'yunyuan-lawn', [114.426642, 30.516092], { id: 'yunyuan-inscribed-stone', width: 6.5, height: 5.2, depth: 1.8, radius: 3.55, yaw: -Math.PI / 2, photo: PHOTOS[1], inscription: plan.inscription, siteName: '韵苑花田', sourceUrl: STONE_SOURCE });
  accept('canopies', 'yunyuan-lawn', [114.426535, 30.515954], { id: 'yunyuan-tension-canopy', form: 'tension', width: 12.4, depth: 12.4, height: 4.7, radius: 6.7, yaw: .3, photo: PHOTOS[0] });
  accept('canopies', 'east-nine-lake-lawn', [114.42339, 30.516073], { id: 'lake-tension-canopy', form: 'tension', width: 12.4, depth: 12.4, height: 4.7, radius: 6.7, yaw: -.6, photo: PHOTOS[2] });
  accept('canopies', 'east-nine-lake-lawn', [114.42312, 30.516037], { id: 'lake-arched-canopy', form: 'arched', width: 4.6, depth: 4.2, height: 2.8, radius: 3.3, yaw: -.3, photo: PHOTOS[2] });
  for (const [index, lawn] of plan.lawns.entries()) {
    const b = lawn.bounds;
    for (let i = 0; i < 700; i++) {
      const x = b.minX + random(i, index + 3) * (b.maxX - b.minX), z = b.minZ + random(i + 91, index + 17) * (b.maxZ - b.minZ);
      if (!insideDisc(x, z, .2, lawn.polygons) || [...plan.stones, ...plan.canopies].some(p => Math.hypot(x - p.x, z - p.z) < p.radius)) continue;
      plan.tufts.push({ x, z, height: .045 + random(i, 61) * .065, yaw: random(i, 113) * Math.PI, lawnId: lawn.id });
    }
  }
  const stone = plan.stones[0], lake = plan.canopies.find(p => p.id === 'lake-tension-canopy');
  if (stone) plan.inspections.stone = { target: [stone.x, 2.2, stone.z], position: [stone.x - 17, 6, stone.z + 11], label: '草坪景石', landmarkId: stone.id };
  if (lake) plan.inspections.lake = { target: [lake.x - 8, 1.5, lake.z], position: [lake.x + 16, 7, lake.z - 25], label: '湖边白棚', landmarkId: lake.id };
  return plan;
}

function tensionGeometry(THREE) {
  const segments = 72, rings = 15, positions = [], uv = [], indices = [];
  for (let ring = 0; ring <= rings; ring++) for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2, fraction = ring / rings, scallop = Math.abs(Math.sin(angle * 3));
    const radius = 6.2 * (1 - .18 * scallop) * fraction, edge = .26 + 1.85 * Math.pow(scallop, .8);
    positions.push(Math.cos(angle) * radius, 4.7 * Math.pow(1 - fraction, 1.22) + edge * fraction, Math.sin(angle) * radius);
    uv.push(i / segments * 6, fraction);
    if (ring < rings && i < segments) { const a = ring * (segments + 1) + i, b = a + segments + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); return g;
}

// Metre-scale relief, including two wandering fissures; the inscription below
// follows exactly this surface instead of floating on a separate flat placard.
function rockFace(x, y, back = false) {
  const warp = .12 * Math.sin(x * 1.35 + y * .48) + .065 * Math.cos(y * 2.6 - x * .75);
  const ripple = .03 * Math.sin(x * 9.2 + Math.sin(y * 1.6) * .9) + .017 * Math.sin(x * 19.4 + y * 2.3);
  const fissure = .10 * Math.exp(-(((x + 1.15 - Math.sin(y * .9) * .14) / .048) ** 2))
    + .08 * Math.exp(-(((x - .62 - Math.sin(y * .63) * .19) / .038) ** 2));
  return back ? -.66 - warp * .8 - ripple * .55 : .68 + warp + ripple - fissure;
}

function weatheredRockGeometry(THREE) {
  const positions = [], uvs = [], step = .16, polygon = [[...STONE_CONTOUR, STONE_CONTOUR[0]]];
  const add = (point, back) => { const [x, y] = point; positions.push(x, y, rockFace(x, y, back)); uvs.push((x + 3.15) / 6.3, y / 5.15); };
  // Clip a fine face grid to the actual asymmetrical outline. Both faces have
  // independent relief, so thickness and silhouette vary through the boulder.
  for (let y = 0; y < 5.2; y += step) for (let x = -3.2; x < 3.2; x += step) {
    const clipped = polygonClipping.intersection([polygon], [[[[x, y], [x + step, y], [x + step, y + step], [x, y + step], [x, y]]]]);
    for (const rings of clipped) {
      const ring = rings[0].slice(0, -1), points = ring.map(p => new THREE.Vector2(...p));
      for (const triangle of THREE.ShapeUtils.triangulateShape(points, [])) {
        for (const index of triangle) add(ring[index], false);
        for (const index of [...triangle].reverse()) add(ring[index], true);
      }
    }
  }
  // Side wall joins the same front/back functions, with intermediate bulging
  // courses instead of a constant-depth vertical extrusion.
  for (let i = 0; i < STONE_CONTOUR.length; i++) {
    const a = STONE_CONTOUR[i], b = STONE_CONTOUR[(i + 1) % STONE_CONTOUR.length], count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    const sidePoint = (t, v) => { const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; return [x, y, rockFace(x, y, true) * (1 - v) + rockFace(x, y) * v]; };
    for (let j = 0; j < count; j++) for (let course = 0; course < 5; course++) {
      const p = [sidePoint(j / count, course / 5), sidePoint((j + 1) / count, course / 5), sidePoint((j + 1) / count, (course + 1) / 5), sidePoint(j / count, (course + 1) / 5)];
      for (const k of [0, 2, 1, 0, 3, 2]) { positions.push(...p[k]); uvs.push((p[k][0] + 3.15) / 6.3, p[k][1] / 5.15); }
    }
  }
  const raw = new THREE.BufferGeometry(); raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); raw.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const geometry = mergeVertices(raw, 1e-5); raw.dispose(); geometry.computeVertexNormals();
  geometry.userData = { geometryBasis: 'fine clipped grid with separate non-planar front/back relief and wandering fissures; photo-informed, not a scan', faceStepMetres: step };
  return geometry;
}

function stoneTextures(THREE) {
  const width = 256, height = 512, colour = new Uint8Array(width * height * 4), bump = new Uint8Array(colour.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, flow = u * 104 + rockNoise(u*9,v*8)*11 + Math.sin(v * 8) * 1.25;
    const broad = (rockNoise(u*7,v*5)-.5)*2, weather=(rockNoise(u*31,v*17)-.5)*2;
    const mask=rockNoise(u*18,v*22),vein=Math.pow(Math.max(0,Math.sin(flow)),12)*mask;
    const split=Math.pow(Math.max(0,Math.sin(flow*1.43+v*6)),28)*(1-mask),grain=(random(x,y)-.5)*32;
    const c=Math.max(45,Math.min(238,154+broad*28+weather*34+vein*42-split*60+grain));
    const b=Math.max(0,Math.min(255,130+broad*12+weather*20+vein*35-split*74+grain));
    colour.set([c + 3, c + 3, c, 255], (y * width + x) * 4); bump.set([b, b, b, 255], (y * width + x) * 4);
  }
  const map = new THREE.DataTexture(colour, width, height, THREE.RGBAFormat), bumpMap = new THREE.DataTexture(bump, width, height, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, bumpMap]) { texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true; }
  return { map, bumpMap };
}

function rockSurfaceSampler(geometry) {
  const cells = new Map(), size = .2, p = geometry.attributes.position, index = geometry.index;
  for (let i = 0; i < index.count; i += 3) {
    const a = [0, 1, 2].map(k => { const n = index.getX(i + k); return [p.getX(n), p.getY(n), p.getZ(n)]; });
    if (a.some(q => q[2] < .1)) continue;
    const denominator = (a[1][1] - a[2][1]) * (a[0][0] - a[2][0]) + (a[2][0] - a[1][0]) * (a[0][1] - a[2][1]);
    if (Math.abs(denominator) < 1e-9) continue;
    const triangle = { a, denominator };
    for (let x = Math.floor(Math.min(...a.map(q => q[0])) / size); x <= Math.floor(Math.max(...a.map(q => q[0])) / size); x++) for (let y = Math.floor(Math.min(...a.map(q => q[1])) / size); y <= Math.floor(Math.max(...a.map(q => q[1])) / size); y++) { const key = `${x}/${y}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(triangle); }
  }
  return (x, y) => {
    for (const { a, denominator } of cells.get(`${Math.floor(x / size)}/${Math.floor(y / size)}`) || []) {
      const u = ((a[1][1] - a[2][1]) * (x - a[2][0]) + (a[2][0] - a[1][0]) * (y - a[2][1])) / denominator;
      const v = ((a[2][1] - a[0][1]) * (x - a[2][0]) + (a[0][0] - a[2][0]) * (y - a[2][1])) / denominator;
      if (u >= -1e-5 && v >= -1e-5 && u + v <= 1.00001) return a[0][2] * u + a[1][2] * v + a[2][2] * (1 - u - v);
    }
    return rockFace(x, y);
  };
}

export function createCampusLawnLandmarks(THREE, model, options = {}) {
  const plan = planCampusLawnLandmarks(model, options), group = new THREE.Group(); group.name = '实拍草坪 · 题字景石与轻型膜棚';
  group.userData = { component: 'campus-lawn-landmarks', photographs: PHOTOS, positionStatus: plan.placementStatus, estimated: true,
    inscription: plan.inscription, note: '韵苑花田文化石铭文由校方正文核实，不称为正式校训；设施精确坐标和白棚长期存续未知。' };
  const geometries = new Set(), materials = new Set(), textures = new Set(), instances = new Set();
  const ownGeometry = g => { geometries.add(g); return g; }, ownMaterial = m => { materials.add(m); return m; };
  const fabric = ownMaterial(new THREE.MeshStandardMaterial({ name: '白色张拉膜 · 实拍形态估计', color: '#e7e6d8', roughness: .83, metalness: 0, side: THREE.DoubleSide }));
  const steel = ownMaterial(new THREE.MeshStandardMaterial({ name: '棚架浅灰细管', color: '#c5ccca', roughness: .45, metalness: .55 }));
  const grass = ownMaterial(options.surfaces?.grass?.clone() || new THREE.MeshStandardMaterial({ roughness: 1 })); grass.color.set(options.surfaces?.grass ? '#dae7bd' : '#759344'); grass.roughness = 1;
  grass.polygonOffset = true; grass.polygonOffsetFactor = -2; grass.polygonOffsetUnits = -2;
  for (const lawn of plan.lawns) {
    const shapes = lawn.polygons.map(poly => { const shape = new THREE.Shape(poly[0].map(p => new THREE.Vector2(p[0], -p[1]))); shape.holes = poly.slice(1).map(ring => new THREE.Path(ring.map(p => new THREE.Vector2(p[0], -p[1])))); return shape; });
    const g = ownGeometry(applyWorldUV(new THREE.ShapeGeometry(shapes, 1), 1, 'xy')), mesh = new THREE.Mesh(g, grass);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = .038; mesh.receiveShadow = true; mesh.name = lawn.id;
    mesh.userData = { component: 'photo-lawn', sourceId: lawn.sourceId, footprintBasis: lawn.footprintBasis, photo: lawn.photo, estimatedMaterial: true }; group.add(mesh);
  }
  const pipeGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 8)), pipes = [], dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  function pipe(holder, a, b, radius = .035) {
    const direction = new THREE.Vector3().subVectors(b, a); if (direction.length() < .001) return;
    const mid = a.clone().add(b).multiplyScalar(.5); dummy.position.copy(mid); dummy.quaternion.setFromUnitVectors(up, direction.clone().normalize()); dummy.scale.set(radius, direction.length(), radius); dummy.updateMatrix();
    holder.updateMatrix(); pipes.push(holder.matrix.clone().multiply(dummy.matrix));
  }
  const tension = ownGeometry(tensionGeometry(THREE));
  for (const p of plan.canopies) {
    const holder = new THREE.Group(); holder.position.set(p.x, p.y, p.z); holder.rotation.y = p.yaw; holder.name = p.id;
    holder.userData = { component: 'photo-canopy', ...p, permanence: 'unknown; photographed installation, not a mapped permanent building' }; group.add(holder);
    if (p.form === 'tension') {
      const roof = new THREE.Mesh(tension, fabric); roof.castShadow = roof.receiveShadow = true; holder.add(roof);
      pipe(holder, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 4.7, 0), .047);
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, tip = new THREE.Vector3(Math.cos(a) * 6.2, .26, Math.sin(a) * 6.2), anchor = new THREE.Vector3(Math.cos(a) * 6.65, .035, Math.sin(a) * 6.65); pipe(holder, tip, anchor, .012); pipe(holder, anchor, anchor.clone().add(new THREE.Vector3(0, .28, 0)), .018); }
    } else {
      const positions = [], indices = [], steps = 24;
      for (const z of [-2.1, 2.1]) for (let i = 0; i <= steps; i++) { const a = i / steps * Math.PI; positions.push(Math.cos(a) * 2.3, 1.8 + Math.sin(a), z); }
      for (let i = 0; i < steps; i++) { const a = i, b = i + steps + 1; indices.push(a, a + 1, b, a + 1, b + 1, b); }
      const g = ownGeometry(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals();
      const roof = new THREE.Mesh(g, fabric); roof.castShadow = roof.receiveShadow = true; holder.add(roof);
      for (const z of [-2.1, 0, 2.1]) for (let i = 0; i < 12; i++) { const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12; pipe(holder, new THREE.Vector3(Math.cos(a) * 2.3, 1.79 + Math.sin(a), z), new THREE.Vector3(Math.cos(b) * 2.3, 1.79 + Math.sin(b), z), .028); }
      for (const x of [-2.3, 2.3]) for (const z of [-2.1, 2.1]) pipe(holder, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 1.8, z));
    }
  }
  if (pipes.length) { const mesh = new THREE.InstancedMesh(pipeGeometry, steel, pipes.length); pipes.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = mesh.receiveShadow = true; mesh.name = '白棚共享支柱、弧肋与锚索'; mesh.computeBoundingSphere(); group.add(mesh); instances.add(mesh); }
  const stoneMaps = stoneTextures(THREE); textures.add(stoneMaps.map); textures.add(stoneMaps.bumpMap);
  const stoneMat = ownMaterial(new THREE.MeshStandardMaterial({ name: '风化灰白纵向岩纹与裂隙', color: '#ffffff', roughness: .98, metalness: 0, ...stoneMaps, bumpScale: .075 }));
  for (const p of plan.stones) {
    const holder = new THREE.Group(); holder.name = p.id; holder.position.set(p.x, p.y, p.z); holder.rotation.y = p.yaw; holder.userData = { component: 'photo-inscribed-stone', ...p, estimated: true }; group.add(holder);
    const rock = new THREE.Mesh(ownGeometry(weatheredRockGeometry(THREE)), stoneMat); rock.name = '自然岩体 · 凹凸双面与竖向裂隙'; rock.userData = { component: 'weathered-stone-body', reliefStatus: 'estimated geometry, not a photogrammetric scan' }; rock.castShadow = rock.receiveShadow = true; holder.add(rock);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 1280; const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#8d302e'; context.font = '125px "Kaiti SC", "STKaiti", "KaiTi", serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
        plan.inscription.carvedColumns.forEach((column, i) => [...column].forEach((character, j) => context.fillText(character, i ? 355 : 160, 120 + j * 218 + (i ? 218 : 0))));
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true; textures.add(texture);
        const textMat = ownMaterial(new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: .92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
        const textGeometry = ownGeometry(new THREE.PlaneGeometry(1.8, 4, 48, 96)), tp = textGeometry.attributes.position, surfaceZ = rockSurfaceSampler(rock.geometry);
        for (let i = 0; i < tp.count; i++) { const x = tp.getX(i) + .85, y = tp.getY(i) + 2.7; tp.setXYZ(i, x, y, surfaceZ(x, y) + .012); } textGeometry.computeVertexNormals();
        const text = new THREE.Mesh(textGeometry, textMat); text.name = '敢擔大任 勇攀高峰 · 随岩面题字'; text.userData = { visibleColumns: plan.inscription.carvedColumns, descriptionColumns: plan.inscription.columns, complete: true, sourceUrl: STONE_SOURCE, rightColumnOffsetCharacters: 1 }; holder.add(text);
      }
    }
  }
  if (plan.tufts.length) {
    const g = ownGeometry(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute([-.07, 0, 0, .07, 0, 0, -.02, 1, 0, 0, 0, -.07, 0, 0, .07, 0, .8, .02], 3)); g.computeVertexNormals();
    const mat = ownMaterial(new THREE.MeshStandardMaterial({ color: '#789449', roughness: 1, side: THREE.DoubleSide })), mesh = new THREE.InstancedMesh(g, mat, plan.tufts.length);
    plan.tufts.forEach((p, i) => { dummy.position.set(p.x, .04, p.z); dummy.rotation.set(0, p.yaw, 0); dummy.scale.set(1, p.height, 1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, new THREE.Color().setHSL(.21 + random(i, 4) * .035, .33, .35 + random(i, 7) * .08)); });
    mesh.instanceMatrix.needsUpdate = true; mesh.receiveShadow = true; mesh.name = '低草簇 · 共享实例'; mesh.computeBoundingSphere(); group.add(mesh); instances.add(mesh);
  }
  let disposed = false;
  return { group, plan, dispose() { if (disposed) return; disposed = true; instances.forEach(m => m.dispose()); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); group.removeFromParent(); group.clear(); } };
}
