import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCampusWaterMotion,campusSurfboardCell} from '../src/campus-water-motion.js';
import {createCampusSurfboards} from '../src/campus-surfboards.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {campusTsunamiFront} from '../src/campus-tsunami-timeline.js';
import {sampleCampusTsunami} from '../src/campus-tsunami.js';
const event={id:'test-wave',startAt:10000,pausedAt:null,pausedMs:0};
const flood=elapsed=>({id:event.id,...sampleCampusTsunami(event,event.startAt+elapsed*1000)});
function fixture(options={}){
  const state={x:1400,z:0,y:.16,mode:'walk',distance:0,speed:0,vx:0,vz:0,yaw:0};
  const water=createCampusWaterMotion({state,groundAt:()=>({height:.16}),...options});
  return {state,water,at(t){water.setFlood(flood(t));},run(start,seconds,input={}){for(let i=0;i<Math.round(seconds*120);i++){water.setFlood(flood(start+i/120));water.step(1/120,input);}}};
}
test('the horizon approach uses the same slow speed throughout the lead-in and crossing',()=>{
  for(const t of [-3,-1,0,1,10,30,100])assert.equal(campusTsunamiFront(t)-campusTsunamiFront(t+1),50);
  assert.ok(campusTsunamiFront(15)>755,'the first wave is still beyond the southern campus after fifteen seconds');
});
test('outdoor water supports passive buoyancy, deliberate diving and surfacing',()=>{
  const f=fixture();f.run(65,3);assert.equal(f.state.waterMode,'swim');assert.ok(Math.abs(f.state.y-(f.water.sample().waterY-1.15))<.6);
  const surface=f.state.y;f.run(68,1,{swimVertical:-1});assert.ok(f.state.y<surface-3);
  const submerged=f.state.y;f.run(69,1,{swimVertical:1});assert.ok(f.state.y>submerged+3);
  f.run(70,3,{swimVertical:1});assert.ok(f.state.y<=f.water.sample().waterY-.65+.001);
  f.water.setFlood(null);assert.equal(f.state.waterMode,'dry');
});
test('floating boards can be mounted nearby, move faster than swimming, and allow diving off',()=>{
  const f=fixture(),b=campusSurfboardCell(54,0);Object.assign(f.state,b);f.run(65,2);
  assert.equal(f.water.nearbyBoard()?.id,b.id);assert.equal(f.water.toggleBoard(),true);
  f.run(67,1,{moveX:1,fast:true});assert.equal(f.state.waterMode,'board');assert.ok(f.state.vx>23);
  assert.ok(Math.abs(f.state.y-f.water.sample().waterY-.16)<.2);
  f.run(68,.2,{swimVertical:-1});assert.equal(f.state.waterMode,'swim');assert.equal(f.water.boardId,null);
});
test('a two second catch window expires and late joiners cannot catch an old wave',()=>{
  const f=fixture();f.at(44.6);f.state.y=f.water.sample().waterY-1.15;f.water.step(1/120,{});
  assert.ok(f.state.surfWindowRemaining>1.99);
  f.at(46.61);assert.equal(f.water.surf(),false);assert.equal(f.state.surfWindowRemaining,0);
  const late=fixture();late.run(65,2);assert.equal(late.water.surf(),false);
});
test('surfing travels forward with the crest for five seconds, then keeps the player on the board',()=>{
  const f=fixture();f.at(44.6);f.state.y=f.water.sample().waterY-1.15;f.water.step(1/120,{});
  assert.equal(f.water.surf(),true);const start=f.state.z,phase=start-campusTsunamiFront(44.6);
  f.run(44.6,4.9);assert.equal(f.state.waterMode,'surf');assert.ok(Math.abs(f.state.z-start+245)<.01);
  assert.ok(Math.abs((f.state.z-campusTsunamiFront(49.5))-phase)<.01,'board stays at the same part of the advancing wave');
  const x=f.state.x;f.run(49.5,.1,{moveX:1});assert.ok(f.state.x>x+.45);
  f.at(49.61);f.water.step(1/120,{});assert.equal(f.state.waterMode,'board');assert.equal(f.state.surfRemaining,0);
  assert.equal(f.water.surf(),false,'the same crest cannot be caught twice');
});
test('pause freezes a ride and resetting the event cancels it',()=>{
  const f=fixture();f.at(44.6);f.state.y=f.water.sample().waterY-1.15;f.water.step(1/120,{});f.water.surf();
  f.water.setFlood({...flood(44.6),paused:true});const before={...f.state};for(let i=0;i<120;i++)f.water.step(1/120,{moveX:1});assert.deepEqual(f.state,before);
  f.water.setFlood({...flood(-3),id:'replacement'});assert.equal(f.state.waterMode,'dry');assert.equal(f.water.boardId,null);assert.equal(f.water.surf(),false);
});
test('a fast surfing step sweeps collisions instead of tunneling through an obstacle',()=>{
  const f=fixture({canOccupy:p=>p.z>-.25});f.at(44.6);f.state.y=f.water.sample().waterY-1.15;f.water.step(1/120,{});f.water.surf();
  f.water.step(.1,{});assert.ok(f.state.z>-.25);assert.equal(f.state.waterMode,'board');assert.equal(f.state.speed,0);
});
test('surfboards use a bounded instanced pool and dispose their shared resources once',()=>{
  const f=fixture(),scene=new THREE.Scene(),boards=createCampusSurfboards(THREE,scene,f.water);
  boards.update(f.state);assert.equal(boards.root.children.length,0);
  f.run(65,2);boards.update(f.state);const resources=new Set();boards.root.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);});
  const count=boards.root.children.length;for(let i=0;i<12;i++){f.state.x+=40;boards.update(f.state);assert.equal(boards.root.children.length,count);}
  const meshes=boards.root.children.filter(o=>o.isInstancedMesh);assert.equal(meshes.length,2);for(const m of meshes)assert.ok(m.count<=81);
  const disposed=new Map();for(const r of resources)r.addEventListener('dispose',()=>disposed.set(r,(disposed.get(r)||0)+1));
  boards.dispose();for(const r of resources)assert.equal(disposed.get(r),1);assert.equal(scene.children.length,0);
});
test('the ordinary player controller supports flooded returns and blocks water motion at buildings',()=>{
  const route={length:300,points:[{x:0,y:.16,z:0,progress:0},{x:0,y:.16,z:-300,progress:300}],segments:[{startProgress:0,endProgress:300,width:7.2}]};
  const player=createPlayerMotion({route,world:{buildings:[{height:18,rings:[[{x:2,z:-50},{x:5,z:-50},{x:5,z:50},{x:2,z:50}]]}],water:[],bounds:{minX:-100,maxX:100,minZ:-400,maxZ:100}}});
  for(let i=0;i<600;i++){player.campusWater.setFlood(flood(65+i/120));player.step(1/120,{moveX:1});}
  assert.equal(player.state.waterMode,'swim');assert.ok(player.state.x<1.74);assert.ok(player.state.y>5);
  const saved={...player.state};assert.equal(player.canRestorePose(saved,'walk').ok,true);assert.equal(player.restorePose(saved,'walk').ok,true);
  player.reset();assert.equal(player.state.waterMode,'dry');assert.equal(player.campusWater.boardId,null);
});
