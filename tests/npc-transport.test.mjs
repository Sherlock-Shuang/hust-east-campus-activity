import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createNpcTransportModels} from '../src/npc-transport-models.js';
import {createNpcTransport} from '../src/npc-transport.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCommuteRoute} from '../src/commute-route.js';

const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
function fixture(){const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,source,frame,geoToLocal),route=createCommuteRoute(source,{frame,geoToLocal});return{scene,model,route};}

test('modest complete fleet has occupied recognisable models within a small draw/triangle budget',()=>{
  const library=createNpcTransportModels(THREE);let draws=0,triangles=0;
  try{for(const mode of['helicopter','hoverboard','hoverboard','roadster','boat']){
    const {root}=library.create(mode),body=root.getObjectByName(`${mode}-npc-body`);
    assert.equal(root.userData.occupied,true);assert.ok(body.userData.sourceParts.includes('npc-pilot-head'));assert.ok(body.userData.sourceParts.includes('npc-pilot-hand'));
    assert.ok(body.userData.sourceParts.some(n=>n.startsWith(`${mode}-`)));
    root.traverse(o=>{assert.ok(!o.isLight);assert.equal(o.castShadow,false);if(o.isMesh){draws++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;assert.equal(o.material.map,null);}});
    assert.equal(root.matrixAutoUpdate,true);assert.equal(root.matrixWorldAutoUpdate,true);
  }assert.ok(draws<=22,`${draws} draw calls`);assert.ok(triangles<14000,`${triangles} triangles`);}finally{library.dispose();}
});

test('shared board body/rotor geometry has independent transforms and every resource disposes once',()=>{
  const library=createNpcTransportModels(THREE),a=library.create('hoverboard'),b=library.create('hoverboard'),geometries=new Map(),materials=new Map();
  assert.notEqual(a.root,b.root);assert.equal(a.root.children[0].geometry,b.root.children[0].geometry);assert.equal(a.root.children[0].material,b.root.children[0].material);
  for(const root of[a.root,b.root])root.traverse(o=>{if(o.isMesh){geometries.set(o.geometry,0);materials.set(o.material,0);}});
  for(const [g]of geometries)g.addEventListener('dispose',()=>geometries.set(g,geometries.get(g)+1));
  for(const [m]of materials)m.addEventListener('dispose',()=>materials.set(m,materials.get(m)+1));
  a.rotors[0].mesh.rotation.y=1;assert.equal(b.rotors[0].mesh.rotation.y,0);assert.equal(a.rotors[0].mesh.geometry,b.rotors[3].mesh.geometry);
  library.dispose();library.dispose();assert.ok([...geometries.values()].every(v=>v===1));assert.ok([...materials.values()].every(v=>v===1));assert.equal(library.create('hoverboard'),null);
});

test('boat deck faces the sky and occupied models retain contact-height proportions',()=>{
  const library=createNpcTransportModels(THREE);
  try{const boat=library.create('boat').root;boat.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(.3,5,-1.7),new THREE.Vector3(0,-1,0)),hits=ray.intersectObject(boat,true);
    assert.ok(hits.some(hit=>Math.abs(hit.point.y-.56)<.001&&hit.face.normal.y>.99),'visible upward deck');
    const car=library.create('roadster').root;car.updateMatrixWorld(true);
    const sideHits=new THREE.Raycaster(new THREE.Vector3(4,.5,1.5),new THREE.Vector3(-1,0,0)).intersectObject(car,true);assert.ok(sideHits.some(hit=>hit.object.name==='roadster-npc-body'&&hit.face.normal.x>.9),'outward car side skin');
    const hoodHits=new THREE.Raycaster(new THREE.Vector3(0,4,-1.5),new THREE.Vector3(0,-1,0)).intersectObject(car,true);assert.ok(hoodHits.some(hit=>hit.object.name==='roadster-npc-body'&&hit.point.y>.65&&hit.face.normal.y>.9),'upward hood skin');
    for(const [mode,heightMin,heightMax]of[['hoverboard',1.9,2.3],['roadster',1.2,1.4],['helicopter',2.4,2.7],['boat',1.8,2.1]]){
      const {root}=library.create(mode);root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(root);assert.ok(bounds.max.y>=heightMin&&bounds.max.y<heightMax,`${mode} y=${bounds.max.y}`);
    }
  }finally{library.dispose();}
});

test('real campus fleet moves offscreen analytically, culls cheaply and resumes at the current loop position',()=>{
  const {scene,model,route}=fixture(),layer=createNpcTransport({THREE,scene,model,route});
  try{
    assert.equal(layer.group.name,'ambient-npc-transport');const initial=layer.getDiagnostics();assert.equal(initial.total,5);assert.deepEqual(initial.counts,{helicopter:1,roadster:1,hoverboard:2,boat:1});
    layer.setFloodState({id:'distance-test',elapsed:0});
    const camera=new THREE.PerspectiveCamera();camera.position.set(1e6,1e6,1e6);assert.equal(layer.tick(.1,camera),false);
    let data=layer.getDiagnostics();assert.equal(data.visibleCount,0);assert.equal(data.drawCalls,0);assert.notDeepEqual(data.poses.map(p=>[p.x,p.y,p.z]),initial.poses.map(p=>[p.x,p.y,p.z]));
    const near=data.poses[0];camera.position.set(near.x,near.y,near.z);assert.equal(layer.tick(.1,camera),true);data=layer.getDiagnostics();assert.ok(data.visibleCount>0);
    const entry=layer.group.getObjectByName(near.id),pose=data.poses.find(p=>p.id===near.id);assert.equal(entry.position.x,pose.x);assert.equal(entry.position.z,pose.z);assert.equal(entry.matrixAutoUpdate,true);
    assert.equal(layer.tick(0,camera),false);const previous=layer.getDiagnostics().elapsedSeconds;layer.tick(25,camera);assert.equal(layer.getDiagnostics().elapsedSeconds,previous+.1,'long frames cannot teleport across a loop');
    assert.ok(layer.getDiagnostics().maxDrawCalls<=22);assert.ok(layer.getDiagnostics().maxTriangles<14000);
  }finally{layer.dispose();model.dispose();}
});

test('hiding freezes NPC time, distance budget scales and repeated disposal removes only this layer',()=>{
  const {scene,model,route}=fixture(),sentinel=new THREE.Group();scene.add(sentinel);const layer=createNpcTransport({THREE,scene,model,route});
  try{
    layer.setFloodState({id:'visibility-test',elapsed:0});
    layer.tick(.1);assert.equal(layer.getDiagnostics().visibleCount,5);const before=layer.getDiagnostics();layer.setVisible(false);assert.equal(layer.tick(.1),false);assert.equal(layer.getDiagnostics().elapsedSeconds,before.elapsedSeconds);assert.equal(layer.getDiagnostics().visibleCount,0);assert.equal(layer.group.visible,false);
    layer.setVisible(true);layer.tick(0);assert.equal(layer.getDiagnostics().visibleCount,5);
    const first=layer.getDiagnostics().poses[0],camera=new THREE.PerspectiveCamera();camera.position.set(first.x+200,first.y,first.z);layer.setDetailDistanceScale(1);layer.tick(0,camera);assert.equal(layer.getDiagnostics().poses[0].visible,true);
    layer.setDetailDistanceScale(.35);layer.tick(0,camera);assert.equal(layer.getDiagnostics().poses[0].visible,false);
    layer.dispose();layer.dispose();assert.equal(scene.getObjectByName('ambient-npc-transport'),undefined);assert.equal(sentinel.parent,scene);assert.equal(layer.getDiagnostics().disposed,true);assert.equal(layer.tick(.1),false);
  }finally{layer.dispose();model.dispose();}
});

test('flood lifts low NPC fleet onto the water while high aircraft keep their flight altitude',()=>{
 const {scene,model,route}=fixture(),layer=createNpcTransport({THREE,scene,model,route});
 try{
  layer.tick(0);const dry=layer.getDiagnostics().poses;
  layer.setFloodState({id:'test',elapsed:180});layer.tick(0);const wet=layer.getDiagnostics().poses;
  for(const p of wet){const b=dry.find(a=>a.id===p.id);if(b.y<2){assert.ok(p.y>6,p.id);const mesh=layer.group.getObjectByName(p.id);assert.equal(mesh.position.y,p.y);}else if(b.y>12)assert.equal(p.y,b.y);}
  layer.setFloodState(null);layer.tick(0);assert.deepEqual(layer.getDiagnostics().poses.map(p=>[p.x,p.y,p.z]),dry.map(p=>[p.x,p.y,p.z]));
  assert.deepEqual(layer.getDiagnostics().poses.filter(p=>p.visible).map(p=>p.mode),['boat']);
 }finally{layer.dispose();model.dispose();}
});

test('airborne NPCs appear only during the tsunami including its approach and pause',()=>{
  const {scene,model,route}=fixture(),layer=createNpcTransport({THREE,scene,model,route});
  try{
    layer.tick(0);
    const ordinary=layer.getDiagnostics();
    assert.equal(ordinary.total,5,'retain the full fleet for the tsunami');
    assert.equal(ordinary.visibleCount,1);
    assert.deepEqual(ordinary.poses.filter(p=>p.visible).map(p=>p.mode),['boat']);
    for(const flood of[
      {id:'approach',elapsed:-3},
      {id:'arrival',elapsed:0},
      {id:'paused',elapsed:60,paused:true},
    ]){
      layer.setFloodState(flood);layer.tick(0);
      const active=layer.getDiagnostics();
      assert.equal(active.visibleCount,5,flood.id);
      assert.deepEqual(active.poses.filter(p=>p.visible&&p.mode!=='boat').map(p=>p.mode).sort(),['helicopter','hoverboard','hoverboard','roadster']);
      layer.setFloodState(null);assert.equal(layer.tick(0),true,'ending the tsunami invalidates the visible scene');
      assert.equal(layer.getDiagnostics().visibleCount,1);
      assert.deepEqual(layer.getDiagnostics().poses.filter(p=>p.visible).map(p=>p.mode),['boat']);
    }
  }finally{layer.dispose();model.dispose();}
});

test('invalid flood identifiers or clocks cannot reveal airborne NPCs',()=>{
  const {scene,model,route}=fixture(),layer=createNpcTransport({THREE,scene,model,route});
  try{
    for(const invalid of[
      undefined,null,{},
      {elapsed:0},{id:'',elapsed:0},{id:null,elapsed:0},
      {id:'missing-clock'},{id:'invalid-clock',elapsed:NaN},
      {id:'infinite-clock',elapsed:Infinity},{id:'string-clock',elapsed:'0'},
    ]){
      layer.setFloodState({id:'before-invalid',elapsed:0});layer.tick(0);
      assert.equal(layer.getDiagnostics().visibleCount,5);
      layer.setFloodState(invalid);layer.tick(0);
      assert.equal(layer.getDiagnostics().visibleCount,1);
      assert.deepEqual(layer.getDiagnostics().poses.filter(p=>p.visible).map(p=>p.mode),['boat']);
    }
  }finally{layer.dispose();model.dispose();}
});
