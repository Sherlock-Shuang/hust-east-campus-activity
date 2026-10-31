import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createEastNineBuildersPoster} from '../src/east-nine-builders-poster.js';
const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
class Element {
 constructor(){this.listeners=new Map();this.hidden=true;this.removed=false;}
 setAttribute(k,v){this[k]=v;}
 addEventListener(k,v){this.listeners.set(k,v);}
 removeEventListener(k,v){if(this.listeners.get(k)===v)this.listeners.delete(k);}
 remove(){this.removed=true;}
}
function fixture(){
 const requests=[],scene=new THREE.Scene(),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),model=createGeoScene(THREE,scene,source,frame,geoToLocal);
 const doc={createElement:()=>new Element(),exitPointerLock(){doc.unlocked=true;}},host={ownerDocument:doc,append(el){host.child=el;}},canvas={dataset:{}},player={active:true,state:{x:0,y:.14,z:0}};
 class Loader{load(url,done,progress,fail){requests.push({url,done,fail});}}
 const card=createEastNineBuildersPoster({THREE:{...THREE,TextureLoader:Loader},scene,model,frame,geoToLocal,host,canvas,getPlayer:()=>player});
 const camera=new THREE.PerspectiveCamera(60,1,.1,2500),p=card.placement;
 const near=()=>{player.state={...p.inspection};camera.position.set(player.state.x,1.79,player.state.z);camera.lookAt(p.x,p.y,p.z);};
 const far=()=>camera.position.set(p.x+700,1.79,p.z);
 const dispose=()=>{card.dispose();model.dispose();};return{requests,scene,model,card,camera,p,near,far,dispose,canvas,doc,host};
}

test('wall image loads only nearby, keeps the full original UV and exposes a usable original-image link',()=>{
 const f=fixture();try{
  f.far();f.card.update(f.camera);assert.equal(f.requests.length,0);assert.equal(f.card.state,'idle');f.near();f.card.update(f.camera);assert.equal(f.requests.length,1);assert.equal(f.card.state,'loading');
  const texture=new THREE.Texture({width:987,height:1347});f.requests[0].done(texture);f.card.update(f.camera);assert.equal(f.card.state,'ready');assert.equal(f.card.group.visible,true);assert.equal(f.card.link.hidden,false);
  assert.deepEqual(texture.repeat.toArray(),[1,1]);assert.deepEqual(texture.offset.toArray(),[0,0]);assert.equal(texture.colorSpace,THREE.SRGBColorSpace);
  const picture=f.card.group.getObjectByName('east-nine-builders-original-image');assert.equal(picture.material.map,texture);assert.equal(picture.material.toneMapped,false);assert.ok(Math.abs(picture.geometry.parameters.width/picture.geometry.parameters.height-987/1347)<1e-10);
  assert.equal(f.card.link.target,'_blank');assert.equal(f.card.link.rel,'noopener');let stopped=false;f.card.link.listeners.get('click')({stopPropagation(){stopped=true;}});assert.ok(stopped&&f.doc.unlocked);
  const pose=f.card.group.matrixWorld.clone();for(let i=0;i<20;i++){f.camera.position.x+=.01;f.card.update(f.camera);}assert.ok(f.card.group.matrixWorld.equals(pose));assert.equal(f.requests.length,1);
  f.card.update(f.camera,{interactive:false});assert.equal(f.card.link.hidden,true);f.card.update(f.camera,{visible:false});assert.equal(f.card.group.visible,false);
 }finally{f.dispose();}
});

test('back-face and distant views hide the link; failed loads retry only after leaving and returning',()=>{
 const f=fixture();try{
  f.near();f.card.update(f.camera);f.requests[0].fail();assert.equal(f.card.state,'error');for(let i=0;i<10;i++)f.card.update(f.camera);assert.equal(f.requests.length,1);
  f.far();f.card.update(f.camera);f.near();f.card.update(f.camera);assert.equal(f.requests.length,2);f.requests[1].done(new THREE.Texture());
  f.camera.position.set(f.p.x-f.p.nx*4,1.79,f.p.z-f.p.nz*4);f.camera.lookAt(f.p.x,f.p.y,f.p.z);f.card.update(f.camera);assert.equal(f.card.link.hidden,true);
  f.far();f.card.update(f.camera);assert.equal(f.card.group.visible,false);assert.equal(f.card.link.hidden,true);
 }finally{f.dispose();}
});

test('disposing during an in-flight image request releases the late texture and all local UI listeners',()=>{
 const f=fixture();f.near();f.card.update(f.camera);const card=f.card;f.dispose();const texture=new THREE.Texture();let released=0;texture.addEventListener('dispose',()=>released++);f.requests[0].done(texture);card.dispose();
 assert.equal(released,1);assert.equal(card.state,'disposed');assert.equal(card.link.listeners.size,0);assert.equal(card.link.removed,true);assert.equal(card.group.parent,null);
});
