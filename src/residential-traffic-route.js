import {getRoadProfile} from './building-profiles.js';
import {createPlayerWorld} from './player-experience.js';
import {planYunyuanSouthPrecinct,YUNYUAN_SOUTH_BUILDING_ID} from './yunyuan-south-precinct.js';

// This is the previously empty north/south approach to the residential gate.
// The existing signal-aware commute already covers the junction and gate;
// these local loops stop well before that junction and never invent a crossing.
export const RESIDENTIAL_TRAFFIC_SOURCES=Object.freeze({gate:'node/1194858814',road:'way/98831423',eastWalk:'way/1483567161',westWalk:'way/1483567165'});
export const SOUTH_CANTEEN_TRAFFIC_SOURCES=Object.freeze({building:YUNYUAN_SOUTH_BUILDING_ID,walk:'way/1483567174',oneEntrance:'way/110398904',twoEntrance:'way/110398907'});
const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),TAU=Math.PI*2;
const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
function contains(ring,x,z){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
function edgeDistance(ring,x,z){let best=Infinity;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/Math.max(1e-12,dx*dx+dz*dz),0,1);best=Math.min(best,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));}return best;}
function tangent(points,i){const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],length=distance(a,b);return{x:(b.x-a.x)/length,z:(b.z-a.z)/length};}
function ribbons(points,width){const sides=points.map((p,i)=>{const t=tangent(points,i);return [{x:p.x-t.z*width/2,z:p.z+t.x*width/2},{x:p.x+t.z*width/2,z:p.z-t.x*width/2}];});return sides.slice(1).map((s,i)=>[sides[i][0],s[0],s[1],sides[i][1]]);}
function clipped(points,north,south){const result=[];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(Math.abs(b.z-a.z)<1e-8)continue;let lo=Math.max(0,Math.min((north-a.z)/(b.z-a.z),(south-a.z)/(b.z-a.z))),hi=Math.min(1,Math.max((north-a.z)/(b.z-a.z),(south-a.z)/(b.z-a.z)));if(hi<lo)continue;for(const t of[lo,hi]){const p=mix(a,b,t);if(!result.length||distance(p,result.at(-1))>.001)result.push(p);}}if(result.length>1&&result[0].z>result.at(-1).z)result.reverse();return result;}
function roundedClosed(points){
  const out=[];
  for(let i=0;i<points.length;i++){
    const before=points[(i+points.length-1)%points.length],p=points[i],after=points[(i+1)%points.length],a=distance(before,p),b=distance(p,after),trim=Math.min(.55,a*.22,b*.22),start=mix(p,before,trim/a),end=mix(p,after,trim/b);
    if(out.length){const previous=out.at(-1),count=Math.ceil(distance(previous,start)/.35);for(let j=1;j<count;j++)out.push(mix(previous,start,j/count));}
    for(let j=0;j<=4;j++){const t=j/4,u=1-t;out.push({x:u*u*start.x+2*u*t*p.x+t*t*end.x,z:u*u*start.z+2*u*t*p.z+t*t*end.z});}
  }
  const last=out.at(-1),first=out[0],count=Math.ceil(distance(last,first)/.35);for(let i=1;i<count;i++)out.push(mix(last,first,i/count));
  return out.filter((p,i)=>!i||distance(p,out[i-1])>1e-7);
}
function makeLoop(center,laneOffset){
  const sides=center.map((p,i)=>{const t=tangent(center,i),n={x:-t.z,z:t.x};return{p,t,n,a:{x:p.x+n.x*laneOffset,z:p.z+n.z*laneOffset},b:{x:p.x-n.x*laneOffset,z:p.z-n.z*laneOffset}};});
  const raw=sides.map(s=>s.a),end=sides.at(-1),start=sides[0];
  for(let i=1;i<=20;i++){const angle=i/20*Math.PI;raw.push({x:end.p.x+end.n.x*laneOffset*Math.cos(angle)+end.t.x*laneOffset*Math.sin(angle),z:end.p.z+end.n.z*laneOffset*Math.cos(angle)+end.t.z*laneOffset*Math.sin(angle)});}
  raw.push(...sides.slice(0,-1).reverse().map(s=>s.b));
  for(let i=1;i<20;i++){const angle=i/20*Math.PI;raw.push({x:start.p.x-start.n.x*laneOffset*Math.cos(angle)-start.t.x*laneOffset*Math.sin(angle),z:start.p.z-start.n.z*laneOffset*Math.cos(angle)-start.t.z*laneOffset*Math.sin(angle)});}
  return roundedClosed(raw);
}
function bounds(points){return{minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};}
function overlap(a,b,r){return a.minX-r<=b.maxX&&a.maxX+r>=b.minX&&a.minZ-r<=b.maxZ&&a.maxZ+r>=b.minZ;}
function obstacles(model){const w=createPlayerWorld(model),list=[];for(const o of [...w.buildings,...w.barriers,...w.water]){const rings=o.rings??(o.polygon?[o.polygon]:[]);if(!rings.length||rings[0].length<3)continue;if(w.water.includes(o)||((o.height??0)>.15&&(o.minHeight??0)<2.2))list.push({rings,bounds:bounds(rings.flat())});}return list;}
function collisionFree(points,radius,corridors,blocks){
  const local=blocks.filter(b=>overlap(bounds(points),b.bounds,radius+.4));
  for(const p of points){
    for(let i=-1;i<12;i++){const a=i/12*TAU,x=p.x+(i<0?0:Math.cos(a)*(radius+.035)),z=p.z+(i<0?0:Math.sin(a)*(radius+.035));if(!corridors.some(c=>contains(c,x,z)))return false;}
    for(const b of local){const inBlock=contains(b.rings[0],p.x,p.z)&&!b.rings.slice(1).some(r=>contains(r,p.x,p.z));if(inBlock||b.rings.some(r=>edgeDistance(r,p.x,p.z)<radius+.035))return false;}
  }
  return true;
}
function finishPath(points,config,center,corridors){
  const distances=[0];for(let i=1;i<=points.length;i++){const d=distance(points[i-1],points[i%points.length]);distances.push(distances.at(-1)+d);}
  const headings=points.map((p,i)=>{const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];return Math.atan2(a.x-b.x,a.z-b.z);});
  const north=center[0],south=center.at(-1);
  return Object.freeze({...config,points:Object.freeze(points.map(p=>Object.freeze(p))),distances:Object.freeze(distances),headings:Object.freeze(headings),length:distances.at(-1),centerline:Object.freeze(center.map(p=>Object.freeze(p))),corridors:Object.freeze(corridors.map(p=>Object.freeze(p.map(v=>Object.freeze(v))))),turnCenters:Object.freeze([north,south]),bounds:Object.freeze(bounds(points))});
}

function appendSouthCanteenPaths({model,frame,geoToLocal,byId,project,blocks,paths,rejected}){
  const south=planYunyuanSouthPrecinct(model,{frame,geoToLocal}),record=byId.get(SOUTH_CANTEEN_TRAFFIC_SOURCES.walk),feature=record?.feature,profile=feature&&getRoadProfile(feature);
  // Both loops belong to the mapped pavement immediately in front of the
  // photographed stair entrances, not the road across from the canteens.
  // Their short extents leave the stair mouths, connecting steps and southern
  // zebra crossing clear. The upper gallery is deliberately not a ground path.
  const configs=[
    {id:'south-canteen-one-front',hallId:'xueyi',entranceId:SOUTH_CANTEEN_TRAFFIC_SOURCES.oneEntrance,north:224,south:231.5,speed:1.08},
    {id:'south-canteen-two-front',hallId:'xueer',entranceId:SOUTH_CANTEEN_TRAFFIC_SOURCES.twoEntrance,north:177.3,south:182.5,speed:1.04},
  ];
  for(const config of configs){
    const entrance=south.stairs.find(s=>s.id===config.entranceId);
    if(!south.accepted||!entrance||feature?.geometry?.type!=='LineString'||profile.bridge||profile.tunnel||profile.elevation!==0){rejected.push({id:config.id,reason:'missing-or-nonground-canteen-pavement'});continue;}
    const source=feature.geometry.coordinates.map(project),center=clipped(source,config.north,config.south),laneOffset=.5,bodyRadius=.48;
    if(center.length<2||Math.abs(center[0].z-config.north)>.01||Math.abs(center.at(-1).z-config.south)>.01){rejected.push({id:config.id,reason:'source-does-not-cover-canteen-entrance'});continue;}
    const points=makeLoop(center,laneOffset),corridors=ribbons(source,profile.width);
    if(!collisionFree(points,bodyRadius,corridors,blocks)){rejected.push({id:config.id,reason:'source-pavement-or-static-obstacle'});continue;}
    paths.push(finishPath(points,{id:config.id,hallId:config.hallId,region:'south-canteen',kind:'walk',count:4,speed:config.speed,laneOffset,bodyRadius,y:south.floorY,width:profile.width,sourceId:SOUTH_CANTEEN_TRAFFIC_SOURCES.walk,sourceIds:Object.freeze([SOUTH_CANTEEN_TRAFFIC_SOURCES.walk,south.sourceId,config.entranceId]),entrance:Object.freeze({id:config.entranceId,x:entrance.a.x,z:entrance.a.z})},center,corridors));
  }
}

/** Source-backed, small pedestrian/cycle flow on Qiming Road towards the gate.
 * All safety checks run once; the hot sampler only reads prepared arrays. */
export function planResidentialTrafficRoute({model,route,frame,geoToLocal}={}){
  const empty={accepted:false,region:'韵苑食堂至生活区门 · 启明路路口南侧',gate:null,paths:[],rejected:[]};
  if(!model?.records||!route?.points||!frame||typeof geoToLocal!=='function')return empty;
  const byId=new Map(model.records.map(r=>[r.id,r])),gateRecord=byId.get(RESIDENTIAL_TRAFFIC_SOURCES.gate);
  if(gateRecord?.feature?.geometry?.type!=='Point'||gateRecord.feature.properties?.tags?.barrier!=='gate')return empty;
  const project=c=>{const p=geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);return{x:p.x,z:p.z};};
  const gate={id:RESIDENTIAL_TRAFFIC_SOURCES.gate,...project(gateRecord.feature.geometry.coordinates)},blocks=obstacles(model),paths=[],rejected=[];
  const configs=[{id:'residential-road',sourceId:RESIDENTIAL_TRAFFIC_SOURCES.road,kind:'scooter',count:6,speed:3.7,laneOffset:1.7,bodyRadius:1.02},
    {id:'residential-east-walk',sourceId:RESIDENTIAL_TRAFFIC_SOURCES.eastWalk,kind:'walk',count:3,speed:1.35,laneOffset:.37,bodyRadius:.48},
    {id:'residential-west-walk',sourceId:RESIDENTIAL_TRAFFIC_SOURCES.westWalk,kind:'walk',count:3,speed:1.3,laneOffset:.37,bodyRadius:.48}];
  for(const config of configs){
    const record=byId.get(config.sourceId),feature=record?.feature,profile=feature&&getRoadProfile(feature);
    if(feature?.geometry?.type!=='LineString'||profile.bridge||profile.tunnel||profile.elevation!==0){rejected.push({id:config.id,reason:'missing-or-nonground-source-road'});continue;}
    const source=feature.geometry.coordinates.map(project),center=clipped(source,-33,64);
    if(center.length<2||Math.abs(center[0].z+33)>.01||Math.abs(center.at(-1).z-64)>.01){rejected.push({id:config.id,reason:'source-does-not-cover-approach'});continue;}
    const points=makeLoop(center,config.laneOffset),corridors=ribbons(source,profile.width);
    if(!collisionFree(points,config.bodyRadius,corridors,blocks)){rejected.push({id:config.id,reason:'source-pavement-or-static-obstacle'});continue;}
    paths.push(finishPath(points,{...config,y:profile.elevation+.14+(profile.motor?.002:0),sourceIds:Object.freeze([config.sourceId]),width:profile.width},center,corridors));
  }
  appendSouthCanteenPaths({model,frame,geoToLocal,byId,project,blocks,paths,rejected});
  return{...empty,gate,accepted:paths.length>0,paths,rejected,coordinateSystem:'LOCAL_ENU',units:'metres',basis:'source Qiming road, separately mapped sidewalks and student-canteen stair entrances; estimated display width; game-local turnaround behaviour, not measured traffic'};
}

/** Arc-length distance may grow indefinitely; wraps continuously without a
 * respawn. Forward -Z heading and total progress suit the existing actor rig. */
export function sampleResidentialTrafficPath(path,distanceAlong,out={}){
  const distance=finite(distanceAlong)?distanceAlong:0,s=((distance%path.length)+path.length)%path.length,ds=path.distances;
  let lo=0,hi=ds.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(ds[mid]<=s)lo=mid;else hi=mid;}
  const next=(lo+1)%path.points.length,a=path.points[lo],b=path.points[next],t=(s-ds[lo])/Math.max(1e-10,ds[lo+1]-ds[lo]);
  out.x=a.x+(b.x-a.x)*t;out.y=path.y;out.z=a.z+(b.z-a.z)*t;
  const yaw=path.headings[lo],delta=Math.atan2(Math.sin(path.headings[next]-yaw),Math.cos(path.headings[next]-yaw));out.yaw=yaw+delta*t;
  const first=path.turnCenters[0],last=path.turnCenters[1],nearTurn=Math.min(Math.hypot(out.x-first.x,out.z-first.z),Math.hypot(out.x-last.x,out.z-last.z));
  out.speed=path.kind==='scooter'?1.25+(path.speed-1.25)*clamp((nearTurn-path.laneOffset-1)/5,0,1):path.speed;
  out.progress=distance;out.direction=out.z>path.centerline[0].z&&Math.cos(out.yaw)<0?1:-1;
  return out;
}
