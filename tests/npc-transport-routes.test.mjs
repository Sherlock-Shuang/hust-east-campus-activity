import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCampus3D} from '../src/campus-3d.js';
import {getReconstructionBuildings} from '../src/campus-feature-selection.js';
import {getBuildingProfile} from '../src/building-profiles.js';
import {waterFootprint} from '../src/water-details.js';
import {planWorldTransport} from '../src/world-transport.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {planNpcTransportRoutes,sampleNpcTransportRoute} from '../src/npc-transport-routes.js';

const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
function fixture(){const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,source,frame,geoToLocal),route=createCommuteRoute(source,{frame,geoToLocal});return{scene,model,route};}
function samples(plan,spacing=.5){return Array.from({length:Math.ceil(plan.length/spacing)+1},(_,i)=>sampleNpcTransportRoute(plan,i/Math.ceil(plan.length/spacing)*plan.periodSeconds));}

test('source campus gets only five stable ambient NPCs without modifying map or commute route',()=>{
  const {model,route}=fixture(),before=JSON.stringify(source),beforeRoute=JSON.stringify(route.points);
  try{
    const a=planNpcTransportRoutes({model,route}),b=planNpcTransportRoutes({model,route});
    assert.deepEqual(a,b);assert.equal(a.length,5);assert.equal(new Set(a.map(p=>p.id)).size,5);
    assert.deepEqual(a.map(p=>p.mode).sort(),['boat','helicopter','hoverboard','hoverboard','roadster']);
    assert.equal(JSON.stringify(source),before);assert.equal(JSON.stringify(route.points),beforeRoute);
    for(const plan of a){assert.ok(Object.isFrozen(plan));assert.ok(Object.isFrozen(plan.center));assert.ok(Object.isFrozen(plan.arc));assert.ok(plan.periodSeconds>15);}
  }finally{model.dispose();}
});

test('paths loop continuously at cruise speed and return the same supplied output object',()=>{
  const {model,route}=fixture();
  try{for(const plan of planNpcTransportRoutes({model,route})){
    const zero=sampleNpcTransportRoute(plan,0),end=sampleNpcTransportRoute(plan,plan.periodSeconds),output={};
    assert.ok(Math.hypot(zero.x-end.x,zero.y-end.y,zero.z-end.z)<1e-9);
    assert.ok(Math.abs(Math.sin(zero.yaw-end.yaw))<1e-9);
    assert.equal(sampleNpcTransportRoute(plan,3,output),output);
    for(const value of Object.values(output))assert.ok(Number.isFinite(value));
    assert.deepEqual(sampleNpcTransportRoute(plan,NaN),zero);
    const points=samples(plan,.2);
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],expected=plan.length/(points.length-1);
      const d=Math.hypot(b.x-a.x,b.z-a.z);
      assert.ok(Math.abs(d/expected-1)<.015,`${plan.id} constant speed`);
      assert.ok(Math.abs(Math.sin(a.yaw-b.yaw))<.12,`${plan.id} continuous heading`);
      const forward={x:-Math.sin(a.yaw),z:-Math.cos(a.yaw)};
      assert.ok(forward.x*(b.x-a.x)+forward.z*(b.z-a.z)>0,`${plan.id} faces travel`);
    }
    const early=sampleNpcTransportRoute(plan,-.001),late=sampleNpcTransportRoute(plan,.001);
    assert.ok(Math.hypot(early.x-late.x,early.z-late.z)<plan.speed*.0021,`${plan.id} phase wrap`);
  }}finally{model.dispose();}
});

test('full yacht hull remains in real water and clear of shoreline, islands, and moored pickups',()=>{
  const {model,route}=fixture();
  try{
    const plan=planNpcTransportRoutes({model,route}).find(p=>p.mode==='boat'),lake=model.water.find(r=>r.id===plan.sourceId),water=waterFootprint(lake);
    const motion=createPlayerMotion({route,world:createPlayerWorld(model)});
    const moored=planWorldTransport({model,route,groundAt:motion.groundAt,canPlaceMode:motion.canPlaceMode}).items.filter(p=>p.mode==='boat');
    assert.equal(moored.length,2);
    assert.equal(plan.height,lake.mesh.position.y);assert.ok(plan.center.x<140,'near west-shore player route');
    for(const p of samples(plan,.25)){
      assert.ok(water.contains(p.x,p.z));assert.ok(water.distance(p.x,p.z)>plan.radius+.45);
      for(const boat of moored)assert.ok(Math.hypot(p.x-boat.x,p.z-boat.z)>plan.radius+3.8,`${boat.id} moored hull clearance`);
      for(const x of [-1.2,0,1.2])for(const z of [-3.5,0,3.5]){
        const wx=p.x+Math.cos(p.yaw)*x+Math.sin(p.yaw)*z,wz=p.z-Math.sin(p.yaw)*x+Math.cos(p.yaw)*z;
        assert.ok(water.contains(wx,wz),'rotated hull cannot clip the shore');
      }
    }
  }finally{model.dispose();}
});

test('low board stays inside open lawn and all air loops clear source building roof heights',()=>{
  const {model,route}=fixture();
  try{
    const plans=planNpcTransportRoutes({model,route}),lawn=waterFootprint(model.records.find(r=>r.id==='way/98867860'));
    const obstacles=getReconstructionBuildings(model).map(r=>({footprint:waterFootprint(r),height:getBuildingProfile(r.feature).height+.065})).filter(p=>p.footprint);
    const board=plans.find(p=>p.id==='npc-hoverboard-yunyuan');assert.equal(board.height,11);
    for(const p of samples(board,.25)){assert.ok(lawn.contains(p.x,p.z));assert.ok(lawn.distance(p.x,p.z)>board.radius+.45);}
    for(const plan of plans.filter(p=>p.mode!=='boat'))for(const p of samples(plan,.5))for(const obstacle of obstacles){
      if(obstacle.footprint.contains(p.x,p.z)||obstacle.footprint.distance(p.x,p.z)<plan.radius)assert.ok(plan.height>=obstacle.height+plan.verticalClearance,`${plan.id} roof clearance`);
    }
  }finally{model.dispose();}
});

test('reconstruction infrastructure can raise an aircraft and suppress an unsafe low route',()=>{
  const {model,route}=fixture();
  try{
    const original=planNpcTransportRoutes({model,route}),board=original.find(p=>p.id==='npc-hoverboard-yunyuan'),c=board.center;
    model.architectureInfrastructure={buildings:[{id:'test/raised-structure',height:33,polygon:[{x:c.x-100,z:c.z-120},{x:c.x+100,z:c.z-120},{x:c.x+100,z:c.z+120},{x:c.x-100,z:c.z+120}]}]};
    const raised=planNpcTransportRoutes({model,route});
    assert.ok(!raised.some(p=>p.id===board.id));
    assert.equal(raised.find(p=>p.mode==='roadster').height,38);
    assert.equal(raised.find(p=>p.mode==='helicopter').height,45);
    model.architectureInfrastructure.buildings[0].height=80;
    assert.ok(planNpcTransportRoutes({model,route}).every(p=>p.sourceId!=='way/98867860'));
  }finally{model.dispose();}
});

test('missing or unusable source land and water omit routes instead of inventing paths',()=>{
  assert.deepEqual(planNpcTransportRoutes(),[]);
  assert.deepEqual(planNpcTransportRoutes({model:{},route:{points:[{x:0,z:0}]}}),[]);
  const {model,route}=fixture();
  try{
    const lake=model.water.find(r=>r.id==='relation/13705236');
    const narrow=new THREE.Shape();narrow.moveTo(0,0);narrow.lineTo(8,0);narrow.lineTo(8,200);narrow.lineTo(0,200);narrow.closePath();
    const unsafe={...model,records:[],water:[{...lake,shapes:[narrow]}]};
    assert.deepEqual(planNpcTransportRoutes({model:unsafe,route}),[]);
  }finally{model.dispose();}
});

test('five safe routes survive the complete current campus reconstruction',()=>{
  const {model,route}=fixture(),campus=createCampus3D(THREE,model,{frame,geoToLocal});
  try{
    const plans=planNpcTransportRoutes({model,route});assert.equal(plans.length,5);
    assert.deepEqual(plans.map(p=>[p.mode,p.height]),[['hoverboard',11],['roadster',28],['helicopter',45],['boat',.022],['hoverboard',13]]);
    for(const plan of plans)for(const pose of samples(plan,1))for(const n of Object.values(pose))assert.ok(Number.isFinite(n));
  }finally{campus.dispose();model.dispose();}
});
