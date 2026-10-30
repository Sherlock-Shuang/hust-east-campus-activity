// Measures construction task slices on the CPU, not browser first paint/FPS.
import fs from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createCampus3D,createCampus3DAsync} from '../src/campus-3d.js';
const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/data/${name}`,import.meta.url)));
const fc=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=()=>createGeoScene(THREE,new THREE.Scene(),fc,frame,geoToLocal);
const runs=[];
for(let run=0;run<3;run++){
  const a=model();let start=performance.now();const sync=createCampus3D(THREE,a,{frame,geoToLocal});const syncMs=performance.now()-start;sync.dispose();a.dispose();
  const b=model(),slices=[],stages=[];let sliceAt=performance.now();start=sliceAt;
  const staged=await createCampus3DAsync(THREE,b,{frame,geoToLocal},{budgetMs:8,onProgress:p=>stages.push(p.stage),yieldTask:async()=>{slices.push(performance.now()-sliceAt);await new Promise(resolve=>setImmediate(resolve));sliceAt=performance.now();}});
  slices.push(performance.now()-sliceAt);const totalMs=performance.now()-start;
  runs.push({syncBlockingMs:syncMs,stagedTotalMs:totalMs,slices:slices.length,maxSliceMs:Math.max(...slices),slicesOver50:slices.filter(n=>n>50).length,stages});staged.dispose();b.dispose();
}
console.log(JSON.stringify({description:'Same full map geometry; CPU task slicing only. Does not claim all stages are under 8ms or neighborhood streaming.',runs},null,2));
