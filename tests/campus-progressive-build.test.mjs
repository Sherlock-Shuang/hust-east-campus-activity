import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createCampus3D,createCampus3DProgressive} from '../src/campus-3d.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {cacheStaticTransforms} from '../src/render-performance.js';
import {createPlayerWorld,getCampusPlayerSpawn} from '../src/player-experience.js';
const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url)));
const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=()=>createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
// Traversal order is deliberately allowed to change: source identities and all
// rendered matrices/geometry must agree after a full-detail export refresh.
function geometryDigest(group){const records=[];group.traverse(o=>{if(!o.isMesh||o.isInstancedMesh&&!o.count)return;const hash=createHash('sha256');for(const attr of Object.values(o.geometry.attributes))hash.update(Buffer.from(attr.array.buffer,attr.array.byteOffset,attr.array.byteLength));if(o.geometry.index)hash.update(Buffer.from(o.geometry.index.array.buffer));if(o.instanceMatrix){const entries=[];for(let i=0;i<o.count;i++){const h=createHash('sha256');h.update(Buffer.from(o.instanceMatrix.array.buffer,i*16*4,16*4));if(o.instanceColor)h.update(Buffer.from(o.instanceColor.array.buffer,i*3*4,3*4));entries.push(h.digest('hex'));}hash.update(entries.sort().join('|'));}records.push([o.name,hash.digest('hex')].join(':'));});return createHash('sha256').update(records.sort().join('\n')).digest('hex');}

test('playable handoff has full collision, three opto entries and walk surfaces; deferred decoration preserves final export',async()=>{
  const a=model(),b=model(),source=JSON.stringify(data),normal=createCampus3D(THREE,a,{frame,geoToLocal});
  let release;const blocked=new Promise(resolve=>release=resolve);let handoff=false;
  const progressive=await createCampus3DProgressive(THREE,b,{frame,geoToLocal},{initialPosition:getCampusPlayerSpawn(b),budgetMs:Infinity,yieldTask:()=>blocked});
  try{
    cacheStaticTransforms(progressive.group);assert.equal(progressive.dynamicGroups.length,0);assert.equal(progressive.tick(.016,new THREE.PerspectiveCamera()),false);
    assert.ok(progressive.group.userData.progressive.pendingFacades>0);assert.equal(progressive.group.userData.progressive.complete,false);
    const worldA=createPlayerWorld(a),worldReady=createPlayerWorld(b);
    assert.deepEqual(worldReady.buildings,worldA.buildings);assert.deepEqual(worldReady.walkSurfaces,worldA.walkSurfaces);assert.deepEqual(progressive.optoEntries,normal.optoEntries);
    assert.deepEqual(b.photoForecourtReservations,a.photoForecourtReservations);assert.deepEqual(b.bridgeInfrastructure,a.bridgeInfrastructure);
    progressive.releaseDecorativeResources();release();const completion=await progressive.whenDetailedReady;assert.equal(completion.error,undefined);assert.equal(completion.cancelled,false);
    assert.equal(progressive.decorationStats.batches.reduce((sum,x)=>sum+x.residentBytes,0),0,'foreground pause cannot install uploaded detail');
    assert.equal(progressive.decorationStats.trees.reduce((sum,x)=>sum+x.residentBytes,0),0);
    assert.ok(progressive.dynamicGroups.length>0,'late people register in the same public array');for(const group of progressive.dynamicGroups)group.traverse(o=>{assert.equal(o.matrixAutoUpdate,true);assert.equal(o.matrixWorldAutoUpdate,true);});
    const worldAfter=createPlayerWorld(b);assert.deepEqual(worldAfter.buildings,worldReady.buildings);assert.deepEqual(worldAfter.walkSurfaces,worldReady.walkSurfaces);
    progressive.resumeDecorativeResources();progressive.update(null);normal.update(null);
    assert.deepEqual(progressive.counts,normal.counts);assert.equal(geometryDigest(progressive.group),geometryDigest(normal.group));assert.equal(JSON.stringify(data),source);
  }finally{release();await progressive.whenDetailedReady;progressive.dispose();normal.dispose();a.dispose();b.dispose();}
});

test('dispose at playable handoff cancels background and settles without late installs or promise rejection',async()=>{
  const m=model();let resume;const blocked=new Promise(resolve=>resume=resolve);
  const campus=await createCampus3DProgressive(THREE,m,{frame,geoToLocal},{initialPosition:getCampusPlayerSpawn(m),budgetMs:Infinity,yieldTask:()=>blocked});
  campus.dispose();const before=campus.group.children.length;resume();assert.deepEqual(await campus.whenDetailedReady,{cancelled:true});assert.equal(campus.group.children.length,before);assert.equal(campus.disposed,true);m.dispose();
});


test('aborting during late stone pixels settles and cancels the unfinished generator without late installation',async()=>{
  const m=model(),controller=new AbortController();let campus;
  campus=await createCampus3DProgressive(THREE,m,{frame,geoToLocal},{initialPosition:getCampusPlayerSpawn(m),signal:controller.signal,budgetMs:0,yieldTask:()=>new Promise(resolve=>setImmediate(resolve)),onProgress:p=>{if(p.stage==='景石表面材质')controller.abort();}});
  const result=await campus.whenDetailedReady;assert.deepEqual(result,{cancelled:true});assert.equal(campus.disposed,true);assert.equal(campus.group.getObjectByName('实拍草坪 · 题字景石与轻型膜棚'),undefined);m.dispose();
});
