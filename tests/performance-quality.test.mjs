import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceQuality,createWorkCadence} from '../src/performance-quality.js';

function run(quality,ms,frame=1000/60,extra={}){
  for(let t=0;t<ms;t+=frame)quality.update({elapsedMs:frame,...extra});
  return quality.budget;
}

test('auto starts conservatively for desktop and known weak devices without exceeding native pixels',()=>{
  const desktop=createPerformanceQuality({deviceRatio:2,width:1920,height:1080});
  assert.equal(desktop.budget.name,'均衡');assert.equal(desktop.budget.reflectionEnabled,false);
  assert.ok(desktop.budget.pixelRatio<1);assert.equal(desktop.budget.shadowMapSize,1024);
  for(const hint of [{handheld:true},{hardwareConcurrency:4},{deviceMemory:4}]){
    const q=createPerformanceQuality({deviceRatio:3,...hint});
    assert.equal(q.budget.level,0);assert.equal(q.budget.shadowEnabled,false);assert.equal(q.budget.trafficHz,15);
  }
  assert.equal(createPerformanceQuality({deviceRatio:.7}).budget.pixelRatio,.7);
  assert.equal(createPerformanceQuality({deviceRatio:NaN}).budget.pixelRatio,1);
});

test('standing still under sustained load reduces full render passes then pixels, including very slow devices',()=>{
  const q=createPerformanceQuality({deviceRatio:2});
  const low=run(q,2200,40,{cpuMs:26});
  assert.equal(low.level,0);assert.equal(low.shadowEnabled,false);assert.ok(low.detailDistanceScale<.7);
  const pixels=low.pixelRatio;
  const slow=run(q,4000,125,{cpuMs:70});
  assert.equal(slow.level,0);assert.ok(slow.pixelRatio<pixels,'8fps is useful pressure, not discarded as a background gap');
  assert.equal(slow.reflectionEnabled,false);assert.equal(slow.trafficHz,15);
  run(q,2000,1000/60,{cpuMs:4});assert.equal(q.budget.pixelRatio,slow.pixelRatio,'stopping cannot undo throttling after 1.2 seconds');
});

test('healthy recovery is slow, gradual and excludes invisible or paused time',()=>{
  const q=createPerformanceQuality({deviceRatio:2});run(q,2200,35);
  const low=q.budget;assert.equal(low.level,0);
  run(q,18000,1000/60,{cpuMs:4});assert.deepEqual(q.budget,low);
  run(q,60000,1000/60,{active:false});assert.deepEqual(q.budget,low);
  run(q,19000,1000/60,{cpuMs:4});assert.deepEqual(q.budget,low,'paused time resets accumulated healthy evidence');
  run(q,2200,1000/60,{cpuMs:4});assert.equal(q.budget.level,1);
  run(q,22000,1000/60,{cpuMs:4});assert.equal(q.budget.level,2);assert.equal(q.budget.reflectionEnabled,true);
  const phone=createPerformanceQuality({deviceRatio:3,handheld:true});
  run(phone,90000,1000/60,{cpuMs:3});assert.equal(phone.budget.level,1);assert.equal(phone.budget.reflectionEnabled,false);
});

test('loading gaps, background throttling and non-rendered idle samples cannot cause a downgrade',()=>{
  for(const ignored of [{visible:false},{active:false},{rendered:false}]){
    const q=createPerformanceQuality({deviceRatio:2});run(q,40000,100,ignored);assert.equal(q.budget.level,1);
  }
  const q=createPerformanceQuality({deviceRatio:2});run(q,2000);
  const before=q.budget;
  for(const elapsedMs of [5000,400,NaN,Infinity,0,-1])q.update({elapsedMs,cpuMs:70});
  assert.equal(q.budget,before);
  for(let i=0;i<5;i++){run(q,1000);q.update({elapsedMs:100,cpuMs:80});}
  assert.equal(q.budget.level,1,'isolated spikes are not sustained frame pressure');
});

test('intentional 30Hz cap and healthy 60Hz cannot be mistaken for frame pressure',()=>{
  const capped=createPerformanceQuality({deviceRatio:1});
  run(capped,12000,1000/30,{targetFrameMs:1000/30,cpuMs:8});assert.equal(capped.budget.level,1);
  const ordinary=createPerformanceQuality();run(ordinary,12000,1000/60,{cpuMs:7});assert.equal(ordinary.budget.level,1);
  const gpuBound=createPerformanceQuality();run(gpuBound,4000,40,{cpuMs:2});
  assert.equal(gpuBound.budget.level,0,'low CPU submission cost cannot hide GPU/driver pressure');
});

test('several consecutive visible sub-four-fps frames still trigger recovery while isolated load stalls do not',()=>{
  const q=createPerformanceQuality();const initial=q.budget;
  q.update({elapsedMs:500});q.update({elapsedMs:16});q.update({elapsedMs:500});q.update({elapsedMs:16});
  assert.equal(q.budget,initial);
  for(let i=0;i<3;i++)q.update({elapsedMs:500,cpuMs:80});
  assert.equal(q.budget.level,0);
  const low=q.budget;for(let i=0;i<3;i++)q.update({elapsedMs:500,visible:false});assert.equal(q.budget,low);
  for(let i=0;i<3;i++)q.update({elapsedMs:500});assert.ok(q.budget.pixelRatio<low.pixelRatio);
});

test('manual modes are explicit and native/viewport pixel caps apply at every quality',()=>{
  const q=createPerformanceQuality({mode:'clear',deviceRatio:2,width:3840,height:2160});
  assert.equal(q.budget.level,2);assert.ok(q.budget.pixelRatio**2*3840*2160<2810000);
  const preset=q.budget;run(q,10000,125);assert.equal(q.budget,preset,'manual selection is not silently overridden');
  q.setMode('smooth');assert.equal(q.budget.level,0);assert.equal(q.budget.shadowEnabled,false);
  const low=q.budget;q.setViewport(2160,3840);assert.equal(q.budget.pixelRatio,low.pixelRatio,'rotation preserves equivalent pixel cost');
  q.setViewport(NaN,0);assert.equal(q.budget.pixelRatio,low.pixelRatio);
  q.setMode('balanced');assert.equal(q.budget.level,1);
  q.setMode('auto');assert.equal(q.budget.mode,'auto');assert.equal(q.budget.level,1);
  q.setMode('unknown-saved-value');assert.equal(q.budget.mode,'auto');
  const phone=createPerformanceQuality({mode:'clear',deviceRatio:3,handheld:true});
  assert.equal(phone.budget.pixelRatio,1.25);assert.equal(phone.budget.reflectionEnabled,false);
});

test('quality snapshots remain referentially stable until an actual budget change',()=>{
  const q=createPerformanceQuality({width:1280,height:720});const initial=q.budget;
  run(q,3000,1000/60,{cpuMs:5});assert.equal(q.budget,initial);
  q.setMode('auto');assert.equal(q.budget,initial);
  q.setViewport(1280,720);assert.equal(q.budget,initial);
  q.setMode('smooth');assert.notEqual(q.budget,initial);assert.ok(q.budget.revision>initial.revision);
});

test('visual cadence bounds work frequency while preserving elapsed time and clearing frozen debt',()=>{
  const visual=createWorkCadence({hz:15});let calls=0,time=0;
  for(let i=0;i<60;i++){const dt=visual.step({elapsedMs:1000/60});if(dt){calls++;time+=dt;}}
  assert.equal(calls,15);assert.ok(Math.abs(time-1)<1e-8);
  const fractional=createWorkCadence({hz:24});let fractionalCalls=0,fractionalTime=0;
  for(let i=0;i<60;i++){const dt=fractional.step({elapsedMs:1000/60});if(dt){fractionalCalls++;fractionalTime+=dt;}}
  assert.equal(fractionalCalls,24);assert.ok(Math.abs(fractionalTime-1)<1e-8,'fractional cadence preserves actual elapsed time without double-counting phase');
  visual.step({elapsedMs:40});visual.step({elapsedMs:100,active:false});
  assert.equal(visual.step({elapsedMs:1000/60}),0,'resume does not replay suspended time');
  assert.equal(visual.step({elapsedMs:5000}),0);
  const tick=visual.step({elapsedMs:200,force:true});assert.equal(tick,.15,'visual work never catches up in an unbounded loop');
  visual.reset();assert.equal(visual.step({elapsedMs:16,hz:30}),0);
  assert.equal(visual.step({elapsedMs:20,hz:30}),.036);
});
