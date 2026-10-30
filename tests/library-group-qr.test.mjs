import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createLibraryGroupQr,planLibraryGroupQr,LIBRARY_GROUP_QR_IMAGE} from '../src/library-group-qr.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

test('group card is above the actual east-library footprint and leaves its GIS unchanged',()=>{
  const fc=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url))),before=JSON.stringify(fc);
  const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,fc,createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),geoToLocal);
  const plan=planLibraryGroupQr(model);assert.equal(plan.sourceId,'way/98867853');
  assert.ok(plan.x>500&&plan.x<600);assert.ok(plan.z>290&&plan.z<360);
  assert.ok(plan.y-plan.height/2>plan.roof,'entire card clears roof');
  assert.equal(JSON.stringify(fc),before);assert.equal(planLibraryGroupQr({records:[]}),null);model.dispose();
});
test('image loads only near the library, stays in world coordinates and owns late texture disposal',()=>{
  const model={records:[{id:'way/98867853',feature:{properties:{name:'东校区图书馆',tags:{amenity:'library'}}},shapes:[new THREE.Shape([new THREE.Vector2(520,-300),new THREE.Vector2(580,-300),new THREE.Vector2(580,-350),new THREE.Vector2(520,-350)])]}]};
  const requests=[];class Loader{load(url,done,_progress,fail){requests.push({url,done,fail});}}
  const scene=new THREE.Scene(),effect=createLibraryGroupQr({THREE:{...THREE,TextureLoader:Loader},scene,model}),position=effect.group.position.clone();
  effect.update({position:new THREE.Vector3(-2000,2,0)});assert.equal(requests.length,0);assert.equal(effect.group.visible,false);
  effect.update({position:new THREE.Vector3(560,2,360)});effect.update({position:new THREE.Vector3(580,2,370)});assert.equal(requests.length,1);assert.equal(requests[0].url,LIBRARY_GROUP_QR_IMAGE);
  const texture=new THREE.Texture();let freed=0;texture.addEventListener('dispose',()=>freed++);requests[0].done(texture);
  assert.equal(effect.group.visible,true);assert.equal(texture.colorSpace,THREE.SRGBColorSpace);assert.deepEqual(texture.repeat.toArray(),[.84,.59]);assert.deepEqual(texture.offset.toArray(),[.08,.25]);
  effect.update({position:new THREE.Vector3(560,200,380)});assert.deepEqual(effect.group.position.toArray(),position.toArray());
  effect.update({position:new THREE.Vector3(560,2,360)},{visible:false});assert.equal(effect.group.visible,false);effect.dispose();effect.dispose();assert.equal(freed,1);assert.equal(effect.group.parent,null);
  const late=createLibraryGroupQr({THREE:{...THREE,TextureLoader:Loader},scene,model});late.update({position:new THREE.Vector3(560,2,360)});late.dispose();const delayed=new THREE.Texture();let lateFreed=0;delayed.addEventListener('dispose',()=>lateFreed++);requests.at(-1).done(delayed);assert.equal(lateFreed,1);assert.equal(late.group.visible,false);
});
