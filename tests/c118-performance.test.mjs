import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createC118Performance} from '../src/c118-performance.js';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {createC118FloodEffect} from '../src/c118-flood-effect.js';
import {createC118Audience} from '../src/c118-audience.js';

const plan=planOptoC118Interior();
const budgetFor=mode=>createC118Performance({mode,deviceRatio:3,width:1920,height:1080}).budget;
const moving=audience=>audience.group.children.filter(mesh=>mesh.name.startsWith('c118-audience-moving-'));

test('hall budgets cap high-DPI pixels and reduce only visual work under sustained pressure',()=>{
  const quality=createC118Performance({deviceRatio:3,handheld:true,width:2532,height:1170});
  assert.equal(quality.budget.level,0);
  assert.ok(2532*1170*quality.budget.pixelRatio**2<805000);
  const before=quality.budget.pixelRatio;
  for(let i=0;i<80;i++)quality.update({elapsedMs:100,cpuMs:70,active:true,rendered:true});
  assert.ok(quality.budget.pixelRatio<before);assert.equal(quality.budget.audienceHz,15);
  const pressured=quality.budget;
  for(let i=0;i<500;i++)quality.update({elapsedMs:500,cpuMs:0,active:false,rendered:false});
  assert.equal(quality.budget,pressured,'background and paused samples do not invent performance pressure');
  quality.setMode('balanced');assert.equal(quality.budget.audienceHz,20);
  quality.setMode('clear');assert.equal(quality.budget.audienceHz,25);
});

test('each water quality keeps identical event sampling and door topology while reducing submitted work',()=>{
  const effect=createC118FloodEffect(THREE,{plan});
  const sampled=effect.sampleAt({x:3,z:2,y:2},33.1),doors=JSON.stringify(effect.group.userData.doors);
  const counts=[];
  for(const level of[2,0,1,2]){
    effect.setPerformanceBudget({level});effect.update({active:true,elapsed:33.1});
    assert.deepEqual(effect.sampleAt({x:3,z:2,y:2},33.1),sampled);
    assert.equal(JSON.stringify(effect.group.userData.doors),doors);
    counts.push(effect.group.children.filter(o=>o.isMesh).reduce((sum,o)=>sum+o.geometry.index.count/3,0));
    const spray=effect.group.getObjectByName('c118-door-spray');
    const visible=Math.min(spray.geometry.drawRange.count,spray.geometry.attributes.position.count);
    assert.equal(visible,[128,320,640][level]);
  }
  assert.ok(counts[1]<counts[0]*.2,'smooth water uses less than one fifth of original triangles');
  assert.ok(counts[2]<counts[0]*.4);assert.equal(counts[3],counts[0]);
  effect.dispose();
});

test('quality transitions keep only current water meshes and dispose each replaced allocation once',()=>{
  const effect=createC118FloodEffect(THREE,{plan}),tracked=new Map();
  const track=()=>effect.group.traverse(o=>{if(o.geometry&&!tracked.has(o.geometry)){const value={count:0};tracked.set(o.geometry,value);o.geometry.addEventListener('dispose',()=>value.count++);}});
  track();
  for(const level of[0,1,0,2,2,1]){effect.setPerformanceBudget({level});track();}
  const live=new Set();effect.group.traverse(o=>{if(o.geometry)live.add(o.geometry);});
  assert.equal(live.size,3,'one water surface, one shared jet mesh and spray remain');
  for(const [geometry,state] of tracked)assert.equal(state.count,live.has(geometry)?0:1);
  effect.dispose();effect.dispose();for(const state of tracked.values())assert.equal(state.count,1);
});

test('NPC quality lowers pose updates and dry uploads contain only the actual aisle walkers',()=>{
  const audience=createC118Audience(THREE,{plan});audience.setPerformanceBudget(budgetFor('smooth'));
  let updates=0;
  for(let i=0;i<600;i++)updates+=Number(audience.update({time:1000+i/60}));
  assert.ok(updates>=149&&updates<=151);
  let bytes=0,allocated=0;
  for(const mesh of moving(audience)){
    allocated+=mesh.instanceMatrix.array.byteLength;
    if(!mesh.count)continue;
    const ranges=mesh.instanceMatrix.updateRanges;
    assert.deepEqual(ranges,[{start:0,count:mesh.count*16}]);
    bytes+=ranges.reduce((sum,range)=>sum+range.count*4,0);
  }
  assert.ok(bytes<allocated*.1,'dry animation uploads less than 10% of reserved full-room matrices');
  const full=createC118Audience(THREE,{plan});
  audience.update({time:1033.1,elapsed:33.1});full.update({time:1033.1,elapsed:33.1});
  for(let i=0;i<moving(audience).length;i++){
    const a=moving(audience)[i],b=moving(full)[i];assert.equal(a.count,b.count);
    assert.deepEqual(a.instanceMatrix.array.subarray(0,a.count*16),b.instanceMatrix.array.subarray(0,b.count*16),'the same event time has the same pose on all quality levels');
  }
  let instanceDisposals=0;audience.group.traverse(o=>{if(o.isInstancedMesh)o.addEventListener('dispose',()=>instanceDisposals++);});
  const instanceCount=audience.group.children.length;audience.dispose();audience.dispose();assert.equal(instanceDisposals,instanceCount);full.dispose();
});
