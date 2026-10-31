import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createFieldGroupQr,planFieldGroupQr,FIELD_GROUP_QR_IMAGE} from '../src/field-group-qr.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

test('group card occupies the canteen-facing roof edge of the second eastward dorm',()=>{
  const fc=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url))),before=JSON.stringify(fc);
  const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,fc,createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),geoToLocal);
  const plan=planFieldGroupQr(model),building=model.records.find(r=>r.id===plan.sourceId);
  assert.equal(building.feature.properties.name,'韵苑十六栋');
  const ring=building.shapes[0].getPoints();
  assert.ok(plan.x>Math.min(...ring.map(p=>p.x))&&plan.x<Math.min(...ring.map(p=>p.x))+5,'near west roof edge');
  assert.ok(plan.z>Math.min(...ring.map(p=>-p.y))&&plan.z<Math.max(...ring.map(p=>-p.y)));
  assert.ok(plan.y-plan.height/2>24,'card clears the roof');
  assert.ok(plan.width<40,'smaller than the misplaced 128 m personal code');
  assert.equal(plan.yaw,-Math.PI/2);
  assert.equal(JSON.stringify(fc),before);assert.equal(planFieldGroupQr({records:[]}),null);model.dispose();
});
test('image loads near the dorm, stays fixed in world coordinates and owns resource disposal',()=>{
  const model={records:[{id:'way/110398530',shapes:[new THREE.Shape()]}]};
  const requests=[];class Loader{load(url,done,_progress,fail){requests.push({url,done,fail});}}
  const scene=new THREE.Scene(),effect=createFieldGroupQr({THREE:{...THREE,TextureLoader:Loader},scene,model}),position=effect.group.position.clone();
  const panel=effect.group.children[0];effect.group.updateMatrixWorld(true);
  assert.equal(panel.isMesh,true);assert.equal(panel.isSprite,undefined);
  const normal=new THREE.Vector3(0,0,1).transformDirection(panel.matrixWorld);
  assert.ok(normal.distanceTo(new THREE.Vector3(-1,0,0))<1e-9,'group card faces west toward the canteen');
  assert.equal(panel.material.depthTest,true);assert.equal(panel.material.depthWrite,true);
  let geometryFreed=0;panel.geometry.addEventListener('dispose',()=>geometryFreed++);
  effect.update({position:new THREE.Vector3(-2000,2,0)});assert.equal(requests.length,0);assert.equal(effect.group.visible,false);
  effect.update({position:new THREE.Vector3(430,2,80)});effect.update({position:new THREE.Vector3(440,2,90)});assert.equal(requests.length,1);assert.equal(requests[0].url,FIELD_GROUP_QR_IMAGE);
  const texture=new THREE.Texture();let freed=0;texture.addEventListener('dispose',()=>freed++);requests[0].done(texture);
  assert.equal(effect.group.visible,true);assert.equal(texture.colorSpace,THREE.SRGBColorSpace);assert.deepEqual(texture.repeat.toArray(),[.84,.59]);assert.deepEqual(texture.offset.toArray(),[.08,.25]);
  effect.update({position:new THREE.Vector3(430,200,80)});assert.deepEqual(effect.group.position.toArray(),position.toArray());
  effect.update({position:new THREE.Vector3(430,2,80)},{visible:false});assert.equal(effect.group.visible,false);effect.dispose();effect.dispose();assert.equal(freed,1);assert.equal(geometryFreed,1);assert.equal(effect.group.parent,null);
  const late=createFieldGroupQr({THREE:{...THREE,TextureLoader:Loader},scene,model});late.update({position:new THREE.Vector3(430,2,80)});late.dispose();const delayed=new THREE.Texture();let lateFreed=0;delayed.addEventListener('dispose',()=>lateFreed++);requests.at(-1).done(delayed);assert.equal(lateFreed,1);assert.equal(late.group.visible,false);
});
