import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createCampus3D} from '../src/campus-3d.js';
import {createBridgeDetails} from '../src/bridge-details.js';
import {createSurfaceMaterials} from '../src/surface-materials.js';
import {YUDAI_BRIDGE_PROFILE as P} from '../src/bridge-profile.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),original=JSON.stringify(source);
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const local=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
const route=createCommuteRoute(source,{frame,geoToLocal}),feature=source.features.find(f=>f.id==='way/456199549');
const record={id:feature.id,feature,category:'road',shapes:[]},model={records:[record],roads:[record],buildings:[],water:[]};
const campus=createCampus3D(THREE,model,{frame,geoToLocal});campus.group.updateMatrixWorld(true);
const path=id=>source.features.find(f=>f.id===id).geometry.coordinates.map(local),surfaces=createSurfaceMaterials(THREE);
const sidewalks=P.sidewalkIds.map(sourceId=>({sourceId,width:P.sidewalkWidth,points:path(sourceId)}));
const bridge=createBridgeDetails(THREE,{points:path(P.mainId),width:P.carriagewayWidth,surfaceY:.142,surfaces,sourceId:P.mainId,sidewalks});
const water=source.features.filter(f=>f.properties?.category==='water'&&['Polygon','MultiPolygon'].includes(f.geometry.type)).flatMap(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(rings=>({id:f.id,rings:rings.map(r=>r.map(local))})));
const center=polygon=>polygon.reduce((p,q)=>({x:p.x+q.x/polygon.length,z:p.z+q.z/polygon.length}),{x:0,z:0});
const advance=(motion,seconds,input)=>{for(let i=0;i<Math.round(seconds*120);i++)motion.step(1/120,input);};
const near=(a,b,tolerance=.0001)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} ~= ${b}`);
after(()=>{bridge.dispose();surfaces.dispose();campus.dispose();assert.equal(JSON.stringify(source),original,'source geometry was not rewritten');});

test('each visible high-bridge pier and rail has the same finite collider extent',()=>{
  const {barriers}=model.bridgeInfrastructure,piers=campus.group.getObjectByName('bridge-piers'),rails=campus.group.getObjectByName('bridge-rails');
  assert.equal(barriers.length,piers.count+rails.count);
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();
  for(const [mesh,label]of [[piers,'高架桥墩'],[rails,'桥侧护栏']]){
    const colliders=barriers.filter(b=>b.label===label);assert.equal(colliders.length,mesh.count);
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);const collider=colliders[i],point=center(collider.polygon);
      near(point.x,position.x);near(point.z,position.z);near(collider.minHeight,position.y-scale.y/2);near(collider.height,position.y+scale.y/2);
      if(mesh===piers){assert.equal(collider.polygon.length,8);near(Math.max(...collider.polygon.map(p=>Math.hypot(p.x-point.x,p.z-point.z))),scale.x*1.2);}
      else{const vertices=mesh.geometry.attributes.position,points=[];for(let j=0;j<vertices.count;j++)points.push(new THREE.Vector3().fromBufferAttribute(vertices,j).applyMatrix4(matrix));
        for(const axis of ['x','z']){near(Math.min(...collider.polygon.map(p=>p[axis])),Math.min(...points.map(p=>p[axis])));near(Math.max(...collider.polygon.map(p=>p[axis])),Math.max(...points.map(p=>p[axis])));}}
    }
  }
});

test('the rendered first high-bridge pier blocks a walking body while the open underpass remains traversable',()=>{
  const world=createPlayerWorld(model);assert.ok(world.barriers.some(b=>b.label==='高架桥墩'),'player world must receive authored bridge infrastructure');
  const pier=model.bridgeInfrastructure.barriers.find(b=>b.label==='高架桥墩'),p=center(pier.polygon);
  const blocked=createPlayerMotion({route,world});assert.equal(blocked.placeWalker({x:p.x-3,z:p.z,y:.14,yaw:-Math.PI/2}).ok,true);
  advance(blocked,2,{moveX:1,moveZ:0});assert.equal(blocked.state.blockedReason,'高架桥墩');assert.ok(blocked.state.x<p.x-.9);near(blocked.state.y,.14);
  const bypass=createPlayerMotion({route,world});assert.equal(bypass.placeWalker({x:p.x-3,z:p.z+2.2,y:.14,yaw:-Math.PI/2}).ok,true);
  advance(bypass,2,{moveX:1,moveZ:0});assert.equal(bypass.state.blockedReason,'');assert.ok(bypass.state.x>p.x+2);near(bypass.state.y,.14);
});

test('high-bridge rails block their visible elevation without closing the ground-level underpass',()=>{
  const world=createPlayerWorld(model),motion=createPlayerMotion({route,world}),rail=model.bridgeInfrastructure.barriers.find(b=>b.label==='桥侧护栏'),p=center(rail.polygon);
  assert.equal(motion.canPlaceMode({...p,y:.14,yaw:0},'walk').ok,true,'raised railing must not act as a ground-level wall');
  const blocked=motion.canPlaceMode({...p,y:11.14,yaw:0},'walk');assert.equal(blocked.ok,false);assert.equal(blocked.reason,'桥侧护栏');
});

test('the visible Yu-Dai shoulder triangles and sidewalk slabs are explicitly water-spanning support surfaces',()=>{
  const infrastructure=bridge.infrastructure,walk=createPlayerMotion({route,world:{water,walkSurfaces:infrastructure.walkSurfaces,barriers:infrastructure.barriers}});
  assert.ok(infrastructure.walkSurfaces.length>=4);assert.ok(infrastructure.walkSurfaces.every(s=>s.bridge===true));
  const geometry=bridge.group.getObjectByName('bridge-continuous-shoulders').geometry,verts=geometry.attributes.position;
  for(let i=0;i<verts.count;i+=3){
    const x=(verts.getX(i)+verts.getX(i+1)+verts.getX(i+2))/3,y=(verts.getY(i)+verts.getY(i+1)+verts.getY(i+2))/3,z=(verts.getZ(i)+verts.getZ(i+1)+verts.getZ(i+2))/3;
    const contact=walk.groundAt(x,z,0,y);assert.equal(contact.overWater,true,'actual river overlap exercises this regression');assert.equal(contact.allowed,true);assert.equal(contact.onBridge,true);
    assert.ok(contact.height>=y-.005&&contact.height<=y+.105,'support follows visible deck or its overlapping sidewalk');
    assert.equal(walk.canPlaceMode({x,y,z,yaw:0},'walk').ok,true,'visible concrete shoulder must not be an invisible water boundary');
  }
});

test('a walker crosses both real Yu-Dai shoulders from the carriageway onto the mapped sidewalks',()=>{
  const infrastructure=bridge.infrastructure,world={water,walkSurfaces:infrastructure.walkSurfaces,barriers:infrastructure.barriers};
  const [a,b]=path(P.mainId),length=Math.hypot(b.x-a.x,b.z-a.z),ax=(b.x-a.x)/length,az=(b.z-a.z)/length;
  for(const sidewalk of sidewalks){
    const target=center(sidewalk.points),station=(target.x-a.x)*ax+(target.z-a.z)*az,start={x:a.x+ax*station,z:a.z+az*station,y:.14,yaw:0};
    const distance=Math.hypot(target.x-start.x,target.z-start.z),dx=(target.x-start.x)/distance,dz=(target.z-start.z)/distance;
    const motion=createPlayerMotion({route,world});assert.equal(motion.placeWalker(start).ok,true);
    for(let i=0;i<900&&(motion.state.x-start.x)*dx+(motion.state.z-start.z)*dz<distance-.08;i++){
      motion.step(1/120,{moveX:dx,moveZ:dz});assert.equal(motion.state.blockedReason,'',`${sidewalk.sourceId}: ${motion.state.x}, ${motion.state.z}`);
      assert.ok(motion.state.y>=.14&&motion.state.y<=.25);
    }
    assert.ok(Math.hypot(motion.state.x-target.x,motion.state.z-target.z)<.15,sidewalk.sourceId);near(motion.state.y,.242);
  }
});

test('Yu-Dai outer rail collision remains outside the source carriageway and follows reversed sidewalk geometry',()=>{
  const reversed=createBridgeDetails(THREE,{points:path(P.mainId),width:P.carriagewayWidth,surfaceY:.142,surfaces,sourceId:P.mainId,sidewalks:sidewalks.map(s=>({...s,points:[...s.points].reverse()}))});
  const signature=barriers=>barriers.map(b=>({x:center(b.polygon).x.toFixed(5),z:center(b.polygon).z.toFixed(5),min:b.minHeight.toFixed(5),max:b.height.toFixed(5)})).map(JSON.stringify).sort();
  assert.deepEqual(signature(reversed.infrastructure.barriers),signature(bridge.infrastructure.barriers));
  const a=path(P.mainId)[0],b=path(P.mainId).at(-1),length=Math.hypot(b.x-a.x,b.z-a.z),nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
  for(const rail of bridge.infrastructure.barriers)for(const p of rail.polygon)assert.ok(Math.abs((p.x-a.x)*nx+(p.z-a.z)*nz)>13.9,'guard and its wider base must remain at the outer edge, beyond the carriageway');
  reversed.dispose();
});
