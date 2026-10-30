import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {planOptoBuilding,OPTO_BUILDING_ID} from '../src/opto-building.js';
import {crossedInteriorDoor,nearbyInterior} from '../src/building-interiors.js';
import {campusLandmarkArrival} from '../src/campus-landmark-arrival.js';

const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
const base=read('east-campus.geojson'),extension=read('opto-southeast.geojson'),sourceBefore=JSON.stringify([base,extension]);
const data=mergeCampusExtension(base,extension);
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
const campus=createCampus3D(THREE,model,{frame,geoToLocal});
const world=createPlayerWorld(model),route=createCommuteRoute(data,{frame,geoToLocal});
const plan=planOptoBuilding(model.buildings.find(r=>r.id===OPTO_BUILDING_ID),{frame,geoToLocal});
const rendered=campus.records.get(OPTO_BUILDING_ID).group;
rendered.updateMatrixWorld(true);
after(()=>{campus.dispose();model.dispose();});
const local=(source,u,v)=>({x:source.x+source.tx*u+source.nx*v,z:source.z+source.tz*u+source.nz*v,y:.14,yaw:Math.atan2(source.nx,source.nz)});
const stateSummary=p=>JSON.stringify({x:p.x,y:p.y,z:p.z,grounded:p.grounded,blockedReason:p.blockedReason});

function walkPath(points,mode){
  const p=createPlayerMotion({world,route});
  assert.equal(p.placeMode(points[0],mode).ok,true,`${mode} path start ${JSON.stringify(points[0])}`);
  let sample={...p.state},tick=0;
  for(const target of points.slice(1)){
    let reached=false;
    for(let i=0;i<9000;i++){
      const dx=target.x-p.state.x,dz=target.z-p.state.z,d=Math.hypot(dx,dz);
      if(d<.06){reached=true;p.suspend();break;}
      const gain=Math.min(.7,d*1.7);
      p.step(1/120,{moveX:dx/d*gain,moveZ:dz/d*gain});
      assert.equal(p.state.blockedReason,'',`${mode} is blocked: ${stateSummary(p.state)}`);
      assert.equal(p.state.grounded,true,`${mode} remains grounded: ${stateSummary(p.state)}`);
      assert.ok(Math.abs(p.state.y-.14)<.035,`${mode} cannot snap onto a roof: ${stateSummary(p.state)}`);
      if(++tick%24===0){
        assert.equal(crossedInteriorDoor(campus.optoEntries,sample,p.state),null,'north passage/foyer is not a C118 teleport');
        assert.equal(nearbyInterior(campus.optoEntries,p.state),null,'north passage/foyer offers no false C118 prompt');
        sample={...p.state};
      }
    }
    assert.ok(reached,`${mode} target ${JSON.stringify(target)} unreachable from ${stateSummary(p.state)}`);
  }
  return p;
}

for(const mode of ['walk','spider']){
  test(`${mode}: from west through the north wing, turn south into the recess and return through both faces`,()=>{
    const n=plan.northPassage;
    // The first leg crosses the west outer face; the second exits the south
    // face into the mapped open recess. Do not claim a straight east tunnel.
    const path=[campusLandmarkArrival(campus,'opto-passage'),local(n,0,-12),local(n,22,-12)];
    walkPath([...path,...path.slice(0,-1).reverse()],mode);
  });

  test(`${mode}: from way/1483567205 into the rear foyer six metres and back onto the same service road`,()=>{
    const road=model.roads.find(r=>r.id==='way/1483567205');
    assert.equal(road.feature.geometry.type,'LineString');
    const points=road.feature.geometry.coordinates.map(c=>geoToLocal({longitude:c[0],latitude:c[1],coordinateSystem:'EPSG:4326'},frame));
    const connector=campus.optoApproachPlan.connectors.find(c=>c.id==='opto-rear-entry-approach');
    assert.ok(connector,'rear doorway must connect to a real source service road');
    assert.equal(connector.sourceId,road.id);
    const pose=p=>({...p,y:.14,yaw:0});
    const path=[pose(points.at(-2)),pose(points.at(-1)),pose(connector.b),local(plan.rear,0,-6)];
    const walked=walkPath([...path,...path.slice(0,-1).reverse()],mode);
    assert.ok(Math.hypot(walked.state.x-points.at(-2).x,walked.state.z-points.at(-2).z)<.08);
  });
}

function visibleSegment(a,b,y){
  const origin=new THREE.Vector3(a.x,y,a.z),end=new THREE.Vector3(b.x,y,b.z),direction=end.clone().sub(origin);
  const ray=new THREE.Raycaster(origin,direction.clone().normalize(),.002,direction.length()-.002);
  return ray.intersectObject(rendered,true)[0];
}

test('both north passage faces and the rear door are visually open at walking body heights',()=>{
  const n=plan.northPassage,r=plan.rear;
  for(const height of [.6,1.65,2.1,3])for(const offset of [-1,0,1]){
    const westHit=visibleSegment(local(n,offset,3),local(n,offset,-12),height);
    assert.equal(westHit,undefined,`north west aperture blocked by ${westHit?.object.name} at ${height} m`);
    const westReverse=visibleSegment(local(n,offset,-12),local(n,offset,3),height);
    assert.equal(westReverse,undefined,`north west aperture inside face blocked by ${westReverse?.object.name} at ${height} m`);
    const southHit=visibleSegment(local(n,0,-12+offset),local(n,22,-12+offset),height);
    assert.equal(southHit,undefined,`north south aperture blocked by ${southHit?.object.name} at ${height} m`);
    const southReverse=visibleSegment(local(n,22,-12+offset),local(n,0,-12+offset),height);
    assert.equal(southReverse,undefined,`north south aperture outside face blocked by ${southReverse?.object.name} at ${height} m`);
    const doorHit=visibleSegment(local(r,offset,2),local(r,offset,-6),height);
    assert.equal(doorHit,undefined,`rear door blocked by ${doorHit?.object.name} at ${height} m`);
    const reverse=visibleSegment(local(r,offset,-6),local(r,offset,2),height);
    assert.equal(reverse,undefined,`rear door inside face blocked by ${reverse?.object.name} at ${height} m`);
  }
});

test('ground openings retain overhead solids, adjacent walls and the bounded foyer end',()=>{
  const p=createPlayerMotion({world,route});
  for(const source of [plan.northPassage,plan.rear]){
    const middle=local(source,0,-5);
    assert.equal(p.placeMode(middle,'spider').ok,true,'ground opening remains traversable');
    assert.equal(p.canRestorePose({...p.state,y:3,grounded:false},'spider').ok,false,'upper volume still blocks a body crossing its 4.4 m soffit');
    const ray=new THREE.Raycaster(new THREE.Vector3(middle.x,2,middle.z),new THREE.Vector3(0,1,0),0,4);
    const hit=ray.intersectObject(rendered,true)[0];
    assert.ok(hit&&hit.point.y>=4.2&&hit.point.y<=4.41,'visible ceiling retained above the ground route');
  }
  assert.equal(p.placeMode(local(plan.northPassage,0,-24),'walk').ok,false,'opening does not erase the adjacent north wing');
  assert.equal(p.placeMode(local(plan.rear,0,-12),'walk').ok,false,'beyond the inner hall door the bounded passage still ends');
  for(const side of [-1,1]){
    assert.equal(p.placeMode(local(plan.rear,side*2.4,0),'spider').ok,false,'fixed side glazing stays solid');
    assert.ok(visibleSegment(local(plan.rear,side*2.4,2),local(plan.rear,side*2.4,-1),1.65),'fixed side glazing remains visible');
  }
  assert.equal(JSON.stringify([base,extension]),sourceBefore,'source GIS untouched');
  assert.equal(campus.optoEntries.length,5,'three auditorium entries plus the confirmed C1/C2 foyer doors');
});

test('both explicit north arrival links place walk and spider on clear ground',()=>{
  for(const place of ['opto-passage','opto-rear'])for(const mode of ['walk','spider']){
    const p=createPlayerMotion({world,route}),pose=campusLandmarkArrival(campus,place);
    assert.ok(pose);assert.equal(p.placeMode(pose,mode).ok,true,`${place}/${mode}`);
    assert.ok(Math.abs(p.state.y-.14)<.03);assert.equal(p.state.grounded,true);
    assert.equal(nearbyInterior(campus.optoEntries,p.state),null);
  }
});
