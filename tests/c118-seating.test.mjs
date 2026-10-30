import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {createC118Seating,c118SeatId,c118SeatedFov} from '../src/c118-seating.js';
import {createC118Navigation} from '../src/c118-navigation.js';
import {createC118Audience} from '../src/c118-audience.js';
const plan=planOptoC118Interior();

test('all chairs are addressable and nearby seat selection follows horizontal and terrace distance',()=>{
 const seating=createC118Seating(plan);assert.equal(seating.seats.length,520);assert.equal(new Set(seating.seats.map(s=>s.id)).size,520);
 const recommended=seating.recommendedSeat;assert.equal(recommended.block,'centre');assert.equal(recommended.row,2);assert.ok(Math.abs(recommended.x)<.3);
 assert.equal(seating.nearest({...recommended}),recommended);
 assert.equal(seating.nearest({x:0,y:0,z:50}),null);assert.equal(seating.nearest({...recommended,y:recommended.y+2}),null);
 assert.equal(seating.getSeat('missing'),null);assert.equal(seating.viewFor('missing'),null);assert.equal(seating.nearest({}),null);
});

test('the third-row view enlarges the whole screen and clears the people in front across common aspect ratios',()=>{
 const seating=createC118Seating(plan),seat=seating.recommendedSeat,view=seating.viewFor(seat.id);
 const screenZ=-plan.config.depth/2+.43,screenMidY=plan.stage.height+3.75;
 for(const aspect of[16/9,4/3,9/16,390/844]){
  const fov=c118SeatedFov(view,aspect);
  const camera=new THREE.PerspectiveCamera(fov,aspect,.07,90);camera.rotation.order='YXZ';camera.position.set(view.x,view.y,view.z);camera.rotation.set(view.pitch,view.yaw,0);camera.updateMatrixWorld();
  const corners=[];
  for(const x of[-4.9,4.9])for(const y of[screenMidY-3,screenMidY+3]){
   const p=new THREE.Vector3(x,y,screenZ).project(camera);corners.push(p);
   assert.ok(Math.abs(p.x)<.95&&Math.abs(p.y)<.95,`whole screen stays inside the comfortable frame at aspect ${aspect}`);
  }
  const width=(Math.max(...corners.map(p=>p.x))-Math.min(...corners.map(p=>p.x)))/2;
  assert.ok(width>.64&&width<.75,`screen occupies ${Math.round(width*100)}% of the viewport width`);
 }
 // The lower screen edge is the strictest line of sight. Even if a host later
 // fills any currently empty front chair, its head must not obscure the video.
 for(const row of plan.seatRows.filter(r=>r.row<seat.row)){
  const t=(view.z-row.z)/(view.z-screenZ),rayY=view.y+(screenMidY-3-view.y)*t;
  assert.ok(row.y+1.43<rayY,`row ${row.row+1} head clears the screen bottom`);
 }
});

test('standing up uses a safe original pose, and every fallback is accepted by the real capsule walker',()=>{
 const seating=createC118Seating(plan),motion=createC118Navigation({plan,spawn:plan.spawn,colliders:plan.colliders,walkSurfaces:plan.walkSurfaces});
 const original={...plan.spawn,yaw:.4,pitch:-.1};assert.deepEqual(seating.exitPoseFor(seating.recommendedSeat.id,original),original);
 for(const seat of seating.seats){
   const fallback=seating.exitPoseFor(seat.id,{x:seat.x,y:seat.y,z:seat.z});
   const result=motion.placeWalker(fallback);assert.equal(result.ok,true,seat.id+' exit reaches a walkable aisle');
   assert.ok(Math.abs(motion.state.y-fallback.y)<.03,'standing height matches the stepped floor');
 }
 assert.deepEqual(seating.exitPoseFor('unknown'),seating.exitPoseFor(seating.recommendedSeat.id));
});

test('virtual audience forms sparse groups with denser front rows, while every physical chair remains available',()=>{
 const audience=createC118Audience(THREE,{plan}),again=createC118Audience(THREE,{plan}),ids=audience.group.userData.seatIds;
 assert.equal(plan.seats.length,520);assert.ok(ids.length>=180&&ids.length<=230,`audience count ${ids.length}`);
 assert.equal(new Set(ids).size,ids.length);assert.deepEqual(ids,again.group.userData.seatIds,'placement is stable between visits');
 const occupied=new Set(ids),bands=[[0,7],[7,14],[14,20]].map(([start,end])=>{
  const seats=plan.seats.filter(s=>s.row>=start&&s.row<end);return seats.filter(s=>occupied.has(c118SeatId(s))).length/seats.length;
 });
 assert.ok(bands[0]>=.55&&bands[0]<=.7,`front occupancy ${bands[0]}`);
 assert.ok(bands[1]>=.3&&bands[1]<=.45,`middle occupancy ${bands[1]}`);
 assert.ok(bands[2]>=.08&&bands[2]<=.2,`rear occupancy ${bands[2]}`);
 const grouped=plan.seats.filter(s=>occupied.has(c118SeatId(s))&&[-1,1].some(offset=>occupied.has(c118SeatId({...s,column:s.column+offset}))));
 assert.ok(grouped.length/ids.length>.65,'most visitors sit in small adjacent groups');
 for(const row of plan.seatRows){const count=plan.seats.filter(s=>s.row===row.row&&occupied.has(c118SeatId(s))).length;assert.ok(count>0&&count<26,'every row retains visible empty chairs');}
 audience.dispose();again.dispose();
});

test('virtual audience hides only an occupied seat, handles empty chairs, and owns its resources',()=>{
 const before=JSON.stringify(plan),audience=createC118Audience(THREE,{plan}),group=audience.group;
 assert.ok(group.children.length<25,'sitting, walking and swimming share fewer than 25 instanced draws');assert.equal(group.userData.type,'virtual-audience');
 const totalTriangles=group.children.reduce((n,m)=>n+(m.geometry.index.count/3)*m.count,0);assert.ok(totalTriangles<280000,`audience triangles ${totalTriangles}`);
 assert.ok(group.children.every(m=>m.isInstancedMesh&&!m.castShadow));
 const clothing=group.children.find(m=>m.name==='c118-audience-clothing'),ids=group.userData.seatIds,a=new THREE.Matrix4(),b=new THREE.Matrix4();clothing.getMatrixAt(122,a);
 audience.setHiddenSeat(ids[122]);clothing.getMatrixAt(122,b);assert.equal(b.determinant(),0);clothing.getMatrixAt(121,b);assert.ok(b.determinant()>0);
 const v=clothing.instanceMatrix.version;audience.setHiddenSeat(ids[122]);assert.equal(clothing.instanceMatrix.version,v,'same seat does not upload again');
 audience.setHiddenSeat(ids[123]);clothing.getMatrixAt(122,b);assert.deepEqual([...b.elements],[...a.elements]);clothing.getMatrixAt(123,b);assert.equal(b.determinant(),0);
 const empty=plan.seats.find(s=>!ids.includes(c118SeatId(s)));audience.setHiddenSeat(c118SeatId(empty));clothing.getMatrixAt(123,b);assert.ok(b.determinant()>0,'moving to an empty chair restores the previous occupant without adding a new one');
 audience.setHiddenSeat(null);assert.equal(group.userData.count,ids.length);
 const geometry=new Set(group.children.map(m=>m.geometry)),materials=new Set(group.children.map(m=>m.material));let freedGeometry=0,freedMaterials=0;
 geometry.forEach(g=>g.addEventListener('dispose',()=>freedGeometry++));materials.forEach(m=>m.addEventListener('dispose',()=>freedMaterials++));
 audience.dispose();audience.dispose();assert.equal(freedGeometry,geometry.size);assert.equal(freedMaterials,materials.size);assert.equal(group.children.length,0);assert.equal(JSON.stringify(plan),before);
});

test('all hairstyles continuously cover the rear skull with outward-facing surfaces',()=>{
 const audience=createC118Audience(THREE,{plan}),group=audience.group,material=new THREE.MeshBasicMaterial();
 const skin=new THREE.Mesh(group.children.find(m=>m.name==='c118-audience-faces-hands').geometry,material),ray=new THREE.Raycaster();
 skin.updateMatrixWorld();
 for(const style of['short','long','tied']){
  const hair=new THREE.Mesh(group.children.find(m=>m.name===`c118-audience-hair-${style}`).geometry,material);hair.updateMatrixWorld();
  for(let level=0;level<=30;level++)for(let sample=0;sample<=35;sample++){
   const y=1.245+level*.005,phi=Math.PI*(.15+.7*sample/35),direction=new THREE.Vector3(-Math.cos(phi),0,-Math.sin(phi));
   ray.set(new THREE.Vector3(.4*Math.cos(phi),y,-.01+.4*Math.sin(phi)),direction);
   const skull=ray.intersectObject(skin)[0],cover=ray.intersectObject(hair)[0];
   assert.ok(skull&&cover&&cover.distance<skull.distance-.002,`${style} hair covers rear skull at height ${y.toFixed(3)}, angle ${phi.toFixed(3)}`);
  }
  ray.set(new THREE.Vector3(0,1.7,-.004),new THREE.Vector3(0,-1,0));
  assert.ok(ray.intersectObject(hair)[0].distance<ray.intersectObject(skin)[0].distance-.005,'closed crown stays outside the head');
 }
 material.dispose();audience.dispose();
});
