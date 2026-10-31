import {getBuildingSpatialIndex} from './building-spatial-index.js';
// Metre-scale camera poses. The player and its vehicle face local -Z. Stateless
// poses and stateful rigs both keep their final rendered result collision safe.
const CAMERA = {
  walk: { distance: 6.4, aim: 1.05, eye: 1.58 },
  boat: { distance: 12, aim: 2.0, eye: 2.1 },
  scooter: { distance: 8.8, aim: 1.05, eye: 1.4 },
  helicopter: { distance: 18, aim: 1.5, eye: 1.5 },
  roadster: { distance: 9.4, aim: .7, eye: .99 },
  hoverboard: { distance: 8.4, aim: 1.2, eye: 2.0 },
  spider: { distance: 5.8, aim: 1.05, eye: 1.65 },
};
const CLEARANCE = .24;
// Walking and Spider-Man can look almost straight up without crossing the pole.
export const WALK_MIN_PITCH = -1.5;
const footprintBounds = new WeakMap();
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function inBuilding(point, rings) {
  return rings.length > 0 && inRing(point, rings[0]) && !rings.slice(1).some(ring => inRing(point, ring));
}

function boundsFor(building) {
  let cached = footprintBounds.get(building);
  if (cached?.rings === building.rings) return cached;
  cached = { rings: building.rings, minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const point of building.rings[0] || []) {
    cached.minX = Math.min(cached.minX, point.x); cached.maxX = Math.max(cached.maxX, point.x);
    cached.minZ = Math.min(cached.minZ, point.z); cached.maxZ = Math.max(cached.maxZ, point.z);
  }
  footprintBounds.set(building, cached);
  return cached;
}

// Split the sight line at every footprint edge and floor/roof crossing. Testing
// intervals avoids stepping over thin wings, walls, or a building courtyard.
function buildingHit(start, end, building) {
  const rings = building.rings || [];
  if (!rings.length) return 1;
  const base = finite(building.minHeight, finite(building.baseY, 0));
  const top = finite(building.baseY, 0) + finite(building.height, 18);
  if (top <= base) return 1;
  if (Math.min(start.y, end.y) > top + CLEARANCE || Math.max(start.y, end.y) < base - CLEARANCE) return 1;
  // Campus footprints are static. Cache their horizontal bounds so hundreds of
  // distant buildings never enter the edge-intersection calculation each frame.
  const bounds = boundsFor(building);
  if (Math.max(start.x, end.x) < bounds.minX || Math.min(start.x, end.x) > bounds.maxX ||
      Math.max(start.z, end.z) < bounds.minZ || Math.min(start.z, end.z) > bounds.maxZ) return 1;
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const cuts = [0, 1];
  if (Math.abs(dy) > 1e-9) for (const y of [base - CLEARANCE, top + CLEARANCE]) {
    const t = (y - start.y) / dy;
    if (t > 0 && t < 1) cuts.push(t);
  }
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], ex = b.x - a.x, ez = b.z - a.z;
    const denominator = dx * ez - dz * ex;
    if (Math.abs(denominator) < 1e-9) continue;
    const rx = a.x - start.x, rz = a.z - start.z;
    const t = (rx * ez - rz * ex) / denominator;
    const u = (rx * dz - rz * dx) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] < 1e-9) continue;
    const point = mix(start, end, (cuts[i] + cuts[i - 1]) / 2);
    if (point.y > base - CLEARANCE && point.y < top + CLEARANCE && inBuilding(point, rings)) return cuts[i - 1];
  }
  return 1;
}

function groundHeight(groundAt, point) {
  // A road overhead is a ceiling, not the camera's supporting ground. Keep
  // the height query on this point's level when roads overlap in X/Z.
  const value = groundAt?.heightAt ? groundAt.heightAt(point.x, point.z, point.y) : groundAt?.(point.x, point.z, 0, point.y);
  return finite(typeof value === 'number' ? value : value?.height ?? value?.y, -Infinity);
}

function groundHit(start, end, groundAt) {
  if (!groundAt) return 1;
  const minX=Math.min(start.x,end.x),minZ=Math.min(start.z,end.z),maxX=Math.max(start.x,end.x),maxZ=Math.max(start.z,end.z);
  // Piers and rails rise above their supporting terrain. Query the same local
  // obstacle cells as movement before the ground-height fast path; otherwise
  // that shortcut would discard every rail on top of a bridge. This index also
  // contains deck slabs, so each candidate needs only one exact volume test.
  const obstacles=groundAt.obstaclesInBounds?.(minX,minZ,maxX,maxZ);
  let hit=1;
  for(const obstacle of obstacles||[])hit=Math.min(hit,buildingHit(start,end,obstacle));
  const maximum=groundAt.maxHeightInBounds?.(minX,minZ,maxX,maxZ);
  if(Number.isFinite(maximum)&&Math.min(start.y,end.y)>=maximum+CLEARANCE)return hit;
  // Height-relative sampling alone would let a descending ray forget a deck
  // as soon as it goes below its top. Test the actual slab volume too, so
  // cameras stay below its underside, above its top or outside its side edge.
  if(!obstacles)for(const deck of groundAt.solidsInBounds?.(minX,minZ,maxX,maxZ)||[])hit=Math.min(hit,buildingHit(start,end,deck));
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const steps = Math.max(1, Math.ceil(length / .2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, point = mix(start, end, t);
    if (point.y >= groundHeight(groundAt, point) + CLEARANCE) continue;
    let low = (i - 1) / steps, high = t;
    for (let j = 0; j < 12; j++) {
      const mid = (low + high) / 2, probe = mix(start, end, mid);
      if (probe.y < groundHeight(groundAt, probe) + CLEARANCE) high = mid;
      else low = mid;
    }
    return Math.min(hit,low);
  }
  return hit;
}

/**
 * Calculate a collision-aware first- or third-person camera, without side effects.
 * state.y is the player's supporting surface/skid elevation. Positive pitch puts
 * a trailing camera above the player and looks downward in first-person view.
 * Buildings use local metre-space rings, optional baseY, and relative height.
 * groundAt(x,z,radius,referenceY) may return a number or {height} / {y}.
 * Layered surfaces also expose heightAt(x,z,referenceY), plus indexed
 * obstaclesInBounds (infrastructure and decks) or legacy solidsInBounds.
 * Use the same support and obstacle volumes as the player's ground contact.
 */
export function calculatePlayerCamera(state, { view = 'third', yawOffset = 0, pitch = .25, distance, heading, visualSpeed, comfortable = false, actionFraming, world, groundAt } = {}) {
  const profile = CAMERA[state.mode] || CAMERA.walk;
  const spider = state.mode === 'spider';
  const horizontalSpeed = finite(visualSpeed, Math.max(Math.abs(finite(state.speed, 0)), Math.hypot(finite(state.vx, 0), finite(state.vz, 0))));
  const speedRatio = Math.min(1, horizontalSpeed / 28);
  const speedFactor = speedRatio * speedRatio * (3 - 2 * speedRatio);
  const zipPulse = state.zipActive ? Math.sin(Math.PI * Math.max(0, Math.min(1, finite(state.zipProgress, 0)))) : 0;
  const action = actionFraming || {approach:state.pointPhase==='approach'?1:0,perch:state.pointPhase==='perch'?1:0,launch:state.pointPhase==='launch'?1:0,trick:finite(state.trickBlend,0)};
  const actionFov = 2.4*action.launch-1.2*action.approach;
  const framing = spider ? { fov: (view === 'first' ? 56 : 58) + (comfortable ? 0 : (view === 'first' ? 10 : 12) * speedFactor + zipPulse * 2 + actionFov), speedFactor } : null;
  const yaw = finite(heading, finite(state.yaw, 0)) + finite(yawOffset, 0);
  const angle = Math.max(view === 'first' && (state.mode === 'walk' || spider) ? WALK_MIN_PITCH : -.65, Math.min(1.3, finite(pitch, .25)));
  const origin = { x: finite(state.x, 0), y: finite(state.y, 0), z: finite(state.z, 0) };
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  if (view === 'first') {
    const position = { ...origin, y: origin.y + profile.eye };
    position.y = Math.max(position.y, groundHeight(groundAt, position) + CLEARANCE);
    const result = { position, target: {
      x: position.x - sin * Math.cos(angle) * 10,
      y: position.y - Math.sin(angle) * 10,
      z: position.z - cos * Math.cos(angle) * 10,
    } };
    return spider ? { ...result, ...framing } : result;
  }
  const reach = Math.max(.7, Math.min(60, finite(distance, spider && comfortable ? 6.8 : profile.distance + (spider ? 2.8 * speedFactor + zipPulse * .45 + action.trick*.85 + action.launch*.35 - action.perch*.55 : 0))));
  let target = { ...origin, y: origin.y + profile.aim };
  if (spider) {
    const bodyTarget = { ...target };
    const airborne = state.grounded === false || !!state.anchor;
    if (airborne && !comfortable) {
      const vx = finite(state.vx, -Math.sin(finite(state.yaw, 0)) * horizontalSpeed);
      const vz = finite(state.vz, -Math.cos(finite(state.yaw, 0)) * horizontalSpeed);
      const velocity = Math.hypot(vx, vz), lead = Math.min(2.2, velocity * .09);
      if (velocity > .001) { target.x += vx / velocity * lead; target.z += vz / velocity * lead; }
      target.y += Math.max(-.35, Math.min(.45, finite(state.verticalSpeed, 0) * .035));
    }
    if (!comfortable && state.pointTarget && action.approach>0) {
      // Only a committed destination influences framing. A candidate changing
      // off screen must never steer the camera or the camera-relative controls.
      const dx=state.pointTarget.x-origin.x,dz=state.pointTarget.z-origin.z,length=Math.hypot(dx,dz)||1;
      const lead=Math.min(1.5,length*.06)*action.approach;
      target.x+=dx/length*lead;target.z+=dz/length*lead;
      target.y+=Math.max(-.25,Math.min(.8,(state.pointTarget.y-origin.y)*.04))*action.approach;
    }
    if (!comfortable) target.y-=action.perch*.25;
    // Velocity look-ahead must not put the sight-line origin inside a
    // facade or a raised deck before the regular trailing-camera ray is tested.
    let targetHit = groundHit(bodyTarget, target, groundAt);
    for (const building of getBuildingSpatialIndex(world?.buildings).querySegment(bodyTarget,target)) targetHit = Math.min(targetHit, buildingHit(bodyTarget, target, building));
    const targetDistance = Math.hypot(target.x - bodyTarget.x, target.y - bodyTarget.y, target.z - bodyTarget.z);
    if (targetHit < 1) target = mix(bodyTarget, target, Math.max(0, targetHit - CLEARANCE / Math.max(.001, targetDistance)));
  }
  const desired = {
    x: (spider ? target.x : origin.x) + sin * Math.cos(angle) * reach,
    y: target.y + Math.sin(angle) * reach,
    z: (spider ? target.z : origin.z) + cos * Math.cos(angle) * reach,
  };
  desired.y = Math.max(desired.y, groundHeight(groundAt, desired) + CLEARANCE);
  let hit = groundHit(target, desired, groundAt);
  for (const building of getBuildingSpatialIndex(world?.buildings).querySegment(target,desired)) hit = Math.min(hit, buildingHit(target, desired, building));
  const length = Math.hypot(desired.x - target.x, desired.y - target.y, desired.z - target.z);
  const fraction = hit < 1 ? Math.max(0, hit - CLEARANCE / Math.max(.001, length)) : 1;
  const result = { position: mix(target, desired, fraction), target };
  return spider ? { ...result, ...framing } : result;
}

// Recheck the *rendered* spring pose, not just its destination. A smoothed
// camera can otherwise travel through a corner between two safe poses.
export function constrainPlayerCamera(state, pose, {world, groundAt} = {}) {
  const origin={x:state.x,y:state.y+1.05,z:state.z};
  function clip(start,end){
    let hit=groundHit(start,end,groundAt);
    for(const b of getBuildingSpatialIndex(world?.buildings).querySegment(start,end))hit=Math.min(hit,buildingHit(start,end,b));
    const length=Math.hypot(end.x-start.x,end.y-start.y,end.z-start.z);
    return hit<1?mix(start,end,Math.max(0,hit-CLEARANCE/Math.max(.001,length))):{...end};
  }
  const target=clip(origin,pose.target),position=clip(target,pose.position);
  position.y=Math.max(position.y,groundHeight(groundAt,position)+CLEARANCE);
  return {...pose,position,target};
}

const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
const damp=(a,b,rate,dt)=>a+(b-a)*(1-Math.exp(-rate*dt));

/** Dragged camera boom with collision-tested spring follow. The character
 * pulls the existing boom around turns; instantaneous velocity never becomes
 * camera yaw. Manual orbit owns heading while the user is looking around. */
export function createTraversalCameraRig(){
  let heading=0,firstHeading=0,ready=false,position=null,target=null,speed=0,fov=58,roll=0,traversalPitch=.18,firstPitch=.18,skyPitch=0;
  let actionFraming={approach:0,perch:0,launch:0,trick:0};
  let focusPoint=null;
  let velocity={x:0,y:0,z:0};
  function reset(state,angle=state.yaw||0){heading=angle;firstHeading=angle;ready=false;position=null;target=null;speed=Math.hypot(state.vx||0,state.vz||0);fov=58;velocity={x:0,y:0,z:0};roll=0;traversalPitch=.18;firstPitch=.18;skyPitch=0;actionFraming={approach:0,perch:0,launch:0,trick:0};focusPoint=null;}
  function rotate(delta){heading=wrapAngle(heading+delta);}
  function update(state,dt,options={}){
    const h=Math.max(0,Math.min(.1,dt)),snap=options.snap||!ready;
    if(!ready){heading=finite(options.heading,heading);ready=true;}
    const rawSpeed=Math.hypot(state.vx||0,state.vz||0,(state.diving ? state.verticalSpeed||0 : 0)*.45);
    speed=snap?rawSpeed:damp(speed,rawSpeed,4.2,h);
    if(position&&!options.lookLocked&&options.view!=='first'&&!snap){
      const anticipation=options.comfortable?0:.08;
      const px=state.x+(state.vx||0)*anticipation,pz=state.z+(state.vz||0)*anticipation;
      const dx=position.x-px,dz=position.z-pz;
      if(Math.hypot(dx,dz)>1.2){
        const delta=wrapAngle(Math.atan2(dx,dz)-heading);
        heading=wrapAngle(heading+Math.max(-1.6*h,Math.min(1.6*h,delta*(1-Math.exp(-10*h)))));
      }
    }
    if(Number.isFinite(options.heading))heading=options.heading;
    const actionTarget={approach:state.pointPhase==='approach'?1:0,perch:state.pointPhase==='perch'?1:0,launch:state.pointPhase==='launch'?1:0,trick:Math.max(0,Math.min(1,finite(state.trickBlend,0)))};
    for(const key of Object.keys(actionFraming))actionFraming[key]=snap?actionTarget[key]:damp(actionFraming[key],actionTarget[key],key==='launch'?7:6,h);
    if(state.pointPhase==='approach'&&state.pointTarget)focusPoint={...state.pointTarget};
    else if(actionFraming.approach<.001)focusPoint=null;
    const airborne=!state.grounded;
    const pitchTarget=options.comfortable?.14:state.diving?.32:state.pointPhase==='perch'?.12:state.pointPhase==='approach'?.04:airborne?.08-Math.max(0,Math.min(14,state.verticalSpeed||0))*.007:.18;
    traversalPitch=snap?pitchTarget:damp(traversalPitch,pitchTarget,5,h);
    const requestedAngle=options.pitch??traversalPitch;
    firstPitch=snap?requestedAngle:damp(firstPitch,requestedAngle,40,h);
    const angle=options.view==='first'?firstPitch:requestedAngle;
    const manualSky=options.view!=='first'&&Number.isFinite(options.pitch)&&options.pitch<0;
    const skyTarget=manualSky?Math.max(WALK_MIN_PITCH,options.pitch):0;
    skyPitch=snap?skyTarget:skyPitch+Math.max(-4.5*h,Math.min(4.5*h,damp(skyPitch,skyTarget,24,h)-skyPitch));
    const framedState=focusPoint&&!state.pointTarget?{...state,pointTarget:focusPoint}:state;
    firstHeading=snap?heading:wrapAngle(firstHeading+wrapAngle(heading-firstHeading)*(1-Math.exp(-40*h)));
    // Keep the boom at body height when the user looks up. Tilting the boom
    // down instead makes ground collision prevent an overhead view.
    const desired=calculatePlayerCamera(framedState,{...options,heading:options.view==='first'?firstHeading:heading,yawOffset:0,pitch:manualSky?0:angle,visualSpeed:speed,actionFraming});
    if(snap||options.view==='first'){
      position={...desired.position};target={...desired.target};velocity={x:0,y:0,z:0};
    }else{
      for(const key of ['x','y','z']){
        // Exact critically damped solution for a fixed target over this frame.
        const omega=options.lookLocked?(key==='y'?24:30):key==='y'?13:16,e=Math.exp(-omega*h),offset=position[key]-desired.position[key];
        const c=velocity[key]+omega*offset;
        position[key]=desired.position[key]+(offset+c*h)*e;
        velocity[key]=(velocity[key]-omega*c*h)*e;
        target[key]=damp(target[key],desired.target[key],20,h);
      }
    }
    const safe=options.view==='first'?{...desired,position,target}:constrainPlayerCamera(state,{...desired,position,target},options);
    const clipped=Math.hypot(safe.position.x-position.x,safe.position.y-position.y,safe.position.z-position.z)>.03;
    position={...safe.position};target={...safe.target};if(clipped)velocity={x:0,y:0,z:0};
    fov=snap?desired.fov:damp(fov,desired.fov,4,h);
    const bank=options.comfortable||options.view==='first'||options.lookLocked?0:Math.max(-.018,Math.min(.018,(state.lean||0)*.045));
    roll=snap?bank:damp(roll,bank,5,h);
    let outputTarget=safe.target;
    if(options.view!=='first'&&skyPitch<0){
      // Tilt only the optical axis after collision checks. Keep the internal
      // structural target for the next spring/collision update and web swing.
      const dx=target.x-position.x,dy=target.y-position.y,dz=target.z-position.z;
      const horizontal=Math.hypot(dx,dz),length=Math.max(.1,Math.hypot(horizontal,dy));
      const baseAngle=Math.atan2(-dy,horizontal),lookAngle=baseAngle+(WALK_MIN_PITCH-baseAngle)*(skyPitch/WALK_MIN_PITCH);
      const forwardX=horizontal>1e-6?dx/horizontal:-Math.sin(heading),forwardZ=horizontal>1e-6?dz/horizontal:-Math.cos(heading);
      outputTarget={x:position.x+forwardX*Math.cos(lookAngle)*length,y:position.y-Math.sin(lookAngle)*length,z:position.z+forwardZ*Math.cos(lookAngle)*length};
    }
    return {...safe,target:outputTarget,fov,roll,heading};
  }
  return {reset,rotate,update,get heading(){return heading;}};
}

const VEHICLE_FRAMING = {
  walk:       { distance: 6.4, aim: 1.05, pitch: .25, fov: 58, speedScale: 3,  lead: .3, pullback: .2, widen: 0 },
  boat:       { distance: 12, aim: 2.0, pitch: .21, fov: 60, speedScale: 9, lead: 1.4, pullback: .6, widen: 2 },
  scooter:    { distance: 8.8, aim: 1.05, pitch: .25, fov: 60, speedScale: 7,  lead: 1.2, pullback: .4, widen: 0 },
  roadster:   { distance: 8.7, aim: .85, pitch: .15, fov: 58, speedScale: 24, lead: 3.5, pullback: 1.1, widen: 8 },
  helicopter: { distance: 18, aim: 1.5, pitch: .25, fov: 60, speedScale: 25, lead: 2, pullback: .8, widen: 0 },
  // Frame the rider below the centre with space to read the road and skyline.
  // At 36 m/s the old narrow map FOV and short boom hid upcoming junctions.
  hoverboard: { distance: 8.8, aim: 2, pitch: .12, fov: 62, speedScale: 36, lead: 4.4, pullback: 2.1, widen: 8 },
};

function clipCameraSegment(start, end, {world, groundAt}, radius = 0) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const horizontal = Math.hypot(dx, dz) || 1;
  // A small near-plane volume, not just a centre ray. This also catches a wall
  // grazing the edge of the screen while the camera centre stays outside it.
  const offsets = radius ? [{x:0,y:0,z:0},
    {x:dz/horizontal*radius,y:0,z:-dx/horizontal*radius},
    {x:-dz/horizontal*radius,y:0,z:dx/horizontal*radius},
    {x:0,y:radius*.6,z:0}, {x:0,y:-radius*.6,z:0}] : [{x:0,y:0,z:0}];
  let hit = 1;
  for (const offset of offsets) {
    const a = {x:start.x+offset.x,y:start.y+offset.y,z:start.z+offset.z};
    const b = {x:end.x+offset.x,y:end.y+offset.y,z:end.z+offset.z};
    hit = Math.min(hit, groundHit(a,b,groundAt));
    for (const building of getBuildingSpatialIndex(world?.buildings).querySegment(a,b)) hit = Math.min(hit, buildingHit(a,b,building));
  }
  const length = Math.hypot(dx,end.y-start.y,dz);
  return hit < 1 ? mix(start,end,Math.max(0,hit-CLEARANCE/Math.max(.001,length))) : {...end};
}

/** Stable, horizon-level chase camera for driving, riding and flight.
 *
 * Translation is carried with the vehicle before the local boom is damped, so
 * steady speed cannot stretch the chase distance or leave the target behind.
 * Only steering, framing and user orbit have inertia. Do not add a second
 * renderer-side target lerp or vehicle pitch/roll to this returned pose.
 *
 * reset(state, heading?) is used for mode changes and respawn.
 * recenter(state) smoothly returns an existing camera behind even a parked
 * vehicle. Use it for a user-requested recenter; reset is for respawn/mode changes.
 * rotate(delta) owns manual orbit; keep lookLocked true during mouse look,
 * pointer lock, touch dragging and the release grace period. Once unlocked, movement gently centres the boom, while
 * a parked vehicle preserves the user's inspection angle.
 * Pass baseFov to override a mode's field of view. Roadster and hoverboard add
 * bounded speed FOV; the map's FOV is not a suitable default for those modes.
 * Switching view on an initialized rig blends for .36s;
 * do not reset the rig during that switch (snap still starts this transition).
 */
export function createVehicleCameraRig() {
  let ready=false, heading=0, position=null, target=null, previousOrigin=null;
  let speed=0, fov=58, pitch=.15, lead=0, activeMode=null, activeView=null;
  let velocity={x:0,y:0,z:0};
  let transition=null, renderedPosition=null, renderedTarget=null, renderedFov=58, renderedLift=0;
  let centering=false,centeringHeading=null,firstHeading=0;
  let followRelease=1;
  let groundFrameY=null;
  function reset(state, angle=state.yaw||0) {
    heading=wrapAngle(angle);ready=false;position=null;target=null;previousOrigin=null;
    firstHeading=heading;speed=Math.abs(finite(state.speed,0));velocity={x:0,y:0,z:0};
    activeMode=null;activeView=null;lead=0;transition=null;renderedPosition=null;renderedTarget=null;renderedLift=0;centering=false;centeringHeading=null;followRelease=1;groundFrameY=null;
  }
  function rotate(delta) { heading=wrapAngle(heading+finite(delta,0));centering=false;centeringHeading=null; }
  function recenter(state) {
    if (!ready) {reset(state);return;}
    centering=true;
    // Camera-relative walking changes body yaw as this camera turns. Capture
    // the requested direction once, otherwise C + sideways input spins forever.
    centeringHeading=state.mode==='walk'?finite(state.yaw,0):null;
  }
  function update(state, dt, options={}) {
    const h=Math.max(0,Math.min(.1,finite(dt,0)));
    const profile=VEHICLE_FRAMING[state.mode]||VEHICLE_FRAMING.walk;
    const board=state.mode==='hoverboard';
    const view=options.view||'third';
    const origin={x:finite(state.x,0),y:finite(state.y,0),z:finite(state.z,0)};
    const teleport=previousOrigin&&Math.hypot(origin.x-previousOrigin.x,origin.y-previousOrigin.y,origin.z-previousOrigin.z)>25;
    if (ready&&activeMode===state.mode&&activeView!==view&&!teleport) {
      transition={elapsed:0,position:{},target:{},fov:renderedFov,lift:renderedLift};
      for (const key of ['x','y','z']) {
        transition.position[key]=renderedPosition[key]-previousOrigin[key];
        transition.target[key]=renderedTarget[key]-previousOrigin[key];
      }
    } else if (!ready||activeMode!==state.mode||teleport) transition=null;
    const snap=!!options.snap||!ready||activeMode!==state.mode||activeView!==view||teleport;
    // Treads move the feet immediately. In comfort mode carry the eye and aim
    // together over small grounded steps, without delaying horizontal movement
    // or changing pitch. Falls, teleports and mode/view switches stay immediate.
    const previousGroundY=groundFrameY??origin.y;
    const easeGround=options.comfortable&&state.mode==='walk'&&state.grounded!==false&&
      (!state.waterMode||state.waterMode==='dry')&&!snap&&previousOrigin&&Math.abs(origin.y-previousOrigin.y)<.5;
    groundFrameY=easeGround?damp(previousGroundY,origin.y,12,h):origin.y;
    const bodyHeading=finite(state.yaw,0);
    if (!ready) heading=finite(options.heading,heading);
    if (Number.isFinite(options.heading)) heading=wrapAngle(options.heading);
    const rawSpeed=Math.abs(finite(state.speed,Math.hypot(state.vx||0,state.vz||0)));
    speed=snap?rawSpeed:damp(speed,rawSpeed,5,h);
    // The caller owns the drag/release grace period. Once it expires, ramp the
    // chase force back in instead of grabbing a manually placed flight camera.
    followRelease=options.lookLocked?0:Math.min(1,followRelease+h/.55);
    if ((centering||!options.lookLocked)&&!Number.isFinite(options.heading)&&(centering||rawSpeed>.25||view==='first')) {
      const followHeading=centeringHeading??bodyHeading;
      const delta=wrapAngle(followHeading-heading);
      // Cabin steering is direct; a trailing boom eases around the turn. The
      // bounded angular rate also avoids whip pans after a manual rear view.
      const followBlend=!centering&&view!=='first'?followRelease*followRelease*(3-2*followRelease):1;
      const rate=(view==='first'?14:board?8.5:5.8)*followBlend;
      const maxStep=(view==='first'?5.5:board?3.2:2.5)*h*followBlend;
      heading=wrapAngle(heading+Math.max(-maxStep,Math.min(maxStep,delta*(1-Math.exp(-rate*h)))));
      if (centering&&Math.abs(wrapAngle(followHeading-heading))<.001) {heading=followHeading;centering=false;centeringHeading=null;}
    }
    const ratio=Math.min(1,speed/profile.speedScale),speedBlend=ratio*ratio*(3-2*ratio);
    const desiredPitch=Math.max(state.mode==='walk'?WALK_MIN_PITCH:-.35,Math.min(.85,finite(options.pitch,view==='first'?.025:profile.pitch)));
    const nextPitch=snap?desiredPitch:damp(pitch,desiredPitch,options.lookLocked&&view==='first'?40:board?(options.lookLocked?24:9):options.lookLocked?24:14,h);
    // Large sky gestures and recentering should not rotate the entire view in
    // one frame. Small input deltas retain the existing response.
    pitch=!snap&&state.mode==='walk'&&view==='third'&&(pitch<0||desiredPitch<0)?pitch+Math.max(-4.5*h,Math.min(4.5*h,nextPitch-pitch)):nextPitch;
    const baseFov=finite(options.baseFov,profile.fov+(view==='first'&&state.mode==='roadster'?3:0));
    const desiredFov=baseFov+(options.comfortable?0:profile.widen*speedBlend);
    fov=snap?desiredFov:fov+Math.max(-14*h,Math.min(14*h,damp(fov,desiredFov,4.5,h)-fov));
    const leadTarget=options.comfortable||options.lookLocked?0:profile.lead*speedBlend*Math.sign(finite(state.speed,0));
    lead=snap?leadTarget:damp(lead,leadTarget,6,h);
    let desired;
    if (view==='first') {
      // Relative mouse input keeps its full control heading immediately. Filter
      // only the rendered eye direction for 25 ms to suppress event batching,
      // without adding that delay to movement or camera-relative aiming.
      firstHeading=snap?heading:wrapAngle(firstHeading+wrapAngle(heading-firstHeading)*(1-Math.exp(-40*h)));
      desired=calculatePlayerCamera(state,{...options,view,heading:firstHeading,yawOffset:0,pitch});
      if(easeGround){
        const original={...desired.position};
        const eased={...original,y:original.y+groundFrameY-origin.y};
        const safe=clipCameraSegment(original,eased,options);
        safe.y=Math.max(safe.y,groundHeight(options.groundAt,safe)+CLEARANCE);
        desired.position=safe;desired.target.y+=safe.y-original.y;
      }else if(!options.comfortable&&state.mode==='walk'&&state.grounded!==false&&!snap&&position){
        // The feet land on the true tread. Ease only the eye's vertical travel
        // over the short riser, without delaying horizontal steering or aim.
        const eyeY=damp(position.y,desired.position.y,18,h),dy=eyeY-desired.position.y;
        desired.position.y=eyeY;desired.target.y+=dy;
      }
      position={...desired.position};target={...desired.target};velocity={x:0,y:0,z:0};
    } else {
      const bodyTarget={x:origin.x,y:origin.y+profile.aim,z:origin.z};
      const reach=Math.max(3,Math.min(35,finite(options.distance,profile.distance+(options.comfortable?0:profile.pullback*speedBlend))));
      const look={x:bodyTarget.x-Math.sin(bodyHeading)*lead,y:groundFrameY+profile.aim,z:bodyTarget.z-Math.cos(bodyHeading)*lead};
      const clearLook=clipCameraSegment(bodyTarget,look,options);
      // Looking above the horizon rotates a walker's optical axis, not the
      // boom into the ground. Keep the eye at chest height or above.
      const boomPitch=state.mode==='walk'?Math.max(0,pitch):pitch;
      const desiredPosition={x:origin.x+Math.sin(heading)*Math.cos(boomPitch)*reach,
        y:groundFrameY+profile.aim+Math.sin(boomPitch)*reach,z:origin.z+Math.cos(heading)*Math.cos(boomPitch)*reach};
      desiredPosition.y=Math.max(desiredPosition.y,groundHeight(options.groundAt,desiredPosition)+CLEARANCE+.18);
      desired={position:desiredPosition,target:clearLook};
      if (snap) {position={...desired.position};target={...desired.target};velocity={x:0,y:0,z:0};}
      else {
        for (const key of ['x','y','z']) {
          const carried=key==='y'?groundFrameY-previousGroundY:origin[key]-previousOrigin[key];
          position[key]+=carried;target[key]+=carried;
          // Keep the flying board responsive during orbit and fast banking,
          // while retaining a stable horizon and carrying translation exactly.
          const omega=options.lookLocked?(key==='y'?32:38):board?(key==='y'?24:28):key==='y'?18:22;
          const e=Math.exp(-omega*h),offset=position[key]-desired.position[key];
          const c=velocity[key]+omega*offset;
          position[key]=desired.position[key]+(offset+c*h)*e;
          velocity[key]=(velocity[key]-omega*c*h)*e;
          target[key]=damp(target[key],desired.target[key],18,h);
        }
      }
      const safeTarget=clipCameraSegment(bodyTarget,target,options);
      const safePosition=clipCameraSegment(safeTarget,position,options,.3);
      const clipped=Math.hypot(safePosition.x-position.x,safePosition.y-position.y,safePosition.z-position.z)>.001;
      position=safePosition;target=safeTarget;
      if (clipped) velocity={x:0,y:0,z:0};
      position.y=Math.max(position.y,groundHeight(options.groundAt,position)+CLEARANCE+.18);
    }
    let outputPosition={...position},outputTarget={...target},outputFov=fov;
    let outputLift=state.mode==='walk'&&view==='third'?Math.max(0,Math.min(1,pitch/WALK_MIN_PITCH)):0;
    if (transition) {
      transition.elapsed+=h;
      const t=Math.min(1,transition.elapsed/.36),ease=t*t*(3-2*t);
      const oldPosition={},oldTarget={};
      for (const key of ['x','y','z']) {
        oldPosition[key]=origin[key]+transition.position[key];
        oldTarget[key]=origin[key]+transition.target[key];
      }
      outputPosition=mix(oldPosition,position,ease);outputTarget=mix(oldTarget,target,ease);
      outputFov=transition.fov+(fov-transition.fov)*ease;
      outputLift=transition.lift+(outputLift-transition.lift)*ease;
      const bodyTarget={x:origin.x,y:origin.y+profile.aim,z:origin.z};
      outputTarget=clipCameraSegment(bodyTarget,outputTarget,options);
      outputPosition=clipCameraSegment(outputTarget,outputPosition,options,.3);
      if (t===1) transition=null;
    }
    ready=true;activeMode=state.mode;activeView=view;previousOrigin=origin;
    // Keep structural targets for collision and view transitions. A skyward
    // look-at point is only an orientation, never a new camera collision ray.
    renderedPosition=outputPosition;renderedTarget=outputTarget;renderedFov=outputFov;renderedLift=outputLift;
    if(outputLift>0){
      const dx=outputTarget.x-outputPosition.x,dy=outputTarget.y-outputPosition.y,dz=outputTarget.z-outputPosition.z;
      const horizontal=Math.hypot(dx,dz),length=Math.max(.1,Math.hypot(horizontal,dy));
      const baseAngle=Math.atan2(-dy,horizontal),angle=baseAngle+(WALK_MIN_PITCH-baseAngle)*outputLift;
      const forwardX=horizontal>1e-6?dx/horizontal:-Math.sin(heading),forwardZ=horizontal>1e-6?dz/horizontal:-Math.cos(heading);
      outputTarget={x:outputPosition.x+forwardX*Math.cos(angle)*length,y:outputPosition.y-Math.sin(angle)*length,z:outputPosition.z+forwardZ*Math.cos(angle)*length};
    }
    return {...desired,position:outputPosition,target:outputTarget,heading,fov:outputFov,roll:0,speedFactor:speedBlend,transitioning:!!transition};
  }
  return {reset,recenter,rotate,update,get heading(){return heading;},get transitioning(){return !!transition;}};
}
