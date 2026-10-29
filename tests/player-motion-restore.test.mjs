import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerMotion} from '../src/player-motion.js';
const rect=(x1,z1,x2,z2)=>[{x:x1,z:z1},{x:x2,z:z1},{x:x2,z:z2},{x:x1,z:z2}];
const route={length:200,points:[{x:0,z:0,y:.16},{x:0,z:-200,y:.16}],segments:[{startProgress:0,endProgress:200,width:8}]};
const building=(x1,z1,x2,z2,height,minHeight=0)=>({height,minHeight,rings:[rect(x1,z1,x2,z2)]});
const pose=(extra={})=>({x:0,y:.14,z:0,yaw:0,grounded:true,vx:0,vz:0,speed:0,verticalSpeed:0,...extra});
const tick=(p,seconds,input={})=>{for(let i=0;i<Math.round(seconds*120);i++)p.step(1/120,input);};

for(const mode of ['walk','scooter','roadster'])test(`${mode}: raised wheel/foot contact cannot push a grounded body into a low building underside`,()=>{
  const top=mode==='roadster'?1.7:2;
  const p=createPlayerMotion({route,world:{buildings:[building(-6,-20,6,5,8,top+.19)],walkSurfaces:[{surfaceY:.34,polygon:rect(-6,-20,6,-2)}]}});
  assert.equal(p.setMode(mode).ok,true);
  tick(p,3,{forward:1});
  assert.ok(p.state.y+top<=top+.19+1e-8,'all grounded contact updates retain overhead clearance');
  assert.match(p.state.blockedReason,/建筑/);
  const blockedZ=p.state.z;tick(p,1,{forward:-1});assert.ok(p.state.z>blockedZ,'reverse can leave the blocked step');
});

test('the same step stays traversable when overhead clearance is sufficient',()=>{
  const p=createPlayerMotion({route,world:{buildings:[building(-6,-20,6,5,8,3)],walkSurfaces:[{surfaceY:.34,polygon:rect(-6,-20,6,-2)}]}});
  tick(p,2,{forward:1});assert.ok(p.state.z<-4);assert.equal(p.state.y,.34);
});

test('failed restore leaves a live pose and private velocity unchanged',()=>{
  const p=createPlayerMotion({route,world:{buildings:[building(20,-10,30,10,15)],barriers:[{polygon:rect(40,-5,42,5),height:5,minHeight:0}],bounds:{minX:-100,maxX:100,minZ:-200,maxZ:100}}});
  p.setMode('roadster');p.setFlightEnabled(true);tick(p,2,{lift:1});
  const before={...p.state};
  for(const invalid of [pose({x:25}),pose({x:41}),pose({x:101}),pose({y:NaN}),pose({speed:Infinity}),pose({x:4,y:4,grounded:true})]){
    assert.equal(p.canRestorePose(invalid,'walk').ok,false);
    assert.equal(p.restorePose(invalid,'walk').ok,false);
    assert.deepEqual(p.state,before);
  }
  p.step(1/120,{lift:1});
  const expectedSpeed=Math.min(8.4,before.verticalSpeed+(18-9.81)/120);
  assert.ok(Math.abs(p.state.y-before.y-expectedSpeed/120)<1e-9,'failed restore never resets the previous integrator');
});

test('restoring an airborne car synchronizes private vertical momentum and can change the active mode',()=>{
  const p=createPlayerMotion({route});p.setMode('helicopter');tick(p,2,{vertical:1});
  const saved=pose({x:15,z:-20,y:25,grounded:false,verticalSpeed:-5,speed:4,flightEnabled:false,pitch:.02,lean:.01});
  assert.equal(p.restorePose(saved,'roadster').ok,true);
  assert.equal(p.state.mode,'roadster');assert.equal(p.state.y,25);assert.equal(p.state.verticalSpeed,-5);
  p.step(1/120,{});
  assert.ok(Math.abs(p.state.verticalSpeed-(-5-9.81/120))<1e-9);
  assert.ok(Math.abs(p.state.y-(25+(-5-9.81/120)/120))<1e-9);
});

test('a returned hovering board preserves its altitude target and clears the old steering command',()=>{
  const p=createPlayerMotion({route});p.setMode('hoverboard');tick(p,4,{vertical:1,forward:1,turn:1});
  const saved=pose({x:12,z:-50,y:12,grounded:false,pitch:0,lean:0,rotorPower:.72,altitudeTarget:12});
  assert.equal(p.restorePose(saved,'hoverboard').ok,true);
  tick(p,1);
  assert.equal(p.state.y,12);assert.equal(p.state.yaw,0);assert.equal(p.state.speed,0);assert.equal(p.state.rotorPower,.72);
});

test('bridge returns choose the saved layer and reject an intersecting slab',()=>{
  const bridge={bridge:true,surfaceY:11.14,polygon:rect(-10,-20,10,20)};
  const p=createPlayerMotion({route:{...route,roadSurfaces:[bridge]}});
  assert.equal(p.restorePose(pose(),'walk').ok,true);assert.equal(p.state.y,.14);
  assert.equal(p.restorePose(pose({y:11.14}),'walk').ok,true);assert.equal(p.state.y,11.14);
  assert.equal(p.canRestorePose(pose({y:10.6,grounded:false}),'spider').ok,false);
  assert.equal(p.restorePose(pose({y:11.139}),'scooter').ok,true,'model wheel contact keeps its existing millimetre offset');
  assert.equal(p.state.y,11.139);
});

test('a spider may restore a valid roof but never restores an old web attachment',()=>{
  const p=createPlayerMotion({route,world:{buildings:[building(-20,-100,-10,-5,22),building(10,-100,20,-5,22)]}});
  p.setMode('spider');tick(p,.2,{swing:true,forward:1});assert.ok(p.state.anchor);
  assert.equal(p.restorePose(pose({x:15,z:-20,y:22.016}),'spider').ok,true);
  assert.equal(p.state.anchor,null);assert.equal(p.state.roofIndex,1);assert.equal(p.state.grounded,true);
  tick(p,.1);assert.ok(Math.abs(p.state.y-22.016)<1e-9);
});

test('restore checks saved tilted board geometry even when the previous mode was walking',()=>{
  const p=createPlayerMotion({route,world:{buildings:[building(1.45,-1,2.5,1,10)]}});
  assert.equal(p.canRestorePose(pose({y:4,grounded:false,pitch:0,lean:-.8}),'hoverboard').ok,false,'leaning rider and rotor envelope cannot resume inside a wall');
  assert.equal(p.canRestorePose(pose({y:4,grounded:false,pitch:0,lean:0}),'hoverboard').ok,true);
});

for(const [mode,ceiling] of [['roadster',80.14],['hoverboard',60.14],['helicopter',120.14]])test(`${mode}: restore refuses positions that would clamp down from above the flight ceiling`,()=>{
  const p=createPlayerMotion({route}),before={...p.state};
  assert.equal(p.restorePose(pose({y:ceiling+1,grounded:false}),mode).ok,false);
  assert.deepEqual(p.state,before);
});
