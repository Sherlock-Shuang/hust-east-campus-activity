import polygonClipping from 'polygon-clipping';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getRoadProfile } from './building-profiles.js';
import { pointInLandcover } from './campus-landcover.js';

export const EINSTEIN_SQUARE_SOURCE_ID = 'way/98865830';
export const EINSTEIN_SQUARE_EVIDENCE = Object.freeze({
  sourceId: EINSTEIN_SQUARE_SOURCE_ID,
  sourceUrl: 'https://www.openstreetmap.org/way/98865830',
  photoArticle: 'https://m.thepaper.cn/newsDetail_forward_28494834',
  photograph: 'https://imagepphcloud.thepaper.cn/pph/image/319/91/301.jpg',
  photographDate: '2024-08-22 publication; capture date unspecified',
  observed: 'A monumental head with a hand supporting the chin, waved hair, dark rectangular inscribed plinth, white open pergola behind, low clipped hedge, side steps and pink/grey rectangular paving.',
  uncertainty: 'Square outline is the unmodified OSM source. Statue position, facing, scale, pergola layout and risers are photograph-informed estimates, not a survey or photogrammetric scan. The back and inscription body are not reconstructed from invented text.',
});
const FLOOR = .16;
const rawPolygons = record => (record?.shapes || []).map(s => [s.getPoints().map(p => [p.x, -p.y]), ...s.holes.map(h => h.getPoints().map(p => [p.x, -p.y]))]);
const rectangle = (x, z, width, depth) => [[x - width / 2, z - depth / 2], [x + width / 2, z - depth / 2], [x + width / 2, z + depth / 2], [x - width / 2, z + depth / 2]];

/** A bounded addition on the existing mapped park. It never rewrites the GIS
 * source, relocates buildings, or changes the campus coordinate frame. */
export function planEinsteinSquare(model, { frame, geoToLocal } = {}) {
  const plan = { sourceId: EINSTEIN_SQUARE_SOURCE_ID, evidence: EINSTEIN_SQUARE_EVIDENCE, polygons: [], barriers: [], walkSurfaces: [], steps: [], pergolaColumns: [], hedgeBeds: [], accepted: false };
  const source = model.records?.find(r => r.id === EINSTEIN_SQUARE_SOURCE_ID);
  if (!source?.shapes?.length || !frame || typeof geoToLocal !== 'function') return plan;
  const local = c => geoToLocal({ longitude: c[0], latitude: c[1], height: 0, coordinateSystem: 'EPSG:4326' }, frame);
  const exclusions = [];
  for (const record of model.records || []) {
    if (['building', 'water', 'sports'].includes(record.category)) exclusions.push(...rawPolygons(record));
    if (record.category !== 'road') continue;
    const geometry = record.feature?.geometry;
    const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
    const radius = getRoadProfile(record.feature).width / 2 + .35;
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = local(line[i - 1]), b = local(line[i]), length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1e-5) continue;
      const nx = -(b.z - a.z) / length * radius, nz = (b.x - a.x) / length * radius;
      exclusions.push([[[a.x + nx, a.z + nz], [b.x + nx, b.z + nz], [b.x - nx, b.z - nz], [a.x - nx, a.z - nz], [a.x + nx, a.z + nz]]]);
    }
  }
  const sourcePolygons = rawPolygons(source);
  plan.polygons = exclusions.length ? polygonClipping.difference(sourcePolygons, ...exclusions) : sourcePolygons;
  if (!plan.polygons.length) return plan;
  const origin = local([114.4301, 30.51682]), yaw = -.08;
  const at = (x, z) => ({ x: origin.x + x * Math.cos(yaw) + z * Math.sin(yaw), z: origin.z - x * Math.sin(yaw) + z * Math.cos(yaw) });
  const polygon = (x, z, width, depth) => rectangle(x, z, width, depth).map(p => at(...p));
  const fits = ring => ring.every(p => pointInLandcover(p.x, p.z, plan.polygons));
  plan.statue = { ...origin, y: FLOOR, yaw, width: 4.7, height: 7.3, plinthWidth: 2.9, plinthHeight: 1.8, plinthDepth: 2.3,
    coordinate: [114.4301, 30.51682], form: 'head-and-supporting-hand', measured: false };
  if (!fits(polygon(0, 0, 5, 4))) return plan;
  plan.accepted = true;
  for (const poly of plan.polygons) plan.walkSurfaces.push({ id: 'einstein-square-paving', sourceId: source.id, kind: 'plaza', polygon: poly[0].map(([x, z]) => ({ x, z })), holes: poly.slice(1).map(r => r.map(([x, z]) => ({ x, z }))), surfaceY: FLOOR });
  plan.barriers.push({ id: 'einstein-statue-plinth', sourceId: source.id, polygon: polygon(0, 0, 2.95, 2.35), minHeight: FLOOR, height: FLOOR + 3.5, label: '爱因斯坦雕塑及基座', estimated: true });
  plan.barriers.push({ id: 'einstein-statue-head', sourceId: source.id, polygon: polygon(0, 0, 4.5, 2.5), minHeight: FLOOR + 3.5, height: FLOOR + 7.3, label: '爱因斯坦头像', estimated: true });
  const platform = polygon(0, -4.8, 19, 2.4);
  if (fits(platform)) {
    plan.platform = { x: 0, z: -4.8, width: 19, depth: 2.4, surfaceY: FLOOR + .72, polygon: platform };
    plan.walkSurfaces.push({ id: 'einstein-pergola-platform', sourceId: source.id, polygon: platform, surfaceY: FLOOR + .72, kind: 'platform', estimated: true });
    // Retaining edges prevent a walker being snapped onto the raised platform
    // from the back or sides. The two front stair openings remain unobstructed.
    for (const [x, z, width, depth] of [[-9.5, -4.8, .12, 2.4], [9.5, -4.8, .12, 2.4], [0, -6, 19, .12], [0, -3.6, 12.3, .12]]) {
      plan.barriers.push({ id: `einstein-platform-edge-${x}-${z}`, sourceId: source.id, polygon: polygon(x, z, width, depth), minHeight: FLOOR, height: FLOOR + .72, label: '廊架平台边缘', estimated: true });
    }
    for (const x of [-7.7, 7.7]) for (let i = 0; i < 6; i++) {
      const step = { x, z: -1.29 - i * .42, width: 3.1, depth: .42, surfaceY: FLOOR + (i + 1) * .12 };
      step.polygon = polygon(step.x, step.z, step.width, step.depth);
      if (!fits(step.polygon)) continue;
      plan.steps.push(step);
      plan.walkSurfaces.push({ id: `einstein-step-${x}-${i}`, sourceId: source.id, polygon: step.polygon, surfaceY: step.surfaceY, kind: 'stair', estimated: true });
    }
    for (let i = 0; i < 7; i++) {
      const x = -8.7 + i * 2.9, z = -4.5 - .65 * (1 - Math.abs(x) / 8.7);
      for (const dz of [-.7, .7]) {
        const col = { x, z: z + dz, height: 3.3, width: .3 };
        if (!fits(polygon(col.x, col.z, .5, .5))) continue;
        plan.pergolaColumns.push(col);
        plan.barriers.push({ id: `einstein-pergola-${i}-${dz}`, sourceId: source.id, polygon: polygon(col.x, col.z, .32, .32), minHeight: FLOOR + .72, height: FLOOR + 4.02, label: '白色廊架立柱', estimated: true });
      }
    }
    for (const x of [-3.5, 3.5]) {
      const bed = { x, z: -2.7, width: 6, depth: 1.15, height: .64 };
      if (!fits(polygon(bed.x, bed.z, bed.width, bed.depth))) continue;
      plan.hedgeBeds.push(bed);
      plan.barriers.push({ id: `einstein-hedge-${x}`, sourceId: source.id, polygon: polygon(bed.x, bed.z, bed.width, bed.depth), minHeight: FLOOR, height: FLOOR + bed.height, label: '廊前花池', estimated: true });
    }
  }
  plan.inspection = { target: [origin.x, 3.5, origin.z], position: [at(10, 20).x, 4.2, at(10, 20).z], label: '爱因斯坦广场' };
  plan.pedestrianInspection = { target: [origin.x, 4.1, origin.z], position: [at(2, 14).x, 1.7, at(2, 14).z] };
  return plan;
}

function pavingTexture(THREE) {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = Math.floor(x / 16), gy = Math.floor(y / 16), joint = x % 16 === 0 || y % 16 === 0;
    const light = (gx + 2 * gy) % 7 === 0, n = ((x * 13 + y * 7) % 11) - 5;
    const c = joint ? [104, 101, 94] : light ? [181 + n, 179 + n, 167 + n] : [154 + n, 133 + n, 124 + n];
    data.set([...c, 255], (y * size + x) * 4);
  }
  const t = new THREE.DataTexture(data, size, size); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}

/** All geometry and textures are generated locally. Public research photographs
 * are neither fetched at runtime nor shipped as photographic mesh textures. */
export function createEinsteinSquare(THREE, model, options = {}) {
  const plan = planEinsteinSquare(model, options), group = new THREE.Group(); group.name = '爱因斯坦广场 · 实照校准';
  group.userData = { component: 'einstein-square', ...EINSTEIN_SQUARE_EVIDENCE, estimated: true };
  const geometries = new Set(), materials = new Set(), textures = new Set(), batches = new Map();
  let disposed = false;
  const infrastructure = { barriers: plan.barriers, walkSurfaces: plan.walkSurfaces, replacedBuildingIds: [] };
  const dispose = () => { if (disposed) return; disposed = true; geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); group.removeFromParent(); group.clear(); };
  if (!plan.accepted) return { group, plan, infrastructure, dispose, update() {} };
  const own = material => { materials.add(material); return material; };
  const mat = (color, roughness = .9, metalness = 0) => own(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const plaster = mat('#e4e5d9'), stone = mat('#b3b1a2'), dark = mat('#343a36', .66), bronze = mat('#80867a', .89, .24), crease = mat('#4a514a', .92, .17), hairMat = mat('#92968a', .96, .12), leaf = mat('#929b38');
  function batch(geometry, material) { const g = geometry.index ? geometry.toNonIndexed() : geometry; if (g !== geometry) geometry.dispose(); if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2)); if (!batches.has(material)) batches.set(material, []); batches.get(material).push(g); }
  function box(w, h, d, x, y, z, material, yaw = 0) { const g = new THREE.BoxGeometry(w, h, d); g.rotateY(yaw); g.translate(x, y, z); batch(g, material); }
  function ellipsoid(x, y, z, rx, ry, rz, material, rotation = 0) { const g = new THREE.SphereGeometry(1, 18, 12); g.scale(rx, ry, rz); g.rotateZ(rotation); g.translate(x, y, z); batch(g, material); }
  function curve(points, radius, material, segments = 16) { const c = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))); batch(new THREE.TubeGeometry(c, segments, radius, 7, false), material); }
  const p = plan.statue, holder = new THREE.Group(); holder.position.set(p.x, FLOOR, p.z); holder.rotation.y = p.yaw; holder.name = '照片估计的雕塑与廊架'; group.add(holder);
  // Pedestal proportions and hand/head silhouette are the identifiable elements
  // in the 2024 official photograph. There is deliberately no invented torso.
  box(3.08, .12, 2.48, 0, .06, 0, stone); box(2.9, 1.68, 2.3, 0, .96, 0, dark); box(3, .08, 2.38, 0, 1.84, 0, dark);
  const wrist = new THREE.CylinderGeometry(.77, 1.02, 1.3, 18, 5); const wp = wrist.getAttribute('position');
  for (let i = 0; i < wp.count; i++) { const y = wp.getY(i); wp.setXYZ(i, wp.getX(i) + y * .25, y + 2.48, wp.getZ(i) * .7 + .2); }
  wrist.computeVertexNormals(); batch(wrist, bronze);
  ellipsoid(.25, 3.04, .54, .93, .58, .44, bronze, -.24);
  // The hand sweeps from the wrist to the cheek. Four bent fingers remain
  // separate close silhouettes, with narrow creases instead of mitten spheres.
  for (let i = 0; i < 4; i++) {
    const y = 3.13 + i * .21, tip = .91 - i * .09;
    curve([[-.63, y - .3, .72], [-.05, y + .02, 1.02], [.54, y + .1, 1.04], [tip, y + .04, .83]], .145 - i * .008, bronze, 18);
  }
  curve([[-.75, 2.65, .65], [-.98, 3.01, .73], [-.76, 3.42, .94], [-.35, 3.62, 1.05]], .2, bronze);
  const head = new THREE.SphereGeometry(1, 64, 44), hp = head.getAttribute('position');
  const gauss = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  for (let i = 0; i < hp.count; i++) {
    const nx = hp.getX(i), ny = hp.getY(i), nz = hp.getZ(i), jaw = ny < -.3 ? 1 + (ny + .3) * .27 : 1;
    let x = nx * 1.53 * jaw, y = 4.78 + ny * 1.8, z = nz * .99;
    if (nz > 0) {
      const front = Math.min(1, nz * 3);
      z += front * (.56 * gauss(x, y, 0, 4.8, .24, .7) + .36 * gauss(x, y, 0, 4.36, .33, .25)
        - .27 * gauss(x, y, -.62, 4.92, .4, .27) - .27 * gauss(x, y, .62, 4.92, .4, .27)
        + .12 * gauss(x, y, -.92, 4.45, .34, .42) + .12 * gauss(x, y, .92, 4.45, .34, .42));
      z += .018 * Math.sin(x * 24 + y * 19) * Math.sin(y * 35) * front;
    }
    hp.setXYZ(i, x, y, z);
  }
  head.computeVertexNormals(); batch(head, bronze);
  for (const s of [-1, 1]) {
    ellipsoid(s * 1.42, 4.65, .01, .23, .49, .25, bronze, s * .12);
    ellipsoid(s * .58, 4.94, .85, .3, .115, .065, crease);
    curve([[s * .25, 4.94, .92], [s * .55, 5.055, .97], [s * .91, 4.97, .79]], .048, bronze, 12);
    curve([[s * .29, 4.89, .93], [s * .59, 4.84, .94], [s * .91, 4.97, .79]], .033, bronze, 12);
    curve([[s * .2, 5.21, 1.01], [s * .58, 5.28, 1.05], [s * .99, 5.13, .8]], .1, bronze);
    curve([[s * .23, 4.86, .98], [s * .61, 4.75, .99], [s * 1.02, 4.88, .72]], .035, bronze);
    curve([[s * .28, 4.35, 1.24], [s * .4, 4.07, 1.12], [s * .84, 3.94, .83]], .025, crease);
    for (let i = 0; i < 9; i++) curve([[s * .07, 4.09 - i * .008, 1.12], [s * .23 + s * i * .04, 4.03 - i * .016, 1.13], [s * (.28 + i * .055), 3.88 - i * .009, .99]], .034, hairMat, 9);
  }
  for (let i = 0; i < 4; i++) {
    const y = 5.55 + i * .16;
    curve([[-.85, y - .03, .85 - i * .025], [-.37, y, 1 - i * .045], [.2, y + .035, 1 - i * .045], [.79, y - .03, .85 - i * .025]], .015, crease);
  }
  // A cut-away, weathered hair mass gives the head an irregular broad outline.
  // Fine swept strands sit in this volume; stacked circular curls made it look
  // like a toy wig, which is inconsistent with the reference photograph.
  const hair = new THREE.SphereGeometry(1, 48, 32), hpos = hair.getAttribute('position'), kept = [];
  const normalised = Array.from({ length: hpos.count }, (_, i) => [hpos.getX(i), hpos.getY(i), hpos.getZ(i)]);
  for (let i = 0; i < hair.index.count; i += 3) {
    const ids = [hair.index.getX(i), hair.index.getX(i + 1), hair.index.getX(i + 2)], avg = [0, 0, 0];
    for (const id of ids) normalised[id].forEach((v, k) => avg[k] += v / 3);
    if (avg[1] < -.52 || (avg[2] > .05 && Math.abs(avg[0]) < .79 && avg[1] < .73)) continue;
    kept.push(...ids);
  }
  hair.setIndex(kept);
  for (let i = 0; i < hpos.count; i++) { const [x, y, z] = normalised[i], r = 1 + .066 * Math.sin(x * 21 + y * 11) * Math.sin(y * 25 - z * 10) + .04 * Math.cos(z * 29 + x * 12); hpos.setXYZ(i, x * 1.81 * r, 4.72 + y * 2.03 * r, z * 1.13 * r - .05); }
  hair.computeVertexNormals(); batch(hair, hairMat);
  for (const s of [-1, 1]) for (let i = 0; i < 17; i++) {
    const y = 3.84 + i * .155, x = s * (1.49 + .13 * Math.sin(i * 1.7)), z = .1 + .22 * Math.sin(i * 2.1);
    curve([[s * 1.3, y + .36, z - .05], [x + s * .17, y + .23, z], [x + s * .23, y - .04, z + .06], [x + s * .04, y - .13, z + .23]], .052 + .018 * (i % 3), hairMat, 11);
  }
  for (let i = 0; i < 23; i++) {
    const x = -1.45 + i * .13, top = 6.54 + .16 * Math.sin(i * 1.8) - Math.abs(x) * .14;
    curve([[x - .08, top - .25, -.11], [x - .19, top, .06], [x + .02, top + .1, .2], [x + .16, top - .15, .49]], .056 + (i % 3) * .015, hairMat, 11);
  }
  if (plan.platform) {
    const a = plan.platform; box(a.width, .72, a.depth, a.x, .36, a.z, stone);
    for (const step of plan.steps) box(step.width, step.surfaceY - FLOOR, step.depth, step.x, (step.surfaceY - FLOOR) / 2, step.z, stone);
    for (const col of plan.pergolaColumns) { box(.3, col.height, .3, col.x, .72 + col.height / 2, col.z, plaster); box(.46, .12, .46, col.x, .78, col.z, plaster); box(.46, .12, .46, col.x, 4.01, col.z, plaster); }
    for (const dz of [-.7, .7]) for (let i = 1; i < 7; i++) {
      const x0 = -8.7 + (i - 1) * 2.9, x1 = -8.7 + i * 2.9;
      const z0 = -4.5 - .65 * (1 - Math.abs(x0) / 8.7) + dz, z1 = -4.5 - .65 * (1 - Math.abs(x1) / 8.7) + dz;
      box(Math.hypot(x1 - x0, z1 - z0) + .38, .26, .27, (x0 + x1) / 2, 4.04, (z0 + z1) / 2, plaster, -Math.atan2(z1 - z0, x1 - x0));
    }
    for (let i = 0; i < 35; i++) { const x = -9.15 + i * .535, z = -4.5 - .65 * (1 - Math.abs(x) / 8.7); box(.12, .18, 2.1, x, 4.23, z, plaster); }
    for (const bed of plan.hedgeBeds) {
      box(bed.width, .27, bed.depth, bed.x, .135, bed.z, stone);
      box(bed.width - .2, .38, bed.depth - .2, bed.x, .45, bed.z, leaf);
      for (let i = 0; i < 13; i++) ellipsoid(bed.x - bed.width / 2 + .3 + i * .44, .63 + .025 * Math.sin(i), bed.z, .32, .19, .56, leaf);
    }
  }
  for (const [material, parts] of batches) { const g = mergeGeometries(parts, false); parts.forEach(p => p.dispose()); geometries.add(g); const mesh = new THREE.Mesh(g, material); mesh.castShadow = mesh.receiveShadow = true; mesh.name = material === bronze ? '托颏头像与手部 · 原创程序几何' : material === hairMat ? '波浪发束与胡须几何' : '雕塑、阶梯、柱架与矮篱'; holder.add(mesh); }
  const pavingMap = pavingTexture(THREE); textures.add(pavingMap);
  const pavingMat = own(new THREE.MeshStandardMaterial({ map: pavingMap, roughness: .91, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const shapes = plan.polygons.map(poly => { const s = new THREE.Shape(poly[0].map(([x, z]) => new THREE.Vector2(x, -z))); s.holes = poly.slice(1).map(r => new THREE.Path(r.map(([x, z]) => new THREE.Vector2(x, -z)))); return s; });
  const paving = new THREE.ShapeGeometry(shapes), pp = paving.getAttribute('position');
  for (let i = 0; i < pp.count; i++) paving.getAttribute('uv').setXY(i, pp.getX(i) / 6, pp.getY(i) / 6);
  geometries.add(paving); const floor = new THREE.Mesh(paving, pavingMat); floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR - .015; floor.receiveShadow = true; floor.name = '爱因斯坦广场源范围 · 灰红石板铺装'; group.add(floor);
  // Only the title is legible enough to transcribe; no fictitious dedicatory body.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256; const context = canvas.getContext('2d');
    if (context) { context.fillStyle = '#343a36'; context.fillRect(0, 0, 512, 256); context.fillStyle = '#c5c2aa'; context.textAlign = 'center'; context.font = '37px serif'; context.fillText('韵 苑 落 成 记', 256, 59);
      const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; textures.add(t); const m = own(new THREE.MeshStandardMaterial({ map: t, roughness: .75 })); const g = new THREE.PlaneGeometry(2.6, 1.3); geometries.add(g); const plaque = new THREE.Mesh(g, m); plaque.position.set(0, .98, 1.157); plaque.name = '已核实碑题；正文未获得清晰影像，不杜撰'; holder.add(plaque); }
  }
  const center = new THREE.Vector3(p.x, 3, p.z);
  return { group, plan, infrastructure, dispose, update(camera) { if (camera?.position) holder.visible = camera.position.distanceToSquared(center) < 550 * 550; }, counts: { drawCalls: group.children.length + holder.children.length - 1, triangles: [...geometries].reduce((n, g) => n + (g.index?.count ?? g.getAttribute('position').count) / 3, 0) } };
}
