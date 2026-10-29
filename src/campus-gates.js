import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CAMPUS_GATE_SOURCES = Object.freeze({
  east: 'way/104350466', eastPassage: 'way/478977155',
  yunyuan: 'node/1194858814', yunyuanRoad: 'way/97057001',
});
export const CAMPUS_GATE_EVIDENCE = Object.freeze({
  east: {
    article: 'https://www.sohu.com/a/337138707_673149',
    photograph: 'https://5b0988e595225.cdn.sohucs.com/images/20190829/47ac9cda5569483c8ab00e5014591e9f.jpeg',
    supplementaryPhoto: 'https://commons.wikimedia.org/wiki/File:HUST_East_Campus.JPG',
    observed: 'East campus main gate: four grey piers, a flat red fascia, grey panelled soffit, side pedestrian passages, glazed side guard booths and raised vehicle barriers.',
    location: 'Existing mapped gate-building footprint at the south end of Huxi Road, crossed by a building_passage road. Not the Northeast Gate, the Qiming Road exit, or the main campus South Gate.',
    uncertainty: 'Footprint is source GIS. Heights, openings and furnishings are photo-informed estimates. Official photo published 2019 and supplementary photo captured 2012; present-day finishes are not independently surveyed.',
  },
  yunyuan: {
    article: 'https://news.hust.edu.cn/info/1004/22620.htm',
    localPhotograph: '宣传片/真实参考图片/截屏2026-10-06 20.19.10.png',
    photograph: 'https://news.sina.cn/gn/2020-12-11/detail-iiznctke6018801.d.html',
    observed: 'The residential entrance is between Yunyuan canteen and dormitory 5, north of the Yujia/Qiming junction. The photographed bird/egg sculpture already belongs to the existing forecourt layer.',
    uncertainty: 'The gate node and access road are source GIS. Street photographs establish an open entrance, not an overhead monumental arch. Small open side railings and posts are restrained illustrative estimates; no guardhouse, invented gate roof or duplicate sculpture is added here.',
  },
});
const FLOOR = .14;
const rectangle = (width, depth, x = 0, z = 0) => [[x - width / 2, z - depth / 2], [x + width / 2, z - depth / 2], [x + width / 2, z + depth / 2], [x - width / 2, z + depth / 2]];
const worldPoint = (gate, x, z) => ({ x: gate.x + x * Math.cos(gate.yaw) + z * Math.sin(gate.yaw), z: gate.z - x * Math.sin(gate.yaw) + z * Math.cos(gate.yaw) });
const worldRing = (gate, ring) => ring.map(([x, z]) => worldPoint(gate, x, z));

/** Only source-backed entrances are accepted. Original map records and their
 * geometry are never edited. Positions use the same explicit WGS84 frame. */
export function planCampusGates(model, { frame, geoToLocal } = {}) {
  const plan = { gates: [], barriers: [], walkSurfaces: [], forestExclusions: [], replacedBuildingIds: [], accepted: false, evidence: CAMPUS_GATE_EVIDENCE };
  if (!frame || typeof geoToLocal !== 'function') return plan;
  const records = model?.records || [], find = id => records.find(r => r.id === id);
  const project = c => geoToLocal({ longitude: c[0], latitude: c[1], height: 0, coordinateSystem: 'EPSG:4326' }, frame);
  const lines = record => record?.feature?.geometry?.type === 'LineString' ? record.feature.geometry.coordinates : null;
  const gateBuilding = find(CAMPUS_GATE_SOURCES.east), passage = find(CAMPUS_GATE_SOURCES.eastPassage), passageLine = lines(passage);
  if (gateBuilding?.shapes?.length && passageLine?.length > 1 && passage.feature.properties.tags?.tunnel === 'building_passage') {
    const a = project(passageLine[0]), b = project(passageLine.at(-1));
    const south = a.z > b.z ? a : b, north = a.z > b.z ? b : a;
    const gate = { id: 'east-campus-main-gate', label: '东校区大门', sourceId: gateBuilding.id, roadSourceId: passage.id, kind: 'red-lintel', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
      yaw: Math.atan2(south.x - north.x, south.z - north.z), coordinate: [(passageLine[0][0] + passageLine.at(-1)[0]) / 2, (passageLine[0][1] + passageLine.at(-1)[1]) / 2], floor: FLOOR, estimated: true, parts: [], openings: [] };
    const ring = gateBuilding.shapes[0].getPoints().map(p => ({ x: p.x, z: -p.y }));
    const inGate = p => ({ x: (p.x - gate.x) * Math.cos(gate.yaw) - (p.z - gate.z) * Math.sin(gate.yaw), z: (p.x - gate.x) * Math.sin(gate.yaw) + (p.z - gate.z) * Math.cos(gate.yaw) });
    const local = ring.map(inGate);
    gate.width = Math.max(...local.map(p => p.x)) - Math.min(...local.map(p => p.x));
    gate.depth = Math.max(...local.map(p => p.z)) - Math.min(...local.map(p => p.z));
    if (gate.width > 12 && gate.width < 28 && gate.depth > 3 && gate.depth < 10) {
      gate.height = 6.7; gate.clearance = 5.35;
      const outer = gate.width / 2 - .55, inner = outer - 2.75, pierWidth = .82;
      gate.piers = [-outer, -inner, inner, outer];
      gate.openings = [{ id: 'vehicle', kind: 'vehicle', x: 0, width: inner * 2 - pierWidth, z: 0, depth: gate.depth + 1, clearHeight: gate.clearance },
        ...[-1, 1].map(side => ({ id: `pedestrian-${side}`, kind: 'pedestrian', x: side * (outer + inner) / 2, width: outer - inner - pierWidth, z: 0, depth: gate.depth + 4, clearHeight: gate.clearance }))];
      gate.piers.forEach((x, i) => gate.parts.push({ id: `pier-${i}`, x, z: .35, width: pierWidth, depth: 1.35, minHeight: FLOOR, height: gate.clearance, kind: 'pier' }));
      gate.parts.push({ id: 'lintel', x: 0, z: 0, width: gate.width, depth: gate.depth, minHeight: gate.clearance, height: gate.height, kind: 'lintel' });
      for (const side of [-1, 1]) {
        gate.parts.push({ id: `guardhouse-${side}`, x: side * (gate.width / 2 + 2.4), z: -.65, width: 3.5, depth: 4.2, minHeight: FLOOR, height: 3.05, kind: 'guardhouse' });
        gate.parts.push({ id: `barrier-machine-${side}`, x: side * (inner - .75), z: -gate.depth / 2 - 2.3, width: .48, depth: .5, minHeight: FLOOR, height: 1.2, kind: 'machine' });
      }
      plan.gates.push(gate); plan.replacedBuildingIds.push(gateBuilding.id);
    }
  }
  const residential = find(CAMPUS_GATE_SOURCES.yunyuan), residentialRoad = find(CAMPUS_GATE_SOURCES.yunyuanRoad), road = lines(residentialRoad);
  if (residential?.feature?.geometry?.type === 'Point' && residential.feature.properties.tags?.barrier === 'gate' && road?.length > 1) {
    const coordinate = residential.feature.geometry.coordinates, index = road.findIndex(c => Math.hypot(c[0] - coordinate[0], c[1] - coordinate[1]) < 1e-9);
    if (index >= 0) {
      const p = project(coordinate), next = road.slice(index + 1).map(project).find(q => q.z < p.z - 1);
      if (next) {
        const gate = { id: 'yunyuan-residential-gate', label: '韵苑生活区入口', sourceId: residential.id, roadSourceId: residentialRoad.id, kind: 'open-residential',
          x: p.x, z: p.z, yaw: Math.atan2(p.x - next.x, p.z - next.z), coordinate: [...coordinate], width: 13.6, depth: 3.4, floor: FLOOR, height: 1.48, estimated: true, parts: [],
          openings: [{ id: 'shared', kind: 'vehicle-and-pedestrian', x: 0, z: 0, width: 10, depth: 14, clearHeight: Infinity }] };
        for (const side of [-1, 1]) {
          gate.parts.push({ id: `post-${side}`, x: side * 5.55, z: 0, width: .46, depth: .46, minHeight: FLOOR, height: 1.48, kind: 'low-post' });
          // Open leaves fold along the side of the approach; they never span
          // the source road or require the player to open a simulated lock.
          gate.parts.push({ id: `open-railing-${side}`, x: side * 5.55, z: -1.9, width: .26, depth: 3.1, minHeight: FLOOR, height: 1.22, kind: 'open-rail' });
        }
        if (index > 0) {
          const before = project(road[index - 1]), d = Math.hypot(before.x - p.x, before.z - p.z), t = Math.min(9 / d, .8);
          gate.approach = { x: p.x + (before.x - p.x) * t, z: p.z + (before.z - p.z) * t };
        }
        plan.gates.push(gate);
      }
    }
  }
  for (const gate of plan.gates) {
    for (const part of gate.parts) plan.barriers.push({ id: `${gate.id}-${part.id}`, sourceId: gate.sourceId, polygon: worldRing(gate, rectangle(part.width, part.depth, part.x, part.z)), minHeight: part.minHeight, height: part.height, label: gate.label, estimated: true });
    // Road centre stays at the shared ground datum. Side pedestrians can pass
    // either side of the inner columns; no full-footprint building collision.
    for (const opening of gate.openings) {
      const polygon = worldRing(gate, rectangle(opening.width, opening.depth, opening.x, opening.z));
      plan.walkSurfaces.push({ id: `${gate.id}-${opening.id}-surface`, sourceId: gate.sourceId, polygon, surfaceY: FLOOR, kind: 'gate-passage', estimated: true });
      plan.forestExclusions.push([polygon.map(p => [p.x, p.z])]);
    }
    for (const part of gate.parts.filter(p => p.kind !== 'lintel')) plan.forestExclusions.push([worldRing(gate, rectangle(part.width + 1, part.depth + 1, part.x, part.z)).map(p => [p.x, p.z])]);
    const p = gate.approach || worldPoint(gate, -1.8, 12);
    gate.arrival = { ...p, y: FLOOR, yaw: Math.atan2(p.x - gate.x, p.z - gate.z), pitch: gate.kind === 'red-lintel' ? -.16 : -.04 };
    const camera = worldPoint(gate, gate.kind === 'red-lintel' ? 13 : 10, 19);
    gate.inspection = { label: gate.label, target: [gate.x, gate.kind === 'red-lintel' ? 3.4 : 1.4, gate.z], position: [camera.x, gate.kind === 'red-lintel' ? 3.2 : 2.2, camera.z] };
  }
  const points = plan.forestExclusions.flat(2);
  if (points.length) plan.bounds = { minX: Math.min(...points.map(p => p[0])) - 2, maxX: Math.max(...points.map(p => p[0])) + 2, minZ: Math.min(...points.map(p => p[1])) - 2, maxZ: Math.max(...points.map(p => p[1])) + 2 };
  plan.accepted = plan.gates.length > 0;
  return plan;
}

/** Photo-referenced original geometry. Source photos remain research artifacts,
 * with no remote textures, downloaded images or runtime photo requests. */
export function createCampusGates(THREE, model, options = {}) {
  const plan = planCampusGates(model, options), group = new THREE.Group(); group.name = '东校区大门与韵苑生活区入口';
  group.userData = { component: 'campus-gates', sourceFootprintsUnchanged: true, evidence: CAMPUS_GATE_EVIDENCE };
  const geometries = new Set(), materials = new Set(), textures = new Set(), holders = [];
  let disposed = false;
  const own = m => (materials.add(m), m), mat = (color, roughness = .85, metalness = 0) => own(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const stone = mat('#8a8c86'), base = mat('#686d65'), fascia = mat('#813d35'), trim = mat('#b1b5ad', .64), glass = mat('#405b5d', .3, .23), steel = mat('#bdc4c1', .45, .8), white = mat('#e7e5d9'), blue = mat('#315f88'), dark = mat('#253036');
  const counts = { drawCalls: 0, triangles: 0 };
  for (const gate of plan.gates) {
    const holder = new THREE.Group(), batches = new Map(); holder.name = gate.label; holder.position.set(gate.x, 0, gate.z); holder.rotation.y = gate.yaw; holder.userData = { sourceId: gate.sourceId, estimated: true, evidence: CAMPUS_GATE_EVIDENCE[gate.kind === 'red-lintel' ? 'east' : 'yunyuan'] }; group.add(holder); holders.push({ holder, gate });
    function batch(g, material) {
      const geometry = g.index ? g.toNonIndexed() : g; if (geometry !== g) g.dispose();
      if (!batches.has(material)) batches.set(material, []); batches.get(material).push(geometry);
    }
    function box(width, height, depth, x, y, z, material, rotation = 0) { const g = new THREE.BoxGeometry(width, height, depth); g.rotateZ(rotation); g.translate(x, y, z); batch(g, material); }
    function bar(a, b, radius, material, segments = 8) { const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), v = end.clone().sub(start), g = new THREE.CylinderGeometry(radius, radius, v.length(), segments); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize())); g.translate(...start.add(end).multiplyScalar(.5).toArray()); batch(g, material); }
    for (const part of gate.parts) {
      const h = part.height - part.minHeight;
      if (part.kind === 'pier' || part.kind === 'low-post') {
        box(part.width, h, part.depth, part.x, part.minHeight + h / 2, part.z, stone);
        box(part.width + .1, .12, part.depth + .1, part.x, FLOOR + .06, part.z, base);
        if (part.kind === 'low-post') box(part.width + .12, .1, part.depth + .12, part.x, part.height + .02, part.z, trim);
      } else if (part.kind === 'lintel') {
        box(part.width, h, part.depth, 0, part.minHeight + h / 2, 0, fascia);
        box(part.width, .12, part.depth, 0, part.minHeight + .06, 0, base);
        // Recessed, matte panel grid under the lintel, visible from below.
        for (let x = -part.width / 2 + .6; x < part.width / 2 - .1; x += 1.15) box(.018, .015, part.depth - .1, x, part.minHeight - .014, 0, trim);
        for (let z = -part.depth / 2 + .65; z < part.depth / 2; z += .85) box(part.width - .1, .015, .018, 0, part.minHeight - .014, z, trim);
      } else if (part.kind === 'guardhouse') {
        box(part.width, 1.02, part.depth, part.x, FLOOR + .51, part.z, stone);
        box(part.width - .18, 1.73, part.depth - .18, part.x, FLOOR + 1.89, part.z, glass);
        box(part.width + .7, .27, part.depth + .65, part.x, 3.01, part.z, trim);
        for (let x = -part.width / 2; x <= part.width / 2 + .01; x += part.width / 4) for (const side of [-1, 1]) box(.055, 1.75, .08, part.x + x, FLOOR + 1.88, part.z + side * (part.depth / 2 - .06), steel);
        for (const side of [-1, 1]) box(part.width, .075, .08, part.x, FLOOR + 2.74, part.z + side * part.depth / 2, steel);
        for (let row = 0; row < 5; row++) box(part.width, .012, .012, part.x, FLOOR + .12 + row * .19, part.z + part.depth / 2 + .01, trim);
      } else if (part.kind === 'machine') {
        box(part.width, h, part.depth, part.x, part.minHeight + h / 2, part.z, blue);
        box(part.width + .08, .13, part.depth + .04, part.x, part.height, part.z, dark);
        // Static raised arm: always out of the vehicle aperture, no per-frame
        // animation and no implicit activity restriction at the campus gate.
        for (let i = 0; i < 8; i++) box(.105, .39, .1, part.x, part.height + .25 + i * .39, part.z, i % 2 ? fascia : white);
      } else if (part.kind === 'open-rail') {
        const a = part.z - part.depth / 2, b = part.z + part.depth / 2;
        for (const y of [FLOOR + .25, FLOOR + 1.02]) bar([part.x, y, a], [part.x, y, b], .034, steel);
        for (let z = a; z < b + .05; z += .38) bar([part.x, FLOOR + .12, z], [part.x, FLOOR + 1.04, z], .026, steel);
        for (let z = a; z < b - .3; z += .76) { bar([part.x, FLOOR + .3, z], [part.x, FLOOR + .98, Math.min(z + .76, b)], .022, steel); bar([part.x, FLOOR + .98, z], [part.x, FLOOR + .3, Math.min(z + .76, b)], .022, steel); }
      }
    }
    if (gate.kind === 'red-lintel') {
      const inner = gate.piers[2];
      for (const opening of gate.openings.filter(o => o.kind === 'pedestrian')) box(opening.width, .07, opening.depth, opening.x, FLOOR - .035, 0, trim);
      for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
        const x = side * (inner - .7), z = -gate.depth / 2 - 4 - i * 1.65;
        const g = new THREE.CylinderGeometry(.11, .23, .7, 8); g.translate(x, FLOOR + .35, z); batch(g, blue);
        const ring = new THREE.CylinderGeometry(.15, .17, .14, 8); ring.translate(x, FLOOR + .43, z); batch(ring, white);
      }
      for (const side of [-1, 1]) {
        const x0 = side * (gate.width / 2 + .6), x1 = side * (gate.width / 2 + 4.3), z = 2.3;
        for (const y of [.55, 1.3]) bar([x0, y, z], [x1, y, z], .035, steel);
        for (let t = 0; t <= 1; t += .1) bar([x0 + (x1 - x0) * t, FLOOR, z], [x0 + (x1 - x0) * t, 1.35, z], .026, steel);
      }
    }
    for (const [material, pieces] of batches) {
      const g = mergeGeometries(pieces, false); pieces.forEach(piece => piece.dispose()); geometries.add(g);
      g.computeBoundingSphere(); const mesh = new THREE.Mesh(g, material); mesh.castShadow = true; mesh.receiveShadow = true; holder.add(mesh);
      counts.drawCalls++; counts.triangles += g.getAttribute('position').count / 3;
    }
    // Runtime lettering is generated from the observed inscription only.
    if (gate.kind === 'red-lintel' && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 768; const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#783b32'; ctx.fillRect(0, 0, 128, 768); ctx.fillStyle = '#d5b97a'; ctx.textAlign = 'center'; ctx.font = '68px serif';
        [...'华中科技大学'].forEach((c, i) => ctx.fillText(c, 64, 110 + i * 107));
        const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; textures.add(t);
        const material = own(new THREE.MeshStandardMaterial({ map: t, roughness: .81 })), g = new THREE.PlaneGeometry(.65, 3.9); geometries.add(g);
        const sign = new THREE.Mesh(g, material); sign.position.set(gate.piers[2], 3.0, .35 + 1.35 / 2 + .014); holder.add(sign); counts.drawCalls++; counts.triangles += 2;
      }
    }
  }
  const dispose = () => { if (disposed) return; disposed = true; geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); group.removeFromParent(); group.clear(); };
  return { group, plan, counts, forestExclusions: plan.forestExclusions, viewpoints: Object.fromEntries(plan.gates.map(g => [g.kind === 'red-lintel' ? 'east-gate' : 'yunyuan-gate', { id: g.id, ...g.inspection, arrival: g.arrival }])),
    infrastructure: { buildings: [], barriers: plan.barriers, walkSurfaces: plan.walkSurfaces, replacedBuildingIds: plan.replacedBuildingIds, extraBounds: plan.bounds },
    update(camera) { if (disposed || !camera?.position) return; for (const { holder, gate } of holders) holder.visible = (camera.position.x - gate.x) ** 2 + (camera.position.z - gate.z) ** 2 < 620 ** 2; }, dispose };
}
