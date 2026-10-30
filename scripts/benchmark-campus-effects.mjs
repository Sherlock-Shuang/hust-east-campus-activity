// Deterministic allocation/submission capacity, not a GPU timing benchmark.
import * as THREE from 'three';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createCampusTsunami} from '../src/campus-tsunami.js';

const root=new URL('../',import.meta.url),out=new URL('artifacts/performance-phase2/c118/',root);
const baselineCommit='a432493';
const source=name=>execFileSync('git',['show',`${baselineCommit}:src/${name}`],{cwd:root,encoding:'utf8'});
const uri=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const oldWater=uri(source('campus-floodwater.js'));
const baseline=await import(uri(source('campus-tsunami.js').replace("'./campus-floodwater.js'",JSON.stringify(oldWater)).replace("'./c118-flood-state.js'",JSON.stringify(new URL('src/c118-flood-state.js',root).href))));
const event={id:'capacity-fixture',startAt:100000,pausedAt:null,pausedMs:0},now=125000;
function capacity(group){
  const geometries=new Set(),buffers=new Set(),materials=new Set();let triangles=0,sprayInstances=0,visibleMeshes=0,drawCalls=0;
  group.traverse(o=>{
    if(o.geometry){geometries.add(o.geometry);for(const attribute of Object.values(o.geometry.attributes))buffers.add(attribute.array.buffer);if(o.geometry.index)buffers.add(o.geometry.index.array.buffer);}
    if(o.material)for(const material of Array.isArray(o.material)?o.material:[o.material])materials.add(material);
  });
  group.traverseVisible(o=>{
    if(o.isMesh){
      const instances=o.geometry.isInstancedBufferGeometry?o.geometry.instanceCount:1,passes=o.material.transparent&&o.material.side===THREE.DoubleSide&&!o.material.forceSinglePass?2:1;
      visibleMeshes++;drawCalls+=passes;triangles+=Math.min(o.geometry.index?.count??o.geometry.attributes.position.count,o.geometry.drawRange.count)/3*instances*passes;
      if(o.name==='campus-tsunami-spray')sprayInstances+=instances*passes;
    }
  });
  return {uniqueGeometryCount:geometries.size,uniqueMaterialCount:materials.size,typedBufferBytes:[...buffers].reduce((sum,b)=>sum+b.byteLength,0),visibleTriangles:triangles,visibleSprayInstances:sprayInstances,drawCalls,visibleMeshes};
}
const old=baseline.createCampusTsunami({THREE,scene:new THREE.Scene()});old.update({event,now});
const report={generatedAt:new Date().toISOString(),baselineCommit,node:process.version,conditions:'Same Three.js version, event and authoritative 25-second phase. Counts before camera frustum rejection; buffer bytes are CPU typed-array capacity, not measured VRAM, GPU time or frame-rate improvements.',baseline:capacity(old.group),levels:[]};
for(const level of[0,1,2]){
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene(),level});effect.update({event,now});
  const sample=effect.sampleAt({x:1100,y:1.8,z:3000});
  report.levels.push({level,...capacity(effect.group),sample});
  effect.releaseResources();report.levels.at(-1).released=capacity(effect.group);effect.dispose();
}
old.dispose();await mkdir(out,{recursive:true});await writeFile(new URL('exterior-capacity.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
