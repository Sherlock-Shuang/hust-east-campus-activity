import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createCampus3D} from '../src/campus-3d.js';
import {getCampusPlayerSpawn} from '../src/player-experience.js';
import {planCampusAIMurals} from '../src/campus-ai-murals.js';

// Use the same merged source map, reconstructed facades and initial player
// position as the actual campus. A standalone flat-wall fixture misses signs
// hidden by the real canteen's columns, cornice or projecting display frame.
const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
const base=read('east-campus.geojson'),extension=read('opto-southeast.geojson');
const sourceBefore=JSON.stringify([base,extension]);
const data=mergeCampusExtension(base,extension),mergedBefore=JSON.stringify(data);
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
const campus=createCampus3D(THREE,model,{frame,geoToLocal});
const plan=campus.aiMuralPlan,spawn=getCampusPlayerSpawn(model),facades=campus.layers.get('building');
campus.group.updateMatrixWorld(true);
after(()=>{campus.dispose();model.dispose();});

const arrivalIds=['canteen-arrival','canteen-entry-display'];
const pointOnSign=(item,u=0,v=0)=>new THREE.Vector3(item.x+item.nz*u,item.y+v,item.z-item.nx*u);
const probe=(origin,target,stopBefore=.005)=>{
  const delta=target.clone().sub(origin),length=delta.length();
  return new THREE.Raycaster(origin,delta.normalize(),0,length-stopBefore).intersectObject(facades,true)[0];
};

test('the real campus registers stable AI artwork and leaves both source maps unchanged',()=>{
  assert.ok(Array.isArray(plan),'createCampus3D must expose the wall plan, not only an unconnected module');
  const layer=facades.children.find(o=>o.userData.component==='campus-ai-murals');
  assert.ok(layer,'AI artwork is attached to the visible building layer');
  assert.equal(campus.counts.aiMurals,plan.length);
  assert.equal(layer.userData.count,plan.length);
  assert.equal(new Set(plan.map(p=>p.id)).size,plan.length);
  assert.deepEqual(planCampusAIMurals(model,campus.records,{frame,geoToLocal}),plan,'same map produces the same wall placements');
  assert.equal(JSON.stringify([base,extension]),sourceBefore);
  assert.equal(JSON.stringify(data),mergedBefore,'artwork does not become source GIS');
});

test('both prominent messages face the unchanged spawn within twenty metres',()=>{
  assert.ok(spawn);
  for(const id of arrivalIds){
    const item=plan.find(p=>p.id===id);assert.ok(item,id);
    const dx=spawn.x-item.x,dz=spawn.z-item.z,distance=Math.hypot(dx,dz);
    assert.ok(distance<20,`${id}: not another sign behind a distant building`);
    assert.ok((dx*item.nx+dz*item.nz)/distance>.2,`${id}: the spawn must see the front, not the back or grazing edge of its single-sided plane`);
    assert.ok(item.height>=1&&item.background,'arrival text has a substantial, contrasting surface');
    const planeNormal=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),item.yaw);
    assert.ok(planeNormal.dot(new THREE.Vector3(item.nx,0,item.nz))>.9999,'plane rotation agrees with the source-facing normal');
  }
});

test('spawn eye-level rays reach the headline and poster without hitting the real building first',()=>{
  const eye=new THREE.Vector3(spawn.x,1.7,spawn.z);
  for(const id of arrivalIds){
    const item=plan.find(p=>p.id===id);
    // Cover the headline/poster interior, not just a convenient clear centre.
    for(const u of [-.4,0,.4])for(const v of [-.4,0,.4]){
      const target=pointOnSign(item,item.width*u,item.height*v),hit=probe(eye,target);
      assert.equal(hit,undefined,`${id} (${u},${v}) is obscured by ${hit?.object.name} before its text plane`);
    }
  }
});

test('arrival paint stays on the blank band and the poster stays within the existing display, not doors or windows',()=>{
  for(const id of arrivalIds){
    const item=plan.find(p=>p.id===id),normal=new THREE.Vector3(item.nx,0,item.nz);
    const expected=id==='canteen-arrival'?'canteen-entry-adjacent-solid-panel':'canteen-entry-dark-display';
    // Cast through the entire artwork footprint, including near its edges.
    // The first real surface behind each point must be its intended support.
    for(const u of [-.49,-.25,0,.25,.49])for(const v of [-.49,0,.49]){
      const point=pointOnSign(item,item.width*u,item.height*v),origin=point.clone().addScaledVector(normal,.02);
      const hit=new THREE.Raycaster(origin,normal.clone().negate(),0,2).intersectObject(facades,true)[0];
      assert.equal(hit?.object.name,expected,`${id} (${u},${v}) covers ${hit?.object.name||'empty space'} instead of ${expected}`);
    }
  }
});

test('several ambient messages remain beside mapped surface roads on their viewing side',()=>{
  const scattered=plan.filter(p=>p.id.startsWith('scattered-'));
  assert.ok(scattered.length>=3,'arrival posters must not replace all roadside discoveries');
  const roads=model.roads.flatMap(record=>{
    const f=record.feature,t=f.properties.tags||{};if(t.bridge==='yes'||t.tunnel==='yes')return [];
    const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:[];
    return lines.map(line=>line.map(c=>geoToLocal({longitude:c[0],latitude:c[1],coordinateSystem:'EPSG:4326'},frame)));
  });
  for(const p of scattered){
    let distance=Infinity;
    for(const line of roads)for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
      const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/den)):0;
      const qx=a.x+dx*t-p.x,qz=a.z+dz*t-p.z,d=Math.hypot(qx,qz);
      if(qx*p.nx+qz*p.nz>d*.45)distance=Math.min(distance,d);
    }
    assert.ok(distance<=24.05,`${p.id}: a reachable viewing-side road should be within 24m, got ${distance}`);
    assert.ok(p.lines.length===1&&[...p.lines[0]].length<=24,'narrow roadside bands use concise copy');
  }
});
