import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { calculatePlayerCamera,createTraversalCameraRig,createVehicleCameraRig,constrainPlayerCamera } from '../src/player-camera.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ~= ${expected}`);
const rectangle = (x1, z1, x2, z2) => [{ x: x1, z: z1 }, { x: x2, z: z1 }, { x: x2, z: z2 }, { x: x1, z: z2 }];

test('third-person poses rotate and translate with the player in every travel mode', () => {
  for (const [mode, reach, aim] of [['walk', 6.4, 1.05], ['scooter', 8.8, 1.05], ['helicopter', 18, 1.5], ['roadster', 9.4, .7], ['hoverboard', 8.4, 1.2], ['spider', 5.8, 1.05]]) {
    const a = calculatePlayerCamera({ mode, x: 0, y: 0, z: 0, yaw: 0 });
    const b = calculatePlayerCamera({ mode, x: 27, y: 5.5, z: -32, yaw: Math.PI / 2 });
    near(b.position.x, 27 + a.position.z);
    near(b.position.z, -32 - a.position.x);
    near(b.position.y, 5.5 + a.position.y);
    near(b.target.x, 27);
    near(b.target.z, -32);
    near(Math.hypot(a.position.x - a.target.x, a.position.y - a.target.y, a.position.z - a.target.z), reach);
    near(a.target.y, aim);
    assert.ok(a.position.y > a.target.y);
  }
});

test('first-person eye height follows mode and aims along the player heading plus look offset', () => {
  for (const [mode, eye] of [['walk', 1.58], ['scooter', 1.4], ['helicopter', 1.5], ['roadster', .99], ['hoverboard', 2.0], ['spider', 1.65]]) {
    const camera = calculatePlayerCamera({ mode, x: 12, y: 5.5, z: -7, yaw: Math.PI / 2 }, { view: 'first', pitch: 0 });
    near(camera.position.y, 5.5 + eye);
    near(camera.target.x, 2);
    near(camera.target.z, -7);
    near(camera.target.y, camera.position.y);
  }
  const looked = calculatePlayerCamera({ mode: 'walk', x: 0, y: 0, z: 0, yaw: 0 }, { view: 'first', yawOffset: Math.PI / 2, pitch: .3 });
  assert.ok(looked.target.x < looked.position.x && looked.target.y < looked.position.y);
  near(looked.target.z, 0);
});

test('a thin building wall shortens the trailing camera without putting it through the facade', () => {
  const state = { mode: 'walk', x: 0, y: 0, z: 0, yaw: 0 };
  const building = { rings: [rectangle(-4, 2, 4, 2.03)], height: 12 };
  const blocked = calculatePlayerCamera(state, { world: { buildings: [building] } });
  assert.ok(blocked.position.z > 1.6 && blocked.position.z < 1.8);
  near(blocked.target.z, 0);
  assert.deepEqual(state, { mode: 'walk', x: 0, y: 0, z: 0, yaw: 0 });
  const aboveRoof = calculatePlayerCamera({ ...state, mode: 'helicopter', y: 25 }, { world: { buildings: [building] } });
  assert.ok(aboveRoof.position.z > 17);
});

test('an open building courtyard does not obstruct a camera contained within its hole', () => {
  const courtyard = { rings: [rectangle(-20, -20, 20, 20), rectangle(-8, -8, 8, 8)], height: 20 };
  const clear = calculatePlayerCamera({ mode: 'walk', x: 0, y: 0, z: 0, yaw: 0 });
  const inCourt = calculatePlayerCamera({ mode: 'walk', x: 0, y: 0, z: 0, yaw: 0 }, { world: { buildings: [courtyard] } });
  assert.deepEqual(inCourt, clear);
});

test('camera clears an elevated bridge and stops before rising terrain along the sight line', () => {
  const bridge = calculatePlayerCamera({ mode: 'scooter', x: 10, y: 5.5, z: 0, yaw: 0 }, { pitch: -.6, groundAt: () => ({ height: 5.5 }) });
  assert.ok(bridge.position.y >= 5.74 - 1e-8);
  const bank = calculatePlayerCamera({ mode: 'walk', x: 0, y: 0, z: 0, yaw: 0 }, { pitch: 0, groundAt: (_x, z) => z >= 2 && z <= 3 ? 3 : 0 });
  assert.ok(bank.position.z < 2 && bank.position.z > 1.5);
  assert.ok(bank.position.y > .24);
});

test('spider speed gradually widens the view and backs away without changing legacy mode outputs', () => {
  const state = { mode:'spider', x:0, y:0, z:0, yaw:0, grounded:true };
  const slow = calculatePlayerCamera({...state,speed:0});
  const middle = calculatePlayerCamera({...state,speed:14});
  const fast = calculatePlayerCamera({...state,speed:28});
  const reach = c => Math.hypot(c.position.x-c.target.x,c.position.y-c.target.y,c.position.z-c.target.z);
  near(reach(slow),5.8);near(reach(fast),8.6);assert.ok(reach(middle)>reach(slow)&&reach(middle)<reach(fast));
  near(slow.fov,58);near(fast.fov,70);near(middle.speedFactor,.5);
  const first = calculatePlayerCamera({...state,speed:100},{view:'first'});near(first.fov,66);near(first.position.y,1.65);
  near(calculatePlayerCamera(state,{view:'first'}).fov,56);
  near(reach(calculatePlayerCamera({...state,speed:28},{distance:6})),6);
  for(const mode of ['walk','scooter','helicopter','roadster','hoverboard']) {
    assert.deepEqual(Object.keys(calculatePlayerCamera({...state,mode})).sort(),['position','target']);
  }
});

test('airborne framing follows travel and stays stable across changes of rope anchor', () => {
  const state = {mode:'spider',x:0,y:5,z:0,yaw:0,speed:18,vx:4,vz:-18,verticalSpeed:3,grounded:false,anchor:Object.freeze({x:5,y:25,z:-12})};
  Object.freeze(state);const before = JSON.stringify(state),a = calculatePlayerCamera(state);
  const b = calculatePlayerCamera({...state,x:20,y:8,z:30,yaw:Math.PI/2,vx:-18,vz:-4,anchor:{x:8,y:28,z:25}});
  for(const key of ['position','target']) {near(b[key].x,20+a[key].z);near(b[key].z,30-a[key].x);near(b[key].y,3+a[key].y);}
  assert.ok(a.target.z<0&&a.target.y>state.y+1.1,'frame has forward and upward space for the swing');
  assert.equal(JSON.stringify(state),before,'camera does not mutate movement or anchor state');
  const candidate = calculatePlayerCamera({...state,anchor:null,candidateAnchor:state.anchor});
  assert.deepEqual(candidate,a,'changing a rope attachment must not jerk the camera target');
});

test('fast spider camera and look-ahead stay outside thin walls and raised ground', () => {
  const state={mode:'spider',x:0,y:0,z:0,yaw:0,speed:28,vx:0,vz:-24,grounded:false};
  const wall={rings:[rectangle(-4,2,4,2.03)],height:12};
  const behind=calculatePlayerCamera(state,{world:{buildings:[wall]}});
  assert.ok(behind.position.z<2&&behind.position.z>1.5,'extended camera stops in front of a thin wall');
  const frontWall={rings:[rectangle(-4,-.75,4,-.65)],height:12};
  const ahead=calculatePlayerCamera(state,{world:{buildings:[frontWall]}});
  assert.ok(ahead.target.z>-.65&&ahead.position.z>-.65,'look-ahead cannot become an origin inside the facade');
  const raised=calculatePlayerCamera(state,{groundAt:(_x,z)=>z<-.6?3:0,pitch:-.6});
  assert.ok(raised.target.z>-.6);assert.ok(raised.position.y>=.24-1e-8);
  const bridge=calculatePlayerCamera({...state,y:5.5},{groundAt:()=>5.5,pitch:-.6});
  assert.ok(bridge.position.y>=5.74-1e-8);
});

test('dragged boom does not snap to a reversed velocity and cannot create a camera-relative input spiral',()=>{
  const rig=createTraversalCameraRig(),s={mode:'spider',x:0,y:8,z:0,yaw:0,vx:0,vz:-20,speed:20,verticalSpeed:0,grounded:false};
  rig.reset(s);const initial=rig.update(s,0,{snap:true});
  const reversed=rig.update({...s,vz:20,yaw:Math.PI},1/60);
  assert.ok(Math.abs(reversed.heading-initial.heading)<.04,'a reversal cannot instantly rotate the camera');
  const locked=rig.heading;
  for(let i=0;i<120;i++)rig.update({...s,x:i*.15,vx:9,vz:0,yaw:-Math.PI/2},1/60,{lookLocked:true});
  near(rig.heading,locked);
  rig.rotate(.4);rig.update(s,1/60,{lookLocked:true});near(rig.heading,locked+.4);
});

test('spring-rendered poses are re-clipped at thin corners after a rapid turn',()=>{
  const rig=createTraversalCameraRig(),world={buildings:[{rings:[rectangle(-1,2,1,2.03)],height:15}]};
  const s={mode:'spider',x:0,y:2,z:0,yaw:0,vx:0,vz:-10,speed:10,grounded:false};
  rig.reset(s);rig.update(s,0,{snap:true});
  for(let i=0;i<80;i++){
    const pose=rig.update({...s,x:i*.025},1/60,{world});
    const again=constrainPlayerCamera({...s,x:i*.025},pose,{world});
    assert.ok(Math.hypot(pose.position.x-again.position.x,pose.position.z-again.position.z)<.001,'rendered pose is already collision-safe');
  }
});

test('camera smoothing converges consistently at 30 and 120 fps',()=>{
  const run=fps=>{const rig=createTraversalCameraRig();let pose;const s={mode:'spider',x:0,y:6,z:0,yaw:0,vx:0,vz:-18,speed:18,grounded:false};rig.reset(s);rig.update(s,0,{snap:true});for(let i=1;i<=fps*3;i++)pose=rig.update({...s,z:-18*i/fps},1/fps);return pose;};
  const a=run(30),b=run(120);
  assert.ok(Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y,a.position.z-b.position.z)<.3);
  near(a.fov,b.fov,.01);near(a.heading,b.heading,.001);
});

test('comfortable camera holds FOV and boom length across speed and zip without changing movement state',()=>{
  const state={mode:'spider',x:0,y:12,z:0,yaw:0,vx:0,vz:-10,verticalSpeed:-5,grounded:false};
  const before=JSON.stringify(state),reach=p=>Math.hypot(p.position.x-p.target.x,p.position.y-p.target.y,p.position.z-p.target.z);
  const slow=calculatePlayerCamera(state,{comfortable:true}),fast=calculatePlayerCamera({...state,vz:-28,zipActive:true,zipProgress:.5},{comfortable:true});
  near(slow.fov,58);near(fast.fov,58);near(reach(slow),6.8);near(reach(fast),6.8);
  near(calculatePlayerCamera(state,{view:'first',comfortable:true}).fov,56);
  assert.equal(JSON.stringify(state),before);
  const rig=createTraversalCameraRig();rig.reset(state);const pose=rig.update({...state,lean:.3,diving:true},0,{comfortable:true,snap:true});
  near(pose.roll,0);near(pose.fov,58);
});

test('zip framing pulse is finite and returns to the ordinary traversal camera',()=>{
  const state={mode:'spider',x:0,y:10,z:0,yaw:0,vx:0,vz:-28,speed:28,grounded:false};
  const normal=calculatePlayerCamera(state),peak=calculatePlayerCamera({...state,zipActive:true,zipProgress:.5}),end=calculatePlayerCamera({...state,zipActive:true,zipProgress:1});
  near(peak.fov,72);near(end.fov,normal.fov);assert.ok(peak.position.z>normal.position.z);
  const rig=createTraversalCameraRig();rig.reset(state);let pose=rig.update(state,0,{snap:true});
  for(let i=1;i<=60;i++){const next=rig.update({...state,z:-28*i/60,zipActive:i<18,zipProgress:Math.min(1,i/18)},1/60);assert.ok(Math.abs(next.fov-pose.fov)<.15,'no FOV jump on the short pull');pose=next;}
  assert.ok(pose.fov<70.15);
});

test('dive pitch eases toward the ground and remains collision safe when the action ends',()=>{
  const s={mode:'spider',x:0,y:16,z:0,yaw:0,vx:0,vz:-16,verticalSpeed:-15,grounded:false};
  const rig=createTraversalCameraRig();rig.reset(s);const a=rig.update(s,0,{snap:true});
  let last=a;
  for(let i=0;i<50;i++){const p=rig.update({...s,diving:i<25},1/60,{groundAt:()=>0});assert.ok(p.position.y>.24);assert.ok(Math.abs(p.position.y-last.position.y)<.2);last=p;}
  assert.ok(Number.isFinite(last.fov)&&last.fov<=72);
});

test('tricks frame the complete body without inheriting its rotation or changing the horizon',()=>{
  const state={mode:'spider',x:0,y:16,z:0,yaw:.2,vx:0,vz:-18,speed:18,verticalSpeed:1,grounded:false,trickBlend:1,trickActive:true};
  const before=JSON.stringify(state),a=calculatePlayerCamera({...state,trickRotation:{x:0,y:0,z:0}});
  const b=calculatePlayerCamera({...state,trickRotation:{x:Math.PI,y:2,z:-Math.PI}});
  assert.deepEqual(a,b);assert.equal(JSON.stringify(state),before);
  const plain=calculatePlayerCamera({...state,trickBlend:0});
  assert.ok(Math.hypot(a.position.x-a.target.x,a.position.y-a.target.y,a.position.z-a.target.z)>Math.hypot(plain.position.x-plain.target.x,plain.position.y-plain.target.y,plain.position.z-plain.target.z));
  assert.deepEqual(calculatePlayerCamera(state,{view:'first'}),calculatePlayerCamera({...state,trickRotation:{x:3,z:4}},{view:'first'}));
});

test('point approach, perch, launch and interrupted trick transitions keep bounded camera motion',()=>{
  const s={mode:'spider',x:0,y:18,z:0,yaw:0,vx:0,vz:0,speed:0,grounded:false,verticalSpeed:0};
  const rig=createTraversalCameraRig();rig.reset(s);let previous=rig.update(s,0,{snap:true});
  for(let i=0;i<180;i++){
    const phase=i<40?'approach':i<60?'perch':i<85?'launch':'idle';
    const next=rig.update({...s,pointPhase:phase,pointTarget:{x:5,y:20,z:-15},trickBlend:i>=85&&i<130?1:0,trickRotation:{x:i*.2,z:i*.3}},1/60,{lookLocked:true});
    assert.ok(Math.abs(next.fov-previous.fov)<.22,'FOV has no discontinuity at transitions');
    assert.ok(Math.hypot(next.position.x-previous.position.x,next.position.y-previous.position.y,next.position.z-previous.position.z)<.2,'stationary framing cannot snap on an action boundary');
    near(next.roll,0);near(next.heading,0);previous=next;
  }
  const candidateOnly=calculatePlayerCamera({...s,candidatePoint:{x:80,y:30,z:40}});
  assert.deepEqual(candidateOnly,calculatePlayerCamera(s),'uncommitted targets never move the camera');
});

test('comfortable mode ignores point and trick framing forces while preserving camera collision',()=>{
  const s={mode:'spider',x:0,y:18,z:0,yaw:0,vx:0,vz:-30,speed:30,grounded:false};
  const a=calculatePlayerCamera(s,{comfortable:true}),b=calculatePlayerCamera({...s,pointPhase:'launch',trickBlend:1},{comfortable:true});
  assert.deepEqual(a,b);near(b.fov,58);
  const wall={rings:[rectangle(-4,2,4,2.03)],height:30};
  const rig=createTraversalCameraRig();rig.reset(s);
  for(let i=0;i<90;i++){
    const frame=rig.update({...s,pointPhase:i<40?'approach':'launch',pointTarget:{x:3,y:25,z:-10},trickBlend:1},1/60,{world:{buildings:[wall]},comfortable:true});
    assert.ok(frame.position.z<2);near(frame.fov,58);near(frame.roll,0);
  }
});

const carState={mode:'roadster',x:0,y:.14,z:0,yaw:0,speed:18,grounded:true,lean:0,pitch:0};
const separation=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

test('vehicle chase carries translation exactly instead of stretching its boom at speed',()=>{
  const rig=createVehicleCameraRig();rig.reset(carState);
  const initial=rig.update(carState,0,{snap:true});let current;
  for(let i=1;i<=120;i++)current=rig.update({...carState,z:-18*i/60},1/60);
  near(current.position.z-carState.z+36,initial.position.z);
  near(current.target.z+36,initial.target.z);
  near(current.position.y,initial.position.y);
  assert.ok(initial.target.z< -2,'the road ahead receives useful screen space');
  assert.ok(initial.position.y<3,'a grounded car uses a low driving camera');
});

test('vehicle turn response is bounded, wraps the short way, and does not inherit vehicle bank',()=>{
  const rig=createVehicleCameraRig(),state={...carState,y:24,grounded:false,yaw:Math.PI-.02};rig.reset(state);
  const before=rig.update(state,0,{snap:true}),after=rig.update({...state,yaw:-Math.PI+.02,pitch:.6,lean:.7},1/60);
  assert.ok(separation(after.position,before.position)<.08,'the ±pi boundary cannot whip the boom around');
  near(after.roll,0);near(after.position.y,before.position.y);
  let previous=after;
  for(let i=0;i<90;i++){
    const next=rig.update({...state,yaw:0,pitch:-.5,lean:-.5},1/60);
    assert.ok(separation(next.position,previous.position)<.5,'turning keeps a bounded camera step');
    near(next.roll,0);previous=next;
  }
  assert.ok(Math.abs(previous.heading)<.08,'chase heading catches the actual vehicle heading');
});

test('manual vehicle orbit persists while parked and softly recentres only after moving unlocked',()=>{
  const rig=createVehicleCameraRig(),state={...carState,speed:0};rig.reset(state);rig.update(state,0,{snap:true});
  rig.rotate(1.4);
  for(let i=0;i<120;i++)rig.update(state,1/60,{lookLocked:i<60});
  near(rig.heading,1.4);
  const held=rig.update(carState,1/60,{lookLocked:true});near(held.heading,1.4);
  const released=rig.update(carState,1/60);assert.ok(released.heading<1.4&&released.heading>1.35);
  for(let i=0;i<120;i++)rig.update(carState,1/60);
  assert.ok(Math.abs(rig.heading)<.001);
});

test('explicit recenter orbits smoothly behind a parked car instead of cutting across its body',()=>{
  const rig=createVehicleCameraRig(),state={...carState,speed:0};rig.reset(state,Math.PI);
  let previous=rig.update(state,0,{snap:true,lookLocked:true});
  rig.recenter(state);near(rig.heading,Math.PI);
  for(let i=0;i<240;i++){
    const next=rig.update(state,1/60);
    const angleStep=Math.abs(Math.atan2(Math.sin(next.heading-previous.heading),Math.cos(next.heading-previous.heading)));
    assert.ok(angleStep<=2.5/60+.00001,'heading itself is rate limited before spring motion');
    assert.ok(separation(next.position,previous.position)<.38,'recenter does not jump the full boom length');
    assert.ok(Math.hypot(next.position.x-state.x,next.position.z-state.z)>8,'camera takes an arc around the body');
    previous=next;
  }
  near(previous.heading,state.yaw,.001);assert.ok(previous.position.z>8);
  rig.rotate(.5);for(let i=0;i<90;i++)rig.update(state,1/60);
  near(rig.heading,.5);
});

test('Roadster speed FOV is gradual and comfortable mode removes it without tilting the horizon',()=>{
  const rig=createVehicleCameraRig(),state={...carState,speed:0};rig.reset(state);
  const initial=rig.update(state,0,{snap:true,baseFov:58});near(initial.fov,58);
  let previous=initial;
  for(let i=0;i<180;i++){
    const next=rig.update({...state,speed:28},1/60,{baseFov:58});
    assert.ok(next.fov>=previous.fov&&next.fov-previous.fov<.3);
    assert.ok(next.fov<=66);near(next.roll,0);previous=next;
  }
  assert.ok(previous.fov>65.9);
  for(let i=0;i<180;i++)previous=rig.update({...state,speed:28,pitch:.7,lean:1},1/60,{baseFov:58,comfortable:true});
  near(previous.fov,58,.001);near(previous.roll,0);
});

test('ordinary transport modes retain the application FOV without acquiring flight speed zoom',()=>{
  for(const mode of ['walk','scooter','helicopter']){
    const rig=createVehicleCameraRig(),state={...carState,mode,speed:0};rig.reset(state);
    near(rig.update(state,0,{snap:true,baseFov:44}).fov,44);
    for(let i=0;i<60;i++)near(rig.update({...state,speed:28},1/60,{baseFov:44}).fov,44);
    near(rig.update(state,0,{view:'first',snap:true,baseFov:44}).fov,44);
  }
});

const boardState={mode:'hoverboard',x:0,y:12,z:0,yaw:0,speed:0,grounded:false,lean:0,pitch:0};

test('hoverboard frames the rider below centre and exposes more road at cruise and boost speed',()=>{
  const poseAt=speed=>{const rig=createVehicleCameraRig();rig.reset(boardState);return rig.update({...boardState,speed},0,{snap:true});};
  const idle=poseAt(0),cruise=poseAt(24),boost=poseAt(36);
  near(idle.fov,62);assert.ok(cruise.fov>67&&cruise.fov<69);near(boost.fov,70);
  assert.ok(boost.position.z-idle.position.z>2,'speed extends the chase boom without excessive zoom');
  assert.ok(cruise.target.z< -3&&boost.target.z< -4,'the camera shows the upcoming path instead of centring the board');
  // Camera-space vertical coordinate of the rider chest, for a level heading.
  // A negative value means the rider is below screen centre, leaving sky/road
  // space above it. At cruise the sight line remains within 8° of horizontal.
  const pitch=Math.atan2(cruise.position.y-cruise.target.y,cruise.position.z-cruise.target.z);
  const chestY=(boardState.y+1.35-cruise.position.y)*Math.cos(pitch)-(boardState.z-cruise.position.z)*Math.sin(pitch);
  assert.ok(chestY<-.8,'rider chest is below the sight-line target');
  assert.ok(pitch>0&&pitch<.14,'a shallow camera pitch preserves a readable horizon');
  const rig=createVehicleCameraRig();rig.reset(boardState);
  const comfortable=rig.update({...boardState,speed:36,lean:1,pitch:.6},0,{snap:true,comfortable:true});
  near(comfortable.fov,62);near(comfortable.roll,0);near(comfortable.position.z,idle.position.z);
});

test('hoverboard manual orbit is held, then progressively released without an initial camera grab',()=>{
  const rig=createVehicleCameraRig(),state={...boardState,speed:36};rig.reset(state);rig.update(state,0,{snap:true});
  rig.rotate(1.2);
  let held;
  for(let i=0;i<90;i++)held=rig.update({...state,z:-36*i/60},1/60,{lookLocked:true,pitch:.37});
  near(held.heading,1.2);
  const first=rig.update({...state,z:-54},1/60,{pitch:.37});
  assert.ok(first.heading<1.2&&first.heading>1.199,'chase force starts from zero after manual lock');
  let last=first;
  for(let i=1;i<=180;i++){
    const pose=rig.update({...state,z:-54-36*i/60},1/60,{pitch:.37});
    assert.ok(Math.abs(Math.atan2(Math.sin(pose.heading-last.heading),Math.cos(pose.heading-last.heading)))<=3.2/60+.00001);
    near(pose.roll,0);last=pose;
  }
  assert.ok(Math.abs(last.heading)<.001,'the camera returns behind a moving board');
  const stopped={...boardState,z:last.target.z};
  rig.reset(stopped);rig.update(stopped,0,{snap:true});rig.rotate(.8);
  for(let i=0;i<120;i++)last=rig.update(stopped,1/60,{lookLocked:i<30,pitch:.37});
  near(last.heading,.8);
  const high=last.position.y;rig.recenter(stopped);
  const recentering=rig.update(stopped,1/60);
  assert.ok(recentering.position.y<high&&recentering.position.y>high-.12,'pitch restore eases out of the manual angle');
  for(let i=0;i<180;i++)last=rig.update(stopped,1/60);
  near(last.heading,0,.001);assert.ok(last.position.y<high-1.5);
});

test('boost-speed hoverboard chase carries translation and crosses ±pi without flipping the view',()=>{
  const rig=createVehicleCameraRig(),state={...boardState,speed:36,yaw:Math.PI-.02};rig.reset(state);
  let last=rig.update(state,0,{snap:true});
  const next=rig.update({...state,yaw:-Math.PI+.02,x:.6},1/60);
  assert.ok(separation({...last.position,x:last.position.x+.6},next.position)<.08);
  near(next.roll,0);
  const straight={...boardState,speed:36};rig.reset(straight);const initial=rig.update(straight,0,{snap:true});
  for(let i=1;i<=180;i++)last=rig.update({...straight,z:-36*i/60},1/60);
  near(last.position.z+108,initial.position.z);near(last.target.z+108,initial.target.z);near(last.position.y,initial.position.y);
});

test('hoverboard boost framing and manual orbit keep the whole camera outside nearby facades',()=>{
  const rig=createVehicleCameraRig(),state={...boardState,speed:36};
  const world={buildings:[{rings:[rectangle(-4,-1,4,-.95)],height:25},{rings:[rectangle(.1,2,3,2.04)],height:25}]};
  rig.reset(state);let pose=rig.update(state,0,{snap:true,world});
  assert.ok(pose.target.z>-.95,'forward look-ahead stops before a facade');
  assert.ok(pose.position.z<2,'a grazing facade stops the camera volume');
  rig.rotate(.75);
  for(let i=0;i<90;i++){
    pose=rig.update(state,1/60,{world,lookLocked:true});
    const checked=constrainPlayerCamera(state,pose,{world});
    assert.ok(separation(checked.position,pose.position)<.001);near(pose.roll,0);
  }
});

test('hoverboard turns and accelerations keep consistent camera framing across frame rates',()=>{
  const run=fps=>{
    const rig=createVehicleCameraRig();rig.reset(boardState);rig.update(boardState,0,{snap:true});let pose;
    for(let i=1;i<=fps*4;i++){
      const t=i/fps;pose=rig.update({...boardState,x:10*Math.sin(t*.4),z:-24*t,yaw:Math.min(1.2,t*.35),speed:Math.min(36,t*12)},1/fps);
    }
    return pose;
  };
  const a=run(30),b=run(120);
  assert.ok(separation(a.position,b.position)<.2);assert.ok(separation(a.target,b.target)<.15);
  near(a.heading,b.heading,.01);near(a.fov,b.fov,.03);
});

test('vehicle camera near-plane volume catches grazing facade corners and remains clear after orbiting',()=>{
  const world={buildings:[{rings:[rectangle(.12,2,3,2.05)],height:15}]};
  const rig=createVehicleCameraRig(),state={...carState,speed:0};rig.reset(state);
  const first=rig.update(state,0,{snap:true,world});
  assert.ok(first.position.z<2,'a wall beside the centre ray still obstructs the camera volume');
  rig.rotate(.7);
  for(let i=0;i<90;i++){
    const pose=rig.update(state,1/60,{lookLocked:true,world});
    const checked=constrainPlayerCamera(state,pose,{world});
    assert.ok(separation(pose.position,checked.position)<.001,'rendered orbit pose is already safe');
  }
});

test('vehicle look-ahead and negative camera pitch cannot enter a facade or go below the bridge',()=>{
  const world={buildings:[{rings:[rectangle(-4,-1,-.1,-.8)],height:15},{rings:[rectangle(-.1,-1,4,-.8)],height:15}]};
  const rig=createVehicleCameraRig();rig.reset(carState);
  const pose=rig.update(carState,0,{snap:true,world});assert.ok(pose.target.z>-.8);
  const bridge={...carState,y:5.5};rig.reset(bridge);
  for(let i=0;i<60;i++){
    const p=rig.update(bridge,1/60,{pitch:-.35,groundAt:()=>5.5});
    assert.ok(p.position.y>=5.74,'bridge floor remains below the eye');
  }
});

test('first/third-person vehicle switches blend over 360ms, including an explicit snap request',()=>{
  const rig=createVehicleCameraRig(),state={...carState,speed:0};rig.reset(state);
  const third=rig.update(state,0,{view:'third',snap:true});
  const switching=rig.update(state,0,{view:'first',snap:true});
  near(separation(switching.position,third.position),0);near(separation(switching.target,third.target),0);
  assert.equal(switching.transitioning,true);assert.equal(rig.transitioning,true);
  let middle,last=switching;
  for(let i=1;i<=24;i++){
    const next=rig.update(state,1/60,{view:'first'});
    assert.ok(separation(next.position,last.position)<.7,'switching avoids a full boom-length jump');
    if(i===11)middle=next;last=next;
  }
  assert.ok(middle.position.z>2&&middle.position.z<7);
  near(last.position.z,state.z);near(last.position.y,state.y+.99);
  assert.equal(last.transitioning,false);assert.equal(rig.transitioning,false);
  const back=rig.update(state,0,{view:'third',snap:true});near(separation(back.position,last.position),0);assert.equal(back.transitioning,true);
  for(let i=0;i<24;i++)last=rig.update(state,1/60,{view:'third'});
  assert.ok(last.position.z>8,'the chase camera returns to its intended distance');
  assert.equal(last.transitioning,false);
});

test('view transitions stay collision-safe when the close and chase camera straddle a thin wall',()=>{
  const world={buildings:[{rings:[rectangle(-4,2,4,2.03)],height:15}]};
  const rig=createVehicleCameraRig(),state={...carState,speed:0};rig.reset(state);
  rig.update(state,0,{view:'first',snap:true,world});
  rig.update(state,0,{view:'third',snap:true,world});
  for(let i=0;i<30;i++){
    const pose=rig.update(state,1/60,{view:'third',world});
    assert.ok(pose.position.z<2,'the interpolated camera cannot pass through a wall');
  }
});

test('vehicle chase stays consistent at 30 and 120 fps through speed and steering changes',()=>{
  const run=fps=>{
    const rig=createVehicleCameraRig(),initial={...carState,speed:0};rig.reset(initial);rig.update(initial,0,{snap:true});let pose;
    for(let i=1;i<=fps*4;i++){
      const t=i/fps;pose=rig.update({...carState,x:6*Math.sin(t*.3),z:-12*t,yaw:Math.min(1,t*.3),speed:Math.min(24,t*7)},1/fps);
    }
    return pose;
  };
  const a=run(30),b=run(120);
  assert.ok(separation(a.position,b.position)<.2);assert.ok(separation(a.target,b.target)<.15);
  near(a.heading,b.heading,.01);near(a.fov,b.fov,.03);
});

test('vehicle mode change and teleport discard old spring velocity without changing movement state',()=>{
  const rig=createVehicleCameraRig();rig.reset(carState);rig.update(carState,0,{snap:true});rig.rotate(1);
  rig.update(carState,1/60,{lookLocked:true});
  const far=Object.freeze({...carState,x:500,z:600,y:30,grounded:false});
  const before=JSON.stringify(far),pose=rig.update(far,1/60,{lookLocked:true});
  assert.ok(separation(pose.position,far)<12);assert.equal(JSON.stringify(far),before);
  rig.reset({...far,mode:'walk',speed:0});
  const walk=rig.update({...far,mode:'walk',speed:0},0,{snap:true});
  near(Math.hypot(walk.position.x-far.x,walk.position.y-far.y-1.05,walk.position.z-far.z),6.4);
});

test('first-person relative mouse batches are lightly filtered without delaying the control heading',()=>{
  for(const mode of ['walk','scooter','roadster','hoverboard','spider']){
    const rig=mode==='spider'?createTraversalCameraRig():createVehicleCameraRig();
    const state={...carState,mode,speed:0,y:10};rig.reset(state);
    rig.update(state,0,{view:'first',snap:true,lookLocked:true,pitch:.1});rig.rotate(.3);
    near(rig.heading,.3);
    let pose=rig.update(state,1/60,{view:'first',lookLocked:true,pitch:.6});
    const eyeHeading=p=>Math.atan2(p.position.x-p.target.x,p.position.z-p.target.z);
    const eyePitch=p=>Math.atan2(p.position.y-p.target.y,Math.hypot(p.position.x-p.target.x,p.position.z-p.target.z));
    assert.ok(eyeHeading(pose)>.14&&eyeHeading(pose)<.16,'a batched input does not apply its full rotation in one frame');
    assert.ok(eyePitch(pose)>.33&&eyePitch(pose)<.35,'vertical mouse batches use the same brief response');
    for(let i=0;i<5;i++)pose=rig.update(state,1/60,{view:'first',lookLocked:true,pitch:.6});
    near(eyeHeading(pose),.3,.006);near(eyePitch(pose),.6,.01);near(pose.heading,.3);
  }
});

test('first-person mouse filtering takes the short arc and is independent of display refresh rate',()=>{
  for(const mode of ['walk','spider']){
    const run=fps=>{
      const rig=mode==='spider'?createTraversalCameraRig():createVehicleCameraRig();
      const state={...carState,mode,speed:0,yaw:Math.PI-.1};rig.reset(state);
      rig.update(state,0,{view:'first',snap:true,lookLocked:true});rig.rotate(.3);
      let pose;for(let i=0;i<fps/2;i++)pose=rig.update(state,1/fps,{view:'first',lookLocked:true});return pose;
    };
    const a=run(24),b=run(144);assert.ok(separation(a.target,b.target)<1e-8);near(a.heading,-Math.PI+.2);
  }
});

test('releasing manual orbit brings every moving ground camera back without a first-frame grab',()=>{
  for(const mode of ['walk','scooter','roadster']){
    const state={...carState,mode,speed:mode==='walk'?1.6:5.5};const rig=createVehicleCameraRig();rig.reset(state);
    rig.update(state,0,{snap:true});rig.rotate(1);
    for(let i=0;i<60;i++)rig.update(state,1/60,{lookLocked:true});
    const released=rig.update(state,1/60);
    assert.ok(released.heading<1&&released.heading>.999,'chase response starts gently after mouse control');
    let pose;for(let i=0;i<180;i++)pose=rig.update(state,1/60);
    near(pose.heading,0,.001);
  }
});

test('walking up a real tread eases eye height without drifting the ground position or aim',()=>{
  const rig=createVehicleCameraRig(),state={mode:'walk',x:0,y:.14,z:0,yaw:0,speed:1.6,grounded:true};
  const options={view:'first',pitch:-.1,snap:true};rig.reset(state);const before=rig.update(state,0,options);
  const next={...state,y:.28,z:-.03},frame=rig.update(next,1/60,{...options,snap:false});
  assert.ok(frame.position.y>before.position.y&&frame.position.y<before.position.y+.06,'a 14cm tread does not kick the eye up 14cm in one frame');
  near(frame.position.z,next.z);near(frame.target.y-frame.position.y,before.target.y-before.position.y);
  let settled;for(let i=0;i<60;i++)settled=rig.update(next,1/60,{...options,snap:false});
  near(settled.position.y,next.y+1.58,1e-6);
  const relocated=rig.update({...next,y:1.12},0,options);near(relocated.position.y,2.70,1e-8);
});

test('walking recenter uses the requested facing once instead of chasing camera-relative lateral movement',()=>{
  const rig=createVehicleCameraRig(),state={mode:'walk',x:0,y:.14,z:0,yaw:0,speed:3.2};
  rig.reset(state);rig.update(state,0,{snap:true,lookLocked:true});
  state.yaw=-Math.PI/2;rig.recenter(state);
  for(let i=0;i<240;i++){
    state.yaw=rig.heading-Math.PI/2; // Holding D as the camera recentres.
    rig.update(state,1/60,{lookLocked:true});
  }
  near(rig.heading,-Math.PI/2,.001);
  rig.rotate(.3);rig.update(state,1/60,{lookLocked:true});
  near(rig.heading,-Math.PI/2+.3,.001);
});

// A layered query must keep a bridge's solid slab separate from the surface
// below a point. This fixture deliberately stops reporting its top as ground
// below it; volume clipping must still catch complete slab crossings.
function layeredDeck({top=8,thickness=.75,ring=rectangle(-20,-20,20,20)}={}){
  const deck={rings:[ring],minHeight:top-thickness,height:top};
  const bounds={minX:Math.min(...ring.map(p=>p.x)),maxX:Math.max(...ring.map(p=>p.x)),minZ:Math.min(...ring.map(p=>p.z)),maxZ:Math.max(...ring.map(p=>p.z))};
  const contains=(x,z)=>x>bounds.minX&&x<bounds.maxX&&z>bounds.minZ&&z<bounds.maxZ;
  const groundAt=(x,z,_radius=0,y=Infinity)=>({height:contains(x,z)&&top<=y+.22?top:.14});
  groundAt.heightAt=(x,z,y)=>groundAt(x,z,0,y).height;
  groundAt.maxHeightInBounds=()=>top;
  groundAt.solidsInBounds=()=>[deck];
  return groundAt;
}

test('real Guanggu viaduct keeps first and third person on the ground below the deck',()=>{
  const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  const route=createCommuteRoute(source,{frame,geoToLocal}),groundAt=createPlayerMotion({route}).groundAt;
  const deck=route.roadSurfaces.find(s=>s.sourceId==='way/607689466'&&s.bounds.maxZ>-300&&s.bounds.maxZ<-220);
  assert.ok(deck&&deck.surfaceY>10,'use the actual layered viaduct, not the level Yudai crossing');
  const center={x:deck.polygon.reduce((n,p)=>n+p.x,0)/deck.polygon.length,z:deck.polygon.reduce((n,p)=>n+p.z,0)/deck.polygon.length};
  const rig=createVehicleCameraRig();let previous=null;
  for(let x=center.x-15;x<=center.x+15;x+=.1){
    const state=Object.freeze({mode:'walk',x,y:.14,z:center.z,yaw:0,grounded:true,speed:3.2});
    const first=calculatePlayerCamera(state,{view:'first',groundAt});
    near(first.position.y,1.72);
    const chase=rig.update(state,1/60,{groundAt,view:'third',lookLocked:true});
    assert.ok(chase.position.y<5,'the chase boom must not jump onto the eleven-metre deck');
    assert.ok(chase.position.z-state.z>5,'the bridge must not collapse the chase boom to vertical');
    if(previous)assert.ok(Math.abs(chase.position.y-previous.position.y)<.1);
    previous=chase;
  }
  const above={mode:'walk',...center,y:deck.surfaceY,yaw:0,grounded:true};
  near(calculatePlayerCamera(above,{view:'first',groundAt}).position.y,deck.surfaceY+1.58);
});

test('camera rays cannot tunnel through the top or underside of an elevated slab',()=>{
  for(const thickness of [.75,.04]){
    const groundAt=layeredDeck({thickness});
    const lower={mode:'walk',x:0,y:.14,z:0,yaw:0};
    const upward=constrainPlayerCamera(lower,{target:{x:0,y:1.19,z:0},position:{x:0,y:12,z:1}},{groundAt});
    assert.ok(upward.position.y<8-thickness-.24,'upward view stops below the slab underside');
    assert.ok(upward.position.y>6,'the camera can use the clear space below the deck');
    const upper={mode:'walk',x:0,y:10,z:0,yaw:0};
    const downward=constrainPlayerCamera(upper,{target:{x:0,y:11.05,z:0},position:{x:0,y:2,z:1}},{groundAt});
    assert.ok(downward.position.y>=8.24,'downward view remains above the deck even when its endpoint is below it');
    assert.ok(downward.position.y<9,'the collision is with the slab, not an arbitrary overhead limit');
  }
});

test('camera volume catches bridge side edges while allowing passage below them',()=>{
  const groundAt=layeredDeck({ring:rectangle(-2,-20,2,20)});
  const state={mode:'walk',x:-5,y:6.55,z:0,yaw:0};
  const clipped=constrainPlayerCamera(state,{target:{x:-5,y:7.6,z:0},position:{x:5,y:7.6,z:0}},{groundAt});
  assert.ok(clipped.position.x< -2,'a horizontal ray in slab thickness must stop at the near edge');
  const low={...state,y:.14},clear=constrainPlayerCamera(low,{target:{x:-5,y:1.19,z:0},position:{x:5,y:1.19,z:0}},{groundAt});
  near(clear.position.x,5);near(clear.position.y,1.19);
  const viaFallback=(...args)=>groundAt(...args);viaFallback.solidsInBounds=groundAt.solidsInBounds;
  near(calculatePlayerCamera({...low,x:0},{view:'first',groundAt:viaFallback}).position.y,1.72);
});

test('camera above the maximum surface keeps the broad-phase fast path',()=>{
  const groundAt=layeredDeck();let volumeQueries=0;
  groundAt.solidsInBounds=()=>{volumeQueries++;throw new Error('clear camera must skip bridge volume tests');};
  const state={mode:'walk',x:0,y:20,z:0,yaw:0,grounded:false},rig=createVehicleCameraRig();rig.reset(state);
  for(let i=0;i<30;i++)rig.update(state,1/60,{groundAt,lookLocked:true});
  assert.equal(volumeQueries,0);
});
