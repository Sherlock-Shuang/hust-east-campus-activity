import { applyWorldUV } from './surface-materials.js';
import { createSportsInfrastructure } from './sports-infrastructure.js';
import { createSportsAccess } from './campus-sports-access.js';

const COURT_SPORTS = new Set(['basketball', 'volleyball', 'badminton', 'tennis']);
const MARKED_SPORTS = new Set([...COURT_SPORTS, 'soccer']);

function profileFor(tags) {
  // Source tags identify a use, not its actual surface colour or material.
  // Unclassified pitches remain neutral: a name alone does not invent a sport.
  if (tags.leisure === 'track') return { kind: 'track', colour: tags.sport === 'horse_racing' ? '#9a8b70' : '#9f6051', y: .046 };
  if (tags.sport === 'soccer') return { kind: 'soccer', colour: '#657d49', y: .058 };
  if (COURT_SPORTS.has(tags.sport)) return { kind: 'court', colour: tags.sport === 'basketball' ? '#8b7366' : '#687c73', y: .058 };
  return { kind: 'unclassified', colour: '#a19c80', y: .034 };
}

/** Only recognize a convex near-rectangle with exactly four source corners.
 * We retain those corners for interpolation rather than replacing the polygon
 * with an axis-aligned bounding rectangle. All distances are display metres. */
function rectangleCorners(shape) {
  if (shape.holes.length) return null;
  const points = shape.getPoints(1).map(point => ({ x: point.x, z: -point.y }));
  if (points.length > 1 && Math.hypot(points[0].x - points.at(-1).x, points[0].z - points.at(-1).z) < 1e-6) points.pop();
  if (points.length !== 4) return null;
  const edges = points.map((point, index) => {
    const next = points[(index + 1) % 4], x = next.x - point.x, z = next.z - point.z;
    return { x, z, length: Math.hypot(x, z) };
  });
  if (edges.some(edge => edge.length < 3)) return null;
  const turns = edges.map((edge, index) => {
    const next = edges[(index + 1) % 4];
    return { cross: edge.x * next.z - edge.z * next.x, cosine: (edge.x * next.x + edge.z * next.z) / (edge.length * next.length) };
  });
  if (turns.some(turn => Math.abs(turn.cosine) > .035 || turn.cross * turns[0].cross <= 0)) return null;
  if (Math.abs(edges[0].length - edges[2].length) / edges[0].length > .03 || Math.abs(edges[1].length - edges[3].length) / edges[1].length > .03) return null;
  return { points, width: (edges[0].length + edges[2].length) / 2, length: (edges[1].length + edges[3].length) / 2 };
}

function markingSegments(shape) {
  const rectangle = rectangleCorners(shape);
  if (!rectangle) return null;
  const { points, width, length } = rectangle;
  // A 0.45 m visual inset, not a claim that the source polygon is a regulation
  // playing boundary. Bilinear interpolation preserves its actual orientation.
  const s = Math.min(.12, .45 / width), t = Math.min(.12, .45 / length);
  const at = (u, v) => ({
    x: points[0].x * (1 - u) * (1 - v) + points[1].x * u * (1 - v) + points[2].x * u * v + points[3].x * (1 - u) * v,
    z: points[0].z * (1 - u) * (1 - v) + points[1].z * u * (1 - v) + points[2].z * u * v + points[3].z * (1 - u) * v,
  });
  const corners = [at(s, t), at(1 - s, t), at(1 - s, 1 - t), at(s, 1 - t)];
  const segments = corners.map((point, index) => [point, corners[(index + 1) % 4]]);
  segments.push(width > length ? [at(.5, t), at(.5, 1 - t)] : [at(s, .5), at(1 - s, .5)]);
  return segments;
}

function stripeGeometry(THREE, segments, y) {
  const positions = [], indices = [], halfWidth = .065;
  for (const [a, b] of segments) {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < .01) continue;
    const nx = -dz / length * halfWidth, nz = dx / length * halfWidth, offset = positions.length / 3;
    positions.push(a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz);
    indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/** Physical sports grounds for the 3D view. Original polygons and island holes
 * are triangulated without scaling or rectangularization. Heights are tiny
 * display offsets above the common datum, not surveyed elevation. */
export function createCampusSports(THREE, model, { surfaces } = {}) {
  const group = new THREE.Group(); group.name = '体育场地 · 源轮廓三维地面';
  group.userData = { category: 'sports', coordinateSystem: 'LOCAL_ENU', units: 'metres',
    footprintBasis: 'source polygons with holes; unmodified local coordinates',
    appearanceBasis: 'estimated colours, surface materials and inset markings; not surveyed', estimated: true };
  const counts = { features: 0, polygons: 0, holes: 0, tracks: 0, soccer: 0, courts: 0, unclassified: 0, markedPolygons: 0, markingSegments: 0, skipped: 0 };
  const geometries = new Set(), materials = new Set(), materialCache = new Map();
  function materialFor(profile) {
    if (materialCache.has(profile.colour)) return materialCache.get(profile.colour);
    const material = new THREE.MeshStandardMaterial({ color: profile.colour, roughness: .94, metalness: 0, side: THREE.DoubleSide, depthTest: true, depthWrite: true });
    if (profile.kind === 'soccer' && surfaces?.grass) {
      material.map = surfaces.grass.map; material.bumpMap = surfaces.grass.bumpMap;
      material.bumpScale = .022; material.color.set('#c2ccae');
    }
    material.name = `体育地面 ${profile.kind} · 外观估计`;
    material.userData = { estimated: true, materialBasis: 'Source use tags; colour and surface finish are visual estimates' };
    materials.add(material); materialCache.set(profile.colour, material); return material;
  }
  const paint = new THREE.MeshStandardMaterial({ name: '球场内缩标线 · 示意', color: '#deddd0', roughness: .88, metalness: 0, side: THREE.DoubleSide, depthTest: true, depthWrite: true,
    polygonOffset: true, polygonOffsetFactor: -.5, polygonOffsetUnits: -1 });
  materials.add(paint);
  for (const record of model?.records || []) {
    if (record.category !== 'sports') continue;
    if (!record.shapes?.length) { counts.skipped++; continue; }
    const tags = record.feature?.properties?.tags || {}, profile = profileFor(tags);
    const geometry = applyWorldUV(new THREE.ShapeGeometry(record.shapes, 1), 1, 'xy'); geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, materialFor(profile));
    mesh.name = record.feature?.properties?.name || `运动场地 ${record.id}`;
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = profile.y; mesh.receiveShadow = true;
    mesh.userData = { featureId: record.id, category: 'sports', kind: profile.kind, sourceUrl: record.feature?.properties?.sourceUrl,
      footprintBasis: 'source polygon with holes', sourceSport: tags.sport || null, estimated: true, surfaceOffsetMetres: profile.y, heightBasis: 'display offset, not terrain elevation' };
    group.add(mesh); counts.features++; counts.polygons += record.shapes.length;
    counts.holes += record.shapes.reduce((sum, shape) => sum + shape.holes.length, 0);
    counts[profile.kind === 'track' ? 'tracks' : profile.kind === 'court' ? 'courts' : profile.kind]++;
    if (tags.leisure !== 'pitch' || !MARKED_SPORTS.has(tags.sport)) continue;
    const allSegments = [];
    for (const shape of record.shapes) {
      const segments = markingSegments(shape);
      if (!segments) continue;
      allSegments.push(...segments); counts.markedPolygons++;
    }
    if (!allSegments.length) continue;
    const markingGeometry = stripeGeometry(THREE, allSegments, profile.y + .008); geometries.add(markingGeometry);
    const markings = new THREE.Mesh(markingGeometry, paint); markings.receiveShadow = true;
    markings.name = `球场内缩边线与中线 ${record.id}`;
    markings.userData = { featureId: record.id, category: 'sports-markings', estimated: true, sourceSport: tags.sport,
      lineWidthMetres: .13, markingBasis: 'Display-only inset boundary and half-way line aligned to the four source corners; no regulation dimensions claimed' };
    group.add(markings); counts.markingSegments += allSegments.length;
  }
  group.userData.counts = { ...counts };
  const hasSite=model?.records?.some(r=>['way/1023821172','way/98867870'].includes(r.id));
  const details=hasSite?createSportsInfrastructure(THREE,model,{surfaces}):null;
  const access=hasSite?createSportsAccess(THREE,model,{surfaces}):null;
  if(details)group.add(details.group);
  if(access)group.add(access.group);
  const infrastructure={barriers:details?.plan.barriers||[],walkSurfaces:[...(details?.plan.walkSurfaces||[]),...(access?.walkSurfaces||[])],replacedBuildingIds:details?.plan.replacedBuildingIds||[],replacedRoadIds:access?.group.userData.sourceIds||[]};
  const inspections={...details?.inspections};
  const stair=access?.group.userData.sourcePaths?.find(p=>p.sourceId==='way/1483567244');
  if(stair){const a=stair.points[0],b=stair.points.at(-1),x=(a.x+b.x)/2,z=(a.z+b.z)/2;inspections.steps={target:[x,.7,z],position:[x-10,5,z+12]};}
  group.userData.infrastructureCounts={...details?.counts,...access?.counts};
  let disposed = false;
  return { group, counts, infrastructure, inspections, details, access, dispose() {
    if (disposed) return; disposed = true;
    details?.dispose();access?.dispose();
    group.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    // Optional surface textures belong to the caller and are never disposed.
  } };
}
