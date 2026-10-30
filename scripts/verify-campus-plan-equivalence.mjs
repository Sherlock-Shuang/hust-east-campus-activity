import * as THREE from 'three';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {planCampusLandcover} from '../src/campus-landcover.js';
import {planEastNineForecourt} from '../src/east-nine-forecourt.js';
import {planEastNinePlanting} from '../src/east-nine-planting.js';
import {createAquaticPlants,planAquaticPlants} from '../src/aquatic-plants.js';
import {createSurfaceMaterials} from '../src/surface-materials.js';
import {createEastNineGround} from '../src/east-nine-ground.js';
import {createCampusLawnLandmarks,planCampusLawnLandmarks} from '../src/campus-lawn-landmarks.js';
const root=new URL('../',import.meta.url);
async function original(file){const text=execFileSync('git',['show',`a120315:src/${file}`],{cwd:root,encoding:'utf8'}).replace(/from\s*'([^']+)'/g,(_,path)=>`from '${path.startsWith('.')?new URL(path,new URL(`src/${file}`,root)).href:import.meta.resolve(path)}'`);return import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);}
const oldAquatic=await original('aquatic-plants.js'),oldSurface=await original('surface-materials.js'),oldGround=await original('east-nine-ground.js'),oldPlanting=await original('east-nine-planting.js'),oldLawn=await original('campus-lawn-landmarks.js'),oldLandcover=await original('campus-landcover.js');
const read=name=>JSON.parse(readFileSync(new URL(`public/data/${name}`,root)));
const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson')),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal),options={frame,geoToLocal};
const forest=planCampusLandcover(model,options),oldForest=oldLandcover.planCampusLandcover(model,options);
for(const field of ['trees','shrubs','coverages','obstacles','counts'])assert.deepEqual(forest[field],oldForest[field],`landcover ${field}`);
const forecourt=planEastNineForecourt(model),plants=planEastNinePlanting(model,forecourt,{existingTrees:forest.trees}),oldPlants=oldPlanting.planEastNinePlanting(model,forecourt,{existingTrees:forest.trees});
for(const field of ['plants','soil','grass'])assert.deepEqual(plants[field],oldPlants[field],`forecourt ${field}`);
const lawn=planCampusLawnLandmarks(model,options),oldLawnPlan=oldLawn.planCampusLawnLandmarks(model,options);assert.deepEqual(lawn,oldLawnPlan,'lawn geometry and landmarks');
const aquaticOptions={record:model.water.find(r=>r.id==='relation/13705236'),roads:model.roads};assert.deepEqual(planAquaticPlants(aquaticOptions).leaves,oldAquatic.planAquaticPlants(aquaticOptions).leaves,'aquatic source positions');
const payload={landcover:{trees:forest.trees,shrubs:forest.shrubs,coverages:forest.coverages,counts:forest.counts},planting:{plants:plants.plants,soil:plants.soil,grass:plants.grass},lawn};
const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
function materialDigest(material){const hash=createHash('sha256');for(const key of['map','bumpMap','roughnessMap']){const texture=material[key];if(texture?.image?.data)hash.update(Buffer.from(texture.image.data.buffer,texture.image.data.byteOffset,texture.image.data.byteLength));}hash.update(JSON.stringify({name:material.name,color:material.color,roughness:material.roughness,bumpScale:material.bumpScale,metalness:material.metalness}));return hash.digest('hex');}
function renderDigest(group){const result=[];group.traverse(o=>{if(!o.isMesh)return;const h=createHash('sha256');for(const attr of Object.values(o.geometry.attributes))h.update(Buffer.from(attr.array.buffer,attr.array.byteOffset,attr.array.byteLength));if(o.geometry.index)h.update(Buffer.from(o.geometry.index.array.buffer));if(o.instanceMatrix)h.update(Buffer.from(o.instanceMatrix.array.buffer));for(const mat of(Array.isArray(o.material)?o.material:[o.material]))h.update(materialDigest(mat));result.push([o.name,h.digest('hex')]);});return result;}
const aquaticA=oldAquatic.createAquaticPlants(THREE,aquaticOptions),aquaticB=createAquaticPlants(THREE,aquaticOptions);assert.deepEqual(renderDigest(aquaticB.group),renderDigest(aquaticA.group),'aquatic geometry and pixels');aquaticA.dispose();aquaticB.dispose();
const surfaceA=oldSurface.createSurfaceMaterials(THREE),surfaceB=createSurfaceMaterials(THREE);
for(const key of Object.keys(surfaceA).filter(key=>key!=='dispose'))assert.equal(materialDigest(surfaceB[key]),materialDigest(surfaceA[key]),`surface pixel/material ${key}`);
const groundA=oldGround.createEastNineGround(THREE,model,{surfaces:surfaceA}),groundB=createEastNineGround(THREE,model,{surfaces:surfaceB});assert.deepEqual(groundB.infrastructure,groundA.infrastructure);assert.deepEqual(renderDigest(groundB.group),renderDigest(groundA.group),'ground geometry, paving pixels and material properties');
const lawnA=oldLawn.createCampusLawnLandmarks(THREE,model,{...options,surfaces:surfaceA}),lawnB=createCampusLawnLandmarks(THREE,model,{...options,surfaces:surfaceB});assert.deepEqual(renderDigest(lawnB.group),renderDigest(lawnA.group),'lawn geometry, inscription rock pixels and material properties');
for(const layer of[groundA,groundB,lawnA,lawnB])layer.dispose();surfaceA.dispose();surfaceB.dispose();
const report={baseline:'a120315',compared:['landcover source positions and clipping','east-nine accepted plants/soil/grass','lawn polygons, stones, canopies, tufts','surface material exact pixels/properties','east-nine ground geometry/texture/infrastructure','lawn render geometry/texture','aquatic source placement/geometry/texture'],result:'exact deep equality',hash};
const out=new URL('artifacts/performance-phase2-2026-10-30/',root);mkdirSync(out,{recursive:true});writeFileSync(new URL('source-plan-equivalence.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));model.dispose();
