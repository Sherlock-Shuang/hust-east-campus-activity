import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createFieldGroupQr,planFieldGroupQr,FIELD_GROUP_QR_IMAGE,FIELD_SOURCE_ID} from '../src/field-group-qr.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const sourceBefore=JSON.stringify(source),originalFile=new URL('../public/images/activity/hust-ai-builders-group.jpg',import.meta.url);
const expectedHash='58711c2ec5d189070bec4a2f031628498158dea23c97c85ca25ab80172974365';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
class Element {
  constructor(){this.listeners=new Map();this.hidden=true;this.removed=false;}
  setAttribute(key,value){this[key]=value;}
  addEventListener(key,value){this.listeners.set(key,value);}
  removeEventListener(key,value){if(this.listeners.get(key)===value)this.listeners.delete(key);}
  remove(){this.removed=true;}
}
function fixture(){
  const scene=new THREE.Scene(),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),model=createGeoScene(THREE,scene,source,frame,geoToLocal),requests=[],globalListeners=[];
  const doc={createElement:()=>new Element(),exitPointerLock(){doc.unlocked=true;},addEventListener(type){globalListeners.push(type);}},host={ownerDocument:doc,append(element){host.child=element;},addEventListener(type){globalListeners.push(type);}},canvas={dataset:{}},player={active:true,state:{x:0,y:.14,z:0}};
  class Loader{load(url,done,_progress,fail){requests.push({url,done,fail});}}
  const card=createFieldGroupQr({THREE:{...THREE,TextureLoader:Loader},scene,model,frame,geoToLocal,host,canvas,getPlayer:()=>player}),p=card.placement,camera=new THREE.PerspectiveCamera(60,1,.1,2500);
  const near=()=>{player.state={...p.inspection};camera.position.set(player.state.x,1.79,player.state.z);camera.lookAt(p.x,p.y,p.z);};
  const far=()=>camera.position.set(p.x+700,1.79,p.z);
  return{scene,frame,model,requests,doc,host,canvas,player,card,p,camera,near,far,globalListeners,dispose(){card.dispose();model.dispose();}};
}

test('the existing QQ card is a fixed full-height East Nine north-wall poster, with no former dorm-roof duplicate',()=>{
  const f=fixture();try{
    assert.ok(f.p);assert.equal(FIELD_SOURCE_ID,'way/1023544717');assert.equal(f.p.sourceId,FIELD_SOURCE_ID);
    assert.ok(f.p.nz<-.98,'the card faces the north road');assert.ok(f.p.height>=f.p.wallHeight*.9,'the print uses almost the full wall height');
    assert.ok(f.p.y-f.p.height/2>=0&&f.p.y+f.p.height/2<=f.p.wallHeight+.1,'the print remains on the wall rather than above its roof');
    assert.ok(f.p.mountOffset>0&&f.p.mountOffset<=.02,'the print sits flush with its wall');
    assert.equal(f.card.group.name,'east-nine-group-poster');assert.equal(f.scene.getObjectByName('yunyuan16-group-qr'),undefined);
    const picture=f.card.group.getObjectByName('hust-ai-builders-group-qr');assert.equal(picture.isMesh,true);assert.equal(picture.isSprite,undefined);
    const normal=new THREE.Vector3(0,0,1).transformDirection(picture.matrixWorld);assert.ok(normal.dot(new THREE.Vector3(f.p.nx,0,f.p.nz))>.99999);
    const pose=f.card.group.matrixWorld.clone();f.far();f.card.update(f.camera);f.near();f.card.update(f.camera);for(let i=0;i<15;i++){f.camera.position.x+=.1;f.card.update(f.camera);}assert.ok(f.card.group.matrixWorld.equals(pose));
    assert.equal(JSON.stringify(source),sourceBefore);assert.equal(planFieldGroupQr({records:[]},{frame:f.frame,geoToLocal}),null);
  }finally{f.dispose();}
});

test('the unchanged original QQ card loads on approach with its established UVs and a matte wall material',()=>{
  const bytes=readFileSync(originalFile);assert.equal(bytes.length,548373);assert.equal(hash(bytes),expectedHash);
  const f=fixture();try{
    f.far();f.card.update(f.camera);assert.equal(f.requests.length,0);assert.equal(f.card.state,'idle');assert.equal(f.card.group.visible,false);
    f.near();f.card.update(f.camera);f.card.update(f.camera);assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,FIELD_GROUP_QR_IMAGE);assert.equal(f.card.state,'loading');assert.equal(f.card.link.hidden,true);
    const texture=new THREE.Texture({width:1284,height:2289});f.requests[0].done(texture);f.card.update(f.camera);
    assert.equal(f.card.state,'ready');assert.equal(f.canvas.dataset.eastNineGroupPoster,'ready');assert.equal(f.canvas.dataset.eastNinePoster,undefined,'QQ status must not overwrite the Xiaohongshu poster');
    assert.equal(f.card.group.visible,true);assert.deepEqual(texture.repeat.toArray(),[.84,.59]);assert.deepEqual(texture.offset.toArray(),[.08,.25]);assert.equal(texture.colorSpace,THREE.SRGBColorSpace);
    const panel=f.card.group.getObjectByName('hust-ai-builders-group-qr'),material=panel.material;
    assert.equal(material.map,texture);assert.equal(material.isMeshStandardMaterial,true);assert.equal(material.toneMapped,true);assert.equal(material.fog,true);assert.equal(material.depthTest,true);assert.equal(material.depthWrite,true);assert.equal(material.emissive.getHex(),0);assert.ok(material.roughness>.9);assert.equal(panel.receiveShadow,true);assert.equal(panel.castShadow,false);
    assert.ok(Math.abs(panel.geometry.parameters.width/panel.geometry.parameters.height-(1284*.84)/(2289*.59))<1e-10,'the visible card retains its established cropped aspect ratio');
    assert.equal(hash(readFileSync(originalFile)),expectedHash,'rendering must not rewrite or recompress the original card');
  }finally{f.dispose();}
});

test('the original-image link is isolated from game controls and preserves native new-tab opening',()=>{
  const f=fixture();try{
    f.near();f.card.update(f.camera);f.requests[0].done(new THREE.Texture());f.card.update(f.camera);
    const link=f.card.link;assert.equal(link.hidden,false);assert.equal(link.href,FIELD_GROUP_QR_IMAGE);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener');assert.match(link.className,/east-nine-group-original/);assert.match(link.textContent,/QQ/);
    assert.deepEqual(f.globalListeners,[],'the poster must not claim global keyboard or pointer controls');
    for(const code of ['KeyF','KeyE','KeyG','Enter']){let stopped=false,prevented=false;link.listeners.get('keydown')({code,stopPropagation(){stopped=true;},preventDefault(){prevented=true;}});assert.equal(stopped,true);assert.equal(prevented,false,'focused-link handling must preserve native browser action');}
    let stopped=false,prevented=false;link.listeners.get('click')({stopPropagation(){stopped=true;},preventDefault(){prevented=true;}});assert.ok(stopped&&f.doc.unlocked);assert.equal(prevented,false,'opening must remain a user-initiated native link');
    f.card.update(f.camera,{interactive:false});assert.equal(link.hidden,true);f.card.update(f.camera,{visible:false});assert.equal(f.card.group.visible,false);
  }finally{f.dispose();}
});

test('failed and late QQ image requests leave no visible cover and dispose all owned rendering resources',()=>{
  const f=fixture();try{
    f.near();f.card.update(f.camera);f.requests[0].fail();assert.equal(f.card.state,'error');assert.equal(f.card.group.visible,false);assert.equal(f.card.link.hidden,true);
    for(let i=0;i<10;i++)f.card.update(f.camera);assert.equal(f.requests.length,1);
    f.far();f.card.update(f.camera);f.near();f.card.update(f.camera);assert.equal(f.requests.length,2);
    const panel=f.card.group.getObjectByName('hust-ai-builders-group-qr'),texture=new THREE.Texture(),released={geometry:0,material:0,grain:0,image:0};
    panel.geometry.addEventListener('dispose',()=>released.geometry++);panel.material.addEventListener('dispose',()=>released.material++);panel.material.bumpMap.addEventListener('dispose',()=>released.grain++);texture.addEventListener('dispose',()=>released.image++);
    f.card.dispose();f.requests[1].done(texture);f.card.dispose();
    assert.deepEqual(released,{geometry:1,material:1,grain:1,image:1});assert.equal(f.card.state,'disposed');assert.equal(f.card.group.parent,null);assert.equal(f.card.group.visible,false);assert.equal(f.card.link.removed,true);assert.equal(f.card.link.listeners.size,0);
  }finally{f.dispose();}
});
