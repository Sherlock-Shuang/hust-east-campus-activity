import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerMotion} from '../src/player-motion.js';
import {createTransportInteraction} from '../src/transport-interaction.js';
import {createScooterTransport} from '../src/scooter-transport.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
const route={length:200,points:[{x:0,z:0,y:.16,progress:0},{x:0,z:-200,y:.16,progress:200}],segments:[{startProgress:0,endProgress:200,width:8,mode:'ride'}],trafficSignals:[]};
const rect=(x1,z1,x2,z2)=>[{x:x1,z:z1},{x:x2,z:z1},{x:x2,z:z2},{x:x1,z:z2}];
const advance=(m,s,input={})=>{for(let t=0;t<s-1e-8;t+=1/60)m.step(1/60,input);};
function source(items){let takes=0,releases=0,restores=0;return{items,nearest(p){return items.filter(i=>!i.taken).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z)).find(i=>Math.hypot((i.boardingPose||i).x-p.x,(i.boardingPose||i).z-p.z)<5)||null;},take(i){if(i.taken)return{ok:false};takes++;i.taken=true;return{ok:true};},release(i,p){if(!i.taken)return{ok:false};releases++;Object.assign(i,p,{taken:false});return{ok:true};},restore(i){if(!i.taken)return{ok:false};restores++;i.taken=false;return{ok:true};},get calls(){return{takes,releases,restores};}};}
const item=(mode='roadster',extra={})=>({id:`test-${mode}`,mode,label:mode,x:2,y:.14,z:0,yaw:0,taken:false,...extra});
test('mount uses the actual item pose and repeated trips preserve one scene object',()=>{
 const motion=createPlayerMotion({route}),vehicle=item(),src=source([vehicle]),changes=[];
 const transport=createTransportInteraction({motion,sources:[src],onChange:m=>changes.push(m)});
 for(let trip=0;trip<3;trip++){
   motion.placeWalker({x:vehicle.x+3,z:vehicle.z,yaw:0});assert.equal(transport.interact().ok,true);assert.equal(motion.state.mode,'roadster');assert.equal(motion.state.x,vehicle.x);assert.equal(vehicle.taken,true);assert.equal(transport.nearest(),null);
   advance(motion,1,{forward:1});advance(motion,1,{brake:true});const parked={x:motion.state.x,z:motion.state.z};assert.equal(transport.interact().ok,true);assert.equal(motion.state.mode,'walk');assert.equal(vehicle.taken,false);assert.equal(vehicle.x,parked.x);assert.equal(vehicle.z,parked.z);assert.equal(src.items.length,1);assert.equal(transport.capture(),null);
 }
 assert.deepEqual(changes,['roadster','walk','roadster','walk','roadster','walk']);assert.deepEqual(src.calls,{takes:3,releases:3,restores:0});
});
test('mount rejection restores a claimed object and leaves the walking player intact',()=>{
 const motion=createPlayerMotion({route,world:{buildings:[{height:20,rings:[rect(2,-2,8,2)]}]}}),vehicle=item('roadster',{x:3}),src=source([vehicle]);
 const transport=createTransportInteraction({motion,sources:[src]});const before={...motion.state};assert.equal(transport.mount({item:vehicle,source:src}).ok,false);assert.equal(vehicle.taken,false);assert.equal(transport.mounted,null);assert.equal(motion.state.mode,'walk');assert.equal(motion.state.x,before.x);assert.equal(motion.state.z,before.z);assert.equal(src.calls.restores,1,'rollback restores rather than parks a borrowed live actor');
});
test('airborne and fast vehicles cannot be abandoned, then permit a grounded stopped exit',()=>{
 const motion=createPlayerMotion({route}),vehicle=item('helicopter',{x:7}),src=source([vehicle]);const transport=createTransportInteraction({motion,sources:[src]});transport.mount({item:vehicle,source:src});
 advance(motion,3,{vertical:1});assert.equal(motion.state.grounded,false);assert.equal(transport.dismount().ok,false);assert.equal(vehicle.taken,true);
 advance(motion,7,{vertical:-1,brake:true});assert.equal(motion.state.grounded,true);assert.equal(transport.dismount().ok,true);
 const car=item('roadster',{x:motion.state.x,z:motion.state.z});src.items.push(car);transport.mount({item:car,source:src});advance(motion,2,{forward:1});assert.ok(motion.state.speed>2.4);assert.equal(transport.dismount().ok,false);advance(motion,2,{brake:true});assert.equal(transport.dismount().ok,true);
});
test('dismount rejects all occupied exits without dropping or duplicating the item',()=>{
 let actors=[];const motion=createPlayerMotion({route,traffic:()=>actors}),vehicle=item('scooter'),src=source([vehicle]);const transport=createTransportInteraction({motion,sources:[src]});transport.mount({item:vehicle,source:src});
 actors=Array.from({length:81},(_,i)=>({id:i,active:true,kind:'walk',type:'walk',x:vehicle.x-4+(i%9),z:vehicle.z-4+Math.floor(i/9),y:.14,yaw:0}));
 assert.equal(transport.dismount().ok,false);assert.equal(vehicle.taken,true);assert.equal(motion.state.mode,'scooter');assert.equal(src.calls.releases,0);
 actors=[];assert.equal(transport.dismount().ok,true);assert.equal(src.calls.releases,1);
});
test('boat exits require a local dry shore and never teleport back from mid-lake to its original dock',()=>{
 const water={id:'lake',surfaceY:.022,rings:[rect(10,-100,100,100)]},motion=createPlayerMotion({route,world:{water:[water]}}),boat=item('boat',{x:12.2,z:0,y:.022,boardingPose:{x:8,z:0,y:.14,yaw:0}}),src=source([boat]);
 src.getDismountCandidates=i=>[{...i.boardingPose}];const transport=createTransportInteraction({motion,sources:[src]});motion.placeWalker(boat.boardingPose);assert.equal(transport.mount().ok,true);
 motion.placeMode({x:50,z:0,yaw:0},'boat');assert.equal(transport.dismount().ok,false);assert.equal(motion.state.mode,'boat');assert.equal(boat.taken,true);
 motion.placeMode({x:12.2,z:30,yaw:0},'boat');assert.equal(transport.dismount().ok,true);assert.equal(motion.state.mode,'walk');assert.ok(motion.state.x<10);assert.ok(Math.abs(motion.state.z-30)<8,'uses nearby bank rather than the old dock');
});
test('refresh claiming is idempotent and hides exactly the saved original once',()=>{
 const original=item('hoverboard'),src=source([original]),motion=createPlayerMotion({route}),transport=createTransportInteraction({motion,sources:[src]});
 const saved={id:original.id,mode:'hoverboard'};assert.equal(transport.restore(saved),true);assert.equal(transport.restore(saved),true);assert.equal(src.calls.takes,1);assert.equal(original.taken,true);assert.equal(src.items.length,1);assert.deepEqual(transport.capture(),saved);
 assert.equal(transport.restore({id:'missing',mode:'hoverboard'}),false);assert.equal(src.calls.takes,1);
 motion.placeMode({x:original.x,z:original.z,yaw:0},'hoverboard');assert.equal(transport.dismount().ok,true);assert.equal(original.taken,false);assert.equal(src.items.length,1);
});
test('failed pickup of a moving scooter returns the live rider to simulation with the same identity',()=>{
 const sim=createCommuteSimulation(route,{seed:44,peakAgents:4,maxAgents:4,startMinutes:478,scooterShare:1,flowScale:0,laneChanging:false});const actor=sim.agents.find(a=>a.kind==='scooter');assert.ok(actor);
 const source=createScooterTransport({simulation:sim});const target=source.items.find(i=>i.record===actor);const obstacle={height:20,rings:[rect(actor.x-2,actor.z-2,actor.x+2,actor.z+2)]};
 const motion=createPlayerMotion({route,world:{buildings:[obstacle]},traffic:()=>sim.agents});const transport=createTransportInteraction({motion,sources:[source]});const before=sim.agents.length;
 assert.equal(transport.mount({item:target,source}).ok,false);assert.equal(sim.agents.length,before);assert.equal(sim.agents.filter(a=>a.id===actor.id).length,1);assert.equal(actor.active,true);assert.notEqual(actor.phase,'borrowed');assert.equal(source.parkedAgents.length,0);source.dispose();
});

for(const level of [.14,11.14])for(const mode of ['scooter','roadster'])test(`${mode} repeats pickup and exit ${level<1?'under':'on'} a viaduct without changing level or duplicating the parked vehicle`,()=>{
 const bridge={bridge:true,sourceId:'test/viaduct',surfaceY:11.14,polygon:rect(-10,-100,10,20)};
 const motion=createPlayerMotion({route:{...route,roadSurfaces:[bridge]}}),vehicle=item(mode,{y:level}),src=source([vehicle]);
 const transport=createTransportInteraction({motion,sources:[src]});
 for(let trip=0;trip<3;trip++){
   assert.equal(motion.placeWalker({x:vehicle.x+2,z:vehicle.z,y:level,yaw:0}).ok,true);
   assert.equal(transport.interact().ok,true);assert.equal(motion.state.mode,mode);
   assert.ok(Math.abs(motion.state.y-level)<.02);
   assert.deepEqual(transport.capture(),{id:vehicle.id,mode});
   advance(motion,1,{forward:1});advance(motion,1,{brake:true});
   const parked={x:motion.state.x,y:motion.state.y,z:motion.state.z,yaw:motion.state.yaw};
   assert.equal(transport.interact().ok,true,'F should allow a grounded exit on the current layer');
   assert.equal(motion.state.mode,'walk');assert.ok(Math.abs(motion.state.y-level)<.02);
   assert.ok(Math.hypot(motion.state.x-parked.x,motion.state.z-parked.z)<5);
   assert.equal(vehicle.taken,false);assert.equal(src.items.length,1);assert.equal(transport.capture(),null);
   for(const key of ['x','y','z','yaw'])assert.equal(vehicle[key],parked[key],`parked ${key} changed`);
 }
 assert.deepEqual(src.calls,{takes:3,releases:3,restores:0});
});

test('dismount resolves a stale source exit height on the current layer without modifying the stored candidate',()=>{
 const bridge={bridge:true,sourceId:'test/viaduct',surfaceY:11.14,polygon:rect(-10,-100,10,20)},motion=createPlayerMotion({route:{...route,roadSurfaces:[bridge]}});
 const vehicle=item('scooter'),src=source([vehicle]),stored={x:4,z:0,y:11.14,yaw:0};
 src.getDismountCandidates=()=>[stored];
 const transport=createTransportInteraction({motion,sources:[src]});assert.equal(transport.mount({item:vehicle,source:src}).ok,true);
 assert.equal(transport.dismount().ok,true);assert.equal(motion.state.x,stored.x);assert.equal(motion.state.z,stored.z);
 assert.equal(motion.state.y,.14,'an old boarding height must not teleport the player onto the viaduct');
 assert.equal(stored.y,11.14,'source-owned candidate remains untouched');
});

test('a boat below a high bridge can cross its water exit corridor to the nearby dry bank',()=>{
 const bridge={bridge:true,sourceId:'test/viaduct',surfaceY:11.14,polygon:rect(-10,-100,30,100)},water={id:'lake',surfaceY:.022,rings:[rect(10,-100,100,100)]};
 const motion=createPlayerMotion({route:{...route,roadSurfaces:[bridge]},world:{water:[water]}}),boat=item('boat',{x:12.2,z:0,y:.022,boardingPose:{x:8,z:0,y:.14,yaw:0}}),src=source([boat]);
 src.getDismountCandidates=i=>[{...i.boardingPose}];const transport=createTransportInteraction({motion,sources:[src]});
 assert.equal(motion.placeWalker(boat.boardingPose).ok,true);assert.equal(transport.mount().ok,true);
 assert.equal(motion.state.mode,'boat');assert.equal(motion.state.y,.022);
 assert.equal(transport.dismount().ok,true);assert.equal(motion.state.mode,'walk');
 assert.equal(motion.state.x,8);assert.equal(motion.state.y,.14);assert.equal(boat.taken,false);
});
