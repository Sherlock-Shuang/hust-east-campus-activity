/** Water finish for the existing, source-shaped lake meshes.
 *
 * Geometry is deliberately not replaced or displaced: the OSM shoreline and
 * island holes remain authoritative. The shallow colour band, centimetre-scale
 * wet edge and small wind ripples are visual estimates, not bathymetry or a
 * hydrodynamic simulation. No remote photograph pixels are used as textures.
 */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const fract = value => value - Math.floor(value);
const hash = (x, z) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);

function openRing(points) {
  const ring = points.map(point => ({ x: point.x, z: -point.y }));
  if (ring.length > 1 && Math.hypot(ring[0].x - ring.at(-1).x, ring[0].z - ring.at(-1).z) < 1e-7) ring.pop();
  return ring;
}

function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function inWater(x, z, polygons) {
  return polygons.some(rings => inRing(x, z, rings[0]) && !rings.slice(1).some(ring => inRing(x, z, ring)));
}

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const fraction = clamp(((x - a.x) * dx + (z - a.z) * dz) / Math.max(1e-12, dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - a.x - dx * fraction, z - a.z - dz * fraction);
}

/** Pure source-space representation, also useful for checking preservation of holes. */
export function waterFootprint(record) {
  const polygons = (record.shapes || []).map(shape => [openRing(shape.getPoints()), ...shape.holes.map(hole => openRing(hole.getPoints()))]).filter(rings => rings[0].length >= 3);
  const points = polygons.flat(2);
  if (!points.length) return null;
  const bounds = {
    minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)),
    minZ: Math.min(...points.map(point => point.z)), maxZ: Math.max(...points.map(point => point.z)),
  };
  return {
    polygons, bounds,
    contains: (x, z) => inWater(x, z, polygons),
    distance: (x, z) => {
      let distance = Infinity;
      for (const rings of polygons) for (const ring of rings) for (let i = 0; i < ring.length; i++) distance = Math.min(distance, segmentDistance(x, z, ring[i], ring[(i + 1) % ring.length]));
      return distance;
    },
  };
}

export function createWaterDetails(THREE, { records = [], shoreline = true, textureSize = 128, reflection = true, reflectionSize = 384 } = {}) {
  const group = new THREE.Group();
  group.name = '水域 · 源岸线内的湿润接触带';
  group.userData = { basis: 'Source water polygons; inferred shallow colour, centimetre-scale wet sediment and wave appearance', units: 'metres', measured: false };
  const materials = new Map(), textures = [], geometries = [], time = { value: 0 };
  const counts = { waterBodies: 0, sourceHoles: 0, shoreTriangles: 0, textures: 0 };
  const size = clamp(Math.round(textureSize), 32, 256);
  const shoreMaterial = new THREE.MeshStandardMaterial({ name: '潮湿的岸沿土石 · 外观估计', color: '#6c7058', roughness: .94, metalness: 0, vertexColors: true });
  shoreMaterial.userData = { basis: 'A low contact strip within source water only; not a surveyed bank or a continuous artificial retaining wall', heightRangeMetres: [.006, .032] };
  let disposed = false;
  const reflectedRecord = reflection && records.find(record => record.id === 'relation/13705236' && record.mesh?.isMesh);
  const reflectionTarget = reflectedRecord ? new THREE.WebGLRenderTarget(clamp(Math.round(reflectionSize), 128, 512), clamp(Math.round(reflectionSize), 128, 512), { type: THREE.HalfFloatType, samples: 0, depthBuffer: true, stencilBuffer: false }) : null;
  const reflectionMatrix = { value: new THREE.Matrix4() }, reflectionAvailable = { value: 0 };
  const reflectionTexel = { value: new THREE.Vector2(1 / (reflectionTarget?.width || 384), 1 / (reflectionTarget?.height || 384)) };
  const reflectedFootprint = reflectedRecord && waterFootprint(reflectedRecord);
  const reflectedCamera = new THREE.PerspectiveCamera();
  const plane = new THREE.Plane(), clipPlane = new THREE.Vector4(), q = new THREE.Vector4();
  const normal = new THREE.Vector3(0, 1, 0), worldPosition = new THREE.Vector3(), reflectedPosition = new THREE.Vector3(), lookAt = new THREE.Vector3(), direction = new THREE.Vector3();
  const cameraRotation = new THREE.Matrix4(), frustumMatrix = new THREE.Matrix4(), frustum = new THREE.Frustum();
  const waterBounds = new THREE.Box3(), savedViewport = new THREE.Vector4(), savedScissor = new THREE.Vector4();
  let reflecting = false, lastReflectionAt = -Infinity, reflectionFrames = 0;
  if (reflectionTarget) {
    reflectionTarget.texture.name = '东九湖 · 真实场景平面倒影';
    reflectionTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
    reflectionTarget.texture.minFilter = reflectionTarget.texture.magFilter = THREE.LinearFilter;
    reflectionTarget.texture.generateMipmaps = false;
  }

  for (const record of records) {
    if (!record.mesh?.isMesh) continue;
    const footprint = waterFootprint(record);
    if (!footprint) continue;
    const { bounds, polygons } = footprint;
    const width = Math.max(.01, bounds.maxX - bounds.minX), depth = Math.max(.01, bounds.maxZ - bounds.minZ);
    const colours = new Uint8Array(size * size * 4), distances = new Uint8Array(size * size);
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      const x = bounds.minX + (col + .5) / size * width, z = bounds.minZ + (row + .5) / size * depth;
      const distance = footprint.distance(x, z), shallow = Math.exp(-distance / 2.1), contact = Math.exp(-distance / .3);
      const cloud = Math.sin(x * .065 + Math.sin(z * .043)) * Math.cos(z * .078) * 3;
      const offset = (row * size + col) * 4;
      // A muted green-grey lake with warmer, slightly cloudy shallow margins.
      // This static map remains meaningful in a GLB without shader extensions.
      colours.set([
        clamp(Math.round(75 + shallow * 22 - contact * 13 + cloud), 0, 255),
        clamp(Math.round(96 + shallow * 12 - contact * 13 + cloud), 0, 255),
        clamp(Math.round(78 + shallow * 5 - contact * 11 + cloud), 0, 255), 255,
      ], offset);
      distances[row * size + col] = Math.round(clamp(distance / 12, 0, 1) * 255);
    }
    const colourMap = new THREE.DataTexture(colours, size, size, THREE.RGBAFormat);
    colourMap.name = `水色与岸边过渡 ${record.id}`;
    colourMap.colorSpace = THREE.SRGBColorSpace;
    colourMap.minFilter = THREE.LinearMipmapLinearFilter;
    colourMap.magFilter = THREE.LinearFilter;
    colourMap.generateMipmaps = true;
    // Source ShapeGeometry UVs use (east, north), while water shader uses (east, south).
    // Offset/repeat also survive GLTFExporter as KHR_texture_transform.
    colourMap.repeat.set(1 / width, -1 / depth);
    colourMap.offset.set(-bounds.minX / width, -bounds.minZ / depth);
    colourMap.updateMatrix();
    colourMap.needsUpdate = true;
    const shoreDistance = new THREE.DataTexture(distances, size, size, THREE.RedFormat);
    shoreDistance.minFilter = shoreDistance.magFilter = THREE.LinearFilter;
    shoreDistance.needsUpdate = true;
    textures.push(colourMap, shoreDistance);

    const material = new THREE.MeshPhysicalMaterial({
      name: `细波湖水 · ${record.feature?.properties?.name || record.id}`,
      color: '#ffffff', map: colourMap, roughness: .22, metalness: 0,
      ior: 1.333, specularIntensity: 1, envMapIntensity: 1.1,
      side: THREE.FrontSide,
    });
    material.userData = {
      sourceFeatureId: record.id, waterFootprint: 'Existing source geometry and holes unchanged',
      materialBasis: 'Muted lake colour and small wind-ripple appearance from campus photographs; not measured depth or flow',
      staticExport: 'Base colour map and physical roughness retained; time-dependent normal perturbation is viewer-only',
    };
    const metricBounds = { value: new THREE.Vector4(bounds.minX, bounds.minZ, 1 / width, 1 / depth) };
    material.onBeforeCompile = shader => {
      shader.uniforms.uLakeTime = time;
      shader.uniforms.uLakeBounds = metricBounds;
      shader.uniforms.uLakeShoreDistance = { value: shoreDistance };
      shader.vertexShader = `varying vec3 vLakeWorldPosition;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLakeWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = `
uniform float uLakeTime;
uniform vec4 uLakeBounds;
uniform sampler2D uLakeShoreDistance;
varying vec3 vLakeWorldPosition;
${shader.fragmentShader}`
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
vec2 lakeUV = (vLakeWorldPosition.xz - uLakeBounds.xy) * uLakeBounds.zw;
float lakeDistance = texture2D(uLakeShoreDistance, lakeUV).r * 12.0;
float lakeShallow = exp(-lakeDistance / 2.1);
roughnessFactor = mix(roughnessFactor, 0.39, lakeShallow * 0.7);`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
// Centimetre/sub-centimetre wind wave slopes in metre coordinates. Analytic
// derivatives perturb the surface normal without shifting shoreline vertices.
vec2 p = vLakeWorldPosition.xz;
float slow = sin(p.x * 0.18 + p.y * 0.11 - uLakeTime * 0.36);
float waveA = cos(dot(p, vec2(2.8, 1.4)) - uLakeTime * 1.2 + slow * 0.35);
float waveB = cos(dot(p, vec2(-5.2, 7.1)) - uLakeTime * 1.7);
float waveC = cos(dot(p, vec2(19.0, 11.0)) - uLakeTime * 2.4);
vec2 slope = vec2(2.8, 1.4) * (0.007 * waveA) + vec2(-5.2, 7.1) * (0.0018 * waveB) + vec2(19.0, 11.0) * (0.00035 * waveC);
// Fade subpixel ripples at distance, avoiding noisy shimmering from the overview.
float footprint = max(length(dFdx(p)), length(dFdy(p)));
float rippleVisibility = 1.0 / (1.0 + footprint * 3.0);
normal = normalize(normal + mat3(viewMatrix) * vec3(-slope.x, 0.0, -slope.y) * mix(0.5, 1.0, rippleVisibility));
nonPerturbedNormal = normal;`);
      if (record === reflectedRecord) {
        shader.uniforms.uLakeReflection = { value: reflectionTarget.texture };
        shader.uniforms.uLakeReflectionMatrix = reflectionMatrix;
        shader.uniforms.uLakeReflectionAvailable = reflectionAvailable;
        shader.uniforms.uLakeReflectionTexel = reflectionTexel;
        shader.fragmentShader = `
uniform sampler2D uLakeReflection;
uniform mat4 uLakeReflectionMatrix;
uniform float uLakeReflectionAvailable;
uniform vec2 uLakeReflectionTexel;
${shader.fragmentShader}`.replace('#include <opaque_fragment>', `
if (uLakeReflectionAvailable > 0.5) {
  vec4 reflectedPosition = uLakeReflectionMatrix * vec4(vLakeWorldPosition, 1.0);
  vec2 reflectionUV = reflectedPosition.xy / max(reflectedPosition.w, 0.0001);
  // The same metre-scale waves that tilt the water normal break up the real
  // building and tree reflection; no repeated or painted silhouettes are used.
  reflectionUV += slope * 0.07 * rippleVisibility;
  float reflectionBorder = smoothstep(0.0, 0.03, min(min(reflectionUV.x, reflectionUV.y), min(1.0 - reflectionUV.x, 1.0 - reflectionUV.y)));
  vec2 uv = clamp(reflectionUV, vec2(0.002), vec2(0.998));
  vec3 reflectedColour = texture2D(uLakeReflection, uv).rgb * 0.40;
  reflectedColour += texture2D(uLakeReflection, uv + vec2(uLakeReflectionTexel.x, 0.0)).rgb * 0.15;
  reflectedColour += texture2D(uLakeReflection, uv - vec2(uLakeReflectionTexel.x, 0.0)).rgb * 0.15;
  reflectedColour += texture2D(uLakeReflection, uv + vec2(0.0, uLakeReflectionTexel.y)).rgb * 0.15;
  reflectedColour += texture2D(uLakeReflection, uv - vec2(0.0, uLakeReflectionTexel.y)).rgb * 0.15;
  float reflectedLuminance = dot(reflectedColour, vec3(0.2126, 0.7152, 0.0722));
  reflectedColour = mix(reflectedColour, vec3(reflectedLuminance), 0.10) * vec3(0.91, 0.97, 0.91);
  vec3 lakeViewDirection = normalize(cameraPosition - vLakeWorldPosition);
  float lakeFresnel = 0.02 + 0.98 * pow(1.0 - clamp(dot(lakeViewDirection, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 5.0);
  float reflectionWeight = min(0.72, 0.055 + lakeFresnel * 0.77) * reflectionBorder * (1.0 - lakeShallow * 0.17);
  outgoingLight = mix(outgoingLight, reflectedColour, reflectionWeight);
}
#include <opaque_fragment>`);
      }
    };
    material.customProgramCacheKey = () => record === reflectedRecord ? 'source-lake-ripples-reflection-v2' : 'source-lake-ripples-v1';
    materials.set(record.id, material);
    counts.waterBodies++;
    counts.sourceHoles += polygons.reduce((sum, rings) => sum + rings.length - 1, 0);

    if (shoreline) {
      const positions = [], vertexColours = [], colour = new THREE.Color();
      const level = record.mesh.position.y;
      const add = vertices => {
        const centre = { x: vertices.reduce((sum, v) => sum + v.x, 0) / 3, z: vertices.reduce((sum, v) => sum + v.z, 0) / 3 };
        // Triangle edges and interior are checked too: an irregular narrow water
        // polygon must not receive an invented strip bridging an island or inlet.
        const probes = [...vertices, centre, ...vertices.map((v, i) => ({ x: (v.x + vertices[(i + 1) % 3].x) / 2, z: (v.z + vertices[(i + 1) % 3].z) / 2 }))];
        if (!probes.every(v => footprint.contains(v.x, v.z))) return;
        const tone = .84 + hash(centre.x, centre.z) * .2;
        colour.setRGB(tone, tone, tone * .94);
        for (const vertex of vertices) {
          positions.push(vertex.x, vertex.y, vertex.z);
          vertexColours.push(colour.r, colour.g, colour.b);
        }
      };
      for (const rings of polygons) for (const ring of rings) for (let edge = 0; edge < ring.length; edge++) {
        const a = ring[edge], b = ring[(edge + 1) % ring.length], length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < .03) continue;
        const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
        const sign = footprint.contains((a.x + b.x) / 2 + nx * .03, (a.z + b.z) / 2 + nz * .03) ? 1 : -1;
        const subdivisions = Math.ceil(length / .85);
        for (let segment = 0; segment < subdivisions; segment++) {
          const point = (fraction, inset, height) => ({ x: a.x + (b.x - a.x) * fraction + nx * sign * inset, y: level + height, z: a.z + (b.z - a.z) * fraction + nz * sign * inset });
          const start = segment / subdivisions, end = (segment + 1) / subdivisions;
          const wetWidth = .13 + hash(a.x + segment, a.z) * .13;
          const upper = .015 + hash(b.x, b.z + segment) * .017;
          const quad = [point(start, .008, upper), point(end, .008, upper), point(end, wetWidth, .006), point(start, wetWidth, .006)];
          // Winding depends on which side is water. Keep all upper faces upward.
          for (const triangle of [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]]) {
            const [v0, v1, v2] = triangle;
            const normalY = (v1.z - v0.z) * (v2.x - v0.x) - (v1.x - v0.x) * (v2.z - v0.z);
            add(normalY > 0 ? triangle : [v0, v2, v1]);
          }
        }
      }
      if (positions.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColours, 3));
        geometry.computeVertexNormals();
        const edge = new THREE.Mesh(geometry, shoreMaterial);
        edge.name = `低矮湿岸接触带 ${record.id}`;
        edge.receiveShadow = true;
        edge.userData = { sourceFeatureId: record.id, basis: 'Visual sediment edge entirely inside the mapped water polygon; inferred, not surveyed bank construction' };
        group.add(edge);
        geometries.push(geometry);
        counts.shoreTriangles += positions.length / 9;
      }
    }
  }
  counts.textures = textures.length;

  /** One throttled reflection pass for East Nine Lake only. The reflected camera
   * and oblique clip-plane construction follow Three.js Reflector (MIT), adapted
   * to a world-space water plane. Rendering is explicit, never an onBeforeRender
   * callback, so calling this cannot recursively render additional lake passes.
   */
  function renderReflection(renderer, scene, camera, nowMilliseconds = performance.now()) {
    if (disposed || reflecting || !reflectionTarget || !reflectedFootprint) return false;
    let waterVisible = group.visible;
    for (let node = reflectedRecord.mesh; node; node = node.parent) waterVisible = waterVisible && node.visible;
    const bounds = reflectedFootprint.bounds, level = reflectedRecord.mesh.position.y;
    camera.updateMatrixWorld();
    worldPosition.setFromMatrixPosition(camera.matrixWorld);
    const outsideX = Math.max(bounds.minX - worldPosition.x, 0, worldPosition.x - bounds.maxX);
    const outsideZ = Math.max(bounds.minZ - worldPosition.z, 0, worldPosition.z - bounds.maxZ);
    waterBounds.min.set(bounds.minX, level - .02, bounds.minZ);
    waterBounds.max.set(bounds.maxX, level + .02, bounds.maxZ);
    frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(frustumMatrix);
    if (!waterVisible || !camera.isPerspectiveCamera || worldPosition.y <= level + .08 || worldPosition.y > 100 || Math.hypot(outsideX, outsideZ) > 180 || !frustum.intersectsBox(waterBounds)) {
      reflectionAvailable.value = 0;
      return false;
    }
    if (nowMilliseconds - lastReflectionAt < 125 && reflectionAvailable.value > 0) return false;

    reflectedPosition.copy(worldPosition);
    reflectedPosition.y = 2 * level - worldPosition.y;
    cameraRotation.extractRotation(camera.matrixWorld);
    direction.set(0, 0, -1).applyMatrix4(cameraRotation);
    lookAt.copy(worldPosition).add(direction);
    lookAt.y = 2 * level - lookAt.y;
    reflectedCamera.position.copy(reflectedPosition);
    reflectedCamera.up.set(0, 1, 0).applyMatrix4(cameraRotation).reflect(normal);
    reflectedCamera.lookAt(lookAt);
    reflectedCamera.near = camera.near;
    reflectedCamera.far = camera.far;
    reflectedCamera.layers.mask = camera.layers.mask;
    reflectedCamera.updateMatrixWorld();
    reflectedCamera.projectionMatrix.copy(camera.projectionMatrix);
    reflectionMatrix.value.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
    reflectionMatrix.value.multiply(reflectedCamera.projectionMatrix).multiply(reflectedCamera.matrixWorldInverse);

    // Clip everything below the lake plane, including the ground datum which
    // would otherwise conceal the upside-down scene from the mirrored camera.
    plane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, level, 0));
    plane.applyMatrix4(reflectedCamera.matrixWorldInverse);
    clipPlane.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const projection = reflectedCamera.projectionMatrix.elements;
    q.set((Math.sign(clipPlane.x) + projection[8]) / projection[0], (Math.sign(clipPlane.y) + projection[9]) / projection[5], -1, (1 + projection[10]) / projection[14]);
    clipPlane.multiplyScalar(2 / clipPlane.dot(q));
    projection[2] = clipPlane.x;
    projection[6] = clipPlane.y;
    projection[10] = clipPlane.z + 1 - .0003;
    projection[14] = clipPlane.w;
    reflectedCamera.projectionMatrixInverse.copy(reflectedCamera.projectionMatrix).invert();

    const hidden = records.filter(record => record.mesh?.isMesh).map(record => [record.mesh, record.mesh.visible]);
    hidden.push([group, group.visible]);
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace(), previousMipmap = renderer.getActiveMipmapLevel();
    const previousXR = renderer.xr.enabled, previousShadowAuto = renderer.shadowMap.autoUpdate, previousShadowNeeded = renderer.shadowMap.needsUpdate;
    const previousToneMapping = renderer.toneMapping, previousScissorTest = renderer.getScissorTest();
    renderer.getViewport(savedViewport);
    renderer.getScissor(savedScissor);
    reflecting = true;
    try {
      for (const [object] of hidden) object.visible = false;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(reflectionTarget);
      renderer.setScissorTest(false);
      renderer.state.buffers.depth.setMask(true);
      if (!renderer.autoClear) renderer.clear();
      renderer.render(scene, reflectedCamera);
      reflectionAvailable.value = 1;
      lastReflectionAt = nowMilliseconds;
      reflectionFrames++;
      return true;
    } finally {
      for (const [object, visible] of hidden) object.visible = visible;
      renderer.xr.enabled = previousXR;
      renderer.shadowMap.autoUpdate = previousShadowAuto;
      renderer.shadowMap.needsUpdate = previousShadowNeeded;
      renderer.toneMapping = previousToneMapping;
      renderer.setRenderTarget(previousTarget, previousFace, previousMipmap);
      renderer.setViewport(savedViewport);
      renderer.setScissor(savedScissor);
      renderer.setScissorTest(previousScissorTest);
      reflecting = false;
    }
  }

  return {
    group, counts, renderReflection,
    materialFor: record => materials.get(typeof record === 'string' ? record : record.id),
    update(dt, { paused = false, enabled = true } = {}) {
      if (disposed || paused || !enabled || !group.visible || !materials.size || !Number.isFinite(dt) || dt <= 0) return false;
      time.value += Math.min(dt, .1);
      return true;
    },
    setVisible(visible) { group.visible = !!visible; },
    get elapsedTime() { return time.value; },
    get reflectionFrames() { return reflectionFrames; },
    dispose() {
      if (disposed) return;
      disposed = true;
      textures.forEach(texture => texture.dispose());
      materials.forEach(material => material.dispose());
      geometries.forEach(geometry => geometry.dispose());
      shoreMaterial.dispose();
      reflectionTarget?.dispose();
      group.removeFromParent();
    },
  };
}
