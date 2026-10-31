import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
import {createScooterTransport} from '../src/scooter-transport.js';
import {createResidentialTraffic,combineTrafficSources} from '../src/residential-traffic.js';
import {sampleResidentialTrafficPath} from '../src/residential-traffic-route.js';
const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
function fixture(t){const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,source,frame,geoToLocal),route=createCommuteRoute(source,{frame,geoToLocal}),flow=createResidentialTraffic({model,route,frame,geoToLocal});t.after(()=>{flow.dispose();model.dispose();});return{model,route,flow};}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

test('gate approach actors and eight southern canteen walkers follow continuous paths without adding population',t=>{
  const {flow}=fixture(t),initial=flow.getDiagnostics();assert.equal(initial.total,20);assert.deepEqual(initial.counts,{walk:14,scooter:6});
  const originalIds=new Set(['residential-road','residential-east-walk','residential-west-walk']);
  const gate=initial.agents.filter(a=>originalIds.has(a.pathId)),south=initial.agents.filter(a=>!originalIds.has(a.pathId));
  assert.deepEqual(gate.map(a=>a.id),Array.from({length:12},(_,i)=>-100001-i),'preserve original rider and walker identities');
  assert.equal(south.length,8);assert.ok(south.every(a=>a.kind==='walk'&&a.z>100),'new people are south by the canteens, not another gate population');
  assert.ok(initial.agents.every(a=>a.id<0&&a.contactMode==='independent'));
  const ids=flow.agents.map(a=>a.id),last=new Map(flow.agents.map(a=>[a.id,{...a}]));
  for(let n=0;n<1500;n++){
    flow.tick(.1);
    for(const a of flow.agents){
      assert.ok([a.x,a.y,a.z,a.yaw,a.speed,a.progress].every(Number.isFinite));
      assert.ok(dist(a,last.get(a.id))<=.39,'no endpoint teleport');
      const path=flow.plan.paths.find(p=>p.id===a.pathId),pose=sampleResidentialTrafficPath(path,a.pathDistance);
      assert.equal(a.x,pose.x);assert.equal(a.z,pose.z);assert.equal(a.y,pose.y+(a.kind==='scooter'?.021:0));
      last.set(a.id,{...a});
    }
    for(const a of flow.agents)for(const b of flow.agents)if(a!==b&&a.pathId===b.pathId){
      assert.ok(dist(a,b)>(a.kind==='walk'?.54:1.9),'independent streams and turns do not overlap');
    }
  }
  assert.deepEqual(flow.agents.map(a=>a.id),ids);assert.equal(flow.getDiagnostics().activeCount,20);
  for(const a of flow.agents)assert.ok(a.progress>initial.agents.find(b=>b.id===a.id).progress+140);
});

test('nearby player stops a rider and its queue, removal resumes, high flight does not block the road',t=>{
  const {flow}=fixture(t),a=flow.agents.find(a=>a.kind==='scooter'&&a.z>-20&&a.z<45),path=flow.plan.paths.find(p=>p.id===a.pathId);
  assert.ok(a);const p=sampleResidentialTrafficPath(path,a.pathDistance+9),obstacle={...p,mode:'walk',grounded:true};
  let minimum=Infinity;
  for(let i=0;i<200;i++){flow.tick(.1,obstacle);minimum=Math.min(minimum,dist(a,obstacle));}
  assert.ok(minimum>1.3,'rider cannot run into the player');assert.ok(a.speed<.15,'rider yields');assert.ok(a.footDown>.9);assert.ok(a.braking);
  const before=a.progress;for(let i=0;i<40;i++)flow.tick(.1,{...obstacle,y:30,mode:'helicopter'});
  assert.ok(a.progress>before+5,'high overhead helicopter does not block ground flow');
});

test('southern canteen pedestrians yield at the door approach and resume when the player leaves',t=>{
  const {flow}=fixture(t),a=flow.agents.find(a=>a.kind==='walk'&&a.z>100);
  assert.ok(a,'a real southern canteen walker exists');
  const path=flow.plan.paths.find(p=>p.id===a.pathId),obstacle={...sampleResidentialTrafficPath(path,a.pathDistance+2.3),mode:'walk'};
  let minimum=Infinity;
  for(let i=0;i<200;i++){flow.tick(.1,obstacle);minimum=Math.min(minimum,dist(a,obstacle));}
  assert.ok(minimum>.7,'walker must not enter the player at the canteen entrance');
  assert.ok(a.speed<.15,'walker waits instead of continuing its walk cycle through the player');
  const before=a.progress;for(let i=0;i<50;i++)flow.tick(.1);
  assert.ok(a.progress>before+1,'door approach flow resumes after player moves away');
});

test('returned parking is avoided, off-route parking is ignored, and hidden-time gaps are bounded',t=>{
  const {flow}=fixture(t),a=flow.agents.find(a=>a.kind==='scooter'&&a.z>-20&&a.z<45),path=flow.plan.paths.find(p=>p.id===a.pathId),parked={...sampleResidentialTrafficPath(path,a.pathDistance+10),active:true};
  let calls=0;const getParking=()=>{calls++;return [parked,{x:9999,z:9999,y:0,active:true}];};
  for(let i=0;i<1200;i++)flow.tick(1/60,null,getParking);
  assert.equal(calls,600,'parking only queried at 30 Hz');assert.ok(a.speed<.15);assert.ok(dist(a,parked)>2.05);
  const before=flow.getDiagnostics();flow.tick(0);flow.tick(NaN);assert.deepEqual(flow.getDiagnostics(),before);
  flow.tick(100);assert.ok(flow.getDiagnostics().elapsedSeconds-before.elapsedSeconds<.101);
});

test('combined pickup uses the same F adapter: borrow once, restore once, then return only one parked scooter',t=>{
  const {flow,route}=fixture(t),primary=createCommuteSimulation(route,{peakAgents:0,maxAgents:20,flowScale:0}),adapter=combineTrafficSources(primary,flow),transport=createScooterTransport({simulation:adapter});t.after(()=>transport.dispose());
  const a=flow.agents.find(a=>a.kind==='scooter'),before=adapter.agents;
  assert.equal(adapter.agents,before,'unchanged input reuses combined array');assert.equal(primary.agents.length,0);
  const item=transport.nearest({x:a.x,z:a.z,y:a.y-.021});assert.equal(item.record,a);assert.equal(transport.take(item).ok,true);assert.equal(adapter.agents.includes(a),false);assert.equal(transport.take(item).ok,false);
  assert.equal(transport.restore(item).ok,true);assert.equal(adapter.agents.filter(b=>b===a).length,1);assert.equal(transport.restore(item).ok,false);
  assert.equal(transport.take(item).ok,true);const pose={x:a.x+3,z:a.z+3,y:.14,yaw:a.yaw};assert.equal(transport.release(item,pose).ok,true);
  assert.equal(adapter.agents.includes(a),false);assert.equal(transport.parkedAgents.filter(b=>b.id===a.id).length,1);assert.equal(transport.parkedAgents.find(b=>b.id===a.id).phase,'parked');
  for(let i=0;i<100;i++)flow.tick(.1);assert.equal(flow.agents.length,19,'no automatic replacement of a borrowed rider');assert.equal(primary.agents.length,0);
});

test('primary traffic changes and leases remain independent; disposal is idempotent',t=>{
  const {flow,route}=fixture(t),primary=createCommuteSimulation(route,{peakAgents:10,maxAgents:10,scooterShare:1,flowScale:0}),adapter=combineTrafficSources(primary,flow),a=primary.agents.find(a=>a.kind==='scooter');
  assert.ok(a);const n=adapter.agents.length,lease=adapter.takeScooter(a);assert.ok(lease.ok);assert.equal(adapter.agents.length,n-1);assert.ok(adapter.restoreScooter(lease).ok);assert.equal(adapter.agents.length,n);
  primary.reset();assert.ok(primary.agents.every(a=>adapter.agents.includes(a)));assert.equal(adapter.signals,primary.signals);assert.deepEqual(adapter.getPoseAt(5),primary.getPoseAt(5));
  const branch=flow.agents.find(a=>a.kind==='scooter'),first=adapter.takeScooter(branch);assert.ok(adapter.restoreScooter(first).ok);const second=adapter.takeScooter(branch);
  assert.equal(adapter.restoreScooter(first).ok,false,'stale branch lease cannot enter primary traffic');assert.equal(primary.agents.includes(branch),false);assert.ok(adapter.restoreScooter(second).ok);
  flow.dispose();flow.dispose();assert.equal(flow.tick(.1),false);assert.deepEqual(flow.agents,[]);assert.equal(adapter.agents.length,primary.agents.length);
});
