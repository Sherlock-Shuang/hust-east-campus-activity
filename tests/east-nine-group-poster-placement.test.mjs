import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {planEastNineBuildersPoster} from '../src/east-nine-builders-poster-placement.js';
import {EAST_NINE_GROUP_POSTER_SOURCE_ID,planEastNineGroupPoster} from '../src/east-nine-group-poster-placement.js';
import {createEastNinePosterFacadeCover} from '../src/east-nine-poster-facade-cover.js';

const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson')),sourceBefore=JSON.stringify(data);
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal});
campus.group.updateMatrixWorld(true);
const groupItem=planEastNineGroupPoster(model,{frame,geoToLocal}),xhsItem=planEastNineBuildersPoster(model,{frame,geoToLocal});
const world=createPlayerWorld(model),collisionBefore=JSON.stringify(model.architectureInfrastructure);
const player=createPlayerMotion({world,route:{points:[{x:400,z:400,y:.14},{x:1000,z:400,y:.14}]}});
const originals=new Map(),doors=[];
campus.group.traverse(object=>{
  if(object.isInstancedMesh&&object.userData.featureId===EAST_NINE_GROUP_POSTER_SOURCE_ID)originals.set(object,new Float32Array(object.instanceMatrix.array));
  if(object.userData.component==='double-glass-door')doors.push({object,matrix:object.matrixWorld.toArray()});
});
const xhsCover=createEastNinePosterFacadeCover(THREE,{scene:campus.group,placement:xhsItem});
const groupCover=createEastNinePosterFacadeCover(THREE,{scene:campus.group,placement:groupItem});
function bothVisible(){xhsCover.setVisible(true);groupCover.setVisible(true);campus.group.updateMatrixWorld(true);}
bothVisible();
after(()=>{groupCover.dispose();xhsCover.dispose();campus.dispose();model.dispose();});
const grid=[-.5,-.25,0,.25,.5];
const on=(item,u,v)=>new THREE.Vector3(item.x+item.nz*u*item.width,item.y+v*item.height,item.z-item.nx*u*item.width);

test('the original QQ crop fills the separate north-west source wall at full height and leaves the door clear',()=>{
  assert.ok(groupItem&&xhsItem);assert.equal(groupItem.sourceId,EAST_NINE_GROUP_POSTER_SOURCE_ID);
  assert.ok(groupItem.nz<-.98&&groupItem.x<groupItem.northEntrance.x&&xhsItem.x>xhsItem.northEntrance.x);
  assert.notDeepEqual(groupItem.sourceEdge,xhsItem.sourceEdge,'the two cards use different source facade edges');
  assert.deepEqual(groupItem.repeat,[.84,.59]);assert.deepEqual(groupItem.offset,[.08,.25]);
  assert.ok(Math.abs(groupItem.width/groupItem.height-(.84*1284)/(.59*2289))<1e-12,'the established cropped card keeps its original aspect');
  assert.ok(groupItem.height>19&&groupItem.width>15);assert.ok(groupItem.y-groupItem.height/2>.3);assert.ok(groupItem.y+groupItem.height/2<groupItem.wallHeight-.3);
  assert.ok(Math.hypot(groupItem.x-groupItem.northEntrance.x,groupItem.z-groupItem.northEntrance.z)-groupItem.width/2>35);
  assert.ok(Math.hypot(groupItem.x-xhsItem.x,groupItem.z-xhsItem.z)>(groupItem.width+xhsItem.width)/2+50);
  assert.ok(groupItem.qrRegion.left>0&&groupItem.qrRegion.right<1&&groupItem.qrRegion.top>0&&groupItem.qrRegion.bottom<1,'the complete QR quiet zone stays within the displayed original crop');
  assert.equal(JSON.stringify(data),sourceBefore);assert.equal(JSON.stringify(model.architectureInfrastructure),collisionBefore);
});

test('both full-height posters have real north wall support while their covers are enabled together',()=>{
  bothVisible();
  for(const item of[groupItem,xhsItem]){
    const normal=new THREE.Vector3(item.nx,0,item.nz);
    for(const u of grid)for(const v of grid){
      const origin=on(item,u,v).addScaledVector(normal,.65),hit=new THREE.Raycaster(origin,normal.clone().negate(),0,1.3).intersectObject(campus.group,true)[0];
      assert.equal(hit?.object.userData.component,'teaching-wing',`${item.id} (${u}, ${v}) covers ${hit?.object.userData.component||'empty space'}`);
      assert.equal(hit.object.userData.featureId,EAST_NINE_GROUP_POSTER_SOURCE_ID);assert.ok(Math.abs(hit.distance-.662)<.002);
    }
  }
});

test('the group card has clear whole-card and complete-QR walking views, connected by an unobstructed walk',()=>{
  bothVisible();
  for(const[kind,pose]of Object.entries({approach:groupItem.approach,inspection:groupItem.inspection})){
    assert.equal(player.placeWalker(pose).ok,true);assert.ok(Math.abs(player.state.y-.14)<.02);
    const eye=new THREE.Vector3(pose.x,player.state.y+1.65,pose.z),camera=new THREE.PerspectiveCamera(45,1280/720,.06,2000);
    camera.position.copy(eye);camera.rotation.set(-pose.pitch,pose.yaw,0,'YXZ');camera.updateMatrixWorld(true);
    for(const u of grid)for(const v of grid){
      const r=groupItem.qrRegion,point=kind==='approach'?on(groupItem,u,v):on(groupItem,r.left+(u+.5)*(r.right-r.left)-.5,.5-r.top-(v+.5)*(r.bottom-r.top));
      const projected=point.clone().project(camera);assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&projected.z>-1&&projected.z<1,`${kind}: intended image region fits a normal first-person camera`);
      const delta=point.sub(eye),distance=delta.length(),hit=new THREE.Raycaster(eye,delta.normalize(),0,distance-.005).intersectObject(campus.group,true)[0];
      assert.equal(Boolean(hit),false,`${kind} (${u}, ${v}) blocked by ${hit?.object.userData.component||hit?.object.name}`);
    }
  }
  player.placeWalker(groupItem.approach);
  for(let frameNumber=0;frameNumber<2400;frameNumber++){
    const dx=groupItem.inspection.x-player.state.x,dz=groupItem.inspection.z-player.state.z,distance=Math.hypot(dx,dz);
    if(distance<.14)break;
    const amount=Math.min(.45,Math.max(.035,distance*.16));player.step(1/60,{moveX:dx/distance*amount,moveZ:dz/distance*amount});
    assert.equal(player.state.blockedReason,'');assert.ok(Math.abs(player.state.y-.14)<.02);
  }
  assert.ok(Math.hypot(player.state.x-groupItem.inspection.x,player.state.z-groupItem.inspection.z)<.14);
});

test('the two covers change disjoint original instances, including floor bands, and restore independently',()=>{
  const changed=()=>{
    const result=new Map();
    for(const[mesh,before]of originals)for(let index=0;index<mesh.count;index++){
      const actual=mesh.instanceMatrix.array.subarray(index*16,index*16+16),saved=before.subarray(index*16,index*16+16);
      if(actual.some((value,i)=>value!==saved[i]))result.set(`${mesh.uuid}/${index}`,{mesh,index,actual:Array.from(actual),saved:Array.from(saved)});
    }
    return result;
  };
  const unchanged=items=>{for(const{mesh,index,actual}of items.values())assert.deepEqual(Array.from(mesh.instanceMatrix.array.subarray(index*16,index*16+16)),actual);};
  const restored=items=>{for(const{mesh,index,saved}of items.values())assert.deepEqual(Array.from(mesh.instanceMatrix.array.subarray(index*16,index*16+16)),saved);};
  try{
    groupCover.setVisible(false);xhsCover.setVisible(false);assert.equal(changed().size,0);
    xhsCover.setVisible(true);const xhsChanged=changed();xhsCover.setVisible(false);
    groupCover.setVisible(true);const groupChanged=changed();
    assert.ok(xhsChanged.size>100&&groupChanged.size>100);
    assert.ok([...xhsChanged.values()].some(item=>item.mesh.userData.component==='floor-band'));
    assert.ok([...groupChanged.values()].some(item=>item.mesh.userData.component==='floor-band'));
    assert.ok([...groupChanged.keys()].every(key=>!xhsChanged.has(key)),'no floor band or window instance belongs to both source-edge covers');
    xhsCover.setVisible(true);unchanged(xhsChanged);unchanged(groupChanged);
    groupCover.setVisible(false);unchanged(xhsChanged);restored(groupChanged);
    groupCover.setVisible(true);xhsCover.setVisible(false);unchanged(groupChanged);restored(xhsChanged);
  }finally{bothVisible();}
});

test('both posters preserve the north entrance, source data and walking infrastructure',()=>{
  bothVisible();assert.equal(doors.length,2);
  const n=new THREE.Vector3(groupItem.nx,0,groupItem.nz);
  for(const{object,matrix}of doors){
    assert.deepEqual(object.matrixWorld.toArray(),matrix);assert.equal(object.visible,true);
    const target=object.getWorldPosition(new THREE.Vector3()),hit=new THREE.Raycaster(target.clone().addScaledVector(n,3),n.clone().negate(),0,3.2).intersectObject(campus.group,true)[0];
    assert.equal(hit?.object.userData.component,'double-glass-door');
  }
  assert.equal(player.placeWalker(groupItem.entranceApproach).ok,true);
  const doorway={x:groupItem.northEntrance.x+groupItem.nx*2.6,z:groupItem.northEntrance.z+groupItem.nz*2.6,y:.14,yaw:groupItem.yaw};
  assert.equal(player.placeWalker(doorway).ok,true);
  assert.equal(JSON.stringify(data),sourceBefore);assert.equal(JSON.stringify(model.architectureInfrastructure),collisionBefore);
});

test('missing or changed source edge fails closed rather than reusing the XHS facade',()=>{
  const options={frame,geoToLocal};assert.equal(planEastNineGroupPoster(null,options),null);assert.equal(planEastNineGroupPoster(model),null);
  assert.equal(planEastNineGroupPoster({records:model.records.filter(record=>record.id!==EAST_NINE_GROUP_POSTER_SOURCE_ID)},options),null);
  assert.equal(planEastNineGroupPoster({records:model.records.filter(record=>record.id!=='way/655063746')},options),null);
  const source=model.records.find(record=>record.id===EAST_NINE_GROUP_POSTER_SOURCE_ID),changed={...source,feature:structuredClone(source.feature)};
  changed.feature.geometry.coordinates[0]=changed.feature.geometry.coordinates[0].filter(point=>Math.abs(point[0]-114.4208807)>1e-7||Math.abs(point[1]-30.5165372)>1e-7);
  const changedModel={records:model.records.map(record=>record===source?changed:record)};
  assert.equal(planEastNineGroupPoster(changedModel,options),null);assert.ok(planEastNineBuildersPoster(changedModel,options),'the independent east-side XHS placement still resolves');
});
