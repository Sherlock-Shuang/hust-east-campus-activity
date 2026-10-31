import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ATMOSPHERE_PRESETS, ATMOSPHERE_STORAGE_KEY, createCampusAtmosphere, readAtmospherePreference, mountAtmosphereUI } from '../src/campus-atmosphere.js';

const memoryStorage=(initial)=>{
  const values=new Map(initial===undefined?[]:[[ATMOSPHERE_STORAGE_KEY,initial]]);
  return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
};
function setup(initial){
  const scene=new THREE.Scene(),renderer={toneMappingExposure:1.1,shadowMap:{needsUpdate:false}};
  scene.background=new THREE.Color('#accdef');scene.environment=new THREE.Texture();scene.environmentIntensity=.65;scene.fog=new THREE.Fog('#cbd6d6',480,2900);
  const hemisphere=new THREE.HemisphereLight('#dbe9f2','#878b73',1.3),sun=new THREE.DirectionalLight('#fff1d9',2.25),sunOffset=new THREE.Vector3(650,520,420);
  sun.target.position.set(10,3,20);sun.position.copy(sun.target.position).add(sunOffset);scene.add(hemisphere,sun,sun.target);
  const camera=new THREE.PerspectiveCamera();camera.position.set(120,8,-55);
  const storage=memoryStorage(initial),changes=[];let invalidations=0,rebuilds=0;
  const daylight={environment:scene.environment,rebuildEnvironment(){rebuilds++;}};
  const original={background:scene.background,environment:scene.environment,fog:scene.fog,fogColor:scene.fog.color.clone(),sunPosition:sun.position.clone(),sunOffset:sunOffset.clone(),sunColor:sun.color.clone(),hemiColor:hemisphere.color.clone(),hemiGround:hemisphere.groundColor.clone()};
  const atmosphere=createCampusAtmosphere({THREE,scene,renderer,hemisphere,sun,sunOffset,daylight,storage,onChange:(...args)=>changes.push(args),invalidate:()=>invalidations++});
  return{scene,renderer,hemisphere,sun,sunOffset,camera,storage,changes,original,atmosphere,get invalidations(){return invalidations;},get rebuilds(){return rebuilds;}};
}
test('all three looks use the existing lights and environment, with stable sky geometry',()=>{
  const f=setup(),{atmosphere,scene,renderer,sun,sunOffset,hemisphere}=f;
  const geometry=atmosphere.sky.geometry,material=atmosphere.sky.material,count=scene.children.length;
  assert.equal(atmosphere.mode,'day');assert.equal(scene.background,null);assert.equal(f.changes.length,0);
  assert.equal(atmosphere.getDiagnostics().drawCalls,1);assert.equal(atmosphere.getDiagnostics().extraLights,0);assert.ok(atmosphere.getDiagnostics().triangles<=1024);
  assert.equal(atmosphere.sky.castShadow,false);assert.equal(atmosphere.sky.receiveShadow,false);assert.equal(atmosphere.sky.material.depthWrite,false);
  for(const mode of ['sunset','night','day','night','sunset','day']){
    assert.equal(atmosphere.setMode(mode),true);
    const p=ATMOSPHERE_PRESETS[mode];
    assert.equal(atmosphere.mode,mode);assert.deepEqual(sunOffset.toArray(),p.offset);
    assert.equal(sun.color.getHexString(),new THREE.Color(p.sun).getHexString());
    assert.equal(sun.intensity,p.sunIntensity);assert.equal(hemisphere.intensity,p.hemisphereIntensity);
    assert.equal(renderer.toneMappingExposure,p.exposure);assert.equal(scene.environmentIntensity,p.environmentIntensity);
    assert.equal(scene.children.length,count);assert.equal(atmosphere.sky.geometry,geometry);assert.equal(atmosphere.sky.material,material);
    assert.equal(scene.environment,f.original.environment);assert.equal(f.storage.getItem(ATMOSPHERE_STORAGE_KEY),mode);
  }
  assert.equal(f.invalidations,6);assert.equal(f.rebuilds,0);assert.equal(f.changes.length,6);
  assert.equal(atmosphere.setMode('day'),false);assert.equal(atmosphere.setMode('unknown'),false);assert.equal(f.changes.length,6);
  assert.deepEqual(f.camera.position.toArray(),[120,8,-55]);
  assert.ok(ATMOSPHERE_PRESETS.night.hemisphereIntensity>.45,'night keeps paths and facades readable');
  assert.ok(ATMOSPHERE_PRESETS.sunset.offset[1]/Math.hypot(...ATMOSPHERE_PRESETS.sunset.offset)<.2,'sunset light is low over the horizon');
  atmosphere.dispose();
});
test('preference survives reconstruction and denied localStorage is harmless',()=>{
  assert.equal(readAtmospherePreference(memoryStorage('night')),'night');
  assert.equal(readAtmospherePreference(memoryStorage('bad')),'day');
  assert.equal(readAtmospherePreference({getItem(){throw Error('disabled');}}),'day');
  const f=setup('sunset');assert.equal(f.atmosphere.mode,'sunset');
  f.storage.setItem=()=>{throw Error('quota');};assert.equal(f.atmosphere.setMode('night'),true);
  const before=f.camera.position.clone();f.atmosphere.update(f.camera);assert.ok(before.equals(f.camera.position));
  f.atmosphere.dispose();
});
test('sky follows the camera, fog accommodates flight and tsunami retains fog ownership',()=>{
  const f=setup(),{atmosphere,scene,camera}=f;
  camera.position.set(100,500,-800);atmosphere.update(camera);
  assert.ok(atmosphere.sky.position.equals(camera.position));assert.equal(scene.fog.near,430+380*.9);assert.equal(scene.fog.far,2900+380*1.3);
  atmosphere.update(camera,{overviewLift:0});assert.equal(scene.fog.near,430);
  const immersion=new THREE.Fog('#074c5e',.2,36);immersion.name='campus-tsunami-immersion';scene.fog=immersion;
  atmosphere.update(camera);assert.equal(atmosphere.sky.visible,false);
  atmosphere.setMode('sunset');assert.equal(immersion.color.getHexString(),'074c5e');assert.equal(immersion.near,.2);assert.equal(immersion.far,36);
  scene.fog=f.original.fog;atmosphere.update(camera,{overviewLift:0});assert.equal(atmosphere.sky.visible,true);
  assert.equal(scene.fog.color.getHexString(),new THREE.Color(ATMOSPHERE_PRESETS.sunset.fog).getHexString());assert.equal(scene.fog.near,330);
  atmosphere.dispose();
});
test('context recovery environment remains authoritative and cleanup disposes only owned resources once',()=>{
  const f=setup(),{atmosphere,scene,renderer,sun,sunOffset,hemisphere,original}=f;
  const recovered=new THREE.Texture();scene.environment=recovered;
  let textureDisposals=0,geometryDisposals=0,materialDisposals=0;
  original.environment.addEventListener('dispose',()=>textureDisposals++);recovered.addEventListener('dispose',()=>textureDisposals++);
  atmosphere.sky.geometry.addEventListener('dispose',()=>geometryDisposals++);atmosphere.sky.material.addEventListener('dispose',()=>materialDisposals++);
  atmosphere.setMode('night');assert.equal(scene.environment,recovered);
  atmosphere.dispose();atmosphere.dispose();
  assert.equal(scene.environment,recovered);assert.equal(scene.background,original.background);assert.equal(scene.environmentIntensity,.65);assert.equal(renderer.toneMappingExposure,1.1);
  assert.ok(sun.position.equals(original.sunPosition));assert.ok(sunOffset.equals(original.sunOffset));assert.ok(sun.color.equals(original.sunColor));assert.equal(sun.intensity,2.25);
  assert.ok(hemisphere.color.equals(original.hemiColor));assert.ok(hemisphere.groundColor.equals(original.hemiGround));assert.equal(hemisphere.intensity,1.3);
  assert.ok(scene.fog.color.equals(original.fogColor));assert.equal(scene.fog.near,480);assert.equal(scene.fog.far,2900);
  assert.equal(scene.children.includes(atmosphere.sky),false);assert.equal(geometryDisposals,1);assert.equal(materialDisposals,1);assert.equal(textureDisposals,0);
  assert.equal(atmosphere.getDiagnostics().disposed,true);assert.equal(atmosphere.setMode('day'),false);
});

class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.attrs={};this.value='';}
  append(child){this.children.push(child);child.parent=this;}
  setAttribute(name,value){this.attrs[name]=value;}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
  removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
  dispatch(name,event={}){for(const fn of this.listeners.get(name)??[])fn(event);}
  blur(){this.blurred=true;}
  remove(){this.parent.children=this.parent.children.filter(x=>x!==this);}
}
test('compact selector is accessible, preserves preference and releases game input listeners',()=>{
  const f=setup('night'),host=new Element('div'),document={createElement:tag=>new Element(tag),getElementById:()=>host};
  let uiChanges=0;const ui=mountAtmosphereUI({document,atmosphere:f.atmosphere,onChange:()=>uiChanges++});
  assert.equal(ui.select.id,'campus-time-of-day');assert.equal(ui.select.attrs['aria-label'],'校园光照时段');assert.equal(ui.select.value,'night');
  assert.deepEqual(ui.select.children.map(x=>x.value),['day','sunset','night']);
  ui.select.value='sunset';ui.select.dispatch('change');assert.equal(f.atmosphere.mode,'sunset');assert.equal(f.storage.getItem(ATMOSPHERE_STORAGE_KEY),'sunset');assert.equal(ui.select.blurred,true);assert.equal(uiChanges,1);
  let stopped=0;for(const name of ['keydown','keyup','pointerdown','pointerup','wheel'])ui.select.dispatch(name,{stopPropagation(){stopped++;}});assert.equal(stopped,5);
  f.atmosphere.setMode('day');assert.equal(ui.select.value,'day');ui.dispose();assert.equal(host.children.length,0);
  assert.equal([...ui.select.listeners.values()].reduce((n,s)=>n+s.size,0),0);
  f.atmosphere.setMode('night');assert.equal(ui.select.value,'day','removed UI subscription no longer receives updates');f.atmosphere.dispose();
});
