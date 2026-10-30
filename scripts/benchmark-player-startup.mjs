import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Fresh processes deliberately avoid the skin-template cache between samples.
// CPU construction only: no claim about browser FPS, GPU upload or network.
const source=resolve(process.env.PERF_SOURCE||fileURLToPath(new URL('..',import.meta.url)));
const samples=Math.max(1,Math.min(10,Number(process.env.PERF_SAMPLES)||3));
const prepared=process.env.PERF_PREPARE==='1';
const worker=`
  import {pathToFileURL} from 'node:url';
  import {performance} from 'node:perf_hooks';
  import * as THREE from 'three';
  const {createPlayerModels}=await import(pathToFileURL(process.argv[1]+'/src/player-models.js'));
  if(process.argv[2]==='prepared'){
    const {createSpiderGeometryAsset,decodeSpiderGeometryAsset}=await import(pathToFileURL(process.argv[1]+'/src/spider-geometry-asset.js'));
    const {usePrecomputedSpiderGeometry}=await import(pathToFileURL(process.argv[1]+'/src/spider-skin-template.js'));
    const math={Vector3:THREE.Vector3,Quaternion:THREE.Quaternion,Matrix4:THREE.Matrix4,Color:THREE.Color};
    usePrecomputedSpiderGeometry(decodeSpiderGeometryAsset(createSpiderGeometryAsset(math).buffer));
  }
  const start=performance.now(),rig=createPlayerModels(THREE);
  rig.update({mode:'walk',grounded:true},0);
  const constructionMs=performance.now()-start,geometries=new Set(),materials=new Set();let meshes=0;
  rig.group.traverse(o=>{if(o.isMesh)meshes++;if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
  let attributeBytes=0;for(const g of geometries){for(const a of Object.values(g.attributes))attributeBytes+=a.array.byteLength;if(g.index)attributeBytes+=g.index.array.byteLength;}
  const spiderBuilt=!!rig.group.getObjectByName('spider-character');rig.dispose();
  console.log(JSON.stringify({constructionMs,meshes,geometries:geometries.size,materials:materials.size,attributeBytes,spiderBuilt}));
`;
const runs=[];
for(let i=0;i<samples;i++){
  const child=spawnSync(process.execPath,['--input-type=module','-e',worker,source,prepared?'prepared':'fallback'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'});
  if(child.status!==0)throw new Error(child.stderr||'Benchmark worker failed');
  runs.push(JSON.parse(child.stdout.trim()));
}
const sorted=runs.map(x=>x.constructionMs).sort((a,b)=>a-b);
console.log(JSON.stringify({source,scope:'Fresh-process CPU player construction + first walking update, no renderer',skin:prepared?'precomputed before timing (successful-worker equivalent)':'not precomputed (blocked/unsupported-worker path)',samples,medianMs:sorted[Math.floor(sorted.length/2)],runs},null,2));
