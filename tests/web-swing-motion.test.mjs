import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPlayerMotion} from '../src/player-motion.js';
import {createWebSwingMotion} from '../src/web-swing-motion.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
import {getBuildingProfile} from '../src/building-profiles.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
const flat={length:300,points:[{x:0,y:.16,z:0,progress:0},{x:0,y:.16,z:-300,progress:300}],segments:[{startProgress:0,endProgress:300,width:7.2}]};
const polygon=(minX,minZ,maxX,maxZ,height=18,minHeight=0)=>({height,minHeight,rings:[[{x:minX,z:minZ},{x:maxX,z:minZ},{x:maxX,z:maxZ},{x:minX,z:maxZ}]]});
const corridor={buildings:[polygon(-20,-100,-10,-5,22),polygon(10,-100,20,-5,22)]};
function advance(player,seconds,input,dt=1/60){for(let t=0;t<seconds-1e-8;t+=dt)player.step(Math.min(dt,seconds-t),input);return player.state;}
function make(world={}){const p=createPlayerMotion({route:flat,world});p.reset(0,'spider');return p;}
function campus(){const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),route=createCommuteRoute(source,{frame,geoToLocal}),simulation=createCommuteSimulation(route);const project=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);const polygons=category=>source.features.filter(f=>f.properties?.category===category&&['Polygon','MultiPolygon'].includes(f.geometry.type)).flatMap(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(rings=>({rings:rings.map(r=>r.map(project)),height:category==='building'?getBuildingProfile(f).height+.065:0,minHeight:category==='building'?getBuildingProfile(f).baseHeight+.065:0})));return{route,simulation,world:{buildings:polygons('building'),water:polygons('water')}};}

test('spider jumps ballistically under gravity and cannot double-jump or fly without anchors',()=>{
  const p=make();p.step(1/120,{jump:true});assert.ok(p.state.verticalSpeed>9.8&&p.state.y>.14);const vy=p.state.verticalSpeed;
  advance(p,.25,{});assert.ok(Math.abs(p.state.verticalSpeed-(vy-9.81*.25))<1e-8);p.step(1/120,{jump:true});assert.ok(p.state.verticalSpeed<vy-2,'airborne jump cannot inject another impulse');
  advance(p,3,{});assert.equal(p.state.grounded,true);assert.equal(p.state.y,.14);advance(p,8,{autoSwing:true});assert.equal(p.state.swingCount,0);assert.equal(p.state.y,.14);assert.ok(p.state.grounded);
});

test('anchors lie on source building edges and ray visibility rejects a wall between hand and target',()=>{
  const state={x:0,y:.14,z:0,yaw:0,mode:'spider'},b=polygon(-10,-32,10,-30,20),blocker=polygon(-20,-15,20,-14,30),groundAt=()=>({height:.14,allowed:true,progress:0});
  const clear=createWebSwingMotion({state:{...state},world:{buildings:[b]},groundAt});const anchor=clear.findAnchor(null);assert.ok(anchor);assert.ok(anchor.z===-30||anchor.z===-32||Math.abs(anchor.x)===10);assert.equal(anchor.y,20);
  const blocked=createWebSwingMotion({state:{...state},world:{buildings:[b,blocker]},groundAt});assert.equal(blocked.lineClear({x:0,y:1.79,z:0},{x:0,y:20,z:-30}),false);assert.equal(blocked.lineClear({x:0,y:40,z:0},{x:0,y:40,z:-30}),true);
  const courtyard=polygon(-20,-40,20,5,20);courtyard.rings.push(polygon(-10,-30,10,3).rings[0]);const hole=createWebSwingMotion({state:{...state},world:{buildings:[courtyard]},groundAt});assert.equal(hole.lineClear({x:0,y:2,z:0},{x:0,y:20,z:-30}),true,'visible courtyard facade is a legitimate edge');
});

test('attached web enforces its maximum length; release retains tangential momentum',()=>{
  const p=make(corridor);advance(p,.1,{jump:true,swing:true,forward:1});assert.ok(p.state.anchor);const initialLength=p.state.ropeLength;
  for(let i=0;i<150;i++){p.step(1/120,{swing:true,forward:1,reel:true});if(p.state.anchor)assert.ok(Math.hypot(p.state.x-p.state.anchor.x,p.state.y+1.65-p.state.anchor.y,p.state.z-p.state.anchor.z)<=p.state.ropeLength+.121);}
  assert.ok(p.state.anchor&&p.state.ropeLength<initialLength-5);const vx=p.state.vx,vz=p.state.vz,vy=p.state.verticalSpeed;p.step(1/120,{});assert.equal(p.state.anchor,null);assert.ok(Math.abs(p.state.vx-vx)<.1&&Math.abs(p.state.vz-vz)<.1);assert.ok(Math.abs(p.state.verticalSpeed-vy+9.81/120)<.05);
});

test('space launches once from an attached web; holding space cannot create successive boosts',()=>{
  const p=make(corridor);advance(p,.2,{jump:true,swing:true,forward:1});advance(p,.2,{swing:true,forward:1});const count=p.state.swingCount;
  p.step(1/120,{jump:true,swing:true});assert.equal(p.state.anchor,null);const vy=p.state.verticalSpeed;advance(p,.15,{jump:true});assert.equal(p.state.swingCount,count);assert.ok(p.state.verticalSpeed<vy-1.4);
});

test('swing physics preserves fixed-step cadence and suspend clears momentum without relocating',()=>{
  const a=make(corridor),b=make(corridor);advance(a,4,{autoSwing:true},1/60);advance(b,4,{autoSwing:true},1/24);
  for(const key of['x','y','z','yaw','vx','vz','verticalSpeed','distance','ropeLength','swingCount'])assert.ok(Math.abs(a.state[key]-b.state[key])<1e-8,key);
  const before={...a.state};a.suspend();for(const key of['x','y','z','grounded'])assert.equal(a.state[key],before[key]);assert.equal(a.state.anchor,null);assert.equal(a.state.vx,0);assert.equal(a.state.vz,0);assert.equal(a.state.verticalSpeed,0);
});

test('spider walls, overhang undersides and campus bounds stay solid during fast movement',()=>{
  const p=make({buildings:[polygon(-5,-12,5,-8,30)],bounds:{minX:-8,maxX:8,minZ:-100,maxZ:10}});advance(p,4,{forward:1,fast:true});assert.ok(p.state.z>=-8+.34-.001);assert.equal(p.state.speed,0);
  p.state.y=4;p.state.grounded=false;p.state.vx=25;p.state.vz=0;advance(p,1,{});assert.ok(p.state.x<=8-.34+1e-8);
  const canopy=make({buildings:[polygon(-5,-5,5,5,8,3)]});advance(canopy,.3,{jump:true});assert.ok(canopy.state.y+2.08<=3+.001,'head cannot pass through underside');assert.ok(canopy.state.y<2);
});

test('spider may land on a roof but cannot switch modes by snapping from roof or air to ground',()=>{
  const p=make({buildings:[polygon(-5,-30,5,-10,10)]});Object.assign(p.state,{x:0,y:14,z:-20,grounded:false,vx:0,vz:0,verticalSpeed:-1});assert.equal(p.setMode('walk').ok,false);
  advance(p,2,{});assert.equal(p.state.grounded,true);assert.ok(Math.abs(p.state.y-10.016)<1e-8);assert.equal(p.state.roofIndex,0);for(const mode of['walk','scooter','roadster','hoverboard','helicopter']){assert.equal(p.setMode(mode).ok,false);assert.equal(p.state.y,10.016);}
  p.reset(0,'walk');assert.equal(p.state.mode,'walk');assert.equal(p.state.y,.14);
});

test('water fall returns to the last safe foot placement and a descending player does not enter an NPC',()=>{
  const p=make({water:[polygon(-10,-30,10,-5)]});advance(p,1.1,{forward:1});const safe={x:p.state.x,z:p.state.z};Object.assign(p.state,{x:0,y:4,z:-10,vx:0,vz:0,verticalSpeed:-4,grounded:false});advance(p,2,{});assert.equal(p.state.grounded,true);assert.ok(p.state.z>-5);assert.ok(p.groundAt(p.state.x,p.state.z).allowed);
  const actor={type:'scooter',x:0,y:.14,z:-5,yaw:0,active:true};const crowd=createPlayerMotion({route:flat,traffic:()=>[actor]});crowd.reset(0,'spider');Object.assign(crowd.state,{x:0,y:4,z:-5,vx:0,vz:0,verticalSpeed:-3,grounded:false});advance(crowd,2,{});assert.ok(Math.hypot(crowd.state.x-actor.x,crowd.state.z-actor.z)>.8,'landing must choose free ground or recover to its safe checkpoint');assert.equal(crowd.state.grounded,true);
});

test('the actual dorm-side campus start chains real anchors and advances for at least fifteen seconds',()=>{
  const {route,world,simulation}=campus(),p=createPlayerMotion({route,world,traffic:()=>simulation.agents,getPoseAt:simulation.getPoseAt});p.reset(0,'spider');const initial={...p.state},anchors=[],sample=[];let maxY=0,airFrames=0;
  for(let i=0;i<18*60;i++){simulation.setPlayerObstacle(p.state);simulation.step(1/60);p.step(1/60,{autoSwing:true});if(p.state.anchor&&!anchors.some(a=>a.buildingIndex===p.state.anchor.buildingIndex&&Math.hypot(a.x-p.state.anchor.x,a.z-p.state.anchor.z)<1))anchors.push({...p.state.anchor});if(!p.state.grounded)airFrames++;maxY=Math.max(maxY,p.state.y);if(i%60===59)sample.push({t:(i+1)/60,x:p.state.x,y:p.state.y,z:p.state.z,count:p.state.swingCount,progress:p.state.progress,blocked:p.state.blockedReason});}
  if(process.env.SWING_TRACE)console.log(JSON.stringify({sample,airFrames,maxY,distance:p.state.distance,anchors:anchors.length}));
  assert.ok(p.state.swingCount>=3,JSON.stringify(sample));assert.ok(anchors.length>=3);assert.ok(p.state.distance>70,JSON.stringify(sample));assert.ok(p.state.progress>50,JSON.stringify(sample));assert.ok(maxY>4);assert.ok(airFrames>18*60*.65,JSON.stringify(sample));
  for(const anchor of anchors){const b=world.buildings[anchor.buildingIndex];assert.ok(b);assert.ok(anchor.y<=b.height+.001);assert.ok(anchor.y>initial.y+3);}
});


test('holding E launches from a valid anchor once; a raised bridge edge requires an actual jump',()=>{
  const p=make(corridor);advance(p,.2,{swing:true});assert.ok(p.state.anchor&&!p.state.grounded);assert.ok(p.state.y>.5);
  const empty=make();advance(empty,3,{swing:true});assert.equal(empty.state.y,.14);assert.equal(empty.state.swingCount,0);
  const route={length:100,points:[{x:0,z:0,y:.16,progress:0},{x:0,z:-20,y:.16,progress:20},{x:0,z:-40,y:3.16,progress:40},{x:0,z:-60,y:3.16,progress:60},{x:0,z:-80,y:.16,progress:80},{x:0,z:-100,y:.16,progress:100}],segments:[{startProgress:0,endProgress:100,width:6}]};
  const bridge=createPlayerMotion({route});bridge.reset(50,'spider');bridge.state.yaw=Math.PI/2;advance(bridge,2,{forward:1});assert.ok(Math.abs(bridge.state.x)<3);assert.equal(bridge.state.y,3.14);assert.equal(bridge.state.grounded,true);
  advance(bridge,.8,{forward:1,jump:true});assert.ok(bridge.state.y>3.5);assert.ok(Math.abs(bridge.state.x)>3,'an explicit jump may leave the bridge, under gravity');
});


test('held-web travel can jump a close shoulder-side pedestrian without tunnelling through them',()=>{
  const actor={type:'walk',x:.69,y:.14,z:-.35,yaw:0,active:true},p=createPlayerMotion({route:flat,traffic:()=>[actor]});p.reset(0,'spider');let maxY=.14,maxStep=0;
  for(let i=0;i<180;i++){
    const before={x:p.state.x,y:p.state.y,z:p.state.z};p.step(1/60,{swing:true,moveX:0,moveZ:-1});maxY=Math.max(maxY,p.state.y);maxStep=Math.max(maxStep,Math.hypot(p.state.x-before.x,p.state.z-before.z));
    for(let k=0;k<=8;k++){const t=k/8,y=before.y+(p.state.y-before.y)*t,x=before.x+(p.state.x-before.x)*t,z=before.z+(p.state.z-before.z)*t;if(y<actor.y+1.9)assert.ok(Math.hypot(x-actor.x,z-actor.z)>=.37+.27+.08-.001,'body remains outside the pedestrian until fully above them');}
  }
  assert.ok(maxY>2.5);assert.ok(p.state.distance>15,'near-field person cannot indefinitely stall held-web traversal');assert.ok(maxStep<.45);
});

test('crossing a roof edge within collision substeps preserves height and starts a fall',()=>{
  const p=make({buildings:[polygon(-5,-30,5,-10,10)]});Object.assign(p.state,{x:4.85,y:10.016,z:-20,grounded:false,vx:27,vz:0,verticalSpeed:-.05});
  p.step(1/120,{});assert.ok(p.state.x>4.8);assert.ok(p.state.y>9.9,'leaving a roof must not snap down to ground');assert.equal(p.state.grounded,false);
  advance(p,.5,{});assert.ok(p.state.y>5&&p.state.y<10);assert.equal(p.state.grounded,false);
});


test('NPC landing avoidance sweeps the whole escape path and cannot cross a thin wall',()=>{
  const wall=polygon(.5,-6,.7,-4,10),actor={type:'scooter',x:0,y:.14,z:-5,yaw:0,active:true};
  const p=createPlayerMotion({route:flat,world:{buildings:[wall]},traffic:()=>[actor]});p.reset(0,'spider');Object.assign(p.state,{x:0,y:4,z:-5,vx:0,vz:0,verticalSpeed:-3,grounded:false});
  for(let i=0;i<180;i++){const before={x:p.state.x,z:p.state.z};p.step(1/60,{});for(let n=0;n<=4;n++){const x=before.x+(p.state.x-before.x)*n/4,z=before.z+(p.state.z-before.z)*n/4;assert.ok(Math.hypot(x-Math.max(.5,Math.min(.7,x)),z-Math.max(-6,Math.min(-4,z)))>=.37-1e-6,'the entire small escape step must remain outside the wall');}}
  assert.equal(p.state.grounded,true);assert.ok(Math.hypot(p.state.x-actor.x,p.state.z-actor.z)>.8,'a remaining safe direction or checkpoint clears the actor');
});


test('world-direction air control turns gradually, preserves coasting and buffers sub-step jump taps',()=>{
  const p=make();p.step(.001,{jump:true});p.step(.02,{});assert.ok(p.state.y>.14&&p.state.verticalSpeed>9.7,'a tap shorter than the fixed step remains buffered');
  Object.assign(p.state,{x:0,y:30,z:0,grounded:false,vx:12,vz:0,verticalSpeed:0});p.step(1/60,{moveX:-1,moveZ:0});assert.ok(p.state.vx>11,'opposite intent decelerates instead of snapping velocity');
  advance(p,1.4,{moveX:-1,moveZ:0});assert.ok(p.state.vx<2,'opposite input brakes within a useful response window');
  Object.assign(p.state,{y:30,vx:10,vz:-3,verticalSpeed:0,grounded:false});const speed=Math.hypot(p.state.vx,p.state.vz);advance(p,.5,{moveX:0,moveZ:0});assert.ok(Math.hypot(p.state.vx,p.state.vz)>speed*.98,'no-input freeflight keeps inertia');
});

test('holding the web key chains low buildings without repeated taps and releasing never reconnects',()=>{
  const buildings=[];for(let z=-150;z<-5;z+=25)buildings.push(polygon(-20,z,-10,z+20,18),polygon(10,z,20,z+20,18));const p=make({buildings});let airborne=0,maxAttachDelta=0;
  for(let i=0;i<8*120;i++){const before={...p.state};p.step(1/120,{swing:true,moveX:0,moveZ:-1});if(!p.state.grounded)airborne++;if(before.anchor===null&&p.state.anchor&&!before.grounded)maxAttachDelta=Math.max(maxAttachDelta,Math.hypot(p.state.vx-before.vx,p.state.vz-before.vz,p.state.verticalSpeed-before.verticalSpeed));}
  assert.ok(p.state.swingCount>=3);assert.ok(p.state.distance>75);assert.ok(airborne>8*120*.8);assert.ok(maxAttachDelta<1.5,`attach impulse ${maxAttachDelta}`);
  const count=p.state.swingCount;advance(p,1,{swing:false,moveX:0,moveZ:0});assert.equal(p.state.anchor,null);assert.equal(p.state.swingCount,count);
});

test('actual campus sixty-second held-web traversal accepts deliberate camera-relative route turns',()=>{
  const {route,world,simulation}=campus(),p=createPlayerMotion({route,world,traffic:()=>simulation.agents,getPoseAt:simulation.getPoseAt});p.reset(0,'spider');let maximumStall=0,stall=0,previous=p.state.distance,air=0,turnSamples=0;const samples=[];
  for(let i=0;i<60*60;i++){
    const ahead=simulation.getPoseAt(Math.min(route.length,p.state.progress+16),1,'scooter'),dx=ahead.x-p.state.x,dz=ahead.z-p.state.z,length=Math.hypot(dx,dz)||1;
    simulation.setPlayerObstacle(p.state);simulation.step(1/60);p.step(1/60,{swing:true,moveX:dx/length,moveZ:dz/length});if(!p.state.grounded)air++;
    if(p.state.distance-previous<.012)stall+=1/60;else stall=0;maximumStall=Math.max(maximumStall,stall);previous=p.state.distance;
    if(i%180===179)samples.push({t:(i+1)/60,progress:Math.round(p.state.progress),speed:+p.state.speed.toFixed(1),y:+p.state.y.toFixed(1),count:p.state.swingCount,phase:p.state.traversalPhase,blocked:p.state.blockedReason,x:Math.round(p.state.x),z:Math.round(p.state.z),candidate:!!p.state.candidateAnchor});
  }
  if(process.env.SWING_TRACE)console.log(JSON.stringify({longManual:samples,maximumStall,air,distance:p.state.distance}));
  assert.ok(p.state.progress>500,JSON.stringify(samples));assert.ok(p.state.distance>550);assert.ok(maximumStall<2.5,JSON.stringify(samples));assert.ok(p.state.swingCount>15);assert.ok(air>60*60*.6);
});


test('a ninety-degree held-web direction change responds within one second and remains continuous for ten seconds',()=>{
  const p=make({buildings:[polygon(-55,-200,-48,-5,22),polygon(48,-200,55,-5,22)]});advance(p,2,{swing:true,moveX:0,moveZ:-1});const before={...p.state};
  p.step(1/60,{swing:true,moveX:1,moveZ:0});assert.ok(Math.hypot(p.state.vx-before.vx,p.state.vz-before.vz)<1,'turn intent applies acceleration, not a velocity reset');
  advance(p,1,{swing:true,moveX:1,moveZ:0});assert.ok(p.state.vx>8&&Math.abs(p.state.vz)<10,JSON.stringify({vx:p.state.vx,vz:p.state.vz}));
  for(let i=0;i<7*60;i++){const old={...p.state};p.step(1/60,{swing:true,moveX:i<180?1:0,moveZ:i<180?0:-1});assert.ok(Math.hypot(p.state.x-old.x,p.state.z-old.z)<.65,'steering and changing anchors never relocate the body');assert.ok(Number.isFinite(p.state.y));}
});

test('holding web traversal continues across a same-height roof instead of stopping for a higher anchor',()=>{
  const p=make({buildings:[polygon(-20,-80,20,-10,12)]});Object.assign(p.state,{x:0,y:12.016,z:-20,grounded:true,roofIndex:0,vx:0,vz:0,verticalSpeed:0});
  let sawHop=false;for(let i=0;i<6*60;i++){p.step(1/60,{swing:true,moveX:0,moveZ:-1});if(!p.state.grounded)sawHop=true;if(p.state.z>-80&&p.state.z<-10&&Math.abs(p.state.x)<20)assert.ok(p.state.y>=12-.02,'roof parkour retains collision support');}
  assert.ok(sawHop);assert.ok(p.state.z<-80,`roof position ${p.state.z}`);assert.ok(p.state.distance>60);
});

test('web zip uses visible paired building anchors, accepts a short tap and applies one bounded pull',()=>{
  const p=make(corridor);Object.assign(p.state,{x:0,y:12,z:0,grounded:false,vx:0,vz:-10,speed:10});p.step(1/60,{});
  assert.equal(p.state.zipReady,true);assert.equal(p.state.zipCandidateAnchors.length,2);
  p.step(.001,{zip:true});p.step(.02,{});assert.equal(p.state.zipCount,1);assert.equal(p.state.zipActive,true);assert.equal(p.state.anchor,null);
  for(const anchor of p.state.zipAnchors){const building=corridor.buildings[anchor.buildingIndex];assert.ok(building);assert.equal(anchor.y,building.height);assert.ok(Math.abs(anchor.x)===10);}
  const start={...p.state};advance(p,.3,{zip:true});assert.ok(p.state.speed>start.speed+4);assert.ok(p.state.speed<=32);assert.equal(p.state.zipActive,false);assert.equal(p.state.zipAnchors.length,0);
  advance(p,1.2,{zip:true});assert.equal(p.state.zipCount,1,'holding F past cooldown cannot retrigger');
  assert.ok(p.state.y<start.y,'a zip must not turn into hovering or repeated upward acceleration');
  const cool=make(corridor);Object.assign(cool.state,{y:20,grounded:false,vz:-10,speed:10});advance(cool,.3,{zip:true});advance(cool,.02,{});advance(cool,.05,{zip:true});assert.equal(cool.state.zipCount,1,'a fresh key edge during cooldown is rejected');advance(cool,1.05,{});assert.equal(cool.state.zipReady,true);advance(cool,.02,{zip:true});assert.equal(cool.state.zipCount,2,'a fresh airborne request after cooldown may pull again');
});

test('zip rejects missing geometry, occluded/thin-wall paths and low commuter clearance, but supports a single facade',()=>{
  const empty=make();Object.assign(empty.state,{y:10,grounded:false,vz:-8,speed:8});advance(empty,.25,{zip:true});assert.equal(empty.state.zipCount,0);assert.equal(empty.state.zipReady,false);assert.equal(empty.state.zipCandidateAnchors.length,0);
  const single=make({buildings:[polygon(10,-100,20,-5,22)]});Object.assign(single.state,{y:10,grounded:false,vz:-10,speed:10});advance(single,.15,{zip:true});assert.equal(single.state.zipCount,1);assert.equal(single.state.zipAnchors.length,1);
  const wall=make({buildings:[...corridor.buildings,polygon(-7,-3.2,7,-3,35)]});Object.assign(wall.state,{x:0,y:8,z:0,grounded:false,vz:-12,speed:12});advance(wall,.4,{zip:true});assert.equal(wall.state.zipCount,0);assert.ok(wall.state.z>=-3+.37-.001,'the complete high-speed body stays before the thin wall');
  const actor={type:'scooter',x:0,y:.14,z:-2,yaw:0,active:true};const crowded=createPlayerMotion({route:flat,world:corridor,traffic:()=>[actor]});crowded.reset(0,'spider');Object.assign(crowded.state,{x:0,y:1.4,z:0,grounded:false,vz:-10,speed:10,verticalSpeed:0});advance(crowded,.12,{zip:true});assert.equal(crowded.state.zipCount,0,'the zip preview includes nearby people, not only walls');
});

test('dive explicitly releases a web, builds downward momentum and never auto-pulls up on release',()=>{
  const p=make(corridor);advance(p,.5,{swing:true,moveX:0,moveZ:-1});assert.ok(p.state.anchor);
  Object.assign(p.state,{y:25,verticalSpeed:0});p.step(1/120,{swing:true,dive:true});assert.equal(p.state.anchor,null);assert.equal(p.state.diving,true);assert.equal(p.state.traversalPhase,'dive');
  advance(p,.5,{swing:true,dive:true});assert.ok(p.state.verticalSpeed< -13.9);assert.equal(p.state.anchor,null);assert.equal(p.state.zipReady,false);
  const vy=p.state.verticalSpeed,y=p.state.y;p.step(1/120,{dive:false});assert.ok(Math.abs(p.state.verticalSpeed-(vy-9.81/120))<1e-8);assert.ok(p.state.y<y);assert.equal(p.state.diving,false);
  const ground=make();advance(ground,2,{dive:true,zip:true});assert.equal(ground.state.y,.14);assert.equal(ground.state.diving,false);assert.equal(ground.state.zipCount,0);
});

test('zip and dive are render-cadence independent and suspend/reset/mode changes clear their transient state',()=>{
  const a=make(corridor),b=make(corridor);for(const p of[a,b])Object.assign(p.state,{y:20,grounded:false,vz:-10,speed:10});
  for(const [duration,input] of[[.3,{zip:true}],[.5,{dive:true}],[.2,{}]]){advance(a,duration,input,1/60);advance(b,duration,input,1/30);}
  for(const key of['x','y','z','vx','vz','verticalSpeed','zipCount','zipCooldown','diveBlend'])assert.ok(Math.abs(a.state[key]-b.state[key])<1e-8,key);
  const before={...a.state};a.suspend();assert.equal(a.state.zipActive,false);assert.equal(a.state.zipAnchors.length,0);assert.equal(a.state.zipReady,false);assert.equal(a.state.diving,false);assert.equal(a.state.diveBlend,0);assert.equal(a.state.x,before.x);assert.equal(a.state.y,before.y);
  a.reset(0,'spider');assert.equal(a.state.zipCount,0);assert.equal(a.state.zipCooldown,0);assert.equal(a.state.zipCandidateAnchors.length,0);
  a.step(.001,{zip:true});assert.equal(a.setMode('walk').ok,true);a.step(.02,{});assert.equal(a.state.zipCount,0);assert.equal(a.state.zipActive,false);assert.equal(a.state.diving,false);
});

test('actual campus zip/dive combination remains continuous for sixty seconds with seeded morning traffic',()=>{
  const {route,world,simulation}=campus(),p=createPlayerMotion({route,world,traffic:()=>simulation.agents,getPoseAt:simulation.getPoseAt});p.reset(0,'spider');assert.ok(simulation.agents.length>=300,'exercise dense seeded traffic on the current 27-building route');assert.ok(simulation.agents.some(a=>a.direction===-1),'include opposing commuters');
  let maximumStall=0,stall=0,divingFrames=0,maxStep=0,diveRemaining=0,nextDiveAfter=150,nextZipAfter=60;
  for(let i=0;i<3600;i++){
    const s=p.state,ahead=simulation.getPoseAt(Math.min(route.length,s.progress+16),1,'scooter'),dx=ahead.x-s.x,dz=ahead.z-s.z,length=Math.hypot(dx,dz)||1;
    // Trigger a short dive at an actual high, attached swing instead of a
    // fixed clock phase that depended on the former route's raised fake bridge.
    const clearance=s.y-p.groundAt(s.x,s.z).height;
    if(i>=nextDiveAfter&&s.anchor&&!s.zipActive&&clearance>4.5){diveRemaining=12;nextDiveAfter=i+300;}
    const dive=diveRemaining>0&&!s.grounded&&clearance>2.5,zip=i>=nextZipAfter&&s.zipReady&&!dive;
    if(zip)nextZipAfter=i+180;
    diveRemaining=Math.max(0,diveRemaining-1);
    const before={x:s.x,z:s.z,distance:s.distance};simulation.setPlayerObstacle(s);simulation.step(1/60);p.step(1/60,{swing:true,moveX:dx/length,moveZ:dz/length,zip,dive});
    if(s.diving)divingFrames++;stall=s.distance-before.distance<.012?stall+1/60:0;maximumStall=Math.max(maximumStall,stall);maxStep=Math.max(maxStep,Math.hypot(s.x-before.x,s.z-before.z));
  }
  const result={distance:p.state.distance,progress:p.state.progress,zipCount:p.state.zipCount,divingFrames,maximumStall,maxStep};if(process.env.SWING_TRACE)console.log(JSON.stringify({combination:result}));
  assert.ok(p.state.distance>550,JSON.stringify(result));assert.ok(p.state.progress>500);assert.ok(p.state.zipCount>=5);assert.ok(divingFrames>=30);assert.ok(maximumStall<2.5);assert.ok(maxStep<.85,'zip/dive may accelerate but cannot teleport through traffic or buildings');
});

function reachPerch(p,{bufferLaunch=false,dt=1/60}={}){
  let requested=false,maxStep=0;
  for(let i=0;i<Math.ceil(8/dt);i++){
    const before={x:p.state.x,y:p.state.y,z:p.state.z};
    const jump=bufferLaunch&&!requested&&p.state.pointPhase==='approach'&&p.state.pointLaunchReady;
    if(jump)requested=true;
    p.step(dt,{jump,moveX:0,moveZ:-1});
    maxStep=Math.max(maxStep,Math.hypot(p.state.x-before.x,p.state.y-before.y,p.state.z-before.z));
    if(p.state.pointPhase==='perch'||p.state.pointLaunchCount)return{requested,maxStep};
  }
  assert.fail(`No roof arrival: ${JSON.stringify({phase:p.state.pointPhase,reason:p.state.blockedReason})}`);
}

test('point traversal reaches a real roof continuously and an early buffered jump launches once into another swing',()=>{
  const p=make(corridor),target={...p.state.candidatePoint,perch:{...p.state.candidatePoint.perch}};
  p.step(.001,{point:true});p.step(.02,{});assert.equal(p.state.pointCount,1,'a tap shorter than one physics step survives');
  const result=reachPerch(p,{bufferLaunch:true});
  assert.equal(result.requested,true);assert.equal(p.state.pointLaunchCount,1);assert.equal(p.state.pointPhase,'launch');assert.equal(p.state.pointLaunchQuality,1);
  assert.ok(result.maxStep<.5,'the approach and launch cannot relocate the player');
  assert.ok(Math.hypot(p.state.x-target.perch.x,p.state.z-target.perch.z)<.5);assert.ok(p.state.y>=target.y);
  assert.ok(p.state.verticalSpeed>11&&p.state.speed>27);
  advance(p,.25,{jump:true});assert.equal(p.state.pointLaunchCount,1,'holding jump cannot repeatedly add a point impulse');
  advance(p,1.4,{swing:true,moveX:0,moveZ:-1});assert.ok(p.state.swingCount>=1,'the point launch returns to normal anchor traversal');assert.ok(p.state.distance>40);
});

test('the roof timing window rewards an early launch but a late jump still leaves the perch, and held G cannot repeat',()=>{
  const fast=make(corridor),late=make(corridor);
  for(const p of[fast,late]){p.step(1/60,{point:true});reachPerch(p);assert.equal(p.state.grounded,true);assert.equal(p.state.roofIndex,0);assert.ok(Math.abs(p.state.y-22.016)<1e-8);}
  fast.step(1/120,{jump:true});advance(late,.45,{point:true});assert.equal(late.state.pointPhase,'perch');assert.equal(late.state.pointCount,1);assert.equal(late.state.pointLaunchReady,false);
  late.step(1/120,{jump:true});assert.equal(late.state.pointLaunchCount,1);assert.equal(late.state.pointLaunchQuality,0);assert.ok(fast.state.speed>late.state.speed+7);assert.ok(fast.state.verticalSpeed>late.state.verticalSpeed+3);
  const held=make(corridor);advance(held,4,{point:true});assert.equal(held.state.pointCount,1);assert.equal(held.state.pointPhase,'perch');
});

test('point selection rejects absent or occluded roofs, a thin overhead body obstruction, and occupied paths',()=>{
  const target=polygon(-5,-30,5,-20,22);
  for(const world of[{}, {buildings:[target,polygon(-60,-15.1,60,-15,60)]}, {buildings:[target,polygon(-60,-10.1,60,-9.9,60,13)]}]){
    const p=make(world);advance(p,.3,{point:true});assert.equal(p.state.pointCount,0);assert.equal(p.state.pointReady,false);assert.equal(p.state.pointPhase,'idle');assert.equal(p.state.grounded,true);
  }
  // The hand ray passes below this canopy, while the upper body would hit it.
  const state={x:0,y:.14,z:0,yaw:0,mode:'spider'},world={buildings:[target,polygon(-60,-10.1,60,-9.9,60,13)]};
  const raw=createWebSwingMotion({state,world,groundAt:()=>({height:.14,allowed:true})});assert.equal(raw.lineClear({x:0,y:1.79,z:0},{x:0,y:22,z:-20}),true);assert.equal(raw.findPoint(),null);
  const actors=[],crowded=createPlayerMotion({route:flat,world:{buildings:[target]},traffic:()=>actors});crowded.reset(0,'spider');actors.push({type:'scooter',x:0,z:-.6,y:.14,yaw:0,active:true});advance(crowded,.3,{point:true});assert.equal(crowded.state.pointCount,0,'people in the rising pull path also prevent the action');
  assert.match(crowded.state.blockedReason,/安全屋沿/);assert.equal(crowded.state.pointReady,false);advance(crowded,.3,{});assert.match(crowded.state.blockedReason,/安全屋沿/,'rejection feedback survives more than one render frame');
  actors.length=0;crowded.step(1/60,{point:true});assert.equal(crowded.state.pointCount,1,'a deliberate retry clears stale failure feedback immediately');assert.equal(crowded.state.blockedReason,'');
});

test('a dynamic roof occupant interrupts a point pull before body overlap, and new traversal actions may cancel the pull',()=>{
  const actors=[],p=createPlayerMotion({route:flat,world:corridor,traffic:()=>actors});p.reset(0,'spider');p.step(1/60,{point:true});
  const perch=p.state.pointTarget.perch;actors.push({type:'walk',x:perch.x,z:perch.z,y:perch.y,yaw:0,active:true});
  let blocked=false;
  for(let i=0;i<240;i++){p.step(1/60,{});if(p.state.pointPhase==='idle'){blocked=true;break;}}
  assert.equal(blocked,true);assert.equal(p.state.pointPhase,'idle');assert.equal(p.state.pointLaunchCount,0);assert.ok(Math.hypot(p.state.x-perch.x,p.state.z-perch.z)>.7);
  for(const input of[{swing:true},{dive:true},{zip:true}]){const q=make(corridor);q.step(1/60,{point:true});advance(q,.5,{});const before={...q.state};q.step(1/60,input);assert.equal(q.state.pointPhase,'idle');assert.ok(Math.hypot(q.state.x-before.x,q.state.y-before.y,q.state.z-before.z)<.55,'cancellation preserves a continuous body path');assert.ok(Number.isFinite(q.state.verticalSpeed));}
});

test('point aiming follows camera heading independently of body yaw and does not retarget an active pull',()=>{
  const left=make(corridor),right=make(corridor);left.step(1/60,{point:true,aimYaw:Math.PI/2});right.step(1/60,{point:true,aimYaw:-Math.PI/2});
  assert.ok(left.state.pointTarget.x<0);assert.ok(right.state.pointTarget.x>0);assert.equal(left.state.yaw,0);assert.equal(right.state.yaw,0);
  const target={...left.state.pointTarget};advance(left,.3,{aimYaw:-Math.PI/2});assert.equal(left.state.pointTarget.x,target.x);assert.equal(left.state.pointTarget.z,target.z);
});

test('clearing action inputs removes pending point and jump taps; suspend, reset and mode changes clear action state',()=>{
  const p=make(corridor);p.step(.001,{point:true,jump:true});p.clearActionInputs();p.step(.02,{});assert.equal(p.state.pointCount,0);assert.equal(p.state.grounded,true);
  p.step(.02,{point:true});advance(p,.3,{});const before={...p.state};p.suspend();for(const key of['x','y','z'])assert.equal(p.state[key],before[key]);assert.equal(p.state.pointPhase,'idle');assert.equal(p.state.pointTarget,null);assert.equal(p.state.pointReady,false);assert.equal(p.state.trickBlend,0);assert.equal(p.state.speed,0);
  p.reset(0,'spider');p.step(.001,{point:true});assert.equal(p.setMode('walk').ok,true);p.step(.02,{});assert.equal(p.state.pointCount,0);assert.equal(p.state.pointPhase,'idle');assert.equal(p.state.trickCount,0);
  const trick=make();Object.assign(trick.state,{y:20,grounded:false,vz:-10});advance(trick,.2,{trick:true});assert.equal(trick.state.trickActive,true);trick.clearActionInputs();assert.equal(trick.state.trickActive,false);advance(trick,.2,{});assert.equal(trick.state.trickBlend,0);assert.equal(trick.state.trickCount,0);
});

test('point approach, timed launch and tricks preserve fixed-step results across render cadences',()=>{
  const a=make(corridor),b=make(corridor),sequence=[[1.9,{point:true}],[.05,{jump:true,moveX:0,moveZ:-1}],[1.5,{trick:true,trickX:1,moveX:0,moveZ:-1}],[.2,{}],[1,{swing:true,moveX:0,moveZ:-1}]];
  for(const [duration,input]of sequence){advance(a,duration,input,1/30);advance(b,duration,input,1/120);}
  for(const key of['x','y','z','yaw','vx','vz','verticalSpeed','distance','pointCount','pointLaunchCount','trickCount','trickBlend','swingCount'])assert.ok(Math.abs(a.state[key]-b.state[key])<1e-8,key);
  assert.equal(a.state.pointLaunchCount,1);assert.equal(a.state.trickCount,1);assert.ok(a.state.swingCount>0);
});

test('four aerial trick directions share unchanged ballistic physics and recover cleanly when released',()=>{
  for(const [input,type]of[[{trickY:1},'frontflip'],[{trickY:-1},'backflip'],[{trickX:1},'rightroll'],[{trickX:-1},'leftroll']]){
    const plain=make(),styled=make();for(const p of[plain,styled])Object.assign(p.state,{y:30,grounded:false,vx:4,vz:-12,verticalSpeed:5});
    advance(plain,.8,{});advance(styled,.8,{trick:true,...input});assert.equal(styled.state.trickType,type);assert.equal(styled.state.trickCount,1);assert.equal(styled.state.trickCombo,1);assert.equal(styled.state.trickActive,true);
    for(const key of['x','y','z','vx','vz','verticalSpeed','distance'])assert.equal(styled.state[key],plain.state[key],`${type} ${key}: acrobatics must not create propulsion`);
    advance(styled,.2,{});assert.equal(styled.state.trickActive,false);assert.equal(styled.state.trickBlend,0);assert.deepEqual(styled.state.trickRotation,{x:0,y:0,z:0});
  }
});

test('aerial tricks require clearance and yield immediately to web, zip, point or dive input',()=>{
  const low=make();Object.assign(low.state,{y:2,grounded:false,verticalSpeed:-2});advance(low,.1,{trick:true});assert.equal(low.state.trickActive,false);assert.equal(low.state.trickCount,0);
  const wall=make(corridor);Object.assign(wall.state,{x:-9.2,y:10,z:-20,grounded:false});advance(wall,.1,{trick:true});assert.equal(wall.state.trickActive,false,'rotating limbs require more clearance than the upright collision body');
  for(const input of[{swing:true},{zip:true},{point:true},{dive:true}]){const p=make(corridor);Object.assign(p.state,{y:10,grounded:false,vz:-8});advance(p,.15,{trick:true});assert.equal(p.state.trickActive,true);p.step(1/120,{trick:true,...input});assert.equal(p.state.trickActive,false);assert.equal(p.state.trickCount,0);}
});

test('actual dorm start supports point launch, a completed aerial trick and uninterrupted return to held-web traversal',()=>{
  const {route,world,simulation}=campus(),p=createPlayerMotion({route,world,traffic:()=>simulation.agents,getPoseAt:simulation.getPoseAt});p.reset(0,'spider');
  let jumpSent=false,trickSeen=false,largestStep=0;
  for(let i=0;i<12*60;i++){
    const s=p.state,ahead=simulation.getPoseAt(Math.min(route.length,s.progress+16),1,'scooter'),dx=ahead.x-s.x,dz=ahead.z-s.z,length=Math.hypot(dx,dz)||1;
    const jump=!jumpSent&&s.pointLaunchReady;if(jump)jumpSent=true;
    const trick=s.pointLaunchCount>0&&s.trickCount===0&&i<360,swing=s.trickCount>0||i>=360;
    const before={x:s.x,y:s.y,z:s.z};simulation.setPlayerObstacle(s);simulation.step(1/60);p.step(1/60,{point:i===0,jump,trick,trickY:-1,swing,moveX:dx/length,moveZ:dz/length});
    trickSeen||=s.trickActive;largestStep=Math.max(largestStep,Math.hypot(s.x-before.x,s.y-before.y,s.z-before.z));
  }
  assert.equal(jumpSent,true);assert.equal(p.state.pointLaunchCount,1);assert.equal(trickSeen,true);assert.ok(p.state.trickCount>=1);assert.ok(p.state.swingCount>=3);assert.ok(p.state.distance>100);assert.ok(largestStep<.7);
});

test('held-web low-rise traversal keeps road clearance and only automatically releases on a safe upswing',()=>{
  const buildings=[];for(let z=-500;z<-5;z+=25)buildings.push(polygon(-20,z,-10,z+20,18),polygon(10,z,20,z+20,18));
  const p=make({buildings});let lowAir=0,landings=0,automaticReleases=0,maxStep=0;
  for(let i=0;i<12*120;i++){
    const before={...p.state};p.step(1/120,{swing:true,moveX:0,moveZ:-1});const s=p.state;
    if(i>120&&!s.grounded&&s.y-.14<3)lowAir++;
    if(!before.grounded&&s.grounded)landings++;
    maxStep=Math.max(maxStep,Math.hypot(s.x-before.x,s.y-before.y,s.z-before.z));
    if(before.anchor&&!s.anchor&&!s.blockedReason&&!s.grounded){
      automaticReleases++;assert.ok(s.y-.14>=8,'passing the anchor cannot sever the web close to the road');
      assert.ok(s.verticalSpeed>1,'the handover preserves a rising arc instead of dropping at the bottom');
    }
  }
  assert.equal(lowAir,0);assert.equal(landings,0);assert.ok(automaticReleases>=2);assert.ok(p.state.distance>180);assert.ok(maxStep<.5,'clearance assistance cannot teleport the body');
  const count=p.state.swingCount,speed=p.state.speed;p.step(1/120,{});assert.equal(p.state.anchor,null);assert.ok(p.state.speed>speed*.99);advance(p,1,{});assert.equal(p.state.swingCount,count,'manual release never restarts a web');
});

test('holding web against a broad facade finds a real side attachment without hanging indefinitely',()=>{
  const p=make({buildings:[polygon(-40,-40,40,-25,19)]});let stall=0,maxStall=0;
  for(let i=0;i<8*120;i++){
    const distance=p.state.distance;p.step(1/120,{swing:true});stall=p.state.distance-distance<.005?stall+1/120:0;maxStall=Math.max(maxStall,stall);
    const a=p.state.anchor;if(a){assert.equal(a.y,19);assert.ok(a.x===-40||a.x===40||a.z===-40||a.z===-25,'recovery still attaches to an actual facade edge');}
    assert.ok(p.state.y>=19||p.state.x<=-40-.36||p.state.x>=40+.36||p.state.z<=-40-.36||p.state.z>=-25+.36,'recovery keeps the body outside the building');
  }
  assert.ok(maxStall<1,`stalled for ${maxStall}s`);assert.ok(p.state.swingCount>=2);assert.ok(Math.abs(p.state.x)>40,'held E clears the facade by moving along its side');
});
