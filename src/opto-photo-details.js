/** Close-range refinements from the user's October 2026 east-campus photos.
 * All shapes are authored geometry. The photographs are reference only; no
 * people, number plates, or photographic facade sheets are shipped.
 * Dimensions are visual estimates. Existing cuts remain the access authority.
 */
export const OPTO_PHOTO_REFERENCE = Object.freeze({
  revision: 'east-campus-user-photos-2026-10',
  exterior: ['3287bbd0f8f8d61953c122fb58e3ad0f.jpg', 'c83ea8fb9da30436adacac659fee4608.jpg', 'e6f09c5d0af9c69de4e8ac6a69588482.jpg'],
  c1: 'e95aff4aeee26dfb98fa89c1868edc76.jpg',
  c2: ['380181d88ec8a2335d459640cc85f394.jpg', '34c92ecdf594b09204bf5d7d0950149e.jpg', '5acaec5e7be622b6b75d2abb3056970d.jpg'],
  lobby: ['0ad94d673e9a2503138816613e1da004.jpg', '9099d1721aff501da75f119c70d02c3c.jpg', 'd7f5cf4bb850d15167f5dcab8c247006.jpg'],
  hallDoor: 'd1f8cf0f5a6956000812d7848e28e253.jpg',
  uncertainty: 'Photo proportions only; preserves the confirmed short corridors and all existing entrances. C2 facade placement and court planting are approximate; no unseen rooms are inferred.',
});

// One small repeatable, authored terrazzo tile; no reference photograph is used.
export function makeOptoTerrazzoTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  ctx.fillStyle = '#d8d9d4'; ctx.fillRect(0, 0, 256, 256);
  let state = 118;
  const random = () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 4300; i++) {
    const shade = Math.floor(155 + random() * 83); ctx.fillStyle = `rgb(${shade},${shade + 1},${shade - 3})`;
    const size = .4 + random() * 1.4; ctx.fillRect(random() * 256, random() * 256, size, size);
  }
  ctx.strokeStyle = '#b9bdb8'; ctx.lineWidth = 1; ctx.strokeRect(.5, .5, 255, 255);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(.72, .72); map.anisotropy = 4;
  return map;
}

/** Build all lettering into one atlas / draw call rather than one per sign.
 * Positions and normals are world-space; text is generated, not photographed.
 */
export function addOptoSignAtlas(THREE, { signs, mesh, geometry, mats }) {
  if (typeof document === 'undefined' || !signs.length) return null;
  const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 2048;
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  const positions = [], uvs = [], indices = [];
  for (const [i, sign] of signs.entries()) {
    if (i >= 32) break;
    const col = i % 2, row = Math.floor(i / 2), x = col * 1024, y = row * 128;
    ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, 1020, 124); ctx.clip();
    if (sign.background) { ctx.fillStyle = sign.background; ctx.fillRect(x + 2, y + 2, 1020, 124); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = sign.color || '#f5f6f0';
    ctx.font = `${sign.weight || 600} ${sign.subtext ? 66 : 88}px sans-serif`;
    let inkWidth = Math.min(990, ctx.measureText?.(sign.text)?.width ?? sign.text.length * 66);
    ctx.fillText(sign.text, x + 512, y + (sign.subtext ? 47 : 66), 990);
    if (sign.subtext) {
      ctx.font = '400 26px sans-serif';
      inkWidth = Math.max(inkWidth, Math.min(990, ctx.measureText?.(sign.subtext)?.width ?? sign.subtext.length * 15));
      ctx.fillText(sign.subtext, x + 512, y + 100, 990);
    }
    ctx.restore();
    const tangent = { x: sign.nz, z: -sign.nx }, base = positions.length / 3;
    for (const [u, v] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]]) {
      positions.push(sign.x + tangent.x * u * sign.width, sign.y + v * sign.height, sign.z + tangent.z * u * sign.width);
    }
    // Crop each atlas cell to its actual ink: short C1/C118 labels must not
    // shrink into a mostly empty 1024 px slot. Leave padding against mip bleed.
    const halfInk = Math.min(510, inkWidth / 2 + 12);
    const u0 = (x + 512 - halfInk) / 2048, u1 = (x + 512 + halfInk) / 2048, v0 = 1 - (y + 126) / 2048, v1 = 1 - (y + 2) / 2048;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1); indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide }); mats.add(mat);
  const geo = geometry(new THREE.BufferGeometry()); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(indices); geo.computeVertexNormals();
  const object = mesh('opto-photo-sign-atlas', geo, mat); object.castShadow = false; object.userData.labels = signs.map(s => s.text);
  return object;
}

export function addOptoPhotoDetails(THREE, { plan, group, entranceLocal: local, box, beam, material, geometry, mesh, materials, signs }) {
  const { glass, frame, white, ceilingLight } = materials;
  const wall = material('#dadcd8', .64), black = material('#292e30', .38, .12);
  const wallBox = (s, ...args) => local(s, 'opto-photo-light-stone-details', wall, ...args);
  const blackBox = (s, ...args) => local(s, 'opto-photo-dark-details', black, ...args);
  const frameBox = (s, ...args) => local(s, 'opto-window-head-sill', frame, ...args);
  const whiteBox = (s, ...args) => local(s, 'opto-college-canopy-frame', white, ...args);
  const glassBox = (s, ...args) => local(s, 'opto-ribbon-glass', glass, ...args);
  const at = (s, u, y, v) => ({ x: s.x + s.tx * u + s.nx * v, y, z: s.z + s.tz * u + s.nz * v });
  const sign = (source, u, y, v, width, height, text, extra = {}) => signs.push({ ...at(source, u, y, v), nx: source.nx, nz: source.nz, width, height, text, ...extra });
  const e = plan.cEntry, rear = plan.rear;

  // Dense narrow strips make the photographed suspended wing readable from
  // the road. They remain above the entire 10.4 m walkable undercroft.
  const parking = plan.parking;
  for (let u = -parking.width / 2 + .35; u < parking.width / 2; u += .43) {
    frameBox(parking, u, parking.height - .10, -11.5, .07, .16, 24.8);
  }
  // One projecting glazed bay on the long screened west elevation. Neither its
  // size nor window rhythm is a claim of an as-built survey.
  const bay = { ...parking, x: parking.x + parking.tx * 21.5, z: parking.z + parking.tz * 21.5 };
  glassBox(bay, 0, 24.3, 1.06, 13.3, 4.35, 1.8);
  for (const y of [22.08, 24.28, 26.52]) frameBox(bay, 0, y, 2.02, 13.5, .10, .13);
  for (let u = -6.65; u <= 6.7; u += 1.33) frameBox(bay, u, 24.3, 2.02, .09, 4.5, .13);
  for (const u of [-6.7, 6.7]) frameBox(bay, u, 24.3, 1.08, .11, 4.5, 1.95);

  // C1's flat transparent steel-and-glass canopy and black perimeter frame.
  for (const u of [-2.85, -1.4, 0, 1.4, 2.85]) frameBox(e, u, 4.60, .7, .09, .11, 2.75);
  for (const v of [-.65, 2.05]) frameBox(e, 0, 4.60, v, 5.8, .13, .12);
  for (const u of [-2.75, 2.75]) for (const v of [-.55, 1.95]) whiteBox(e, u, 4.72, v, .13, .18, .13);
  sign(e, 0, 5.45, .25, 1.45, .93, 'C1', { color: '#efbd12', weight: 700 });

  // Refine only existing bounded corridors. All display surfaces are pressed
  // to walls; nothing projects into the central door aperture or left turn.
  for (const [key, source, half, length] of [['c1', e, 2.4, 9.6], ['rear', rear, 2.9, 7.7]]) {
    for (const side of [-1, 1]) {
      const usable = key === 'c1' && side === -1 ? 4.55 : length;
      wallBox(source, side * (half - .03), 2.20, -usable / 2, .055, 4.14, usable);
      blackBox(source, side * (half - .07), .25, -usable / 2, .06, .24, usable);
      for (let v = -1.8; v > -usable + .65; v -= 1.48) {
        wallBox(source, side * (half - .075), 1.94, v, .045, 2.48, 1.24);
        // Blue headings, thin divider, and gray abstract lines suggest scientific
        // posters without inventing legible research claims or copying faces.
        frameBox(source, side * (half - .105), 2.99, v, .035, .18, 1.14);
        for (let row = 0; row < 5; row++) blackBox(source, side * (half - .108), 2.63 - row * .28, v, .025, .024, .89 - (row % 2) * .22);
        frameBox(source, side * (half - .108), 1.13, v - .25, .025, .32, .26);
        frameBox(source, side * (half - .108), 1.20, v + .20, .025, .47, .33);
      }
    }
    // Thin dark tile joint ribbons and a black threshold, all below shoe height.
    for (let v = -.6; v > -length; v -= 1.36) blackBox(source, 0, .122, v, half * 1.96, .002, .008);
    for (const u of [-1.36, 0, 1.36]) blackBox(source, u, .122, -length / 2, .008, .002, length);
    blackBox(source, 0, .125, .04, half * 2, .012, .27);
    // The photos show alternating long strip lights and ceiling slats.
    for (let v = -1; v > -length + .3; v -= 1.62) {
      local(source, 'opto-rear-foyer-light', ceilingLight, 0, 4.27, v, half * 1.64, .035, .075);
      for (let j = 1; j <= 3; j++) whiteBox(source, 0, 4.30, v - j * .32, half * 1.96, .06, .065);
    }
    blackBox(source, 0, 3.60, -3.65, 2.5, .46, .10);
    for (const u of [-.92, .92]) blackBox(source, u, 3.99, -3.65, .022, .34, .022);
    sign(source, 0, 3.60, -3.58, 2.38, .33, key === 'c1' ? '← 报告厅 C118　　1F C区' : '报告厅 C118　↑　1F C区');
  }
  // The side-wall identity panel borrows the photographed gray/blue treatment;
  // its position adapts to the already confirmed lobby rather than closing it.
  const logo = { ...rear, ...at(rear, 2.79, 0, -5.5), nx: -rear.tx, nz: -rear.tz, tx: rear.nx, tz: rear.nz, yaw: rear.yaw - Math.PI / 2 };
  wallBox(logo, 0, 2.28, .035, 3.2, 2.65, .07);
  sign(logo, 0, 2.91, .09, 2.95, .48, '光谷实验室', { color: '#233e78', subtext: 'OPTICS VALLEY LABORATORY' });
  sign(logo, 0, 2.21, .09, 2.95, .58, '武汉光电国家研究中心', { color: '#233e78', subtext: 'WUHAN NATIONAL LABORATORY FOR OPTOELECTRONICS' });
  sign(logo, 0, 1.50, .09, 1.4, .44, 'WNLO', { color: '#23578e', weight: 700 });
  // A shallow luminous skylight grid under the existing ceiling; it adds no
  // hole through the floors above and does not extend the verified lobby.
  for (const u of [-1.7, -.85, 0, .85, 1.7]) whiteBox(rear, u, 4.27, -5.55, .07, .09, 1.7);
  for (const v of [-4.7, -5.55, -6.4]) whiteBox(rear, 0, 4.27, v, 3.46, .09, .07);
  local(rear, 'opto-rear-foyer-light', ceilingLight, 0, 4.285, -5.55, 3.4, .025, 1.65);

  for (const door of [plan.groundFloor.hallDoor, plan.rearHallDoor]) {
    // Compact real-style plate above the white door, without suggesting the
    // neighboring control room is an additional accessible game room.
    blackBox(door, 0, 3.66, .08, 1.10, .46, .06);
    sign(door, 0, 3.66, .122, 1.01, .37, 'C118　报告厅 C1', { subtext: 'AUDITORIUM C1' });
    for (const side of [-1, 1]) whiteBox(door, side * 1.78, 1.78, .07, .11, 3.35, .17);
    whiteBox(door, 0, 3.40, .07, 3.67, .10, .17);
  }

  // C2 court: photographed Y-branches and a fine translucent canopy grid.
  // Keep the pre-existing college stairs/landing and source-hole roof intact.
  const cs = plan.groundFloor.collegeSteps;
  for (let u = -10; u <= 10; u += .62) frameBox(cs, u, 8.35, 2.3, .045, .09, 5.8);
  for (const v of [-.5, 1.35, 3.2, 5.1]) whiteBox(cs, 0, 8.38, v, 20.8, .12, .09);
  for (const side of [-1, 1]) {
    const stem = at(cs, side * 8.8, 5.3, 4);
    beam('opto-tree-column-branches', at(cs, side * 8.8, .12, 4), stem, .30, white);
    beam('opto-tree-column-branches', stem, at(cs, side * 8.8 - 2.15, 8.35, 2.3), .20, white);
    beam('opto-tree-column-branches', stem, at(cs, side * 8.8 + 2.15, 8.35, 2.3), .20, white);
  }
  // Ball shrubs are kept outside the 12 m stair / access width. One instanced
  // draw with per-instance colors represents both green and burgundy planting.
  const shrubGeo = geometry(new THREE.SphereGeometry(1, 10, 6)), shrubMat = material('#ffffff', .98);
  const placements = [];
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) placements.push({ ...at(cs, side * (7.1 + i * 1.45), .67 + (i % 2) * .15, 8.6 + (i % 2) * .4), radius: .72 + (i % 3) * .15, purple: i % 3 === 1 });
  const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, placements.length), dummy = new THREE.Object3D();
  placements.forEach((p, i) => { dummy.position.set(p.x, p.y, p.z); dummy.scale.set(p.radius, p.radius * .84, p.radius); dummy.updateMatrix(); shrubs.setMatrixAt(i, dummy.matrix); shrubs.setColorAt(i, new THREE.Color(p.purple ? '#654657' : i % 2 ? '#69893a' : '#7d983c')); });
  shrubs.name = 'opto-photo-court-shrubs'; shrubs.instanceMatrix.needsUpdate = true; shrubs.instanceColor.needsUpdate = true; shrubs.computeBoundingSphere(); shrubs.castShadow = true; shrubs.receiveShadow = true; shrubs.userData = { photoReference: OPTO_PHOTO_REFERENCE.c2, estimate: true }; group.add(shrubs);
  group.userData.photoReference = OPTO_PHOTO_REFERENCE;
  return { detailNames: ['opto-photo-light-stone-details', 'opto-photo-dark-details', 'opto-photo-court-shrubs'], viewpoints: {
    c1: { position: at(e, 0, 1.72, 7), target: at(e, 0, 2.2, -3) },
    lobby: { position: at(rear, -.65, 1.72, -1.7), target: at(rear, 1.4, 2.1, -6.4) },
    c118Door: { position: at(plan.rearHallDoor, 0, 1.72, 3.5), target: at(plan.rearHallDoor, 0, 1.8, 0) },
    exterior: { position: at(parking, 12, 2.2, 39), target: at(parking, 10, 17, -3) },
    collegeCourt: { position: at(cs, 0, 1.72, 21), target: at(cs, 0, 4.7, 1) },
  } };
}
