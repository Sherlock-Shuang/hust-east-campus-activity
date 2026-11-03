import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPlayerMotion} from '../src/player-motion.js';
import {createVehicleCameraRig} from '../src/player-camera.js';
import {createPlayerModels} from '../src/player-models.js';
import {sampleActorPose} from '../src/commute-actors.js';
import {refineWalkingLegPose,refineWalkingUpperBodyPose} from '../src/player-walking-pose.js';

const route={length:300,points:[{x:0,y:.16,z:0,progress:0},{x:0,y:.16,z:-300,progress:300}],segments:[{startProgress:0,endProgress:300,width:7.2}]};
const rectangle=(a,b,c,d)=>[{x:a,z:b},{x:c,z:b},{x:c,z:d},{x:a,z:d}];
const wall={height:18,rings:[rectangle(2,-30,5,5)]};
const rotate=(p,yaw)=>({x:p.x*Math.cos(yaw)+p.z*Math.sin(yaw),z:-p.x*Math.sin(yaw)+p.z*Math.cos(yaw)});
const advance=(player,seconds,input,fps=120)=>{for(let i=0;i<Math.round(seconds*fps);i++)player.step(1/fps,input);return player.state;};
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} should be near ${b}`);

test('diagonal walking retains its tangential speed at straight and rotated facades without a speed boost',()=>{
  for(const yaw of [0,.37,Math.PI/4,1.1])for(const fast of [false,true]){
    const polygon={...wall,rings:[wall.rings[0].map(p=>rotate(p,yaw))]};
    const player=createPlayerMotion({route,world:{buildings:[polygon]}}),input=rotate({x:1,z:-1},yaw);
    for(let i=0;i<360;i++){
      player.step(1/120,{moveX:input.x,moveZ:input.z,fast});
      const local=rotate(player.state,-yaw);
      assert.ok(local.x<=1.740001,'the entire .26m footprint stays outside the wall');
      assert.ok(player.state.speed<=(fast?5.2:3.2)+1e-8);
    }
    const local=rotate(player.state,-yaw);
    assert.ok(local.z<(fast?-8.8:-5.9),'holding diagonally continues along the facade');
    near(player.state.speed,(fast?5.2:3.2)/Math.SQRT2,.01);
    assert.equal(player.state.blockedReason,'建筑边界');
  }
});

test('a sliding walker can retreat from a wall but cannot cut through an inside corner or pedestrian',()=>{
  const corner=createPlayerMotion({route,world:{buildings:[wall,{height:18,rings:[rectangle(-20,-6,5,-4)]}]}});
  advance(corner,8,{moveX:1,moveZ:-1,fast:true});
  assert.ok(corner.state.x<=1.740001&&corner.state.z>=-3.740001);
  assert.ok(corner.state.speed<.01);
  const before={...corner.state};advance(corner,1,{moveX:-1,moveZ:1});
  assert.ok(corner.state.x<before.x-1&&corner.state.z>before.z+1,'reverse input releases both contacts');
  const person={id:1,type:'walk',x:1.5,y:.14,z:-4.8};
  const player=createPlayerMotion({route,world:{buildings:[wall]},traffic:[person]});
  advance(player,5,{moveX:1,moveZ:-1,fast:true});
  assert.ok(Math.hypot(player.state.x-person.x,player.state.z-person.z)>=.63-1e-6);
  assert.ok(player.state.z>-4.3,'projected motion still yields before the person');
});

test('head-on contact at a polygon vertex stops without inventing lateral steering and clears its label on retreat',()=>{
  const ring=Array.from({length:8},(_,i)=>({x:3+Math.cos(i*Math.PI/4),z:Math.sin(i*Math.PI/4)}));
  for(const world of [{buildings:[{height:8,rings:[ring]}]},{barriers:[{height:8,minHeight:0,polygon:ring,label:'桥墩'}]}]){
    const player=createPlayerMotion({route,world});advance(player,3,{moveX:1,moveZ:0});
    assert.ok(player.state.x<1.740001);near(player.state.z,0);
    assert.equal(player.state.speed,0);assert.equal(player.state.blockedReason,world.barriers?'桥墩':'建筑边界');
    advance(player,.5,{moveX:-1,moveZ:0});assert.equal(player.state.blockedReason,'');
    assert.ok(player.state.x<1.2,'moving away remains free and does not retain a stale contact warning');
  }
});

test('walking slides along fence, water and campus edges while retaining their footprint limits',()=>{
  const cases=[
    {barriers:[{polygon:rectangle(2,-30,2.1,5),minHeight:0,height:1.3,label:'栏杆'}]},
    {water:[{rings:[rectangle(2,-30,5,5)]}]},
    {bounds:{minX:-20,maxX:2,minZ:-30,maxZ:5}},
  ];
  for(const world of cases){
    const player=createPlayerMotion({route,world});advance(player,3,{moveX:1,moveZ:-1});
    assert.ok(player.state.x<=1.740001);
    assert.ok(player.state.z<-5.9);
    assert.equal(player.groundAt(player.state.x,player.state.z,.26,player.state.y).allowed,true);
  }
});

test('sliding preserves bridge support and cannot shortcut a raised deck edge',()=>{
  const world={walkSurfaces:[{bridge:true,polygon:rectangle(-3,-30,3,5),surfaceY:2,deckDepth:.4}]};
  const player=createPlayerMotion({route,world});assert.equal(player.placeWalker({x:0,z:0,y:2,yaw:0}).ok,true);
  for(let i=0;i<360;i++){
    player.step(1/120,{moveX:1,moveZ:-1,fast:true});
    near(player.state.y,2);assert.ok(player.state.x<=3-.26+1e-6);
  }
  assert.ok(player.state.z<-8.8);
});

test('release stops promptly while small analogue input, diagonal limits and fixed-step consistency remain intact',()=>{
  for(const fast of [false,true]){
    const results=[];
    for(const fps of [24,60,144]){
      const player=createPlayerMotion({route});advance(player,3,{moveX:0,moveZ:-1,fast},fps);
      const start=player.state.distance;advance(player,.5,{moveX:0,moveZ:0},fps);
      assert.equal(player.state.speed,0);assert.equal(player.state.vx,0);assert.equal(player.state.vz,0);
      assert.ok(player.state.distance-start<(fast?1.12:.52));
      const stopped=player.state.distance;advance(player,1,{moveX:0,moveZ:0},fps);near(player.state.distance,stopped);
      results.push({...player.state});
    }
    for(const result of results.slice(1))for(const key of ['x','z','speed','distance'])near(result[key],results[0][key]);
  }
  const player=createPlayerMotion({route});advance(player,2,{moveX:.005,moveZ:0});
  near(player.state.speed,.016,1e-6);assert.ok(player.state.x>.02,'slow stick movement is not treated as an idle snap');
  advance(player,2,{moveX:1,moveZ:1,fast:true});near(player.state.speed,5.2,.002);
});

test('collision projection is deterministic across 24, 60 and 144 Hz',()=>{
  const poses=[24,60,144].map(fps=>{
    const player=createPlayerMotion({route,world:{buildings:[wall]}});
    advance(player,3,{moveX:1,moveZ:-1},fps);advance(player,.5,{moveX:0,moveZ:0},fps);return player.state;
  });
  for(const pose of poses.slice(1))for(const key of ['x','z','yaw','speed','distance','vx','vz'])near(pose[key],poses[0][key]);
});

test('normal walking eases stair height in both views and bypasses smoothing for water, falls and relocation',()=>{
  for(const view of ['first','third']){
    const state={mode:'walk',x:0,y:.5,z:0,yaw:0,speed:3.2,grounded:true};
    const rig=createVehicleCameraRig(),options={view,lookLocked:true,pitch:.2,groundAt:()=>.14};rig.reset(state);
    const before=rig.update(state,0,{...options,snap:true});
    const next={...state,x:.03,y:.68,z:-.04},step=rig.update(next,1/60,options);
    const rise=step.position.y-before.position.y;
    assert.ok(rise>0&&rise<.055,'an 18cm tread is spread across frames');
    near(step.position.x-before.position.x,.03);near(step.position.z-before.position.z,-.04);
    near(step.target.y-step.position.y,before.target.y-before.position.y);
  }
  for(const changed of [{y:1.5},{y:.65,waterMode:'swim'},{y:.65,grounded:false}]){
    const rig=createVehicleCameraRig(),state={mode:'walk',x:0,y:.5,z:0,yaw:0,grounded:true};
    rig.reset(state);rig.update(state,0,{view:'first',snap:true});
    const next={...state,...changed},pose=rig.update(next,1/60,{view:'first'});
    near(pose.position.y,next.y+1.58,'swim'===next.waterMode?1e-6:1e-8);
  }
});

test('first-person step easing rechecks the complete vertical path against an overhead solid',()=>{
  for(const comfortable of [false,true]){
    const rig=createVehicleCameraRig(),state={mode:'walk',x:0,y:.32,z:0,yaw:0,grounded:true};
    rig.reset(state);rig.update(state,0,{view:'first',snap:true,comfortable});
    const world={buildings:[{minHeight:1.8,height:2,rings:[rectangle(1,-2,3,2)]}]};
    const next={...state,x:2,y:.14};
    const pose=rig.update(next,1/60,{view:'first',comfortable,world});
    assert.ok(pose.position.y<1.8,'the old eye height must not carry into the solid');
    near(pose.target.y-pose.position.y,10*Math.sin(-.025),1e-6);
  }
});

test('walking knees retain forward flexion and stable limb lengths across idle, walking and running',()=>{
  for(const speed of [0,.1,.6,2.2,3.8])for(let i=0;i<240;i++){
    const pose=sampleActorPose({id:0,speed,progress:i/240*Math.PI*2/5.2},'walk');
    const feet=structuredClone({left:pose.points.ankleL,right:pose.points.ankleR});refineWalkingLegPose(pose,speed);
    assert.deepEqual(pose.points.ankleL,feet.left);assert.deepEqual(pose.points.ankleR,feet.right);
    for(const side of ['L','R']){
      const h=pose.points[`hip${side}`],k=pose.points[`knee${side}`],a=pose.points[`ankle${side}`];
      const upper=Math.hypot(k[1]-h[1],k[2]-h[2]),lower=Math.hypot(a[1]-k[1],a[2]-k[2]);
      assert.ok(upper>=.40&&upper<.435,'the thigh cannot stretch visibly during a stride');
      assert.ok(lower>=.42&&lower<.456,'the calf no longer stretches from .425m to .60m');
      assert.ok((a[1]-h[1])*(k[2]-h[2])-(a[2]-h[2])*(k[1]-h[1])>0,'the knee stays on the forward side of the hip-ankle line');
      if(speed===0)assert.ok(Math.abs(k[2]-(h[2]+a[2])/2)<.04,'idle knees relax toward a standing pose');
    }
  }
});

test('walking upper body has relaxed idle arms and opposed arm-leg swing with stable arm lengths',()=>{
  for(const speed of [0,2.2,3.8])for(const phase of [Math.PI/2,Math.PI*1.5]){
    const agent={speed,progress:phase/5.2},pose=sampleActorPose(agent,'walk');refineWalkingUpperBodyPose(pose,agent);
    for(const side of ['L','R']){
      const s=pose.points[`shoulder${side}`],e=pose.points[`elbow${side}`],h=pose.points[`hand${side}`],a=pose.points[`ankle${side}`];
      near(Math.hypot(...e.map((value,i)=>value-s[i])),.265);
      near(Math.hypot(...h.map((value,i)=>value-e[i])),.245);
      if(speed===0){assert.ok(h[1]<.84&&e[1]>h[1]+.23,'hands hang below the hip with almost straight forearms');assert.ok(Math.abs(h[2]-s[2])<.03);}
      else assert.ok((h[2]-s[2])*(a[2]-.075)<0,'each arm swings opposite its corresponding leg');
    }
  }
});

test('the actual walking rig stands upright with a level head and vertical palms, without changing the scooter pose',()=>{
  const rig=createPlayerModels(THREE);
  try{
    rig.update({mode:'walk',speed:0,distance:0},1/60);
    const walker=rig.group.getObjectByName('player-walk'),torso=walker.children.find(m=>m.name==='player-coat-torso');
    const lower=new THREE.Vector3(0,.875,.20).applyMatrix4(torso.matrix),upper=new THREE.Vector3(0,1.345,.062).applyMatrix4(torso.matrix);
    assert.ok(Math.abs(upper.z-lower.z)<.015,'the sculpted riding lean is compensated for walking');
    for(const mesh of walker.children){
      if(mesh.name==='player-skin-torso'||mesh.name==='player-hair-torso')assert.ok(Math.abs(mesh.matrix.elements[6])<.02,'straightening the torso does not tilt the face up');
      if(mesh.name==='player-skin-hand'){
        assert.ok(mesh.matrix.elements[13]<.84);
        assert.ok(mesh.matrix.elements[9]<-.99,'the long hand axis hangs down along the forearm');
      }
    }
    rig.update({mode:'scooter',speed:4},1/60);
    const scooter=rig.group.getObjectByName('player-scooter'),hand=scooter.children.find(m=>m.name==='player-skin-hand');
    near(hand.matrix.elements[13],1.075);near(hand.matrix.elements[9],0);
    rig.update({mode:'walk',speed:0,waterMode:'swim',elapsed:.2},1/60);
    for(const mesh of walker.children.filter(m=>m.name==='player-skin-hand'))near(mesh.matrix.elements[9],0);
  }finally{rig.dispose();}
});

test('the rendered walker uses bounded leg segments while water and scooter poses keep their own articulation',()=>{
  const rig=createPlayerModels(THREE);
  try{
    for(const speed of [3.2,5.2])for(let i=0;i<=120;i++){
      rig.update({mode:'walk',speed,distance:i*speed/120},1/120);
      for(const mesh of rig.group.getObjectByName('player-walk').children.filter(m=>m.name==='player-pants-limb')){
        const e=mesh.matrix.elements,length=Math.hypot(e[4],e[5],e[6]);
        assert.ok(length>.41&&length<.456);
      }
    }
    rig.update({mode:'walk',waterMode:'swim',elapsed:.2},1/60);
    const shoes=rig.group.getObjectByName('player-walk').children.filter(m=>m.name.endsWith('-shoe'));
    for(const shoe of shoes)near(shoe.matrix.elements[13],.07);
    rig.update({mode:'scooter',speed:4},1/60);
    assert.equal(rig.group.getObjectByName('player-scooter').visible,true);
  }finally{rig.dispose();}
});
