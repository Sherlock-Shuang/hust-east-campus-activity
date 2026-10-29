import polygonClipping from 'polygon-clipping';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getRoadProfile } from './building-profiles.js';
import { pointInLandcover } from './campus-landcover.js';
import { localToGeo } from './geospatial.js';

export const EINSTEIN_SQUARE_SOURCE_ID = 'way/98865830';
export const EINSTEIN_SQUARE_EVIDENCE = Object.freeze({
  sourceId: EINSTEIN_SQUARE_SOURCE_ID,
  sourceUrl: 'https://www.openstreetmap.org/way/98865830',
  photoArticle: 'https://m.thepaper.cn/newsDetail_forward_28494834',
  photograph: 'https://imagepphcloud.thepaper.cn/pph/image/319/91/301.jpg',
  photographDate: '2024-08-22 publication; capture date unspecified',
  locationArticle: 'https://www.sohu.com/a/192202956_407273',
  orientationArticle: 'https://www.sohu.com/a/334911573_781998',
  overhead: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/19/215437/428794',
  placementBasis: 'Public overhead imagery aligned against the unchanged 14/15/17/18 dormitory footprints; user confirms the statue is south of the transverse road and faces Dongyuan canteen. Imagery capture date is unknown.',
  siteCorrection: 'The user requested a further small southward statue adjustment: +3 m on the campus Z axis. This is user site calibration, not a surveyed displacement; paving, northern corridor and roads stay at their registered positions.',
  observed: 'A monumental head with a hand supporting the chin, waved hair, dark rectangular inscribed plinth, white open pergola behind, low clipped hedge, side steps and pink/grey rectangular paving.',
  uncertainty: 'Square outline is the unmodified OSM source. Statue point and independent curved pergola are registered to overhead imagery, not a survey or photogrammetric scan; dimensions, risers and sculpture detail remain photo-informed estimates. The northern grass cap is not paved. The back and inscription body are not reconstructed from invented text.',
});
// Image registration, not a GPS survey. Keep the statue and northern corridor
// independent: perspective in a ground photograph previously compressed their
// real separation into 4.8 m and put both on the wrong side of the road.
export const EINSTEIN_SQUARE_ALIGNMENT = Object.freeze({
  statue: Object.freeze([114.4300345, 30.5164233]),
  statueSouthAdjustmentM: 3,
  pergolaCourt: Object.freeze([114.430055, 30.516601]),
  frontAxis: Object.freeze([114.430019, 30.516245]),
  measured: false,
});
const FLOOR = .16;
const rawPolygons = record => (record?.shapes || []).map(s => [s.getPoints().map(p => [p.x, -p.y]), ...s.holes.map(h => h.getPoints().map(p => [p.x, -p.y]))]);
const rectangle = (x, z, width, depth) => [[x - width / 2, z - depth / 2], [x + width / 2, z - depth / 2], [x + width / 2, z + depth / 2], [x - width / 2, z + depth / 2]];
const arcRing = (cx, cz, outer, inner, start, end, segments = 32) => {
  const ring = [];
  for (let i = 0; i <= segments; i++) { const a = start + (end - start) * i / segments; ring.push([cx + Math.sin(a) * outer, cz - Math.cos(a) * outer]); }
  for (let i = segments; i >= 0; i--) { const a = start + (end - start) * i / segments; ring.push([cx + Math.sin(a) * inner, cz - Math.cos(a) * inner]); }
  return ring;
};

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
  const available = exclusions.length ? polygonClipping.difference(sourcePolygons, ...exclusions) : sourcePolygons;
  const registered = local(EINSTEIN_SQUARE_ALIGNMENT.statue), front = local(EINSTEIN_SQUARE_ALIGNMENT.frontAxis);
  // Move only the statue assembly; keep the independently aligned ground and
  // corridor fixed, including the already established south-facing orientation.
  const origin = { ...registered, z: registered.z + EINSTEIN_SQUARE_ALIGNMENT.statueSouthAdjustmentM, north: registered.north - EINSTEIN_SQUARE_ALIGNMENT.statueSouthAdjustmentM };
  const yaw = Math.atan2(front.x - registered.x, front.z - registered.z);
  const statueCoordinate = localToGeo(origin, frame);
  plan.pavingCenter = { x: registered.x, z: registered.z };
  const at = (x, z) => ({ x: origin.x + x * Math.cos(yaw) + z * Math.sin(yaw), z: origin.z - x * Math.sin(yaw) + z * Math.cos(yaw) });
  const fromWorld = p => ({ x: (p.x - origin.x) * Math.cos(yaw) - (p.z - origin.z) * Math.sin(yaw), z: (p.x - origin.x) * Math.sin(yaw) + (p.z - origin.z) * Math.cos(yaw) });
  const polygon = (x, z, width, depth) => rectangle(x, z, width, depth).map(p => at(...p));
  // The mapped park includes a separate grass cap north of the transverse road.
  // Only the connected southern court containing the photographed statue is paved.
  plan.polygons = available.filter(poly => pointInLandcover(origin.x, origin.z, [poly]));
  if (!plan.polygons.length) return plan;
  const fits = ring => ring.every(p => pointInLandcover(p.x, p.z, plan.polygons));
  plan.statue = { ...origin, y: FLOOR, yaw, width: 4.7, height: 7.3, plinthWidth: 2.9, plinthHeight: 1.8, plinthDepth: 2.3,
    coordinate: [statueCoordinate.longitude, statueCoordinate.latitude], registeredCoordinate: [...EINSTEIN_SQUARE_ALIGNMENT.statue], southAdjustmentM: EINSTEIN_SQUARE_ALIGNMENT.statueSouthAdjustmentM, form: 'head-and-supporting-hand', measured: false };
  if (!fits(polygon(0, 0, 5, 4))) return plan;
  plan.accepted = true;
  for (const poly of plan.polygons) plan.walkSurfaces.push({ id: 'einstein-square-paving', sourceId: source.id, kind: 'plaza', polygon: poly[0].map(([x, z]) => ({ x, z })), holes: poly.slice(1).map(r => r.map(([x, z]) => ({ x, z }))), surfaceY: FLOOR });
  plan.barriers.push({ id: 'einstein-statue-plinth', sourceId: source.id, polygon: polygon(0, 0, 2.95, 2.35), minHeight: FLOOR, height: FLOOR + 3.5, label: '爱因斯坦雕塑及基座', estimated: true });
  plan.barriers.push({ id: 'einstein-statue-head', sourceId: source.id, polygon: polygon(0, 0, 4.5, 2.5), minHeight: FLOOR + 3.5, height: FLOOR + 7.3, label: '爱因斯坦头像', estimated: true });
  const court = fromWorld(local(EINSTEIN_SQUARE_ALIGNMENT.pergolaCourt));
  const platformRing = arcRing(court.x, court.z, 12.7, 9.2, -Math.PI / 2, Math.PI / 2);
  const platform = platformRing.map(p => at(...p));
  if (fits(platform)) {
    plan.pergola = { ...court, coordinate: [...EINSTEIN_SQUARE_ALIGNMENT.pergolaCourt], radius: 10.95, outerRadius: 12.7, innerRadius: 9.2, measured: false };
    plan.platform = { ...court, localPolygon: platformRing, surfaceY: FLOOR + .72, polygon: platform };
    plan.walkSurfaces.push({ id: 'einstein-pergola-platform', sourceId: source.id, polygon: platform, surfaceY: FLOOR + .72, kind: 'platform', estimated: true });
    // Both annular edges have retaining barriers; the open ends meet the stairs.
    for (const radius of [9.2, 12.7]) for (let i = 0; i < 32; i++) {
      const a = -Math.PI / 2 + Math.PI * i / 32, b = a + Math.PI / 32;
      plan.barriers.push({ id: `einstein-platform-edge-${radius}-${i}`, sourceId: source.id,
        polygon: arcRing(court.x, court.z, radius + .06, radius - .06, a, b, 1).map(p => at(...p)),
        minHeight: FLOOR, height: FLOOR + .72, label: '弧形廊架平台边缘', estimated: true });
    }
    for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
      const step = { side, x: court.x + side * 10.95, z: court.z + 2.31 - i * .42, width: 3.1, depth: .42, surfaceY: FLOOR + (i + 1) * .12 };
      step.polygon = polygon(step.x, step.z, step.width, step.depth);
      if (!fits(step.polygon)) continue;
      plan.steps.push(step);
      plan.walkSurfaces.push({ id: `einstein-step-${side}-${i}`, sourceId: source.id, polygon: step.polygon, surfaceY: step.surfaceY, kind: 'stair', estimated: true });
    }
    for (let i = 0; i <= 10; i++) {
      const angle = -Math.PI / 2 + Math.PI * i / 10;
      for (const radius of [9.8, 12.05]) {
        const col = { x: court.x + Math.sin(angle) * radius, z: court.z - Math.cos(angle) * radius, height: 3.3, width: .3, angle };
        if (!fits(polygon(col.x, col.z, .5, .5))) continue;
        plan.pergolaColumns.push(col);
        plan.barriers.push({ id: `einstein-pergola-${i}-${radius}`, sourceId: source.id, polygon: polygon(col.x, col.z, .32, .32), minHeight: FLOOR + .72, height: FLOOR + 4.02, label: '白色弧形廊架立柱', estimated: true });
      }
    }
    // The overhead view shows a planted semicircle inside the northern corridor
    // and two curved low beds framing its southern opening, not a solid white box.
    const lawn = arcRing(court.x, court.z, 8.8, 0, -Math.PI / 2, Math.PI / 2);
    plan.pergolaLawn = { localPolygon: lawn, polygon: lawn.map(p => at(...p)), height: .28 };
    plan.barriers.push({ id: 'einstein-pergola-garden', sourceId: source.id, polygon: plan.pergolaLawn.polygon, minHeight: FLOOR, height: FLOOR + .55, label: '北廊内弧形种植区', estimated: true });
    for (const [start, end] of [[Math.PI / 2 + .12, Math.PI - .16], [Math.PI + .16, Math.PI * 1.5 - .12]]) {
      const ring = arcRing(court.x, court.z, 8.9, 8.05, start, end, 16), bed = { localPolygon: ring, polygon: ring.map(p => at(...p)), height: .64 };
      if (!fits(bed.polygon)) continue;
      plan.hedgeBeds.push(bed);
      plan.barriers.push({ id: `einstein-hedge-${start}`, sourceId: source.id, polygon: bed.polygon, minHeight: FLOOR, height: FLOOR + bed.height, label: '廊前弧形花池', estimated: true });
    }
  }
  // A normal walking arrival on the southern paved court, looking up its axis.
  // The position is checked against both the actual court and all solid barriers.
  for (const [x, z] of [[1.5, 11.5], [0, 9], [3.5, 8]]) {
    const p = at(x, z);
    if (!pointInLandcover(p.x, p.z, plan.polygons) || plan.barriers.some(b => pointInLandcover(p.x, p.z, [[b.polygon.map(v => [v.x, v.z])]]))) continue;
    plan.arrival = { ...p, y: FLOOR, yaw: Math.atan2(p.x - origin.x, p.z - origin.z), pitch: -.12 };
    break;
  }
  if (!plan.arrival) { plan.accepted = false; plan.barriers = []; plan.walkSurfaces = []; return plan; }
  plan.inspection = { target: [origin.x, 3.5, origin.z], position: [at(10, 20).x, 4.2, at(10, 20).z], label: '爱因斯坦广场' };
  plan.pedestrianInspection = { target: [origin.x, 4.1, origin.z], position: [plan.arrival.x, 1.7, plan.arrival.z] };
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
  function extrudedRing(ring, height, material, base = 0) {
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
    g.rotateX(-Math.PI / 2); g.translate(0, base, 0); batch(g, material);
  }
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
    extrudedRing(plan.platform.localPolygon, .72, stone);
    for (const step of plan.steps) box(step.width, step.surfaceY - FLOOR, step.depth, step.x, (step.surfaceY - FLOOR) / 2, step.z, stone);
    for (const col of plan.pergolaColumns) { box(.3, col.height, .3, col.x, .72 + col.height / 2, col.z, plaster); box(.46, .12, .46, col.x, .78, col.z, plaster); box(.46, .12, .46, col.x, 4.01, col.z, plaster); }
    const court = plan.pergola;
    for (const radius of [9.8, 12.05]) {
      const ring = arcRing(court.x, court.z, radius + .14, radius - .14, -Math.PI / 2, Math.PI / 2, 40);
      extrudedRing(ring, .26, plaster, 3.91);
    }
    for (let i = 0; i <= 48; i++) {
      const a = -Math.PI / 2 + Math.PI * i / 48, radius = 10.925;
      box(.12, .18, 3.1, court.x + Math.sin(a) * radius, 4.23, court.z - Math.cos(a) * radius, plaster, -a);
    }
    if (plan.pergolaLawn) extrudedRing(plan.pergolaLawn.localPolygon, .28, leaf);
    for (const bed of plan.hedgeBeds) {
      extrudedRing(bed.localPolygon, .27, stone);
      extrudedRing(bed.localPolygon, .37, leaf, .27);
    }
  }
  for (const [material, parts] of batches) { const g = mergeGeometries(parts, false); parts.forEach(p => p.dispose()); geometries.add(g); const mesh = new THREE.Mesh(g, material); mesh.castShadow = mesh.receiveShadow = true; mesh.name = material === bronze ? '托颏头像与手部 · 原创程序几何' : material === hairMat ? '波浪发束与胡须几何' : '雕塑、阶梯、柱架与矮篱'; holder.add(mesh); }
  const pavingMap = pavingTexture(THREE); textures.add(pavingMap);
  const pavingMat = own(new THREE.MeshStandardMaterial({ map: pavingMap, roughness: .91, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const pavingCenter = plan.pavingCenter;
  const circle = (radius, count = 64) => Array.from({ length: count + 1 }, (_, i) => [pavingCenter.x + Math.sin(i / count * Math.PI * 2) * radius, pavingCenter.z + Math.cos(i / count * Math.PI * 2) * radius]);
  const roundCourt = polygonClipping.intersection([[circle(9.35)]], plan.polygons);
  const rings = polygonClipping.union(...[4.6, 8.9].map(r => [arcRing(pavingCenter.x, pavingCenter.z, r + .12, r - .12, 0, Math.PI * 2, 64)]));
  // Cut disjoint surfaces, rather than stacking almost coplanar decoration.
  const shapes = polygonClipping.difference(plan.polygons, roundCourt).map(poly => { const s = new THREE.Shape(poly[0].map(([x, z]) => new THREE.Vector2(x, -z))); s.holes = poly.slice(1).map(r => new THREE.Path(r.map(([x, z]) => new THREE.Vector2(x, -z)))); return s; });
  const paving = new THREE.ShapeGeometry(shapes), pp = paving.getAttribute('position');
  for (let i = 0; i < pp.count; i++) paving.getAttribute('uv').setXY(i, pp.getX(i) / 6, pp.getY(i) / 6);
  geometries.add(paving); const floor = new THREE.Mesh(paving, pavingMat); floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR - .015; floor.receiveShadow = true; floor.name = '爱因斯坦广场源范围 · 灰红石板铺装'; group.add(floor);
  // The overhead photograph distinguishes the southern circular patterned
  // court from the northern planted/pergola court. These are original colours,
  // never a downloaded aerial image used as a runtime texture.
  function pavedAccent(polygons, material, y) {
    if (!polygons.length) return;
    const shapes = polygons.map(poly => { const shape = new THREE.Shape(poly[0].map(([x, z]) => new THREE.Vector2(x, -z))); shape.holes = poly.slice(1).map(r => new THREE.Path(r.map(([x, z]) => new THREE.Vector2(x, -z)))); return shape; });
    const g = new THREE.ShapeGeometry(shapes); geometries.add(g);
    const mesh = new THREE.Mesh(g, material); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; mesh.receiveShadow = true; mesh.name = '卫星配准的南圆场同心铺装'; group.add(mesh);
  }
  const rose = mat('#a89081'), band = mat('#c0b9a8');
  pavedAccent(polygonClipping.difference(roundCourt, rings), rose, FLOOR - .015);
  pavedAccent(polygonClipping.intersection(rings, roundCourt), band, FLOOR - .015);
  // Only the title is legible enough to transcribe; no fictitious dedicatory body.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256; const context = canvas.getContext('2d');
    if (context) { context.fillStyle = '#343a36'; context.fillRect(0, 0, 512, 256); context.fillStyle = '#c5c2aa'; context.textAlign = 'center'; context.font = '37px serif'; context.fillText('韵 苑 落 成 记', 256, 59);
      const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; textures.add(t); const m = own(new THREE.MeshStandardMaterial({ map: t, roughness: .75 })); const g = new THREE.PlaneGeometry(2.6, 1.3); geometries.add(g); const plaque = new THREE.Mesh(g, m); plaque.position.set(0, .98, 1.157); plaque.name = '已核实碑题；正文未获得清晰影像，不杜撰'; holder.add(plaque); }
  }
  const center = new THREE.Vector3(p.x, 3, p.z);
  return { group, plan, infrastructure, dispose, update(camera) { if (camera?.position) holder.visible = camera.position.distanceToSquared(center) < 550 * 550; }, counts: { drawCalls: group.children.length + holder.children.length - 1, triangles: [...geometries].reduce((n, g) => n + (g.index?.count ?? g.getAttribute('position').count) / 3, 0) } };
}
