// Deterministic CPU query/movement benchmark on the current reconstructed map.
// Optional SPATIAL_BASELINE points to a directory containing the three original
// player-motion.js, player-camera.js and web-swing-motion.js modules. Not GPU/FPS.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createPlayerWorld,getCampusPlayerSpawn} from '../src/player-experience.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {campusLandmarkArrival} from '../src/campus-landmark-arrival.js';
import {getBuildingSpatialIndex} from '../src/building-spatial-index.js';
import * as motion from '../src/player-motion.js';
import * as camera from '../src/player-camera.js';
import * as swing from '../src/web-swing-motion.js';
const after={...motion,...camera,...swing};
const baseline=process.env.SPATIAL_BASELINE;
const before=baseline?Object.assign({},...await Promise.all(['player-motion','player-camera','web-swing-motion'].map(name=>import(pathToFileURL(`${baseline}/${name}.js`).href)))):null;
const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal});
const world=createPlayerWorld(model),route=createCommuteRoute(data,{frame,geoToLocal}),index=getBuildingSpatialIndex(world.buildings);
const poses=[getCampusPlayerSpawn(model),...['canteen-shops','cbd','opto-left','opto-rear'].map(place=>campusLandmarkArrival(campus,place))].filter(Boolean);
const hash=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>typeof v==='number'?Math.round(v*1e8)/1e8:v)).digest('hex');
function createRun(api,kind){
  const player=api.createPlayerMotion({world,route}),states=[];
  const web=kind==='web-lines'?api.createWebSwingMotion({state:player.state,world,groundAt:player.groundAt}):null;
  return()=>{
    states.length=0;
    for(const pose of poses){
      const mode=kind==='spider'?'spider':kind==='flight'?'hoverboard':'walk';
      player.reset(0,mode);Object.assign(player.state,{...pose,y:kind==='flight'?35:(pose.y??.14),grounded:kind!=='flight',rotorPower:1,flightEnabled:true});
      for(let n=0;n<240;n++){
        if(kind==='camera'){
          const state={...player.state,mode:n%2?'spider':'walk',x:pose.x+Math.sin(n*.03)*12,y:1+n%60*.3,z:pose.z+Math.cos(n*.03)*12,yaw:n*.025,vx:0,vz:-12,speed:12};
          const options={world,groundAt:player.groundAt,pitch:Math.sin(n*.01)*.4};
          states.push(api.constrainPlayerCamera(state,api.calculatePlayerCamera(state,options),options));
        }else if(kind==='web-lines'){
          states.push(web.lineClear({x:pose.x,y:2+n%30,z:pose.z},{x:pose.x+Math.cos(n*.15)*60,y:22,z:pose.z+Math.sin(n*.15)*60}));
        }else{
          player.step(n%101===100?.125:1/60,{moveX:-Math.sin(pose.yaw),moveZ:-Math.cos(pose.yaw),forward:1,fast:true,turn:n>120?.18:0,swing:mode==='spider'&&n%90<75,jump:mode==='spider'&&n%90===0,vertical:mode==='hoverboard'?.2:0});
          if(n%20===0)states.push({...player.state});
        }
      }
    }
    return hash(states);
  };
}
const quantile=(rows,q)=>[...rows].sort((a,b)=>a-b)[Math.min(rows.length-1,Math.floor(rows.length*q))];
const results=[];
for(const kind of ['walk','flight','spider','camera','web-lines']){
  const next=createRun(after,kind),old=before&&createRun(before,kind);
  const nextHash=next(),oldHash=old?.();
  if(old&&nextHash!==oldHash)throw new Error(`${kind}: baseline trace mismatch`);
  next();old?.();
  const times={after:[],before:[]};
  for(let n=0;n<7;n++)for(const [label,fn]of n%2?[['after',next],['before',old]]:[['before',old],['after',next]])if(fn){const start=performance.now();fn();times[label].push(performance.now()-start);}
  const a=quantile(times.after,.5),b=old?quantile(times.before,.5):null;
  results.push({kind,poses:poses.length,framesOrQueriesPerPose:240,traceHash:nextHash,identicalToBaseline:old?nextHash===oldHash:null,afterMedianMs:a,beforeMedianMs:b,medianReductionPercent:b?100*(1-a/b):null,afterRangeMs:[Math.min(...times.after),Math.max(...times.after)],beforeRangeMs:old?[Math.min(...times.before),Math.max(...times.before)]:null});
}
let candidateCount=0,queries=0;
for(const p of poses)for(let n=0;n<240;n++){candidateCount+=index.querySegment({x:p.x,z:p.z},{x:p.x+Math.cos(n*.15)*60,z:p.z+Math.sin(n*.15)*60}).length;queries++;}
console.log(JSON.stringify({description:'Local Node CPU benchmark; exact trace comparison at five reconstructed-campus locations, not GPU time/FPS or physical low-end hardware.',baseline:baseline||null,node:process.version,buildingVolumes:world.buildings.length,cells:index.cellCount,averageCandidates:candidateCount/queries,fullScanCandidates:world.buildings.length,results},null,2));
campus.dispose();model.dispose();
