// CPU/geometry/changed-buffer benchmark. Not a browser FPS or GPU measurement.
import fs from 'node:fs';
import * as THREE from 'three';
import {fileURLToPath} from 'node:url';
// Optional PERF_SOURCE points at a before-change checkout of this project.
const base=process.env.PERF_SOURCE||fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const {createGeoScene}=await import(base+'/src/geo-scene.js');
const {createLocalFrame,geoToLocal}=await import(base+'/src/geospatial.js');
const {createCampus3D}=await import(base+'/src/campus-3d.js');
const {getCampusPlayerSpawn}=await import(base+'/src/player-experience.js');
const data=JSON.parse(fs.readFileSync(base+'/public/data/east-campus.geojson'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal),beg=performance.now();
const campus=createCampus3D(THREE,model,{frame,geoToLocal});
const spawn=getCampusPlayerSpawn(model),camera=new THREE.PerspectiveCamera(58,1280/720,.12,5000);
camera.position.set(spawn.x+Math.sin(spawn.yaw)*6.4,3.7,spawn.z+Math.cos(spawn.yaw)*6.4);camera.lookAt(spawn.x,1.5,spawn.z);camera.updateMatrixWorld();campus.group.updateMatrixWorld(true);campus.update(camera);
const initialMs=performance.now()-beg;
const vp=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),frustum=new THREE.Frustum().setFromProjectionMatrix(vp),rows=[];
campus.group.traverseVisible(o=>{if(!o.isMesh)return;if(o.frustumCulled&& !frustum.intersectsObject(o))return;const tri=(o.geometry.index?.count||o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);rows.push({name:o.name,parent:o.parent?.name,triangles:tri,calls:Array.isArray(o.material)?o.geometry.groups.length:1,count:o.count||1,frustumCulled:o.frustumCulled,matrixBytes:o.instanceMatrix?.array.byteLength||0});});
const time=[];let byteCount=0;const versions=new Map();campus.group.traverse(o=>{for(const attr of [o.instanceMatrix,o.instanceColor])if(attr){versions.set(attr,attr.version);attr.clearUpdateRanges();}});for(let i=0;i<180;i++){camera.position.x+=.08;camera.rotation.y+=.001;camera.updateMatrixWorld();const start=performance.now();campus.update(camera);time.push(performance.now()-start);campus.group.traverse(o=>{for(const attr of [o.instanceMatrix,o.instanceColor])if(attr&&versions.get(attr)!==attr.version){versions.set(attr,attr.version);if(attr.updateRanges.length)byteCount+=attr.updateRanges.reduce((n,r)=>n+r.count*attr.array.BYTES_PER_ELEMENT,0);else byteCount+=attr.array.byteLength;attr.clearUpdateRanges();}});}
time.sort((a,b)=>a-b);const result={initialMs,spawn,meshes:rows.length,triangles:rows.reduce((n,r)=>n+r.triangles,0),calls:rows.reduce((n,r)=>n+r.calls,0),updateMs:{median:time[90],p95:time[171]},changedAttributeUploadBytesPerFrame:byteCount/180,top:rows.sort((a,b)=>b.triangles-a.triangles).slice(0,30)};
console.log(JSON.stringify(result,null,2));campus.dispose();
