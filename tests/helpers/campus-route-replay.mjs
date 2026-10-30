/** Segmented route regression against the complete rendered campus collider
 * world. Separate route starts are intentional; no unverified straight-line
 * connection between districts is asserted. This is CPU physics, not UI QA. */
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../../src/geo-scene.js';
import {createCampus3D} from '../../src/campus-3d.js';
import {createLocalFrame,geoToLocal} from '../../src/geospatial.js';
import {mergeCampusExtension} from '../../src/campus-data-merge.js';
import {createPlayerWorld} from '../../src/player-experience.js';
import {createPlayerMotion} from '../../src/player-motion.js';
import {createCommuteRoute} from '../../src/commute-route.js';
import {crossedInteriorDoor,nearbyInterior} from '../../src/building-interiors.js';
import {YUDAI_BRIDGE_PROFILE} from '../../src/bridge-profile.js';

const midpoint=points=>points.reduce((p,q)=>({x:p.x+q.x/points.length,z:p.z+q.z/points.length}),{x:0,z:0});
const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
export const ROUTE_FRAME_PROFILES=[20,30,60].flatMap(hz=>[
  {id:`${hz}Hz`,hz,frame:n=>1/hz},
  {id:`${hz}Hz+100-250ms`,hz,frame:n=>n%37===12?.1:n%37===29?.25:1/hz},
]);

export function createCampusRouteFixture(){
  const read=name=>JSON.parse(readFileSync(new URL(`../../public/data/${name}`,import.meta.url),'utf8'));
  const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson'));
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal});
  const world=createPlayerWorld(model),route=createCommuteRoute(data,{frame,geoToLocal});
  const local=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
  const path=id=>data.features.find(f=>f.id===id).geometry.coordinates.map(local),cases=[];
  function add(id,label,points,{startY=.14,minY=.13,maxY=.3,entry=null,sourceIds=[]}={}){
    if(points.length<2)throw new Error(`${id} needs a path`);
    cases.push({id,label,points,startY,minY,maxY,entry,sourceIds,length:points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0)});
  }
  const south=campus.yunyuanSouthPlan;
  for(const stair of south.stairs){
    const start=mix(stair.first,stair.b,-.8/distance(stair.first,stair.b));
    add(`canteen-stair-${stair.id}`,'学生食堂台阶上行与原路下行',[start,stair.b,start],{maxY:3.55,sourceIds:[stair.id]});
  }
  const gallery=south.galleries[1];
  add('canteen-ground-gallery','食堂门面下层通廊',[mix(gallery.a,gallery.b,.1),mix(gallery.a,gallery.b,.9)],{sourceIds:['way/110398905']});
  add('canteen-upper-gallery','食堂二层连廊',[mix(gallery.a,gallery.b,.1),mix(gallery.a,gallery.b,.9)],{startY:3.54,minY:3.53,maxY:3.55,sourceIds:['way/110398905']});
  for(const id of ['way/1483567195','way/1483567196','way/1483567197'])add(`cbd-${id}`,'CBD 店铺前源道路',path(id),{sourceIds:[id]});
  for(const id of [YUDAI_BRIDGE_PROFILE.mainId,...YUDAI_BRIDGE_PROFILE.sidewalkIds])add(`bridge-${id}`,'喻岱桥车行或人行桥面',path(id),{startY:id===YUDAI_BRIDGE_PROFILE.mainId?.14:.242,maxY:.26,sourceIds:[id]});
  const pier=model.bridgeInfrastructure.barriers.find(b=>b.label==='高架桥墩'),p=midpoint(pier.polygon);
  add('high-bridge-underpass','高架首个桥墩旁地面通行',[{x:p.x-3,z:p.z+2.2},{x:p.x+3,z:p.z+2.2}],{sourceIds:[pier.sourceId]});
  const surfaces=model.architectureInfrastructure.walkSurfaces;
  const landing=surfaces.find(s=>s.id==='east-nine-a-east-landing'),first=surfaces.find(s=>s.id==='east-nine-a-east-step-1');
  const a=midpoint(landing.polygon),b=midpoint(first.polygon),outside=mix(a,b,1+4/distance(a,b));
  add('east-nine-entry-stairs','东九 A 东端门前台阶往返',[outside,a,outside],{maxY:1.14,sourceIds:['way/1023544717','east-nine-a-east-landing']});
  const arcade=model.architectureInfrastructure.viewpoints.arcade;
  add('east-nine-arcade','东九柱廊中段纵向通行',[{x:arcade.x,z:arcade.z-8},{x:arcade.x,z:arcade.z+8}],{maxY:.55,sourceIds:['way/1023544717']});
  for(const entry of campus.optoEntries){
    // C1 is tested as its own exterior portal. Start the legacy inner-door case inside it.
    const path=entry.id==='opto-c118-left-hall'?entry.accessPath.slice(1):entry.accessPath;
    add(entry.id,'光电楼门厅与报告厅入口',path,{startY:entry.approach.y??.14,maxY:1.7,entry,sourceIds:[entry.id]});
  }
  return{world,route,campus,model,cases,dispose(){campus.dispose();model.dispose();}};
}

export function replayCampusSegment(fixture,segment,profile){
  const player=createPlayerMotion({world:fixture.world,route:fixture.route}),points=segment.points;
  const yaw=Math.atan2(points[0].x-points[1].x,points[0].z-points[1].z);
  const placed=player.placeWalker({...points[0],y:segment.startY,yaw});
  const result={segment:segment.id,label:segment.label,profile:profile.id,lengthMetres:segment.length,sourceIds:segment.sourceIds,passed:false,spawn:placed.ok,frames:0,longFrames:0,elapsedSeconds:0,minY:player.state.y,maxY:player.state.y,maxFrameRise:0,blockedFrames:0,blockedReasons:[],waypointsReached:0,crossedDoor:null,returnClear:null};
  if(!placed.ok){result.failure=`Spawn blocked: ${placed.reason}`;return result;}
  const reasons=new Set();let previous={...player.state},crossed=null;
  for(const [index,target]of points.slice(1).entries()){
    let reached=false,segmentTime=0;const timeout=distance(player.state,target)/1.2+30;
    while(segmentTime<timeout){
      const dx=target.x-player.state.x,dz=target.z-player.state.z,d=Math.hypot(dx,dz);
      if(d<.14){reached=true;result.waypointsReached++;break;}
      // A deterministic low-speed route follower, not gameplay/autopilot code.
      // Approach slowly so sampled inputs at 20 Hz do not orbit a waypoint.
      const amount=Math.min(.45,Math.max(.035,d*.16)),dt=profile.frame(result.frames);
      player.step(dt,{moveX:dx/d*amount,moveZ:dz/d*amount});
      result.frames++;if(dt>=.1)result.longFrames++;result.elapsedSeconds+=dt;segmentTime+=dt;
      if(player.state.blockedReason){result.blockedFrames++;reasons.add(player.state.blockedReason);}
      result.minY=Math.min(result.minY,player.state.y);result.maxY=Math.max(result.maxY,player.state.y);result.maxFrameRise=Math.max(result.maxFrameRise,player.state.y-previous.y);
      if(!['x','y','z','speed','yaw'].every(key=>Number.isFinite(player.state[key]))){result.failure='Non-finite motion state';break;}
      if(player.state.y<segment.minY-1e-5||player.state.y>segment.maxY+1e-5){result.failure=`Height left expected band [${segment.minY}, ${segment.maxY}]`;break;}
      if(segment.entry){crossed=crossedInteriorDoor(fixture.campus.optoEntries,previous,player.state);if(crossed){result.crossedDoor=crossed.id;reached=index===points.length-2;break;}}
      previous={...player.state};
    }
    if(result.failure||!reached){result.failure||=`Waypoint ${index+1} blocked or timed out`;break;}
    if(crossed)break;
    // Release the control between authored path turns, just as in existing
    // entrance tests. No position or height teleport is used between waypoints.
    player.suspend();previous={...player.state};
  }
  result.end={x:player.state.x,y:player.state.y,z:player.state.z};result.blockedReasons=[...reasons];
  result.endDistanceMetres=distance(player.state,points.at(-1));
  if(segment.entry){
    result.returnClear=player.placeWalker(segment.entry.returnPose).ok&&nearbyInterior([segment.entry],player.state)===null;
    if(crossed?.id!==segment.entry.id)result.failure||='Did not cross intended inner auditorium door';
    if(!result.returnClear)result.failure||='Return pose overlaps an entrance trigger or collider';
  }
  result.passed=!result.failure;return result;
}
