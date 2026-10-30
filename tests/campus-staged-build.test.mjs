import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createCampus3D,createCampus3DAsync} from '../src/campus-3d.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createPlayerWorld} from '../src/player-experience.js';

test('time-sliced complete campus preserves final geometry, collider topology and source data',async()=>{
  const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url)));
  const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson')),source=JSON.stringify(data);
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  const build=()=>createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
  const a=build(),b=build();let ticks=0,yields=0;const progress=[];
  const first=createCampus3D(THREE,a,{frame,geoToLocal});
  const second=await createCampus3DAsync(THREE,b,{frame,geoToLocal},{budgetMs:8,now:()=>++ticks,yieldTask:async()=>{yields++;},onProgress:p=>progress.push(p.stage)});
  const digest=group=>{const hash=createHash('sha256');group.traverse(o=>{if(!o.isMesh)return;hash.update(o.name);for(const attr of Object.values(o.geometry.attributes))hash.update(Buffer.from(attr.array.buffer,attr.array.byteOffset,attr.array.byteLength));if(o.geometry.index)hash.update(Buffer.from(o.geometry.index.array.buffer));if(o.instanceMatrix)hash.update(Buffer.from(o.instanceMatrix.array.buffer));});return hash.digest('hex');};
  try{
    assert.ok(yields>20,'large scene yields multiple main-thread tasks');assert.equal(progress.at(-1),'校园准备完成');
    assert.equal(digest(second.group),digest(first.group));assert.deepEqual(second.counts,first.counts);
    const worldA=createPlayerWorld(a),worldB=createPlayerWorld(b);
    assert.deepEqual(worldB.buildings,worldA.buildings);assert.deepEqual(worldB.walkSurfaces,worldA.walkSurfaces);
    assert.deepEqual(second.optoEntries,first.optoEntries);assert.equal(JSON.stringify(data),source);
  }finally{first.dispose();second.dispose();a.dispose();b.dispose();}
});
