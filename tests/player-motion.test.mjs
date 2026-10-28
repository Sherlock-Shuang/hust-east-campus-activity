import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPlayerMotion} from '../src/player-motion.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
import {getBuildingProfile} from '../src/building-profiles.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
const flat={length:300,points:[{x:0,y:.16,z:0,progress:0},{x:0,y:.16,z:-300,progress:300}],segments:[{startProgress:0,endProgress:300,width:7.2}]};
const polygon=(minX,minZ,maxX,maxZ,height=18)=>({height,rings:[[{x:minX,z:minZ},{x:maxX,z:minZ},{x:maxX,z:maxZ},{x:minX,z:maxZ}]]});
function advance(player,seconds,input,dt=1/60){for(let t=0;t<seconds-1e-8;t+=dt)player.step(Math.min(dt,seconds-t),input);return player.state;}

test('fixed-step movement is independent of render cadence, with forward -Z and positive left turn',()=>{
  const a=createPlayerMotion({route:flat}),b=createPlayerMotion({route:flat});
  advance(a,3,{forward:1,turn:.12},1/60);advance(b,3,{forward:1,turn:.12},1/24);
  for(const field of ['x','y','z','yaw','speed','distance'])assert.ok(Math.abs(a.state[field]-b.state[field])<1e-9,field);
  assert.ok(a.state.x<0&&a.state.z<0&&a.state.yaw>0);
  assert.equal(a.state.speed,3.2);assert.ok(a.state.distance>7);
  const before=a.state.distance;a.step(100,{forward:1});assert.ok(a.state.distance-before<=.801,'resuming after a stalled tab cannot jump across campus');
});

test('walking, scooter acceleration, braking and mode switches preserve player position',()=>{
  const player=createPlayerMotion({route:flat});advance(player,1,{forward:1});
  const before={...player.state};assert.equal(player.setMode('scooter').ok,true);
  assert.equal(player.state.x,before.x);assert.equal(player.state.z,before.z);assert.equal(player.state.speed,0);
  advance(player,4,{forward:1});assert.equal(player.state.speed,7.5);assert.ok(player.state.distance>20);
  const stopDistance=player.state.distance;advance(player,1,{brake:true});assert.equal(player.state.speed,0);assert.ok(player.state.distance-stopDistance<3.2);
  player.setMode('walk');advance(player,1,{forward:1,fast:true});assert.equal(player.state.speed,5.2);
});

test('body clearance prevents building and lake penetration and respects polygon holes',()=>{
  const building=createPlayerMotion({route:flat,world:{buildings:[polygon(-5,-9,5,-4)]}});
  advance(building,8,{forward:1});assert.ok(building.state.z>=-3.74-1e-6);assert.equal(building.state.blockedReason,'建筑边界');
  const lake=polygon(-10,-15,10,-4);lake.rings.push(polygon(-2,-12,2,-7).rings[0]);
  const water=createPlayerMotion({route:flat,world:{water:[lake]}});advance(water,8,{forward:1});assert.ok(water.state.z>=-3.74-1e-6);assert.equal(water.state.blockedReason,'水域边界');
  assert.equal(water.groundAt(0,-10).allowed,true,'dry island inside an interior ring remains traversable');
  assert.equal(water.groundAt(4,-10).allowed,false);
});

test('scooter capsule and world bounds stop both wheels before obstacles',()=>{
  const player=createPlayerMotion({route:flat,world:{buildings:[polygon(-5,-10,5,-5)],bounds:{minX:-20,maxX:20,minZ:-30,maxZ:10}}});player.setMode('scooter');advance(player,10,{forward:1});
  assert.ok(player.state.z>=-5+.52+.42-1e-6,'front vehicle body stops before the wall');assert.equal(player.state.speed,0);
  const bound=createPlayerMotion({route:flat,world:{bounds:{minX:-20,maxX:20,minZ:-4,maxZ:10}}});advance(bound,8,{forward:1});assert.ok(bound.state.z>=-3.74-1e-6);assert.equal(bound.state.blockedReason,'校园边界');
});

test('bridge ramp contact stays continuous and a raised deck cannot be exited sideways',()=>{
  const route={length:100,points:[{x:0,z:0,y:.16,progress:0},{x:0,z:-20,y:.16,progress:20},{x:0,z:-40,y:2.16,progress:40},{x:0,z:-60,y:2.16,progress:60},{x:0,z:-80,y:.16,progress:80},{x:0,z:-100,y:.16,progress:100}],segments:[{startProgress:0,endProgress:100,width:6}]};
  const player=createPlayerMotion({route,world:{water:[polygon(-15,-60,15,-40)]}});player.setMode('scooter');player.reset(25);
  let previous=player.state.y;for(let i=0;i<300;i++){player.step(1/60,{forward:1});assert.ok(Math.abs(player.state.y-previous)<.013,'ramp follows continuous source profile');previous=player.state.y;}
  assert.ok(player.state.progress>50);assert.ok(Math.abs(player.state.y-2.139)<.002);
  player.setMode('walk');player.reset(50);advance(player,Math.PI/2/2.2,{turn:1});advance(player,5,{forward:1});assert.ok(Math.abs(player.state.x)<=3-.26+1e-5);assert.ok(player.state.y>2.13);assert.ok(['水域边界','桥面边缘'].includes(player.state.blockedReason));
});

test('player yields to a nearby actor while allowing retreat out of an overlap',()=>{
  const actor={kind:'scooter',active:true,x:0,y:.14,z:-4,yaw:0};const player=createPlayerMotion({route:flat,traffic:()=>[actor]});player.setMode('scooter');advance(player,6,{forward:1});assert.equal(player.state.blockedReason,'前方人车');assert.ok(player.state.z>-2.6);
  actor.z=player.state.z-.3;const z=player.state.z;advance(player,1,{forward:-1});assert.ok(player.state.z>z,'reverse may leave a pre-existing overlap');
});

test('helicopter takeoff and landing are continuous; airborne ground-mode switch is rejected',()=>{
  const player=createPlayerMotion({route:flat});assert.equal(player.setMode('helicopter').ok,true);const initialY=player.state.y;
  player.step(1/60,{vertical:1});assert.ok(player.state.y-initialY<.002,'activation does not teleport upward');advance(player,4,{vertical:1});assert.ok(player.state.y>10);assert.equal(player.state.grounded,false);assert.equal(player.setMode('walk').ok,false);
  advance(player,4,{forward:1});assert.ok(player.state.speed>17&&player.state.distance>20);advance(player,3,{brake:true});advance(player,10,{vertical:-1,brake:true});assert.equal(player.state.grounded,true);assert.equal(player.state.y,.14);assert.equal(player.setMode('walk').ok,true);
});

test('helicopter stays above water and below its altitude limit without switching to walking in midair',()=>{
  const player=createPlayerMotion({route:flat,world:{water:[polygon(-100,-200,100,-10)]}});player.setMode('helicopter');advance(player,5,{vertical:1});advance(player,3,{forward:1});assert.ok(player.state.z<-10);advance(player,10,{vertical:-1,brake:true});assert.ok(Math.abs(player.state.y-2.64)<.001);assert.equal(player.state.grounded,false);assert.equal(player.setMode('scooter').ok,false);assert.ok(player.state.blockedReason.includes('水面'));
  advance(player,35,{vertical:1});assert.equal(player.state.y,120.14);assert.ok(player.state.blockedReason.includes('120'));
});

test('actual campus route player contact matches the source bridge and resets at requested progress',()=>{
  const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),route=createCommuteRoute(source,{frame,geoToLocal}),bridge=route.segments.find(s=>s.bridge),player=createPlayerMotion({route});
  player.setMode('scooter');const progress=(bridge.startProgress+bridge.endProgress)/2;player.reset(progress);assert.ok(Math.abs(player.state.progress-progress)<1e-8);assert.ok(Math.abs(player.state.y-(bridge.elevation+.139))<.002);assert.equal(player.state.grounded,true);
  const before={...player.state};assert.equal(player.setMode('walk').ok,true);assert.equal(player.state.x,before.x);assert.equal(player.state.z,before.z);assert.ok(Math.abs(player.state.y-(bridge.elevation+.14))<.001);
});


test('helicopter activation checks rotor and tail clearance, and an unsafe reset becomes walking',()=>{
  for(const building of [polygon(3.9,-1,5,1),polygon(-.4,4.7,.4,6)]){
    const player=createPlayerMotion({route:flat,world:{buildings:[building]}});assert.equal(player.setMode('helicopter').ok,false,'rotor/tail cannot spawn through a wall');assert.equal(player.state.mode,'walk');
  }
  const player=createPlayerMotion({route:flat,world:{buildings:[polygon(2,-54,5,-46)]}});assert.equal(player.setMode('helicopter').ok,true);player.reset(50);assert.equal(player.state.mode,'walk');assert.ok(player.state.blockedReason.includes('净空'));assert.equal(player.state.y,.14);assert.equal(player.state.z,-50);
});

test('landing with forward momentum levels the helicopter without burying the skid contact points',()=>{
  const player=createPlayerMotion({route:flat});player.setMode('helicopter');advance(player,4,{vertical:1});advance(player,4,{forward:1});
  for(let i=0;i<600&&!player.state.grounded;i++){
    player.step(1/60,{forward:1,vertical:-1,turn:.1});const s=player.state;
    for(const x of[-1.085,1.085])for(const z of[-1.97,1.36])assert.ok(s.y+Math.sin(s.lean)*x*Math.cos(s.pitch)-Math.sin(s.pitch)*z>=.14-1e-7,'tilted skid envelope stays above ground');
  }
  assert.equal(player.state.grounded,true);assert.equal(player.state.pitch,0);assert.equal(player.state.lean,0);assert.equal(player.state.speed,0);assert.equal(player.state.y,.14);
});

test('the real source dorm-side spawn has room for all three modes',()=>{
  const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),route=createCommuteRoute(source,{frame,geoToLocal}),simulation=createCommuteSimulation(route,{maxAgents:0});
  const project=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
  const polygons=category=>source.features.filter(f=>f.properties?.category===category&&['Polygon','MultiPolygon'].includes(f.geometry.type)).flatMap(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(rings=>({rings:rings.map(r=>r.map(project)),height:category==='building'?getBuildingProfile(f).height+.065:0})));
  const player=createPlayerMotion({route,world:{buildings:polygons('building'),water:polygons('water')},getPoseAt:simulation.getPoseAt});const initial={...player.state};
  for(const mode of ['scooter','helicopter','walk']){assert.equal(player.setMode(mode).ok,true,mode);assert.equal(player.state.x,initial.x);assert.equal(player.state.z,initial.z);}
});

test('explicit reset selects a traffic-clear route position and refuses a fully occupied respawn',()=>{
  let actors=[{type:'walk',active:true,x:0,y:.14,z:0,yaw:0}];const player=createPlayerMotion({route:flat,traffic:()=>actors});
  assert.ok(player.state.progress>0&&player.state.progress<=10);assert.ok(Math.hypot(player.state.x,player.state.z)>=.63,'initial player does not intersect the existing pedestrian');
  player.reset(50);const previous={...player.state};actors=Array.from({length:45},(_,i)=>({type:'scooter',active:true,x:0,y:.14,z:-i*.25,yaw:0}));player.reset(0);assert.equal(player.state.x,previous.x);assert.equal(player.state.z,previous.z);assert.ok(player.state.blockedReason.includes('未改变位置'));
});

test('ascending below a raised building stops at underside clearance instead of snapping above the roof',()=>{
  const canopy={...polygon(-10,-10,10,10,9),minHeight:6};const player=createPlayerMotion({route:flat,world:{buildings:[canopy]}});assert.equal(player.setMode('helicopter').ok,true);
  let previous=player.state.y;for(let i=0;i<360;i++){player.step(1/60,{vertical:1});assert.ok(player.state.y-previous<.081);previous=player.state.y;}
  assert.ok(Math.abs(player.state.y-2.6)<1e-9);assert.ok(player.state.blockedReason.includes('净空'));assert.equal(player.setMode('walk').ok,false);
});

test('Roadster ground driving accelerates, steers, brakes and reverses without implicit flight',()=>{
  const player=createPlayerMotion({route:flat});assert.equal(player.setMode('roadster').ok,true);advance(player,4,{forward:1,vertical:1});assert.equal(player.state.speed,12);assert.equal(player.state.y,.14);assert.equal(player.state.flightEnabled,false);assert.equal(player.state.jetPower,0);assert.equal(player.state.rotorPower,0);
  advance(player,2,{forward:1,fast:true});assert.equal(player.state.speed,18);assert.equal(player.state.jetPower,0);assert.ok(player.state.forwardJetPower>0,'ground boost uses rear thrust without lift');
  const braking=player.state.distance;advance(player,2.2,{brake:true});assert.equal(player.state.speed,0);assert.ok(player.state.distance-braking<18.1);
  const stationaryYaw=player.state.yaw;advance(player,.5,{turn:1});assert.equal(player.state.yaw,stationaryYaw,'ground steering cannot spin the parked car');advance(player,1,{forward:-1,turn:1});assert.equal(player.state.speed,-3);assert.ok(player.state.yaw<stationaryYaw,'reverse steering follows wheelbase kinematics');assert.equal(player.state.lean,0);
});

test('Roadster full body stops at walls, water and bounds, and refuses overlapping mode activation',()=>{
  const worlds=[{buildings:[polygon(-10,-20,10,-7)]},{water:[polygon(-10,-20,10,-7)]},{bounds:{minX:-10,maxX:10,minZ:-7,maxZ:10}}];
  for(const world of worlds){const player=createPlayerMotion({route:flat,world});assert.equal(player.setMode('roadster').ok,true);advance(player,6,{forward:1,fast:true});assert.ok(player.state.z>=-7+2.3-1e-6,'front bumper clearance is retained');assert.equal(player.state.speed,0);}
  const npc={type:'walk',active:true,x:1.2,y:.14,z:0,yaw:0},player=createPlayerMotion({route:flat,traffic:()=>[npc]});assert.equal(player.setMode('roadster').ok,false);assert.equal(player.state.mode,'walk');assert.equal(player.state.x,0);assert.equal(player.state.z,0);
});

test('Roadster ramp contact uses its 2.65m wheelbase and cannot drive sideways off the raised bridge',()=>{
  const route={length:120,points:[{x:0,z:0,y:.16,progress:0},{x:0,z:-20,y:.16,progress:20},{x:0,z:-40,y:2.16,progress:40},{x:0,z:-80,y:2.16,progress:80},{x:0,z:-100,y:.16,progress:100},{x:0,z:-120,y:.16,progress:120}],segments:[{startProgress:0,endProgress:120,width:6}]};
  const player=createPlayerMotion({route,world:{water:[polygon(-20,-80,20,-40)]}});player.setMode('roadster');player.reset(30);assert.ok(Math.abs(player.state.pitch-Math.atan(.1))<1e-9);assert.ok(Math.abs(player.state.y-1.14)<1e-9);
  let previous=player.state.y;for(let i=0;i<180;i++){player.step(1/60,{forward:1});assert.ok(Math.abs(player.state.y-previous)<.021);previous=player.state.y;}assert.ok(player.state.progress>40);assert.ok(Math.abs(player.state.y-2.14)<1e-9);
  player.reset(60);advance(player,10,{forward:1,turn:1});assert.ok(Math.abs(player.state.x)<3-1.1+.001);assert.ok(player.state.y>2.13);assert.equal(player.state.speed,0);assert.ok(['水域边界','桥面边缘'].includes(player.state.blockedReason));
});

test('Roadster held jets lift, release falls, and disabling power preserves airborne momentum',()=>{
  const player=createPlayerMotion({route:flat});player.setMode('roadster');assert.equal(player.setFlightEnabled(true).ok,true);const before={...player.state};player.step(1/60,{vertical:1});assert.ok(player.state.y-before.y<.002,'cold-gas activation has no altitude jump');advance(player,3,{vertical:1});assert.ok(player.state.y>10);assert.equal(player.state.grounded,false);assert.equal(player.setMode('walk').ok,false);assert.equal(player.setMode('helicopter').ok,false);assert.ok(player.state.jetPower>.8);assert.equal(player.state.rotorPower,0);
  advance(player,4,{forward:1,turn:.1,vertical:1});assert.ok(player.state.speed>11.9);assert.ok(player.state.yaw>0);
  const released=player.state.y,velocity=player.state.verticalSpeed;assert.equal(player.setFlightEnabled(false).ok,true);assert.equal(player.state.y,released);assert.equal(player.state.verticalSpeed,velocity);
  advance(player,8,{brake:true});assert.equal(player.state.grounded,true);assert.equal(player.state.y,.14);assert.equal(player.state.pitch,0);assert.equal(player.state.lean,0);assert.equal(player.state.jetPower,0);assert.equal(player.state.verticalSpeed,0);assert.equal(player.setMode('walk').ok,true);
});

test('Roadster retains water collision and 80m ceiling without rendering collision contact as jet lift',()=>{
  const player=createPlayerMotion({route:flat,world:{water:[polygon(-100,-200,100,-10)]}});player.setMode('roadster');player.setFlightEnabled(true);advance(player,4,{vertical:1});advance(player,3,{forward:1});assert.ok(player.state.z<-10);advance(player,10,{vertical:-1,brake:true});assert.ok(Math.abs(player.state.y-2.64)<1e-9);assert.equal(player.state.grounded,false);assert.equal(player.state.jetPower,0);assert.equal(player.state.flightPhase,'blocked');assert.equal(player.setFlightEnabled(false).ok,true);
  player.setFlightEnabled(true);advance(player,25,{vertical:1});assert.equal(player.state.y,80.14);assert.ok(player.state.blockedReason.includes('80'));
});

test('Roadster refuses descent onto commuters and retains low-altitude collision while allowing flight above them',()=>{
  let actors=[];const player=createPlayerMotion({route:flat,traffic:()=>actors});player.setMode('roadster');player.setFlightEnabled(true);advance(player,2,{vertical:1});actors=[{type:'walk',active:true,x:player.state.x,y:.14,z:player.state.z,yaw:0}];advance(player,6,{vertical:-1});assert.ok(player.state.y>=2.04-1e-9);assert.equal(player.state.grounded,false);assert.ok(player.state.blockedReason.includes('下方有人车'));assert.equal(player.setFlightEnabled(false).ok,true);
  actors=[];advance(player,3,{vertical:-1});assert.equal(player.state.grounded,true);player.setFlightEnabled(false);player.reset(0);actors=[{type:'scooter',active:true,x:0,y:.14,z:-6,yaw:0}];player.setFlightEnabled(true);advance(player,.15,{vertical:1});advance(player,5,{forward:1});assert.equal(player.state.blockedReason,'前方人车');assert.ok(player.state.z>-3.2);advance(player,2,{vertical:1});advance(player,3,{forward:1,vertical:9.81/18});assert.ok(player.state.z<-6,'once the body clears the commuters, held thrust permits flight above them');
});

test('Roadster dynamics are deterministic across render rates in ground and flight modes',()=>{
  const a=createPlayerMotion({route:flat}),b=createPlayerMotion({route:flat});a.setMode('roadster');b.setMode('roadster');
  for(const p of[a,b])p.setFlightEnabled(true);advance(a,2,{vertical:1},1/60);advance(b,2,{vertical:1},1/24);advance(a,3,{forward:1,turn:.2},1/60);advance(b,3,{forward:1,turn:.2},1/24);
  for(const key of ['x','y','z','yaw','speed','jetPower','distance'])assert.ok(Math.abs(a.state[key]-b.state[key])<1e-9,key);
});

test('requested-mode reset searches using the full car footprint and preserves the prior mode on failure',()=>{
  let actors=[{type:'scooter',active:true,x:0,y:.14,z:0,yaw:0}];
  const getPoseAt=(progress,lane,kind)=>({x:kind==='walk'?2.98:(lane-1)*1.8,y:.16,z:-progress,yaw:0});
  const player=createPlayerMotion({route:flat,traffic:()=>actors,getPoseAt});player.reset(0,'roadster');assert.equal(player.state.mode,'roadster');assert.equal(player.state.blockedReason,'');assert.ok(Math.abs(player.state.x)>=1.8);assert.ok(player.state.progress<=10);assert.equal(player.state.flightEnabled,false);
  actors=[];player.reset(50,'walk');const previous={...player.state};actors=Array.from({length:22},(_,row)=>[-6,-4,-2,0,2,4,6].map(x=>({type:'scooter',active:true,x,y:.14,z:-row*.5,yaw:0}))).flat();player.reset(0,'roadster');assert.equal(player.state.mode,'walk');assert.equal(player.state.x,previous.x);assert.equal(player.state.z,previous.z);assert.ok(player.state.blockedReason.includes('未改变位置'));
});

test('a low Roadster supported by held thrust cannot rotate its rear quarter into a nearby pedestrian',()=>{
  let actors=[];const player=createPlayerMotion({route:flat,traffic:()=>actors});
  player.setMode('roadster');player.setFlightEnabled(true);advance(player,.3,{vertical:1});advance(player,.25,{});
  const pedestrian={x:1.7,z:1.7,y:.14,type:'walk',active:true};actors=[pedestrian];
  assert.ok(player.state.y<1.7&&!player.state.grounded);
  advance(player,1,{turn:1,vertical:9.81/18});
  assert.equal(player.state.blockedReason,'前方人车');assert.ok(player.state.yaw<.6,'rotation stops before the rear quarter reaches the pedestrian');
  const yaw=player.state.yaw;advance(player,.3,{turn:-1,vertical:9.81/18});assert.ok(player.state.yaw<yaw,'turning away remains possible');
});

test('hoverboard waits for rotor spin-up, cannot slide on its legs, then lands and spins down',()=>{
  const player=createPlayerMotion({route:flat});assert.equal(player.setMode('hoverboard').ok,true);const initial={...player.state};advance(player,1,{forward:1,turn:1});assert.equal(player.state.x,initial.x);assert.equal(player.state.z,initial.z);assert.equal(player.state.yaw,initial.yaw);assert.equal(player.state.rotorPower,0);
  advance(player,.4,{vertical:1,forward:1});assert.equal(player.state.y,initial.y);assert.equal(player.state.grounded,true);assert.ok(player.state.rotorPower>0&&player.state.rotorPower<.38);
  advance(player,2,{vertical:1});assert.ok(player.state.y>3);assert.equal(player.state.grounded,false);assert.equal(player.setMode('walk').ok,false);assert.equal(player.setMode('roadster').ok,false);assert.equal(player.state.jetPower,0);
  advance(player,5,{vertical:-1});assert.equal(player.state.grounded,true);assert.equal(player.state.y,.14);advance(player,2,{});assert.equal(player.state.rotorPower,0);assert.equal(player.setMode('walk').ok,true);
});

test('hoverboard flies forward and backward, banks into turns and space overrides vertical commands to hover',()=>{
  const player=createPlayerMotion({route:flat});player.reset(0,'hoverboard');advance(player,3,{vertical:1});advance(player,3,{forward:1});assert.equal(player.state.speed,24);assert.ok(player.state.pitch<0);advance(player,2,{forward:1,fast:true,turn:.5});assert.equal(player.state.speed,36);assert.ok(player.state.yaw>0);assert.ok(player.state.lean>0&&player.state.lean<=.2);
  advance(player,3,{brake:true,vertical:1,forward:1});assert.equal(player.state.speed,0);assert.equal(player.state.verticalSpeed,0);const hover=player.state.y;advance(player,1,{brake:true,vertical:1});assert.equal(player.state.y,hover);assert.ok(player.state.rotorPower>.6);assert.equal(player.state.jetPower,0);
  advance(player,2,{forward:-1});assert.equal(player.state.speed,-7);
});

test('hoverboard rotor span and standing rider use separate clearance envelopes',()=>{
  const sideWall=polygon(1.37,-1,2.2,1);const blocked=createPlayerMotion({route:flat,world:{buildings:[sideWall]}});assert.equal(blocked.setMode('hoverboard').ok,false,'a lateral rotor cannot spawn through a wall');
  const overRotor={...polygon(1.05,-.6,1.5,.6,2.5),minHeight:.7};const clear=createPlayerMotion({route:flat,world:{buildings:[overRotor]}});assert.equal(clear.setMode('hoverboard').ok,true,'a low overhead ledge only overlaps the low rotor, not the standing rider');advance(clear,3,{vertical:1});assert.ok(clear.state.y<.32&&clear.state.y>.14,'ascent stops below the rotor-side ledge rather than snapping above its roof');assert.ok(clear.state.blockedReason.includes('净空'));
  const overHead={...polygon(-.3,-.3,.3,.3,3),minHeight:2.2};const head=createPlayerMotion({route:flat,world:{buildings:[overHead]}});assert.equal(head.setMode('hoverboard').ok,false,'standing head height is included even though the deck would fit');
});

test('hoverboard four feet retain source bridge contact and do not sink during banked landings',()=>{
  const route={length:120,points:[{x:0,z:0,y:.16,progress:0},{x:0,z:-20,y:.16,progress:20},{x:0,z:-40,y:2.16,progress:40},{x:0,z:-80,y:2.16,progress:80},{x:0,z:-100,y:.16,progress:100},{x:0,z:-120,y:.16,progress:120}],segments:[{startProgress:0,endProgress:120,width:6}]};
  const bridge=createPlayerMotion({route,world:{water:[polygon(-20,-80,20,-40)]}});bridge.reset(55,'hoverboard');assert.equal(bridge.state.mode,'hoverboard');assert.ok(Math.abs(bridge.state.y-2.14)<1e-9);assert.equal(bridge.state.grounded,true);advance(bridge,3,{vertical:1});advance(bridge,5,{vertical:-1});assert.equal(bridge.state.grounded,true);assert.ok(Math.abs(bridge.state.y-2.14)<1e-9);
  const player=createPlayerMotion({route:flat});player.reset(0,'hoverboard');advance(player,4,{vertical:1});advance(player,4,{forward:1,turn:.4});
  for(let i=0;i<600&&!player.state.grounded;i++){player.step(1/60,{forward:1,turn:.2,vertical:-1});const s=player.state;for(const x of[-.74,.74])for(const z of[-.36,.36])assert.ok(s.y+x*Math.sin(s.lean)*Math.cos(s.pitch)-z*Math.sin(s.pitch)>=.14-1e-7,'all four leg tips stay above the surface');}
  assert.equal(player.state.grounded,true);assert.equal(player.state.speed,0);assert.equal(player.state.pitch,0);assert.equal(player.state.lean,0);
});

test('hoverboard yields to people during low flight and descent, but can clear them at altitude',()=>{
  let actors=[];const player=createPlayerMotion({route:flat,traffic:()=>actors});player.reset(0,'hoverboard');advance(player,1,{vertical:1});advance(player,.5,{});assert.ok(player.state.y<1.8&&!player.state.grounded);
  actors=[{type:'walk',active:true,x:0,z:-5,y:.14,yaw:0}];advance(player,4,{forward:1});assert.equal(player.state.blockedReason,'前方人车');assert.ok(player.state.z>-3.8);advance(player,3,{vertical:1});advance(player,3,{forward:1});assert.ok(player.state.z<-5);
  advance(player,2,{brake:true});actors=[{type:'scooter',active:true,x:player.state.x,z:player.state.z,y:.14,yaw:0}];advance(player,8,{vertical:-1});assert.ok(player.state.y>=2.04-1e-8);assert.equal(player.state.grounded,false);assert.ok(player.state.blockedReason.includes('下方有人车'));actors=[];advance(player,3,{vertical:-1});assert.equal(player.state.grounded,true);
});

test('hoverboard remains above water and within its 60m ceiling and campus bounds',()=>{
  const player=createPlayerMotion({route:flat,world:{water:[polygon(-100,-150,100,-10)],bounds:{minX:-50,maxX:50,minZ:-45,maxZ:10}}});player.reset(0,'hoverboard');advance(player,4,{vertical:1});advance(player,4,{forward:1,fast:true});advance(player,3,{brake:true});advance(player,8,{vertical:-1});assert.ok(Math.abs(player.state.y-2.64)<1e-8);assert.equal(player.state.grounded,false);assert.equal(player.setMode('scooter').ok,false);
  advance(player,25,{vertical:1});assert.equal(player.state.y,60.14);assert.ok(player.state.blockedReason.includes('60'));advance(player,5,{forward:1,fast:true});assert.ok(player.state.z>-44);assert.equal(player.state.blockedReason,'校园边界');
});

test('hoverboard movement is deterministic and a requested hoverboard spawn checks its whole rotor span',()=>{
  const a=createPlayerMotion({route:flat}),b=createPlayerMotion({route:flat});a.reset(0,'hoverboard');b.reset(0,'hoverboard');advance(a,3,{vertical:1},1/60);advance(b,3,{vertical:1},1/24);advance(a,2,{forward:1,turn:.3},1/60);advance(b,2,{forward:1,turn:.3},1/24);
  for(const key of ['x','y','z','yaw','pitch','lean','speed','distance','rotorPower'])assert.ok(Math.abs(a.state[key]-b.state[key])<1e-9,key);
  const actors=[{type:'walk',active:true,x:1.2,z:.43,y:.14,yaw:0}],player=createPlayerMotion({route:flat,traffic:()=>actors});player.reset(0,'hoverboard');assert.equal(player.state.mode,'hoverboard');assert.equal(player.state.blockedReason,'');assert.ok(player.state.progress>0&&player.state.progress<=10,'spawn moves along the source route until all rotor disks have room');
});

test('walking starts without a one-frame velocity or steering kick and releases promptly',()=>{
  const player=createPlayerMotion({route:flat});
  player.step(1/120,{forward:1,turn:1});
  assert.ok(player.state.speed>0&&player.state.speed<.01,'throttle begins with a small non-zero response');
  assert.ok(player.state.yawRate>0&&player.state.yawRate<.2,'turning ramps instead of jumping to 2.2 rad/s');
  let previous={...player.state};
  for(let i=0;i<72;i++){
    player.step(1/120,{forward:1,turn:1});
    assert.ok(Math.abs(player.state.yawRate-previous.yawRate)<=18/120+1e-9,'the initial steering acceleration is bounded');
    assert.ok(player.state.speed>=previous.speed&&player.state.speed<=3.2);
    previous={...player.state};
  }
  assert.equal(player.state.speed,3.2);assert.ok(Math.abs(player.state.yawRate-2.2)<1e-9);
  const before=player.state.distance;advance(player,.55,{});
  assert.equal(player.state.speed,0);assert.equal(player.state.yawRate,0);
  assert.ok(player.state.distance-before<.75,'letting go stops a brisk walk within a short step');
});

test('scooter release settles before the junction while braking remains decisive',()=>{
  for(const brake of [false,true]){
    const player=createPlayerMotion({route:flat});player.setMode('scooter');advance(player,4,{forward:1});
    const distance=player.state.distance;advance(player,brake?1:2.3,{brake});
    assert.equal(player.state.speed,0);assert.ok(player.state.distance-distance<(brake?3.2:7));
    assert.ok(player.state.distance-distance>(brake?2.5:5.5),'release remains a smooth coast instead of an instant velocity reset');
  }
});

test('walking and scooter easing remain deterministic across 24, 60 and 144 Hz and do not retain drive after a reset',()=>{
  const sequence=[[1,{forward:1,turn:.4}],[.5,{forward:1,turn:-.2}],[.5,{}],[1,{forward:-1}],[.5,{brake:true}]];
  for(const mode of ['walk','scooter']){
    const runs=[24,60,144].map(fps=>{const player=createPlayerMotion({route:flat});player.setMode(mode);for(const [duration,input] of sequence)advance(player,duration,input,1/fps);return player;});
    for(const other of runs.slice(1))for(const key of ['x','z','yaw','speed','acceleration','yawRate','distance'])assert.ok(Math.abs(runs[0].state[key]-other.state[key])<1e-9,`${mode} ${key}`);
    for(const player of runs){player.reset(0);advance(player,.3,{});assert.equal(player.state.distance,0);assert.equal(player.state.yaw,0);advance(player,.2,{forward:1,turn:1});player.suspend();const before={...player.state};advance(player,.3,{});assert.equal(player.state.distance,before.distance);assert.equal(player.state.yaw,before.yaw);}
  }
});

test('world-relative walking follows all camera axes regardless of avatar heading and turns naturally',()=>{
  for(const [moveX,moveZ] of [[0,-1],[1,0],[0,1],[-1,0]]){
    const player=createPlayerMotion({route:flat});player.placeWalker({x:0,z:0,yaw:.71});
    player.step(1/120,{moveX,moveZ,forward:-1,turn:1});
    assert.ok(Math.abs(player.state.yaw-.71)<.01,'first frame does not snap avatar to the new heading');
    advance(player,1.5,{moveX,moveZ,forward:-1,turn:1});
    assert.ok(player.state.x*moveX+player.state.z*moveZ>3.5,'world input wins over legacy body-relative controls');
    assert.ok(Math.abs(player.state.x*moveZ-player.state.z*moveX)<1e-9,'path never arcs with avatar rotation');
    assert.ok(Math.abs(Math.atan2(Math.sin(player.state.yaw-Math.atan2(-moveX,-moveZ)),Math.cos(player.state.yaw-Math.atan2(-moveX,-moveZ))))<.002);
    assert.equal(player.state.speed,3.2);
  }
});

test('world-relative walking normalizes diagonals, respects analog input, and eases direction changes and stops',()=>{
  const straight=createPlayerMotion({route:flat}),diagonal=createPlayerMotion({route:flat}),analog=createPlayerMotion({route:flat});
  advance(straight,2,{moveX:0,moveZ:-1});advance(diagonal,2,{moveX:1,moveZ:-1});advance(analog,2,{moveX:0,moveZ:-.5});
  assert.ok(Math.abs(straight.state.distance-diagonal.state.distance)<1e-8,'diagonal input gives no speed boost');
  assert.ok(Math.abs(analog.state.speed-1.6)<1e-9);
  const z=straight.state.z;straight.step(1/120,{moveX:0,moveZ:1});
  assert.ok(straight.state.z<z,'reversal first arrests existing velocity instead of instantly flipping it');
  advance(straight,1.5,{moveX:0,moveZ:1,fast:true});assert.equal(straight.state.speed,5.2);
  const stop={...straight.state};advance(straight,1,{moveX:0,moveZ:0});
  assert.equal(straight.state.speed,0);assert.ok(straight.state.distance-stop.distance<1.7);
  const idle={...straight.state};advance(straight,1,{moveX:0,moveZ:0});assert.equal(straight.state.distance,idle.distance);
  straight.suspend();advance(straight,1,{moveX:0,moveZ:0});assert.equal(straight.state.distance,idle.distance);
});

test('camera-relative walking retains walls, water, fences, traffic and raised-deck boundaries at running speed',()=>{
  const worlds=[{buildings:[polygon(4,-10,10,10)]},{water:[polygon(4,-10,10,10)]},{barriers:[{polygon:polygon(4,-10,4.15,10).rings[0],minHeight:0,height:2,label:'围栏'}]}];
  for(const world of worlds){const player=createPlayerMotion({route:flat,world});advance(player,4,{moveX:1,moveZ:0,fast:true});assert.ok(player.state.x<3.741);assert.equal(player.state.speed,0);assert.ok(player.state.blockedReason);}
  const actor={type:'walk',x:4,z:0,y:.14,active:true},traffic=createPlayerMotion({route:flat,traffic:()=>[actor]});
  advance(traffic,4,{moveX:1,moveZ:0,fast:true});assert.ok(traffic.state.x<3.38);assert.equal(traffic.state.blockedReason,'前方人车');
  const before=traffic.state.x;advance(traffic,1,{moveX:-1,moveZ:0});assert.ok(traffic.state.x<before,'walking back out of a queue remains possible');
  const route={length:100,points:[{x:0,z:0,y:2.16,progress:0},{x:0,z:-100,y:2.16,progress:100}],segments:[{startProgress:0,endProgress:100,width:6,bridge:true}]};
  const bridge=createPlayerMotion({route,world:{water:[polygon(-10,-100,10,10)]}});advance(bridge,3,{moveX:1,moveZ:0,fast:true});assert.ok(bridge.state.x<=2.74);assert.ok(bridge.state.y>2.13);assert.ok(bridge.state.blockedReason);
});

test('world-relative walking is deterministic at 24, 60 and 144 Hz and reset clears residual velocity',()=>{
  const sequence=[[1,{moveX:1,moveZ:-1}],[.5,{moveX:0,moveZ:1,fast:true}],[.5,{moveX:0,moveZ:0}],[1,{moveX:-1,moveZ:0}],[.5,{moveX:1,moveZ:0,brake:true}]];
  const runs=[24,60,144].map(fps=>{const player=createPlayerMotion({route:flat});for(const[seconds,input]of sequence)advance(player,seconds,input,1/fps);return player;});
  for(const other of runs.slice(1))for(const key of ['x','z','yaw','speed','acceleration','yawRate','distance'])assert.ok(Math.abs(runs[0].state[key]-other.state[key])<1e-9,key);
  for(const player of runs){player.reset();advance(player,1,{moveX:0,moveZ:0});assert.equal(player.state.distance,0);assert.equal(player.state.speed,0);assert.equal(player.state.yaw,0);}
});

test('restoring a captured walking pose honors its canonical velocity and placement clears previous motion',()=>{
  const player=createPlayerMotion({route:flat});const idle={...player.state};
  advance(player,1,{moveX:1,moveZ:0});assert.ok(player.state.vx>3);assert.equal(player.state.vz,0);
  Object.assign(player.state,idle);advance(player,.3,{moveX:0,moveZ:0});
  assert.equal(player.state.x,idle.x);assert.equal(player.state.z,idle.z);assert.equal(player.state.speed,0);
  advance(player,1,{moveX:0,moveZ:-1});const saved={...player.state};
  advance(player,1,{moveX:1,moveZ:0});Object.assign(player.state,saved);
  player.step(1/120,{moveX:0,moveZ:0});
  assert.equal(player.state.x,saved.x,'return preserves the saved movement axis rather than the most recent one');
  assert.ok(player.state.z<saved.z);assert.equal(player.state.speed,Math.hypot(player.state.vx,player.state.vz));
  player.placeWalker({x:25,z:0,yaw:.5});advance(player,.5,{moveX:0,moveZ:0});
  assert.equal(player.state.x,25);assert.equal(player.state.z,0);assert.equal(player.state.vx,0);assert.equal(player.state.vz,0);
  advance(player,1,{forward:-1});assert.ok(player.state.vx>0&&player.state.vz>0,'legacy backward movement also captures its actual velocity');
  const legacy={...player.state};player.step(1/120,{moveX:0,moveZ:0});
  assert.ok(player.state.x>legacy.x&&player.state.z>legacy.z,'switching input styles eases the existing motion');
});
