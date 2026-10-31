import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCampusTsunami,mountCampusTsunamiNotice} from '../src/campus-tsunami.js';
import {reconcileC118Flood} from '../src/c118-flood-state.js';

const event={id:'notice-flood',startAt:103000,pausedAt:null,pausedMs:0};
const atSeconds=seconds=>event.startAt+seconds*1000;
function element(){
  return {
    children:[],style:{},dataset:{},attributes:new Map(),queries:new Map(),parentNode:null,
    setAttribute(name,value){this.attributes.set(name,String(value));},
    append(child){child.parentNode=this;this.children.push(child);},
    querySelector(selector){if(!this.queries.has(selector)){const child=element();this.queries.set(selector,child);this.append(child);}return this.queries.get(selector);},
    remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}},
  };
}
function fogValues(fog){
  return fog?{color:fog.color.toArray(),near:fog.near,far:fog.far,density:fog.density,name:fog.name}:null;
}
function fixture(t,originalFog=new THREE.Fog('#cbd6d6',480,2900)){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>element()}});
  const root=element(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();scene.fog=originalFog;
  camera.position.set(1400,1.8,0);
  const effect=createCampusTsunami({THREE,scene,quality:'low'});
  const controller=mountCampusTsunamiNotice({THREE,root,camera,effect,scene});
  const wash=root.children.find(node=>node.className==='campus-tsunami-wash');
  const notice=root.children.find(node=>node.className==='campus-tsunami-notice');
  const originalValues=fogValues(originalFog);
  t.after(()=>{
    controller.dispose();effect.dispose();
    if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;
  });
  const update=(input={},options={})=>{effect.update({event,now:atSeconds(60),...input});controller.update(options);};
  return {root,scene,camera,effect,controller,wash,notice,originalFog,originalValues,update};
}
function assertOriginal(f){
  assert.equal(f.scene.fog,f.originalFog,'restore the original fog object, not a replacement with similar values');
  assert.deepEqual(fogValues(f.originalFog),f.originalValues,'the original fog parameters must never be mutated');
}

test('mounting and repeated inactive updates leave the original scene fog untouched',t=>{
  const f=fixture(t);
  assertOriginal(f);
  for(const options of [{},{paused:true},{reducedMotion:true}]){
    f.update({event:null},options);
    assertOriginal(f);assert.equal(f.wash.hidden,true);assert.equal(f.notice.hidden,true);
  }
  assert.equal(f.effect.group.children.length,0,'the notice must not cause an inactive wave to allocate rendering resources');
});

test('the approaching crest adds mist before inundation and restores it when the crest is distant',t=>{
  const f=fixture(t);f.camera.position.set(1400,1.8,1950);
  f.update({now:event.startAt});
  assert.equal(f.effect.sampleAt(f.camera.position).wet,false,'this checks the approaching crest, not underwater fog');
  assert.notEqual(f.scene.fog,f.originalFog);
  assert(f.scene.fog.far<f.originalFog.far);
  assert.equal(f.wash.hidden,false);assert.equal(f.wash.dataset.submerged,'false');
  assert(Number(f.wash.style.opacity)>0);
  assert.deepEqual(fogValues(f.originalFog),f.originalValues);
  f.camera.position.z=-1000;f.controller.update();
  assertOriginal(f);assert.equal(f.wash.hidden,true);
});

test('leaving water, hiding the campus, stopping the event and disposing the effect all restore the original fog',t=>{
  const f=fixture(t);
  for(const transition of ['leave-water','hide-campus','stop-event','dispose-effect']){
    f.camera.position.set(1400,1.8,0);f.update();
    assert(f.effect.sampleAt(f.camera.position).depth>5);
    assert.notEqual(f.scene.fog,f.originalFog);
    assert.equal(f.wash.dataset.submerged,'true');assert.equal(f.wash.hidden,false);
    assert(f.scene.fog.near<f.originalFog.near&&f.scene.fog.far<f.originalFog.far);
    if(transition==='leave-water')f.camera.position.y=30;
    if(transition==='hide-campus')f.effect.update({event,now:atSeconds(61),visible:false});
    if(transition==='stop-event')f.effect.update({event:null,now:atSeconds(61)});
    if(transition==='dispose-effect')f.effect.dispose();
    f.controller.update();
    assertOriginal(f);assert.equal(f.wash.hidden,true,transition);
    if(transition!=='leave-water')assert.equal(f.notice.hidden,true,transition);
  }
});

test('authoritative pause freezes fog and wash while resume advances their shared water state',t=>{
  const f=fixture(t);
  const paused=reconcileC118Flood({c118Flood:event},{c118Flood:event,paused:true},atSeconds(60.2));
  f.update({event:paused,now:atSeconds(61),paused:true},{paused:true});
  const fog=f.scene.fog,values=fogValues(fog),opacity=f.wash.style.opacity,water=f.effect.sampleAt(f.camera.position);
  assert.notEqual(fog,f.originalFog);assert.equal(f.notice.hidden,true);
  for(const seconds of [62,100,1000]){
    f.update({event:paused,now:atSeconds(seconds),paused:true},{paused:true});
    assert.equal(f.scene.fog,fog);assert.deepEqual(fogValues(f.scene.fog),values);
    assert.equal(f.wash.style.opacity,opacity);assert.deepEqual(f.effect.sampleAt(f.camera.position),water);
  }
  const resumed=reconcileC118Flood({c118Flood:paused},{c118Flood:paused,paused:false},atSeconds(1000));
  f.update({event:resumed,now:atSeconds(1000.8)});
  assert.equal(f.notice.hidden,false);assert(f.effect.sample.elapsed>60.2);
  assert.notEqual(f.wash.style.opacity,opacity,'the fog/wash continues from the resumed event, not a separate animation clock');
  f.update({event:null},{paused:true});assertOriginal(f);assert.equal(f.wash.hidden,true,'a stop still clears the scene during a global pause');
});

test('reduced motion skips the crest impact flash while preserving underwater visibility cues',t=>{
  const f=fixture(t);f.camera.position.set(1400,1.8,1950);
  f.update({now:event.startAt});assert.notEqual(f.scene.fog,f.originalFog);assert.equal(f.wash.hidden,false);
  f.update({now:event.startAt,reducedMotion:true},{reducedMotion:true});
  assertOriginal(f);assert.equal(f.wash.hidden,true);
  f.camera.position.set(1400,1.8,0);
  f.update({now:atSeconds(60),reducedMotion:true},{reducedMotion:true});
  assert.notEqual(f.scene.fog,f.originalFog);assert.equal(f.wash.hidden,false);
  assert.equal(f.wash.dataset.submerged,'true');assert(Number(f.wash.style.opacity)>0);
});

for(const [name,makeFog] of [['no fog',()=>null],['exponential fog',()=>new THREE.FogExp2('#a1b5b0',.0008)]]){
  test(`immersion restores the exact original ${name} configuration`,t=>{
    const f=fixture(t,makeFog());f.update();
    assert.notEqual(f.scene.fog,f.originalFog);assert.equal(f.scene.fog.isFog,true);
    assert.deepEqual(fogValues(f.originalFog),f.originalValues);
    f.update({event:null});assertOriginal(f);
  });
}

test('a newer fog owner survives a direct stop or notice disposal',t=>{
  const f=fixture(t);f.update();
  const replacement=new THREE.Fog('#403f58',7,410),values=fogValues(replacement);f.scene.fog=replacement;
  f.update({event:null});
  assert.equal(f.scene.fog,replacement);assert.deepEqual(fogValues(replacement),values);
  f.update();
  const latest=new THREE.FogExp2('#737a8b',.0014),latestValues=fogValues(latest);f.scene.fog=latest;
  f.controller.dispose();f.controller.dispose();
  assert.equal(f.scene.fog,latest);assert.deepEqual(fogValues(latest),latestValues);
  assert.equal(f.root.children.length,0);
});

test('a newer fog owner is not lost after another active update and subsequent restoration',t=>{
  const f=fixture(t);f.update();
  const replacement=new THREE.Fog('#403f58',7,410),values=fogValues(replacement);f.scene.fog=replacement;
  f.update({now:atSeconds(61)});
  f.update({event:null,now:atSeconds(62)});
  assert.equal(f.scene.fog,replacement,'restore must preserve the newer module configuration after continued tsunami updates');
  assert.deepEqual(fogValues(replacement),values);
  assert.deepEqual(fogValues(f.originalFog),f.originalValues);
});

test('disposing the notice restores fog and late updates cannot take ownership again',t=>{
  const f=fixture(t);f.update();assert.notEqual(f.scene.fog,f.originalFog);
  f.controller.dispose();assertOriginal(f);assert.equal(f.root.children.length,0);
  f.controller.update();assertOriginal(f);assert.equal(f.root.children.length,0);
  const replacement=new THREE.Fog('#667c8a',20,900);f.scene.fog=replacement;
  f.controller.dispose();f.controller.update();
  assert.equal(f.scene.fog,replacement,'a disposed notice cannot interfere with a later fog owner');
});
