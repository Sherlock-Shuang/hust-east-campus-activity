import test from 'node:test';
import assert from 'node:assert/strict';
import {createScooterTransport} from '../src/scooter-transport.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
const route={points:[{x:0,y:.16,z:0},{x:0,y:.16,z:-100}],segments:[{startProgress:0,endProgress:100,width:8,mode:'ride'}],trafficSignals:[]};
const simulation=()=>createCommuteSimulation(route,{seed:44,peakAgents:4,maxAgents:4,startMinutes:478,scooterShare:1,flowScale:0,laneChanging:false});
test('parked scooter game copies never mutate source parking coordinates and cannot be taken twice',()=>{
 const parking=[{id:17,colorIndex:4,x:1,z:2,y:.16,yaw:.3}],before=structuredClone(parking),source=createScooterTransport({parking,simulation:{agents:[]}}),i=source.items[0];
 assert.equal(source.take(i).ok,true);assert.equal(source.parkedAgents.length,0);assert.equal(source.take(i).ok,false);assert.equal(source.release(i,{x:12,y:.14,z:8,yaw:.8}).ok,true);assert.equal(source.parkedAgents.length,1);assert.equal(source.items.length,1);assert.equal(source.items[0].x,12);assert.deepEqual(parking,before);
 assert.equal(source.nearest({x:12,y:.14,z:8}),i);assert.equal(source.nearest({x:12,y:8,z:8}),null);source.dispose();assert.equal(source.take(i).ok,false);
});
test('borrowing and returning a live scooter removes the rider exactly once and leaves one parked vehicle',()=>{
 const sim=simulation(),source=createScooterTransport({simulation:sim});const i=source.items.find(v=>v.origin==='traffic'),actor=i.record,before=sim.agents.length;
 assert.equal(source.take(i).ok,true);assert.equal(sim.agents.includes(actor),false);assert.equal(sim.agents.length,before-1);assert.equal(source.items.filter(v=>v.id===i.id).length,1);assert.equal(actor.phase,'borrowed');
 assert.equal(source.release(i,{x:12,y:.14,z:8,yaw:.8}).ok,true);assert.equal(source.parkedAgents.length,1);assert.equal(source.parkedAgents[0].id,actor.id);assert.equal(source.items.filter(v=>v.id===i.id).length,1);assert.equal(sim.agents.includes(actor),false);
 for(let n=0;n<3;n++){assert.equal(source.take(i).ok,true);assert.equal(source.parkedAgents.length,0);assert.equal(source.release(i,{x:15+n,y:.14,z:8,yaw:1}).ok,true);assert.equal(source.parkedAgents.length,1);}
 assert.equal(sim.agents.length,before-1);source.dispose();
});
test('cancelled live pickup restores simulation identity, population and candidate eligibility',()=>{
 const sim=simulation(),source=createScooterTransport({simulation:sim}),i=source.items.find(v=>v.origin==='traffic'),before=sim.agents.length,phase=i.record.phase;
 source.take(i);assert.equal(source.restore(i).ok,true);assert.equal(sim.agents.length,before);assert.equal(i.record.phase,phase);assert.equal(i.record.active,true);assert.equal(source.parkedAgents.length,0);assert.equal(source.items.find(v=>v.id===i.id),i);assert.equal(source.take(i).ok,true);source.restore(i);source.dispose();
});
test('ended riders cease being candidates while mounted and parked returns remain in the inventory',()=>{
 const sim=simulation(),source=createScooterTransport({simulation:sim}),i=source.items.find(v=>v.origin==='traffic');
 i.record.active=false;source.update();assert.equal(source.items.some(v=>v.id===i.id),false);assert.equal(source.take(i).ok,false);source.dispose();
});
