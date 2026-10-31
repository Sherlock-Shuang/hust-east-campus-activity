import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
import {createCommuteScene} from '../src/commute-scene.js';
import {sampleActorPose} from '../src/commute-actors.js';
import {sampleVehicleContact} from '../src/vehicle-contact.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

const fc=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
function fixture(t){
  const sourceRoute=createCommuteRoute(fc,{frame,geoToLocal});
  // Deliberately high main-road profile exposes accidental sampling of branch
  // gait distance as a main-route bridge position.
  const route={...sourceRoute,points:sourceRoute.points.map(p=>({...p,y:25}))};
  const sim=createCommuteSimulation(route,{peakAgents:0,maxAgents:30,flowScale:0});
  const render=createCommuteScene(THREE,new THREE.Scene(),route,sim);t.after(()=>render.dispose());
  const meshes=()=>render.group.children.filter(o=>o.isInstancedMesh&&/scooter|pedestrian/.test(o.userData.component));
  const body=(id,label='electric-scooter')=>meshes().find(m=>m.userData.component===label&&m.userData.part==='paint'&&m.userData.joint==='fixed'&&m.userData.agentIds.includes(id));
  return {route,sim,render,meshes,body};
}
function actor(id,kind='scooter',overrides={}){return{id,kind,type:kind,originalKind:kind,active:true,phase:'moving',x:0,y:.16,z:0,yaw:.3,progress:50,speed:kind==='walk'?1.35:3,groundSpeed:3,lean:0,steeringAngle:0,footDown:0,colorIndex:2,pathScale:1,direction:1,waitingTime:0,...overrides};}
const matrixFor=(mesh,id)=>{assert.ok(mesh,'Expected actor batch');const matrix=new THREE.Matrix4();mesh.getMatrixAt(mesh.userData.agentIds.indexOf(id),matrix);return matrix;};
function sameMatrix(actual,expected,message='matrix'){for(let i=0;i<16;i++)assert.ok(Math.abs(actual.elements[i]-expected.elements[i])<.00001,`${message} element ${i}`);}
const world=(a,y,pitch=0)=>new THREE.Matrix4().makeTranslation(a.x,y,a.z).multiply(new THREE.Matrix4().makeRotationY(a.yaw)).multiply(new THREE.Matrix4().makeRotationX(pitch));

test('independent branch scooters keep their own ground contact while main traffic still samples the route',t=>{
  const f=fixture(t),branch=actor(900001,'scooter',{contactMode:'independent',groundPitch:0}),main=actor(1,'scooter',{x:4,y:.16});
  f.sim.state.agents=[branch,main];f.render.update();
  const originalMain=matrixFor(f.body(main.id),main.id),mainContact=sampleVehicleContact(f.route,main);
  sameMatrix(originalMain,world(main,mainContact.y,mainContact.pitch));assert.ok(mainContact.y>20);
  sameMatrix(matrixFor(f.body(branch.id),branch.id),world(branch,.139));
  branch.groundPitch=.17;f.render.update();sameMatrix(matrixFor(f.body(branch.id),branch.id),world(branch,.139,.17),'changed independent pitch invalidates cache');
  sameMatrix(matrixFor(f.body(main.id),main.id),originalMain,'main actor remains identical');
  branch.contactMode=undefined;f.render.update();const contact=sampleVehicleContact(f.route,branch);
  sameMatrix(matrixFor(f.body(branch.id),branch.id),world(branch,contact.y,contact.pitch),'contact-mode change invalidates cache');
});

test('branch pedestrians reuse the existing walking gait and stop animation when speed is zero',t=>{
  const f=fixture(t),walker=actor(900002,'walk',{contactMode:'independent',x:5,y:.27,yaw:.4,progress:0});f.sim.state.agents=[walker];f.render.update();
  const shoeMatrices=()=>f.meshes().filter(m=>m.userData.component==='pedestrian'&&m.userData.part==='rubber'&&m.userData.joint==='shoe'&&m.userData.agentIds.includes(walker.id)).map(m=>matrixFor(m,walker.id));
  function expectedShoes(){const p=sampleActorPose(walker,'walk');return ['L','R'].map(side=>world(walker,walker.y).multiply(new THREE.Matrix4().makeTranslation(...p.points['ankle'+side])));}
  const before=shoeMatrices();assert.equal(before.length,2);for(const [i,m]of before.entries())sameMatrix(m,expectedShoes()[i]);
  walker.progress=.37;f.render.update();const moved=shoeMatrices();assert.notDeepEqual(moved[0].elements,before[0].elements);for(const [i,m]of moved.entries())sameMatrix(m,expectedShoes()[i]);
  walker.speed=0;f.render.update();const stopped=shoeMatrices();walker.progress+=.75;f.render.update();for(const [i,m]of shoeMatrices().entries())sameMatrix(m,stopped[i],'stationary feet');
});

test('branch population shares existing instance meshes and respects distance budgets without hiding main traffic',t=>{
  const f=fixture(t),initialMeshes=f.meshes(),main=actor(1,'scooter',{y:25}),branch=Array.from({length:12},(_,i)=>actor(900010+i,i<6?'walk':'scooter',{contactMode:'independent',x:(i%3)-1,z:-Math.floor(i/3)*2}));
  f.sim.state.agents=[main,...branch];f.render.update();assert.deepEqual(f.meshes(),initialMeshes,'no extra vehicle or pedestrian draw batches');
  const visible=id=>f.meshes().some(m=>m.userData.agentIds.includes(id));
  const camera=new THREE.PerspectiveCamera(70,16/9,.1,2000);camera.position.set(0,2,110);camera.lookAt(0,1,0);
  f.render.setDetailDistanceScale(1);f.render.update(camera);assert.ok(branch.every(a=>visible(a.id)));assert.ok(visible(main.id));
  f.render.setDetailDistanceScale(.45);f.render.update(camera);assert.ok(branch.every(a=>!visible(a.id)));assert.ok(visible(main.id),'original far traffic keeps its existing visibility');
  camera.position.set(0,2,20);camera.lookAt(0,1,0);f.render.update(camera);assert.ok(branch.every(a=>visible(a.id)));
  f.render.setDetailDistanceScale(1);camera.position.set(0,2,50);camera.lookAt(0,1,0);branch[0].drawDistance=30;f.render.update(camera);assert.equal(visible(branch[0].id),false);
  branch[0].drawDistance=100;f.render.update(camera);assert.equal(visible(branch[0].id),true);
  const versions=f.meshes().map(m=>[m,m.instanceMatrix.version,m.instanceColor?.version]);f.render.update(camera);for(const[m,a,b]of versions){assert.equal(m.instanceMatrix.version,a);assert.equal(m.instanceColor?.version,b);}
});

test('branch scooter pickup removes its rider once and returns a grounded parked vehicle',t=>{
  const f=fixture(t),branch=actor(900099,'scooter',{contactMode:'independent',groundPitch:.12,x:2000,z:2000});f.sim.state.agents=[branch];f.render.update();
  const item=f.render.scooterTransport.nearest({x:branch.x,y:.14,z:branch.z});assert.equal(item.record,branch);
  assert.equal(f.render.scooterTransport.take(item).ok,true);assert.equal(f.sim.agents.includes(branch),false);assert.equal(f.body(branch.id),undefined);
  assert.equal(f.render.scooterTransport.take(item).ok,false);
  const pose={x:2002,y:.14,z:2003,yaw:1.1};assert.equal(f.render.scooterTransport.release(item,pose).ok,true);
  const parked=f.body(branch.id,'parked-scooter');assert.ok(parked);sameMatrix(matrixFor(parked,branch.id),world({...branch,...pose},pose.y),'returned vehicle does not retain old road pitch');
  assert.equal(f.sim.agents.length,0);assert.equal(f.render.scooterTransport.parkedAgents.filter(a=>a.id===branch.id).length,1);
});
