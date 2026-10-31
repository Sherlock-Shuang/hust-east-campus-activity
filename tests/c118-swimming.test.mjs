import test from 'node:test';
import assert from 'node:assert/strict';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {createC118Swimming} from '../src/c118-swimming.js';
import {sampleC118Flood} from '../src/c118-flood-effect.js';

const plan=planOptoC118Interior();
function run(swim,seconds,input={}){for(let i=0;i<seconds*120;i++)swim.step(1/120,{elapsed:30,...input});return swim.state;}
function still(swim,vertical=0){const w=sampleC118Flood(plan,swim.state,30);return{moveX:-w.currentX*.7/2.7,moveZ:-w.currentZ*.7/2.7,vertical};}

test('swimming has independent rise/dive controls, buoyancy and finite water inertia',()=>{
  const swim=createC118Swimming(plan);swim.enter({x:0,y:6,z:-9});
  const before=swim.state.y;
  run(swim,1.2,still(swim,-1));assert.ok(swim.state.y<before-2.3,'C descends against buoyancy');
  const deep=swim.state.y;
  run(swim,1.2,still(swim,1));assert.ok(swim.state.y>deep+2.3,'Space ascends');
  run(swim,5,still(swim));
  assert.ok(Math.abs(swim.state.y-swim.state.waterY-.22)<.08,'release returns eyes above the water');
  const {x,z}=swim.state;run(swim,1);
  assert.ok(Math.hypot(swim.state.x-x,swim.state.z-z)>.05,'persistent water current moves an idle swimmer');
  assert.ok(Math.abs(swim.state.vx)<2.6&&Math.abs(swim.state.vz)<2.6);
});

test('room shell, raised floor and ceiling bound swimming for long input and large dt',()=>{
  const swim=createC118Swimming(plan);swim.enter({x:0,y:8.2,z:-9});
  run(swim,20,{moveX:1,moveZ:1,vertical:1});
  assert.ok(swim.state.x<plan.config.width/2-.3&&swim.state.z<plan.config.depth/2-.3);
  assert.ok(swim.state.y<plan.config.floorY+plan.config.height-.2);
  run(swim,10,{moveX:1,moveZ:1,vertical:-1});
  assert.ok(swim.state.y>=plan.seatRows.at(-1).y+.65,'cannot descend through the raised rear terraces');
  const before={...swim.state};swim.step(1000,{moveX:-1,vertical:-1,elapsed:3600});
  assert.ok(Math.hypot(swim.state.x-before.x,swim.state.y-before.y,swim.state.z-before.z)<1,'suspension never replays a large time interval');
  for(const key of['x','y','z','vx','vy','vz','waterY'])assert.ok(Number.isFinite(swim.state[key]));
});

test('low swimming is blocked by solid chairs and stage, while high swimming crosses chairs',()=>{
  const chair=plan.colliders.find(s=>s.id==='c118-seats-centre-0')||plan.colliders.find(s=>s.id.startsWith('c118-seats-'));
  const x=(chair.polygon[0].x+chair.polygon[2].x)/2,z=chair.polygon[0].z-.6;
  const low=createC118Swimming(plan);low.enter({x,y:chair.height+.3,z});
  run(low,1.5,{moveZ:1,vertical:-1});
  assert.ok(low.state.z<chair.polygon[0].z-.2,'body cannot pass through the chair back');
  const high=createC118Swimming(plan);high.enter({x,y:6,z});
  run(high,1.5,{moveZ:1});assert.ok(high.state.z>chair.polygon[2].z,'swimming above seats is allowed');
  const stage=createC118Swimming(plan);stage.enter({x:0,y:1,z:plan.stage.front+1.2});
  run(stage,2,{moveZ:-1,vertical:-1});
  assert.ok(stage.state.z>plan.stage.front+.7,'the curved stage cannot be entered beneath its floor');
});

test('reset drops momentum and underwater state; inactive step cannot change position',()=>{
  const swim=createC118Swimming(plan);swim.enter({x:0,y:5,z:-9});run(swim,1,{moveX:1,vertical:-1});
  swim.reset();const before={...swim.state};
  assert.equal(before.active,false);assert.equal(before.submerged,false);assert.equal(before.vx,0);assert.equal(before.vy,0);assert.equal(before.vz,0);
  swim.step(1,{moveX:1,vertical:1,elapsed:400});assert.deepEqual(swim.state,before);
  swim.enter({x:0,y:4,z:-9});assert.equal(swim.state.active,true);assert.equal(swim.state.vx,0);
});

test('a swimmer can dive through each actual doorway and gets one stable exit notification',()=>{
  for(const door of plan.doors){
    const swim=createC118Swimming(plan);swim.enter({x:door.x-door.side*.65,y:door.y+1.35,z:door.z});
    for(let i=0;i<300&&!swim.state.exitDoorId;i++){
      const water=sampleC118Flood(plan,swim.state,30);
      swim.step(1/120,{elapsed:30,moveX:door.side,moveZ:-water.currentZ*.7/2.7,vertical:-1});
    }
    assert.equal(swim.state.exitDoorId,door.id,`${door.id} is a usable submerged exit`);
    assert.ok(door.side*(swim.state.x-door.x)>.25);
    assert.ok(swim.state.y-.65>=door.y-.004&&swim.state.y+.17<=door.y+door.height);
    const exited={...swim.state};swim.step(1,{elapsed:31,moveX:door.side,vertical:1});assert.deepEqual(swim.state,exited);
    swim.reset();assert.equal(swim.state.exitDoorId,null);
    swim.enter({x:0,y:5,z:-9});assert.equal(swim.state.exitDoorId,null);
  }
});

test('door escape requires both real height and width clearance, not just a nearby wall',()=>{
  for(const door of plan.doors){
    for(const pose of[
      {x:door.x-door.side*.65,y:door.y+door.height+1,z:door.z,vertical:1},
      {x:door.x-door.side*.65,y:door.y+1.35,z:door.z+door.width/2+.35,vertical:-1},
    ]){
      const swim=createC118Swimming(plan);swim.enter(pose);
      for(let i=0;i<240;i++){
        const water=sampleC118Flood(plan,swim.state,30);
        swim.step(1/120,{elapsed:30,moveX:door.side,moveZ:-water.currentZ*.7/2.7,vertical:pose.vertical});
      }
      assert.equal(swim.state.exitDoorId,null);
      assert.ok(door.side*swim.state.x<plan.config.width/2-.3,'high or off-centre swimmers remain inside');
    }
  }
});

test('a swimmer inside a doorway cannot rise through its lintel',()=>{
  const door=plan.doors.find(d=>d.side===1&&d.tier==='front');
  const swim=createC118Swimming(plan);swim.enter({x:door.x-.5,y:door.y+door.height-.3,z:door.z});
  for(let i=0;i<120&&swim.state.x<=door.x-.2;i++){
    const water=sampleC118Flood(plan,swim.state,30);
    swim.step(1/120,{elapsed:30,moveX:1,moveZ:-water.currentZ*.7/2.7,vertical:-.05});
  }
  assert.ok(swim.state.x>door.x-.2,'swimmer reaches the actual doorway recess');
  for(let i=0;i<180;i++)swim.step(1/120,{elapsed:30,...still(swim,1)});
  assert.equal(swim.state.exitDoorId,null);
  assert.ok(swim.state.y+.17<=door.y+door.height,'the door header remains solid');
});
