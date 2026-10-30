import { waterFootprint } from './water-details.js';
import { getRoadProfile } from './building-profiles.js';

const LAKE_ID = 'relation/13705236';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fract = value => value - Math.floor(value);
const random = (a, b, c = 0) => fract(Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123);

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / Math.max(1e-12, dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

/** Read the existing local line geometry, including bridges. This uses the same
 * road widths as campus-3d; no independently invented bridge corridor is added. */
function roadExclusions(roads, bounds) {
  const segments = [], areas = [];
  for (const road of roads) {
    const width = getRoadProfile(road.feature).width;
    if (road.shapes?.length) {
      const footprint = waterFootprint(road);
      if (footprint) areas.push(footprint);
    }
    road.group?.updateWorldMatrix(true, true);
    road.group?.traverse(object => {
      if (!object.isLine || object.isLineSegments) return;
      const position = object.geometry?.getAttribute('position');
      if (!position) return;
      const matrix = object.matrixWorld.elements;
      const point = index => {
        const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
        return { x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] };
      };
      for (let i = 1; i < position.count; i++) {
        const a = point(i - 1), b = point(i), margin = width / 2 + .55;
        const box = { minX: Math.min(a.x, b.x) - margin, maxX: Math.max(a.x, b.x) + margin, minZ: Math.min(a.z, b.z) - margin, maxZ: Math.max(a.z, b.z) + margin };
        if (box.maxX < bounds.minX || box.minX > bounds.maxX || box.maxZ < bounds.minZ || box.minZ > bounds.maxZ) continue;
        segments.push({ a, b, margin, ...box });
      }
    });
  }
  return (x, z, radius) => segments.some(segment => x >= segment.minX - radius && x <= segment.maxX + radius && z >= segment.minZ - radius && z <= segment.maxZ + radius && segmentDistance(x, z, segment.a, segment.b) < segment.margin + radius)
    || areas.some(area => area.contains(x, z) || area.distance(x, z) < radius + .35);
}

function shorelineClusters(footprint) {
  const ring = [...footprint.polygons].sort((a, b) => b[0].length - a[0].length)[0][0];
  const edges = ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length], length: Math.hypot(a.x - ring[(i + 1) % ring.length].x, a.z - ring[(i + 1) % ring.length].z) }));
  const perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
  const span = Math.min(footprint.bounds.maxX - footprint.bounds.minX, footprint.bounds.maxZ - footprint.bounds.minZ);
  const sizeFactor = Math.min(1, span / 85);
  const clusters = [];
  // Sparse, shore-biased patches only. Fractions and coverage are visual layout
  // estimates; the photo does not register individual patches to coordinates.
  for (const [index, fraction] of [.055, .20, .365, .535, .69, .84].entries()) {
    let remaining = fraction * perimeter;
    const edge = edges.find(edge => { if (remaining <= edge.length) return true; remaining -= edge.length; return false; });
    if (!edge || edge.length < .05) continue;
    const tx = (edge.b.x - edge.a.x) / edge.length, tz = (edge.b.z - edge.a.z) / edge.length;
    const anchor = { x: edge.a.x + tx * remaining, z: edge.a.z + tz * remaining };
    let nx = -tz, nz = tx;
    if (!footprint.contains(anchor.x + nx * .15, anchor.z + nz * .15)) { nx *= -1; nz *= -1; }
    const tangentRadius = (14 + random(index, 13) * 7) * sizeFactor;
    const normalRadius = (5.2 + random(index, 29) * 2.1) * sizeFactor;
    const inset = normalRadius * .72 + .6;
    const centre = { x: anchor.x + nx * inset, z: anchor.z + nz * inset };
    if (!footprint.contains(centre.x, centre.z)) continue;
    clusters.push({ index, ...centre, tx, tz, nx, nz, tangentRadius, normalRadius });
  }
  return clusters;
}

/** Deterministic authored planting layout, not a vegetation or seasonal model.
 * A whole circumscribed leaf disc must fit inside the source water polygon. */
export function* buildAquaticPlantPlan({ record, footprint = record && waterFootprint(record), roads = [], maxLeaves = 12000 } = {}) {
  if (record?.id !== LAKE_ID || !footprint || !record.mesh?.isMesh) return { leaves: [], clusters: [], footprint: null };
  const clusters = shorelineClusters(footprint), occupied = new Map(), leaves = [];
  const blocked = roadExclusions(roads, footprint.bounds);
  const cellSize = .35;
  const cellKey = (x, z) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  for (const cluster of clusters) {
    const step = .335;
    for (let i = -Math.ceil(cluster.tangentRadius / step); i <= Math.ceil(cluster.tangentRadius / step); i++) {
      if(i%8===0)yield {stage:"湖岸水生植物规划",cluster:cluster.index,row:i};
      for (let j = -Math.ceil(cluster.normalRadius / step); j <= Math.ceil(cluster.normalRadius / step); j++) {
        const seed = cluster.index * 97;
        const u = (i + (random(i, j, seed) - .5) * .82) * step;
        const v = (j + (random(j, i, seed + 1) - .5) * .82) * step;
        const angle = Math.atan2(v / cluster.normalRadius, u / cluster.tangentRadius);
        const boundary = 1 + .12 * Math.sin(angle * 3 + cluster.index) + .07 * Math.cos(angle * 7 - cluster.index * .8);
        const normalizedDistance = Math.hypot(u / cluster.tangentRadius, v / cluster.normalRadius);
        if (normalizedDistance > boundary) continue;
        // A broken edge and small internal gaps avoid a perfect solid ellipse.
        const density = normalizedDistance > .76 ? .73 : .94;
        if (random(i, j, seed + 2) > density) continue;
        if (Math.hypot(u + cluster.tangentRadius * .22, v - cluster.normalRadius * .18) < cluster.normalRadius * (.16 + .08 * Math.sin(u))) continue;
        const x = cluster.x + cluster.tx * u + cluster.nx * v, z = cluster.z + cluster.tz * u + cluster.nz * v;
        const radius = .09 + .12 * Math.pow(random(i, j, seed + 3), .65);
        // All geometry fits within this conservative horizontal disc, including
        // the occasional tilted emergent leaf. Island holes are shorelines too.
        const clearanceRadius = radius * 1.05 + .025;
        if (!footprint.contains(x, z) || footprint.distance(x, z) < clearanceRadius || footprint.distance(x, z) > 23) continue;
        if (blocked(x, z, clearanceRadius)) continue;
        const ix = Math.floor(x / cellSize), iz = Math.floor(z / cellSize);
        let tooClose = false;
        for (let dx = -1; dx <= 1 && !tooClose; dx++) for (let dz = -1; dz <= 1 && !tooClose; dz++) {
          for (const other of occupied.get(`${ix + dx},${iz + dz}`) || []) if (Math.hypot(x - other.x, z - other.z) < .63 * (radius + other.radius)) { tooClose = true; break; }
        }
        if (tooClose) continue;
        const emergent = random(i, j, seed + 4) > .925;
        const leaf = {
          x, z, radius, clearanceRadius, cluster: cluster.index,
          yaw: random(i, j, seed + 5) * Math.PI * 2,
          variant: Math.floor(random(i, j, seed + 6) * 3),
          height: emergent ? .12 + random(i, j, seed + 7) * .28 : .008 + random(i, j, seed + 8) * .009,
          emergent, tilt: emergent ? (random(i, j, seed + 9) - .5) * .28 : 0,
          tone: random(i, j, seed + 10), rank: random(i, j, seed + 11),
        };
        leaves.push(leaf);
        const key = cellKey(x, z);
        if (!occupied.has(key)) occupied.set(key, []);
        occupied.get(key).push(leaf);
      }
    }
  }
  // Keep every patch represented when enforcing the render budget.
  leaves.sort((a, b) => a.rank - b.rank);
  leaves.length = Math.min(leaves.length, Math.max(0, Math.floor(maxLeaves)));
  return { leaves, clusters, footprint };
}

export function planAquaticPlants(options={}){const iterator=buildAquaticPlantPlan(options);let step;do{step=iterator.next();}while(!step.done);return step.value;}

function leafGeometry(THREE, variant) {
  const positions = [0, 0, 0], uv = [.5, .5], indices = [], segments = 16, rings = [.29, .64, 1];
  for (const radius of rings) for (let i = 0; i < segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const irregularity = .968 + Math.sin(angle * 3 + variant * 1.7) * .018 + Math.cos(angle * 7 - variant) * .011;
    const x = Math.cos(angle) * radius * irregularity, z = Math.sin(angle) * radius * irregularity * (.88 + variant * .035);
    const cup = (.065 + variant * .022) * radius ** 2;
    const edgeCurl = Math.sin(angle * 4 + variant) * .017 * radius ** 3;
    const y = cup + edgeCurl + Math.sin(angle + variant * 1.9) * .018 * radius;
    positions.push(x, y, z); uv.push((x + 1) / 2, (z + 1) / 2);
  }
  for (let i = 0; i < segments; i++) indices.push(0, 1 + (i + 1) % segments, 1 + i);
  for (let ring = 0; ring < rings.length - 1; ring++) for (let i = 0; i < segments; i++) {
    const a = 1 + ring * segments + i, b = 1 + ring * segments + (i + 1) % segments, c = a + segments, d = b + segments;
    indices.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function leafTexture(THREE) {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const x = (col + .5) / size * 2 - 1, z = (row + .5) / size * 2 - 1;
    const radius = Math.hypot(x, z), angle = Math.atan2(z, x);
    const vein = Math.exp(-Math.pow(Math.sin(angle * 5 + .09 * Math.sin(radius * 8)) * radius / .014, 2));
    const secondary = Math.exp(-Math.pow(Math.sin(angle * 10 + radius * 4.5) * radius / .009, 2)) * .27;
    const tissue = Math.sin(x * 21 + z * 11) * Math.cos(z * 26 - x * 8) * 3;
    const value = clamp(Math.round(211 + (vein + secondary) * 23 + tissue - radius * 5), 0, 255);
    const offset = (row * size + col) * 4;
    data.set([value, value, Math.round(value * .96), 255], offset);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = '原创圆叶细脉 · 程序绘制，非照片贴图';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Low round-leaf shoreline vegetation informed by a reviewed campus photo.
 * Species, coordinates, diameter, growth density and season are not measured. */
export function* buildAquaticPlants(THREE, { record, footprint, roads = [], maxLeaves = 12000 } = {}) {
  const group = new THREE.Group();
  group.name = '东九湖岸 · 圆叶水生植物（外观与分布估计）';
  group.userData = {
    sourceFeatureId: LAKE_ID, measured: false, estimated: true, units: 'metres',
    photoReference: 'https://www.xiaohongshu.com/explore/6ad4cf6d0000000028038cc3',
    basis: 'Reviewed photo shows low round leaves concentrated at lake margins; plant species, patch positions, extent and season are not established',
    leafDiameterMetres: [.18, .42], coverage: 'Authored shore-biased clusters; not a registered vegetation survey or seasonal reconstruction',
    waterBoundary: 'Original source water shape and island holes unchanged; every complete leaf disc is clipped by clearance tests',
  };
  const layout = yield* buildAquaticPlantPlan({ record, footprint, roads, maxLeaves });
  const counts = { leaves: layout.leaves.length, emergentLeaves: 0, clusters: new Set(layout.leaves.map(leaf => leaf.cluster)).size, drawCalls: 0, leafAreaUpperBoundM2: 0, lakeAreaM2: record?.flatArea || 0 };
  const geometries = [], materials = [], textures = [], batches = [];
  let disposed = false,completed=false;
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();group.traverse(object=>{if(object.isInstancedMesh)object.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
  try{
  const visibility = new Uint8Array(layout.leaves.length);
  visibility.fill(1);
  const leafIndices = new Map(layout.leaves.map((leaf, index) => [leaf, index]));
  const thresholds = layout.leaves.map(leaf => random(leaf.x, leaf.z, 53));
  const cameraPosition = new THREE.Vector3(), localCamera = new THREE.Vector3();
  const lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  const plantingBounds = new THREE.Box3();
  let lastProjection = NaN, lastViewport = NaN, fullDetail = true;
  function cacheBatch(mesh, leaves) {
    batches.push({ mesh, indices: leaves.map(leaf => leafIndices.get(leaf)), matrices: mesh.instanceMatrix.array.slice(),
      colours: mesh.instanceColor?.array.slice(), selected: Int32Array.from(leaves, (_, index) => index) });
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  if (layout.leaves.length) {
    const texture = leafTexture(THREE);
    textures.push(texture);
    const material = new THREE.MeshStandardMaterial({ name: '圆叶表皮与轻细叶脉', color: '#ffffff', map: texture, roughness: .76, metalness: 0, side: THREE.DoubleSide });
    materials.push(material);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), euler = new THREE.Euler(), colour = new THREE.Color();
    const level = record.mesh.position.y;
    for (let variant = 0; variant < 3; variant++) {
      yield {stage:"湖岸圆叶实例",variant};
      const leaves = layout.leaves.filter(leaf => leaf.variant === variant);
      if (!leaves.length) continue;
      const geometry = leafGeometry(THREE, variant);
      geometries.push(geometry);
      const mesh = new THREE.InstancedMesh(geometry, material, leaves.length);
      mesh.name = `岸侧圆叶 ${variant + 1}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData = { sourceFeatureId: LAKE_ID, estimated: true, leafDiameterMetres: [.18, .42], count: leaves.length };
      leaves.forEach((leaf, index) => {
        position.set(leaf.x, level + leaf.height, leaf.z);
        rotation.setFromEuler(euler.set(leaf.tilt, leaf.yaw, 0, 'YXZ'));
        scale.setScalar(leaf.radius);
        mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
        colour.setHSL(.245 + leaf.tone * .065, .28 + leaf.tone * .14, .25 + leaf.tone * .10, THREE.SRGBColorSpace);
        mesh.setColorAt(index, colour);
        counts.leafAreaUpperBoundM2 += Math.PI * leaf.radius * leaf.radius;
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      cacheBatch(mesh, leaves);
      counts.drawCalls++;
    }
    const emergent = layout.leaves.filter(leaf => leaf.emergent);
    counts.emergentLeaves = emergent.length;
    if (emergent.length) {
      const geometry = new THREE.CylinderGeometry(.0035, .0045, 1, 5, 1, true);
      const material = new THREE.MeshStandardMaterial({ name: '细茎', color: '#647341', roughness: .87 });
      geometries.push(geometry); materials.push(material);
      const stems = new THREE.InstancedMesh(geometry, material, emergent.length);
      stems.name = '少量挺水叶的细茎';
      emergent.forEach((leaf, index) => {
        position.set(leaf.x, level + leaf.height / 2, leaf.z);
        rotation.identity(); scale.set(1, leaf.height, 1);
        stems.setMatrixAt(index, matrix.compose(position, rotation, scale));
      });
      stems.instanceMatrix.needsUpdate = true;
      stems.computeBoundingSphere();
      group.add(stems); counts.drawCalls++;
      cacheBatch(stems, emergent);
    }
    for (const leaf of layout.leaves) plantingBounds.expandByPoint(new THREE.Vector3(leaf.x, level + leaf.height, leaf.z));
    group.userData.estimatedClusters = layout.clusters.map(({ x, z, tangentRadius, normalRadius }) => ({ x, z, tangentRadius, normalRadius }));
    group.userData.projectedLeafAreaUpperBoundM2 = Math.round(counts.leafAreaUpperBoundM2);
  }
  /** Keep the original surface at close range. Between 2 and .9 reference
   * pixels, a fixed per-leaf threshold thins the planting gradually; below .9
   * pixels it submits no geometry. Radius and camera FOV determine the range,
   * so larger leaves/zoomed views retain detail farther away. The default is an
   * 800 CSS-pixel viewport; callers may supply their actual viewport height.
   * No-camera export restores every original matrix and colour in source order.
   */
  function update(camera, { viewportHeight = 800 } = {}) {
    if (disposed || !batches.length) return false;
    const restore = !camera?.isPerspectiveCamera;
    if (restore && fullDetail) return false;
    let allHidden = false;
    if (restore) visibility.fill(1);
    else {
      camera.getWorldPosition(cameraPosition);
      group.updateWorldMatrix(true, false);
      localCamera.copy(cameraPosition); group.worldToLocal(localCamera);
      const projection = Math.abs(camera.projectionMatrix.elements[5]);
      const viewport = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : 800;
      if (!fullDetail && localCamera.distanceToSquared(lastCamera) < .35 ** 2 &&
        Math.abs(projection - lastProjection) < .0005 && viewport === lastViewport) return false;
      lastCamera.copy(localCamera); lastProjection = projection; lastViewport = viewport;
      // The source lake is static and metre-scaled. Its broad bounds make the
      // common dormitory view O(1), rather than visiting all 12,000 leaves.
      const minDistance = plantingBounds.distanceToPoint(localCamera);
      if (minDistance > .21 * projection * viewport / .9) allHidden = true;
      else for (let index = 0; index < layout.leaves.length; index++) {
        const leaf = layout.leaves[index];
        const distance = Math.hypot(localCamera.x - leaf.x, localCamera.y - (record.mesh.position.y + leaf.height), localCamera.z - leaf.z);
        const pixels = leaf.radius * projection * viewport / Math.max(.01, distance);
        const t = clamp((pixels - .9) / 1.1, 0, 1), density = t * t * (3 - 2 * t);
        visibility[index] = density >= 1 || density > thresholds[index] ? 1 : 0;
      }
    }
    let changed = false;
    for (const batch of batches) {
      const { mesh, indices, matrices, colours, selected } = batch;
      let count = 0, dirty = false;
      for (let index = 0; !allHidden && index < indices.length; index++) {
        if (!visibility[indices[index]]) continue;
        if (selected[count] !== index) {
          for (let k = 0; k < 16; k++) mesh.instanceMatrix.array[count * 16 + k] = matrices[index * 16 + k];
          if (colours) for (let k = 0; k < 3; k++) mesh.instanceColor.array[count * 3 + k] = colours[index * 3 + k];
          selected[count] = index; dirty = true;
        }
        count++;
      }
      changed ||= dirty || mesh.count !== count;
      mesh.count = count;
      mesh.visible = count > 0;
      if (dirty) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    }
    fullDetail = restore;
    group.userData.visibleLeaves = batches.slice(0, 3).filter(batch => batch.colours).reduce((sum, batch) => sum + batch.mesh.count, 0);
    return changed;
  }
  completed=true;return {group,counts,update,dispose};
  }finally{if(!completed)dispose();}
}

export function createAquaticPlants(THREE,options={}){const iterator=buildAquaticPlants(THREE,options);let step;do{step=iterator.next();}while(!step.done);return step.value;}
