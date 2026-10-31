import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CAMPUS_TSUNAMI_PLACEMENT,createCampusTsunami,sampleCampusTsunami} from '../src/campus-tsunami.js';
import {reconcileC118Flood} from '../src/c118-flood-state.js';

const event={id:'shared-campus-and-c118',startAt:103000,pausedAt:null,pausedMs:0};
const atSeconds=seconds=>event.startAt+seconds*1000;
function resources(group){
  const drawables=[],geometries=new Set(),materials=new Set(),textures=new Set();
  group.traverse(item=>{
    if(!item.isMesh&&!item.isPoints&&!item.isLine)return;
    drawables.push(item);if(item.geometry)geometries.add(item.geometry);
    for(const material of [].concat(item.material||[])){
      materials.add(material);
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
      for(const uniform of Object.values(material.uniforms||{})){
        for(const value of [].concat(uniform.value??[]))if(value?.isTexture)textures.add(value);
      }
    }
  });
  return {drawables,geometries,materials,textures};
}
function assertReused(before,after){
  for(const key of ['drawables','geometries','materials','textures']){
    const expected=new Set(before[key]),actual=new Set(after[key]);
    assert.equal(actual.size,expected.size,`${key} must not accumulate across event transitions`);
    for(const resource of actual)assert(expected.has(resource),`${key} must reuse the existing resource`);
  }
}
function assertFiniteUniforms(group){
  for(const material of resources(group).materials)for(const [name,uniform] of Object.entries(material.uniforms||{})){
    if(typeof uniform.value==='number')assert(Number.isFinite(uniform.value),`${name} must stay finite`);
  }
}
// Count the worst resident frame, including both crests even when one is
// currently hidden. Shared geometry is drawn once per mesh and once per
// instance; transparent double-sided passes also consume the GPU budget.
function gpuBudget(group){
  const drawables=resources(group).drawables;
  const total={drawables:drawables.length,drawCalls:0,vertices:0,triangles:0,sprayInstances:0};
  for(const item of drawables){
    const geometry=item.geometry,index=geometry.index,available=index?.count??geometry.attributes.position.count;
    const instances=item.isInstancedMesh?item.count:geometry.isInstancedBufferGeometry?geometry.instanceCount:1;
    assert(Number.isSafeInteger(instances)&&instances>=0,'instance count must have a finite upper bound');
    const drawStart=geometry.drawRange.start,drawEnd=Math.min(available,drawStart+geometry.drawRange.count);
    const ranges=Array.isArray(item.material)?geometry.groups.map(range=>({...range,material:item.material[range.materialIndex]})):[{start:0,count:available,material:item.material}];
    for(const range of ranges){
      const start=Math.max(drawStart,range.start),end=Math.min(drawEnd,range.start+range.count),count=Math.max(0,end-start);
      if(!count||!instances)continue;
      const material=range.material,passes=material.transparent&&material.side===THREE.DoubleSide&&!material.forceSinglePass?2:1;
      const referenced=index?new Set(Array.from({length:count},(_,offset)=>index.getX(start+offset))).size:count;
      total.drawCalls+=passes;
      total.vertices+=referenced*instances*passes;
      if(item.isMesh)total.triangles+=Math.floor(count/3)*instances*passes;
      if(item.name==='campus-tsunami-spray')total.sprayInstances+=instances*passes;
    }
  }
  return total;
}

test('the first wave crosses the whole playable campus instead of stopping outside it',()=>{
  assert.equal(sampleCampusTsunami(null,100000),null);
  const countdown=sampleCampusTsunami(event,100000),arrival=sampleCampusTsunami(event,103000),storm=sampleCampusTsunami(event,atSeconds(140));
  assert.equal(countdown.elapsed,-3);
  assert.equal(countdown.front,CAMPUS_TSUNAMI_PLACEMENT.farFront);
  assert.ok(countdown.firstFront>arrival.firstFront&&arrival.firstFront>storm.firstFront);
  assert.ok(countdown.height<arrival.height);
  assert.equal(arrival.firstFront,CAMPUS_TSUNAMI_PLACEMENT.shoreFront);
  assert.ok(storm.firstFront+CAMPUS_TSUNAMI_PLACEMENT.arcDepth<-3942,'even the curved wings have passed the northernmost playable boundary');
  for(const [seconds,z] of [[28,755],[45,0],[80,-1801],[125,-3942]]){
    const sample=sampleCampusTsunami(event,event.startAt+seconds*1000);
    assert.ok(sample.firstFront<z,`wave sweeps past ${z} at ${seconds}s`);
  }
  assert.equal(sampleCampusTsunami(event,300000).phase,'surging');
});

test('successive crests keep crossing after the first impact, while flooded ground stays wet',()=>{
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene()});
  try{
    for(const cycle of[0,1,20,100]){
      const a=sampleCampusTsunami(event,event.startAt+(cycle*CAMPUS_TSUNAMI_PLACEMENT.period+5)*1000),b=sampleCampusTsunami(event,event.startAt+(cycle*CAMPUS_TSUNAMI_PLACEMENT.period+8)*1000);
      assert.ok(a.waves[0].front>b.waves[0].front,'later crest advances north');
      effect.update({event,now:event.startAt+(cycle*CAMPUS_TSUNAMI_PLACEMENT.period+60)*1000});
      assert.ok(effect.sampleAt({x:0,y:1.8,z:0}).depth>5,'recycling crests cannot uncover the flooded campus');
    }
  }finally{effect.dispose();}
});

test('crest wraparound stays beyond the campus and never rolls the inundation front backward',()=>{
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene()});
  const {period,interval}=CAMPUS_TSUNAMI_PLACEMENT;
  try{
    for(const cycle of [1,2,20])for(const slot of [0,1]){
      const boundary=cycle*period+slot*interval-3;
      const samples=[-.001,0,.001].map(offset=>sampleCampusTsunami(event,atSeconds(boundary+offset)));
      assert(samples[0].firstFront>samples[1].firstFront&&samples[1].firstFront>samples[2].firstFront);
      assert.equal(samples[0].waves[slot].visible,false,'the outgoing crest has faded beyond the northern campus');
      assert.equal(samples[1].waves[slot].visible,false,'the replacement crest starts invisibly at the southern horizon');
      for(const offset of [-.001,0,.001]){
        effect.update({event,now:atSeconds(boundary+offset)});
        for(const position of [{x:1400,y:1.8,z:-3942},{x:-2900,y:1.8,z:-1000},{x:3500,y:1.8,z:755}]){
          const water=effect.sampleAt(position);
          assert.equal(water.fill,1,'an already flooded point cannot dry when a crest recycles');
          assert(water.depth>5);
        }
      }
    }
  }finally{effect.dispose();}
});

test('late joins, host pause and resume keep the exterior on the same authoritative phase',()=>{
  const paused=reconcileC118Flood({c118Flood:event},{c118Flood:event,paused:true},111000);
  assert.deepEqual(sampleCampusTsunami(paused,150000),sampleCampusTsunami(event,111000));
  const resumed=reconcileC118Flood({c118Flood:paused},{c118Flood:paused,paused:false},161000);
  assert.deepEqual(sampleCampusTsunami(resumed,166000),sampleCampusTsunami(event,116000));
  const scene=new THREE.Scene(),a=createCampusTsunami({THREE,scene}),b=createCampusTsunami({THREE,scene});
  try{
    a.update({event,now:103000});a.update({event:resumed,now:166000});
    b.update({event:resumed,now:166000});
    assert.deepEqual(a.sample,b.sample,'joining mid-event skips directly to the server phase');
    a.update({event:paused,now:200000,paused:true});
    const frozen=a.group.getObjectByName('campus-tsunami-wall').material.uniforms.uTime.value;
    assert.equal(a.update({event:paused,now:300000,paused:true}),false);
    assert.equal(a.group.getObjectByName('campus-tsunami-wall').material.uniforms.uTime.value,frozen);
  }finally{a.dispose();b.dispose();}
});

test('local pause freezes the last visible phase until the authoritative pause state arrives',()=>{
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene()});
  try{
    effect.update({event,now:atSeconds(5)});
    const sample=structuredClone(effect.sample),water=effect.sampleAt({x:1400,y:1.8,z:2500});
    assert.equal(effect.update({event,now:atSeconds(60),paused:true}),false);
    assert.deepEqual(effect.sample,sample);
    assert.deepEqual(effect.sampleAt({x:1400,y:1.8,z:2500}),water);
    assert.equal(effect.update({event,now:atSeconds(61),paused:true}),false);
    assert.equal(effect.update({event,now:atSeconds(62),paused:false}),true);
    assert.deepEqual(effect.sample,sampleCampusTsunami(event,atSeconds(62)));
  }finally{effect.dispose();}
});

test('no event builds nothing; entering a portal suspends the wave and returning catches up',()=>{
  const scene=new THREE.Scene(),effect=createCampusTsunami({THREE,scene});
  try{
    assert.equal(effect.update({event:null,now:100000}),false);
    assert.equal(effect.group.children.length,0,'no initial geometry or shader allocation');
    effect.update({event,now:108000});
    const mesh=effect.group.getObjectByName('campus-tsunami-wall'),time=mesh.material.uniforms.uTime.value;
    assert.equal(effect.update({event,now:109000,visible:false}),true);
    assert.equal(effect.active,false);
    assert.equal(effect.sampleAt({x:0,y:1.8,z:0}).wet,false,'portal interiors clear the exterior underwater state');
    assert.equal(effect.update({event,now:120000,visible:false}),false);
    assert.equal(mesh.material.uniforms.uTime.value,time,'an embedded report hall does not animate the hidden campus');
    effect.update({event,now:125000});assert.equal(effect.sample.elapsed,22);
    assert.equal(effect.update({event:null,now:126000}),true);
    assert.equal(effect.active,false);assert.equal(effect.sample,null);
    assert.equal(effect.update({event:null,now:127000}),false);
  }finally{effect.dispose();}
});

test('an event restart begins a fresh countdown and reuses all resident rendering resources',()=>{
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene()});
  try{
    effect.update({event,now:atSeconds(95)});
    const resident=resources(effect.group),position={x:1400,y:1.8,z:0};
    assert(effect.sampleAt(position).depth>5);
    const now=atSeconds(96),next={...event,id:'next-campus-wave',startAt:now+3000};
    assert.equal(effect.update({event:next,now}),true);
    assert.equal(effect.sample.elapsed,-3);
    assert.equal(effect.sample.firstFront,CAMPUS_TSUNAMI_PLACEMENT.farFront);
    assert.equal(effect.sampleAt(position).wet,false,'the new event must not inherit the old inundation');
    assertReused(resident,resources(effect.group));
    effect.update({event:next,now:next.startAt+60000});
    assert(effect.sampleAt(position).depth>5);
    assert.equal(effect.update({event:null,now:next.startAt+61000}),true);
    assert.equal(effect.active,false);assert.equal(effect.sample,null);
    assert.equal(effect.sampleAt(position).wet,false);
    assertReused(resident,resources(effect.group));
  }finally{effect.dispose();}
});

test('stopping while the campus is hidden cannot resurrect old waves or water on return',()=>{
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene()});
  try{
    effect.update({event,now:atSeconds(30)});
    const resident=resources(effect.group);
    assert.equal(effect.update({event,now:atSeconds(31),visible:false}),true);
    assert.equal(effect.update({event:null,now:atSeconds(32),visible:false}),false);
    assert.equal(effect.sample,null);assert.equal(effect.active,false);
    assert.equal(effect.update({event:null,now:atSeconds(33),visible:true}),false);
    assert.equal(effect.sampleAt({x:1400,y:1.8,z:0}).wet,false);
    const next={...event,id:'after-interior-return',startAt:atSeconds(37)};
    effect.update({event:next,now:atSeconds(34)});
    assert.equal(effect.sample.elapsed,-3);
    assert.equal(effect.sampleAt({x:1400,y:1.8,z:0}).wet,false);
    assertReused(resident,resources(effect.group));
  }finally{effect.dispose();}
});

test('changing reduced motion at an unchanged zero phase still requests a fresh paint',()=>{
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene()});
  try{
    effect.update({event,now:event.startAt,reducedMotion:false});
    const position={x:1400,y:1.8,z:2500},normal=effect.sampleAt(position);
    assert.equal(effect.update({event,now:event.startAt,reducedMotion:true}),true);
    assert.notEqual(effect.sampleAt(position).waterY,normal.waterY,'the reduced-motion surface actually changes');
    assert.equal(effect.update({event,now:event.startAt,reducedMotion:true}),false,'unchanged preferences and phase stay idle');
    assert.equal(effect.update({event,now:event.startAt,reducedMotion:false}),true);
    assert.deepEqual(effect.sampleAt(position),normal);
  }finally{effect.dispose();}
});

test('invalid clocks and malformed event times remain inactive without poisoning GPU uniforms',()=>{
  const invalid=[
    ...[NaN,Infinity,-Infinity,undefined].map(now=>({event,now})),
    ...[{}, {...event,startAt:NaN}, {...event,pausedAt:Infinity}, {...event,pausedMs:NaN}].map(event=>({event,now:103000})),
  ];
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene()});
  try{
    for(const input of invalid){
      assert.equal(sampleCampusTsunami(input.event,input.now),null);
      assert.equal(effect.update(input),false);
      assert.equal(effect.active,false);assert.equal(effect.sample,null);
      assert.equal(effect.group.children.length,0,'invalid input cannot allocate render resources');
    }
    effect.update({event,now:atSeconds(30)});
    const resident=resources(effect.group);
    assert.equal(effect.update({event,now:NaN}),true,'invalid input hides a previously visible effect');
    assert.equal(effect.active,false);assert.equal(effect.sample,null);
    assert.equal(effect.sampleAt({x:1400,y:1.8,z:0}).wet,false);
    assertFiniteUniforms(effect.group);
    assert.equal(effect.update({event,now:atSeconds(31)}),true);
    assert.deepEqual(effect.sample,sampleCampusTsunami(event,atSeconds(31)));
    assertReused(resident,resources(effect.group));
  }finally{effect.dispose();}
});

test('waves and water keep a fixed world frame and dispose every unique resource exactly once',()=>{
  const scene=new THREE.Scene(),effect=createCampusTsunami({THREE,scene});
  effect.update({event,now:110000});
  const original=effect.group.position.clone();
  const resident=resources(effect.group);
  assert(resident.drawables.length>0);
  assert([...resident.materials].every(material=>!material.fog));
  assert(resident.drawables.every(item=>!item.castShadow));
  effect.group.updateMatrixWorld();
  assert.equal(effect.group.getObjectByName('campus-floodwater').getWorldPosition(new THREE.Vector3()).x,1400,'water is not translated twice');
  const disposals=new Map([...resident.geometries,...resident.materials,...resident.textures].map(resource=>[resource,0]));
  for(const resource of disposals.keys())resource.addEventListener('dispose',()=>disposals.set(resource,disposals.get(resource)+1));
  effect.update({event,now:700000});assert.deepEqual(effect.group.position,original);
  assertReused(resident,resources(effect.group));
  effect.dispose();effect.dispose();
  for(const [resource,count] of disposals)assert.equal(count,1,`${resource.type} ${resource.uuid} must be disposed exactly once`);
  assert.equal(scene.children.length,0);assert.equal(effect.group.children.length,0);
  assert.equal(effect.active,false,'a disposed effect cannot leave a visible HUD with a null sample');
  assert.equal(effect.sample,null);
  assert.equal(effect.sampleAt({x:1400,y:1.8,z:0}).wet,false);
  assert.equal(effect.update({event,now:800000}),false,'a disposed effect cannot recreate resources');
  assert.equal(effect.group.children.length,0);
});

test('quality budgets include every indexed triangle, instanced spray quad and rendering pass',t=>{
  const limits={
    desktop:{vertices:75000,triangles:115000,sprayInstances:2200},
    mobile:{vertices:40000,triangles:60000,sprayInstances:960},
    low:{vertices:22000,triangles:33000,sprayInstances:440},
  };
  let previous;
  for(const [quality,limit] of Object.entries(limits)){
    const effect=createCampusTsunami({THREE,scene:new THREE.Scene(),quality});
    try{
      assert.equal(effect.group.children.length,0,`${quality} stays lazy before an event`);
      effect.update({event,now:atSeconds(23)});
      const measured=gpuBudget(effect.group),resident=resources(effect.group);
      assert(measured.drawables>0&&measured.drawables<=9,`${quality}: ${measured.drawables} drawables`);
      assert(measured.drawCalls<=9,`${quality}: transparent passes must fit the draw-call budget`);
      for(const key of ['vertices','triangles','sprayInstances']){
        assert(measured[key]>0&&measured[key]<=limit[key],`${quality}: ${measured[key]} ${key} exceeds ${limit[key]}`);
      }
      const unexpandedVertices=resident.drawables.reduce((sum,item)=>sum+item.geometry.attributes.position.count,0);
      assert(measured.vertices>unexpandedVertices,'instanced quads cannot be counted as one four-vertex sprite');
      if(previous)for(const key of ['vertices','triangles','sprayInstances'])assert(measured[key]<previous[key],`${quality} must reduce actual ${key}`);
      previous=measured;
      effect.update({event,now:atSeconds(7200)});
      assert.deepEqual(gpuBudget(effect.group),measured,'long events cannot grow rendering work');
      assertReused(resident,resources(effect.group));
      t.diagnostic(`${quality}: ${JSON.stringify(measured)}`);
    }finally{effect.dispose();}
  }
});

test('all quality levels share exactly the same water samples and authoritative clock',()=>{
  const effects=['desktop','mobile','low'].map(quality=>createCampusTsunami({THREE,scene:new THREE.Scene(),quality}));
  const positions=[
    {x:1400,y:1.8,z:-3942},{x:-2900,y:1.8,z:-1000},{x:3500,y:1.8,z:755},
    {x:1400,y:1.8,z:1225},{x:1400,y:12,z:2500},{x:5901,y:1.8,z:2500},
  ];
  const paused=reconcileC118Flood({c118Flood:event},{c118Flood:event,paused:true},atSeconds(8));
  const resumed=reconcileC118Flood({c118Flood:paused},{c118Flood:paused,paused:false},atSeconds(108));
  const restart={...event,id:'quality-restart',startAt:atSeconds(200)+3000};
  const inputs=[
    ...[-3,0,1.5,5,23,36.999,37,37.001,3600].map(seconds=>({event,now:atSeconds(seconds)})),
    {event:paused,now:atSeconds(100),paused:true},
    {event:resumed,now:atSeconds(113)},
    {event:resumed,now:atSeconds(114),reducedMotion:true},
    {event:restart,now:atSeconds(200)},
    {event:restart,now:atSeconds(225)},
    {event:null,now:atSeconds(226)},
  ];
  try{
    let resident;
    for(const input of inputs){
      const expected=sampleCampusTsunami(input.event,input.now);
      for(const effect of effects){
        effect.update(input);assert.deepEqual(effect.sample,expected);
        if(expected){
          const clocks=new Set([...resources(effect.group).materials].filter(material=>material.uniforms?.uTime).map(material=>material.uniforms.uTime.value));
          assert.deepEqual(clocks,new Set([input.reducedMotion?0:expected.elapsed]),'wave and water shaders use the same clock at every quality');
        }
      }
      resident??=effects.map(effect=>resources(effect.group));
      for(const position of positions){
        const expectedWater=effects[0].sampleAt(position);
        for(const effect of effects.slice(1))assert.deepEqual(effect.sampleAt(position),expectedWater,'quality changes tessellation and spray density, never water height or arrival');
      }
      effects.forEach((effect,index)=>assertReused(resident[index],resources(effect.group)));
    }
  }finally{effects.forEach(effect=>effect.dispose());}
});

test('live quality changes preserve the current water and clock while retiring every old resource once',()=>{
  const scene=new THREE.Scene(),effect=createCampusTsunami({THREE,scene}),position={x:1400,y:1.8,z:0};
  const disposals=new Map();
  const owned=resident=>[...resident.geometries,...resident.materials,...resident.textures];
  function watch(){
    const resident=resources(effect.group);
    for(const resource of owned(resident))if(!disposals.has(resource)){
      disposals.set(resource,0);resource.addEventListener('dispose',()=>disposals.set(resource,disposals.get(resource)+1));
    }
    return resident;
  }
  const clocks=resident=>new Set([...resident.materials].filter(material=>material.uniforms?.uTime).map(material=>material.uniforms.uTime.value));
  function switchTo(next){
    const previous=watch(),sample=effect.sample,water=effect.sampleAt(position),times=clocks(previous),placement=effect.group.position.clone();
    assert.equal(effect.setQuality(next),true);
    assert.equal(effect.sample,sample,'changing quality must not resample or rewind the event');
    assert.deepEqual(effect.sampleAt(position),water,'the water level is preserved immediately, before the next animation update');
    assert.deepEqual(effect.group.position,placement);assert.equal(effect.active,true);
    const current=watch();assert(current.drawables.length>0);
    assert.deepEqual(clocks(current),times,'rebuilt shaders inherit the existing paused or reduced-motion clock');
    for(const resource of owned(previous))assert.equal(disposals.get(resource),1,'every retired unique resource is disposed once');
    for(const resource of owned(current))assert.equal(disposals.get(resource),0,'new resources remain resident');
    assert.equal(effect.setQuality(next),false,'reselecting the same normalized quality cannot rebuild');
    assertReused(current,watch());
    return current;
  }
  try{
    effect.update({event,now:atSeconds(30)});watch();
    const desktop=gpuBudget(effect.group);
    const paused=reconcileC118Flood({c118Flood:event},{c118Flood:event,paused:true},atSeconds(30));
    for(const input of [{event,now:atSeconds(30)},{event:paused,now:atSeconds(100),paused:true},{event:paused,now:atSeconds(200),paused:true,reducedMotion:true}]){
      effect.update(input);watch();
      for(const quality of ['mobile','low','desktop']){
        const current=switchTo(quality);
        effect.update(input);assertReused(current,watch());
      }
    }
    for(const unsupported of ['unrecognized','toString','constructor','__proto__',undefined]){
      switchTo('low');switchTo(unsupported);
      assert.deepEqual(gpuBudget(effect.group),desktop,`${String(unsupported)} must normalize to the desktop budget`);
    }
  }finally{effect.dispose();effect.dispose();}
  for(const [resource,count] of disposals)assert.equal(count,1,`${resource.type} ${resource.uuid} must be released exactly once across all replacements`);
  assert.equal(effect.setQuality('mobile'),false);assert.equal(scene.children.length,0);
});

test('quality changes stay lazy without a visible event and cannot allocate after disposal',()=>{
  const allocations={geometries:0,materials:0};
  const trackedThree={...THREE,
    PlaneGeometry:class extends THREE.PlaneGeometry{constructor(...args){super(...args);allocations.geometries++;}},
    InstancedBufferGeometry:class extends THREE.InstancedBufferGeometry{constructor(...args){super(...args);allocations.geometries++;}},
    ShaderMaterial:class extends THREE.ShaderMaterial{constructor(...args){super(...args);allocations.materials++;}},
  };
  const effect=createCampusTsunami({THREE:trackedThree,scene:new THREE.Scene()});
  try{
    for(const quality of ['mobile','low','desktop'])assert.equal(effect.setQuality(quality),true);
    assert.deepEqual(allocations,{geometries:0,materials:0});
    assert.equal(effect.update({event:null,now:atSeconds(20)}),false);
    assert.equal(effect.group.children.length,0);assert.equal(effect.sample,null);
    effect.update({event,now:atSeconds(30)});
    assert(allocations.geometries>0&&allocations.materials>0);
    const builtCounts={...allocations},sample=effect.sample;
    effect.update({event,now:atSeconds(31),visible:false});
    for(const quality of ['mobile','low'])assert.equal(effect.setQuality(quality),true);
    assert.equal(effect.sample,sample,'the hidden event checkpoint is retained until the next visible update');
    assert.equal(effect.active,false);assert.equal(effect.group.children.length,0);
    assert.deepEqual(allocations,builtCounts,'hidden quality changes release old resources without rebuilding offscreen');
    effect.update({event:null,now:atSeconds(32),visible:false});
    assert.equal(effect.setQuality('mobile'),true);assert.equal(effect.sample,null);
    assert.deepEqual(allocations,builtCounts,'no-event quality changes remain allocation-free');
    effect.update({event,now:atSeconds(50)});
    assert.deepEqual(effect.sample,sampleCampusTsunami(event,atSeconds(50)),'returning uses the current event clock, not the hidden checkpoint');
    assert(effect.sampleAt({x:1400,y:1.8,z:0}).depth>5);
    const resumedCounts={...allocations};assert(resumedCounts.geometries>builtCounts.geometries);
    effect.update({event:null,now:atSeconds(51)});
    assert.equal(effect.setQuality('desktop'),true);
    assert.equal(effect.group.children.length,0);assert.deepEqual(allocations,resumedCounts,'a stopped event must not rebuild for a quality preference');
    effect.dispose();
    for(const quality of ['desktop','mobile','low','unknown'])assert.equal(effect.setQuality(quality),false);
    assert.equal(effect.update({event,now:atSeconds(60)}),false);
    assert.deepEqual(allocations,resumedCounts);assert.equal(effect.group.children.length,0);
  }finally{effect.dispose();}
});
