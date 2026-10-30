import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {c118SeatId} from '../src/c118-seating.js';
import {createC118Audience} from '../src/c118-audience.js';
import {createC118Walkers,c118AudienceFloorY,c118AudienceObstacleY,isC118AudienceSwimmer,sampleC118AudiencePose} from '../src/c118-audience-motion.js';

const plan=planOptoC118Interior(),epoch=1793370000;
const moving=audience=>audience.group.children.filter(mesh=>mesh.name.startsWith('c118-audience-moving-'));
const snapshot=audience=>audience.group.children.map(mesh=>({name:mesh.name,count:mesh.count,visible:mesh.visible,
  matrix:Array.from(mesh.instanceMatrix.array.subarray(0,mesh.count*16)),color:Array.from(mesh.instanceColor?.array.subarray(0,mesh.count*3)||[])}));
const visibleTriangles=audience=>audience.group.children.reduce((sum,mesh)=>sum+(mesh.visible?mesh.geometry.index.count/3*mesh.count:0),0);

test('fourteen articulated walkers stay in real aisles and plant their feet on the stepped floor',()=>{
  const walkers=createC118Walkers(plan),matrix=new THREE.Matrix4(),point=new THREE.Vector3();
  assert.equal(walkers.length,14);assert.deepEqual(walkers,createC118Walkers(plan));
  for(const person of walkers){
    const initial=sampleC118AudiencePose(plan,person,{time:epoch}),later=sampleC118AudiencePose(plan,person,{time:epoch+1});
    assert.equal(initial.mode,'walking');assert.notDeepEqual(initial.position,later.position);
    assert.notDeepEqual(initial.joints.elbows,later.joints.elbows,'arms swing rather than sliding a seated mesh');
    assert.notDeepEqual(initial.joints.knees,later.joints.knees,'knees articulate');
    for(let time=0;time<120;time+=2.7){
      const pose=sampleC118AudiencePose(plan,person,{time:epoch+time});
      const sx=.94+(person.seed%9)*.012,sy=.975+((person.seed>>>5)%6)*.008;
      matrix.compose(new THREE.Vector3(...Object.values(pose.position)),new THREE.Quaternion().setFromEuler(new THREE.Euler(...Object.values(pose.rotation))),new THREE.Vector3(sx,sy,1));
      if(person.route.cross)assert.ok(Math.abs(pose.position.z-plan.crossAisle.z)<.3);
      else assert.ok(plan.aisles.some(aisle=>pose.position.x>aisle.x0+.35&&pose.position.x<aisle.x1-.35));
      for(const ankle of pose.joints.ankles)for(const toe of[-.17,.07]){
        point.set(ankle[0],ankle[1]-.068,ankle[2]+toe).applyMatrix4(matrix);
        assert.ok(point.y>=c118AudienceFloorY(plan,point.x,point.z)-.001,'feet stay above each actual stair tread');
      }
    }
  }
});

test('flood poses seek deterministically, move individual limbs, stay in bounds, and reset directly',()=>{
  const walkers=createC118Walkers(plan),seats=[0,35,200,380,519].map((index)=>({id:c118SeatId(plan.seats[index]),seed:991+index*1021,seat:plan.seats[index]}));
  const point=new THREE.Vector3(),matrix=new THREE.Matrix4();
  for(const person of[...walkers,...seats]){
    const initial=sampleC118AudiencePose(plan,person,{time:epoch});
    for(const elapsed of[4,8,12,20,40,80,300]){
      const pose=sampleC118AudiencePose(plan,person,{time:epoch+elapsed,elapsed});
      assert.deepEqual(pose,sampleC118AudiencePose(plan,person,{time:epoch+elapsed,elapsed}));
      assert.ok(Number.isFinite(pose.position.y));
      if(pose.floating>.5){
        const sx=.94+(person.seed%9)*.012,sy=.975+((person.seed>>>5)%6)*.008;
        matrix.compose(new THREE.Vector3(...Object.values(pose.position)),new THREE.Quaternion().setFromEuler(new THREE.Euler(...Object.values(pose.rotation))),new THREE.Vector3(sx,sy,1));
        for(const joint of Object.values(pose.joints).flat()){
          point.set(...joint).applyMatrix4(matrix);
          assert.ok(Math.abs(point.x)<plan.config.width/2-.05,'limbs stay inside the side walls');
          assert.ok(Math.abs(point.z)<plan.config.depth/2-.05,'limbs stay inside the end walls');
          assert.ok(point.y>=c118AudienceFloorY(plan,point.x,point.z)+.04,'floating limbs clear the terraced floor');
        }
      }
    }
    const a=sampleC118AudiencePose(plan,person,{time:epoch+40,elapsed:40}),b=sampleC118AudiencePose(plan,person,{time:epoch+41,elapsed:41});
    assert.equal(a.mode,'flooded');assert.ok(a.floating>.5);
    assert.notDeepEqual(a.position,b.position,'currents keep carrying people after the first surge');
    assert.notDeepEqual(a.rotation,b.rotation,'the body rolls in the current');
    assert.notDeepEqual(a.joints.wrists,b.joints.wrists,'arms keep struggling independently');
    assert.deepEqual(initial,sampleC118AudiencePose(plan,person,{time:epoch,elapsed:null}));
    const calm=sampleC118AudiencePose(plan,person,{time:epoch+40,elapsed:40,reducedMotion:true});
    if(!a.swimming)assert.ok(Math.abs(calm.rotation.x)<=Math.abs(a.rotation.x)+1e-9);assert.ok(calm.floating>.5);
  }
});

test('audience updates are bounded, pause safely, seek late, and reset every seat without extra draw or vertex load',()=>{
  const audience=createC118Audience(THREE,{plan}),late=createC118Audience(THREE,{plan});
  audience.update({time:epoch});const dry=snapshot(audience);
  assert.equal(audience.group.userData.count,203);assert.equal(audience.group.userData.walkingCount,14);
  assert.equal(audience.group.userData.totalCount,217);assert.ok(audience.group.children.length<25);
  let uploads=0;for(let i=0;i<100;i++)uploads+=Number(audience.update({time:epoch+i*.01}));assert.ok(uploads<=25);
  const paused=snapshot(audience);assert.equal(audience.update({time:epoch+40,elapsed:40,active:false}),false);assert.deepEqual(snapshot(audience),paused);
  for(const elapsed of[3,7,11,15,20,40]){
    audience.update({time:epoch+elapsed,elapsed});
    assert.ok(visibleTriangles(audience)<280000,'no duplicate seated/swimming vertex workload during transition');
  }
  assert.equal(audience.group.userData.floatingCount,217);assert.equal(audience.group.userData.seatedCount,0);
  assert.ok(audience.group.userData.swimmingCount>=217*.25&&audience.group.userData.swimmingCount<=217*.35,'a stable minority chooses to swim');
  assert.ok(audience.group.userData.divingCount>20&&audience.group.userData.divingCount<audience.group.userData.swimmingCount,'divers and surfacing swimmers are visible together');
  assert.ok(moving(audience).every(mesh=>mesh.count>0));
  late.update({time:epoch+40,elapsed:40});assert.deepEqual(snapshot(audience),snapshot(late),'late arrivals need no replay');
  const occupied=audience.group.userData.seatIds[122];audience.setHiddenSeat(occupied);
  assert.equal(audience.group.userData.floatingCount,216,'the player seat avatar remains hidden in water');
  audience.update({time:epoch,elapsed:null});audience.setHiddenSeat(null);assert.deepEqual(snapshot(audience),dry);
  assert.equal(audience.group.userData.swimmingCount,0);assert.equal(audience.group.userData.divingCount,0);
  audience.dispose();late.dispose();assert.equal(audience.update({time:epoch+41}),false);
});

test('active swimmers repeatedly dive, surface and stroke forward while their whole bodies clear the furniture',()=>{
  const point=new THREE.Vector3(),matrix=new THREE.Matrix4(),forward=new THREE.Vector3();
  let deepest=0,closestSurface=Infinity;
  for(const [i,seed] of[16,48,96,144,192,288].entries()){
    const person={id:`diver-${seed}`,seed,seat:plan.seats[i*26+8]};assert.ok(isC118AudienceSwimmer(person));
    const sx=.94+(seed%9)*.012,sy=.975+((seed>>>5)%6)*.008;
    let dives=0,surfacing=0,oldQuaternion=null,oldPose=null;
    for(let elapsed=18;elapsed<80;elapsed+=.2){
      const pose=sampleC118AudiencePose(plan,person,{time:epoch+elapsed,elapsed});
      const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(...Object.values(pose.rotation)));
      if(elapsed<24&&oldQuaternion){
        assert.ok(quaternion.angleTo(oldQuaternion)<.8,'the initial turn has no +/- PI flip');
        assert.ok(Math.hypot(pose.position.x-oldPose.position.x,pose.position.y-oldPose.position.y,pose.position.z-oldPose.position.z)<.75,'entry into the swimming route is continuous');
      }
      oldQuaternion=quaternion;oldPose=pose;
      if(pose.swimming<=.5)continue;
      matrix.compose(new THREE.Vector3(...Object.values(pose.position)),quaternion,new THREE.Vector3(sx,sy,1));
      for(const joint of Object.values(pose.joints).flat()){
        point.set(...joint).applyMatrix4(matrix);
        assert.ok(point.y-.07>=c118AudienceObstacleY(plan,point.x,point.z,.08),'hands and feet clear chair backs, tables and the stage');
      }
      if(elapsed>=24){
        forward.set(0,1,0).applyQuaternion(quaternion);assert.ok(Math.abs(forward.y)<.14,'the swimmer is prone');
        const next=sampleC118AudiencePose(plan,person,{time:epoch+elapsed+.1,elapsed:elapsed+.1});
        const dx=next.position.x-pose.position.x,dz=next.position.z-pose.position.z;
        assert.ok((forward.x*dx+forward.z*dz)/Math.hypot(dx,dz)>.9,'strokes face the direction of travel');
        assert.notDeepEqual(pose.joints.wrists,next.joints.wrists);assert.notDeepEqual(pose.joints.ankles,next.joints.ankles);
        dives+=Number(pose.diveDepth>1.5);surfacing+=Number(pose.diveDepth<.1);
        deepest=Math.max(deepest,pose.diveDepth);closestSurface=Math.min(closestSurface,pose.diveDepth);
        assert.ok(pose.diveDepth<=3.5+.001);
      }
    }
    assert.ok(dives>20&&surfacing>10,'each swimmer repeats both the dive and breathing phases');
  }
  assert.ok(deepest>3&&closestSurface<.1,'nearby swimmers visibly span the requested 1.5–3.5 metre dives');
  const rear={seed:96,seat:plan.seats.at(-1)};
  assert.equal(sampleC118AudiencePose(plan,rear,{time:epoch+40,elapsed:40}).swimming,0,'shallow water above rear chairs prevents diving');
  assert.equal(sampleC118AudiencePose(plan,{seed:96,seat:plan.seats[8]},{time:epoch+8,elapsed:8}).swimming,0,'nobody dives in the initial shallow rush');
});
