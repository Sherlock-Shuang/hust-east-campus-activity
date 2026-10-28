import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import{createSpiderModel}from'../src/spider-model.js';
const centroid=(geometry,ring,sides)=>{const p=geometry.attributes.position,v=new THREE.Vector3();for(let j=0;j<sides;j++)v.add(new THREE.Vector3().fromBufferAttribute(p,ring*sides+j));return v.divideScalar(sides);};

test('continuous adult skin has one closed surface, local normalized weights and grounded soles',()=>{
  const model=createSpiderModel(THREE),skin=model.group.getObjectByName('spider-continuous-skin'),g=skin.geometry,bounds=new THREE.Box3().setFromObject(model.group.getObjectByName('spider-character'));
  assert.ok(skin.isSkinnedMesh);assert.ok(bounds.max.y>1.71&&bounds.max.y<1.79);assert.ok(bounds.min.y>=-.002&&bounds.min.y<.003);assert.ok(bounds.max.x-bounds.min.x<.78);
  assert.ok(model.group.userData.originalProceduralAsset);assert.ok(model.group.getObjectByName('spider-white-eye--1'));assert.deepEqual(model.group.userData.suitMarkings,['painted-web','chest-spider','back-spider']);
  const n=g.attributes.position.count,parent=Int32Array.from({length:n},(_,i)=>i),edges=new Map(),idx=g.index.array;
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let i=0;i<idx.length;i+=3)for(let j=0;j<3;j++){const a=idx[i+j],b=idx[i+(j+1)%3];parent[root(a)]=root(b);const key=a<b?a*n+b:b*n+a;edges.set(key,(edges.get(key)||0)+1);}
  assert.equal(new Set(Array.from(parent,(_,i)=>root(i))).size,1,'shoulders, elbows, palms and hips share one surface, not intersecting shells');
  assert.ok(Array.from(edges.values()).every(n=>n===2),'the remeshed character has no open joint seams');
  const weights=g.attributes.skinWeight,indices=g.attributes.skinIndex;
  for(let i=0;i<n;i++){let sum=0;for(let j=0;j<4;j++){sum+=weights.array[i*4+j];assert.ok(indices.array[i*4+j]<skin.skeleton.bones.length);}assert.ok(Math.abs(sum-1)<1e-6);}
  const soleVertices=[];for(let i=0;i<n;i++)if(g.attributes.position.getY(i)<.10)soleVertices.push(i);const v=new THREE.Vector3();
  for(let i=0;i<20;i++){model.update({grounded:true,speed:4.8,elapsed:i*.1},.1);for(const index of soleVertices)assert.ok(skin.getVertexPosition(index,v).y>=-.002,'running soles do not sink into the supporting plane');}
  model.dispose();
});

test('swing kick, release and landing change the whole pose continuously',()=>{
  const model=createSpiderModel(THREE),anchor={x:0,y:15,z:-8},position=name=>model.group.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  model.update({grounded:false,anchor,swingHand:1,speed:12,traversalPhase:'swing',swingPhase:'downswing',bottomKick:0,attachAge:1},0);
  const downFoot=position('spider-bone-footR'),leftFoot=position('spider-bone-footL');assert.ok(downFoot.distanceTo(leftFoot)>.28,'legs have an asymmetric swinging silhouette');
  model.update({grounded:false,anchor,swingHand:1,speed:12,traversalPhase:'swing',swingPhase:'bottom',bottomKick:1,attachAge:1},0);
  assert.ok(downFoot.distanceTo(position('spider-bone-footR'))>.3,'the bottom kick extends a leg instead of simply playing the same hanging pose');
  const wristBefore=position('spider-web-wrist-R');model.update({grounded:false,traversalPhase:'release',releaseTime:.016,speed:12},.016);
  const wristAfter=position('spider-web-wrist-R');assert.ok(wristBefore.distanceTo(wristAfter)<.20,'letting go blends the extended arm rather than teleporting it');
  for(let i=1;i<=12;i++)model.update({grounded:false,traversalPhase:'release',releaseTime:i*.025,speed:12},.025);
  assert.ok(position('spider-web-wrist-R').distanceTo(wristBefore)>.3,'the release continues into a different full-body pose');
  model.update({grounded:true,traversalPhase:'ground'},0);const standingPelvis=position('spider-bone-pelvis').y;
  model.update({grounded:true,traversalPhase:'landing',landingImpact:9},0);assert.ok(position('spider-bone-pelvis').y<standingPelvis-.08,'impact compresses the hips and knees');
  const skin=model.group.getObjectByName('spider-continuous-skin'),p=skin.geometry.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i++)if(p.getY(i)<.10)assert.ok(skin.getVertexPosition(i,v).y>=-.002,'landing compression preserves sole contact');
  model.dispose();
});

test('the casting hand separates extended fingers, curled fingers and an opposing thumb',()=>{
  const model=createSpiderModel(THREE);model.update({grounded:false,anchor:{x:3,y:14,z:-7},swingHand:1,attachAge:1,traversalPhase:'swing'},0);
  const mesh=model.group.getObjectByName('spider-articulated-fingers-R'),p=mesh.geometry.attributes.position,count=p.count/5;
  const tip=f=>new THREE.Vector3().fromBufferAttribute(p,(f+1)*count-1);
  assert.ok(tip(0).y>tip(1).y+.012,'the index finger extends beyond the curled middle finger');
  assert.ok(tip(3).y>tip(2).y+.002,'the little finger remains extended rather than making a mitten');
  assert.ok(Math.abs(tip(4).x)>.045,'the thumb has a distinct opposing silhouette');
  const before=tip(1);model.update({grounded:false,traversalPhase:'fall'},0);assert.ok(tip(1).distanceTo(before)>.025,'the balancing hand opens after release');
  model.dispose();
});

test('web connects the actual raised wrist to the same world anchor under transformed parents',()=>{
  const model=createSpiderModel(THREE),parent=new THREE.Group(),scene=new THREE.Scene();scene.add(parent);parent.add(model.group);
  parent.position.set(12,6,-30);parent.rotation.set(-.21,.72,.15,'YXZ');parent.updateMatrixWorld(true);
  const anchor=new THREE.Vector3(4,28,-44);model.update({grounded:false,anchor,ropeLength:32,webTension:1,swingHand:-1,view:'third'},.05);
  const web=model.group.getObjectByName('spider-web-main'),meta=model.group.userData,start=centroid(web.geometry,0,meta.webSides).applyMatrix4(web.matrixWorld),end=centroid(web.geometry,meta.webSegments,meta.webSides).applyMatrix4(web.matrixWorld),wrist=model.group.getObjectByName('spider-web-wrist-L').getWorldPosition(new THREE.Vector3());
  assert.ok(start.distanceTo(wrist)<1e-5);assert.ok(end.distanceTo(anchor)<1e-5);
  const middle=centroid(web.geometry,meta.webSegments/2,meta.webSides).applyMatrix4(web.matrixWorld);assert.ok(middle.distanceTo(start.clone().lerp(end,.5))<1e-5,'a taut web stays straight even when physical rope length is measured from the torso');
  parent.position.x+=5;parent.rotation.y+=.4;parent.updateMatrixWorld(true);model.update({grounded:false,anchor,ropeLength:40,webSlack:1,webTension:.1,swingHand:1},.05);
  const shiftedEnd=centroid(web.geometry,meta.webSegments,meta.webSides).applyMatrix4(web.matrixWorld);assert.ok(shiftedEnd.distanceTo(anchor)<1e-5,'anchor remains world fixed after parent motion');
  const start2=centroid(web.geometry,0,meta.webSides).applyMatrix4(web.matrixWorld),mid2=centroid(web.geometry,meta.webSegments/2,meta.webSides).applyMatrix4(web.matrixWorld);assert.ok(mid2.y<start2.clone().lerp(anchor,.5).y-.1,'slack bows toward world gravity');
  const armStart=model.group.getObjectByName('spider-shoulder-R').getWorldPosition(new THREE.Vector3()),hand=model.group.getObjectByName('spider-web-wrist-R').getWorldPosition(new THREE.Vector3());assert.ok(hand.distanceTo(armStart)<.63,'raised arm never stretches beyond anatomical reach');
  model.dispose();
});

test('first-person keeps the web and candidate visible while updates reuse all resources',()=>{
  const model=createSpiderModel(THREE),before=new Set();model.group.traverse(o=>{if(o.geometry)before.add(o.geometry.id);});
  model.update({grounded:false,view:'first',anchor:{x:0,y:15,z:-8},ropeLength:17,webTension:.7},.05);
  assert.equal(model.group.getObjectByName('spider-character').visible,false);assert.ok(model.group.getObjectByName('spider-web-main').visible);assert.ok(model.group.getObjectByName('spider-anchor-marker').visible);
  const after=new Set();for(let i=0;i<30;i++)model.update({grounded:false,anchor:{x:i*.2,y:15,z:-8},speed:8,verticalSpeed:-4,elapsed:i*.05},.05);
  model.group.traverse(o=>{if(o.geometry)after.add(o.geometry.id);assert.ok(o.matrixWorld.elements.every(Number.isFinite));});assert.deepEqual(after,before);
  model.update({grounded:true,candidateAnchor:{x:2,y:8,z:-4},view:'third'},.05);assert.ok(!model.group.getObjectByName('spider-web-main').visible);assert.ok(model.group.getObjectByName('spider-anchor-marker').visible);
  const resources=new Set(),counts=new Map();model.group.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);});for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)||0)+1));model.dispose();model.dispose();for(const r of resources)assert.equal(counts.get(r),1);
});

test('downswing stretch and upswing compression produce distinct torso and knee silhouettes',()=>{
  const model=createSpiderModel(THREE),anchor={x:3,y:16,z:-8},common={grounded:false,anchor,attachAge:1,speed:14,vx:0,vz:-14,swingHand:1,webTension:1,traversalPhase:'swing',bottomKick:0};
  const axis=()=>new THREE.Vector3(0,1,0).applyQuaternion(model.group.getObjectByName('spider-bone-chest').quaternion);
  const foot=key=>model.group.getObjectByName(`spider-bone-foot${key}`).position.clone();
  model.update({...common,swingPhase:'downswing'},0);const downAxis=axis(),downLeft=foot('L'),downRight=foot('R');
  model.update({...common,swingPhase:'upswing'},0);assert.ok(downAxis.angleTo(axis())>.30,'the torso changes silhouette rather than remaining vertical through the arc');
  assert.ok(foot('L').y>downLeft.y+.15&&foot('R').y>downRight.y+.15,'both hips compress during ascent after the extended downswing');
  for(const name of['upperArmL','upperArmR','forearmL','forearmR','thighL','thighR','shinL','shinR'])assert.ok(Math.abs(model.group.getObjectByName(`spider-bone-${name}`).scale.y-1)<1e-5,'pose changes preserve limb lengths');
  model.dispose();
});

test('zip strands join the two actual wrists to their respective world targets, including first person',()=>{
  const model=createSpiderModel(THREE),parent=new THREE.Group();parent.add(model.group);parent.position.set(9,5,-12);parent.rotation.set(-.18,.72,.13,'YXZ');parent.updateMatrixWorld(true);
  const anchors=[new THREE.Vector3(-7,16,-30),new THREE.Vector3(22,18,-36)],meta=model.group.userData;
  model.update({grounded:false,traversalPhase:'zip',zipActive:true,zipAnchors:anchors,zipStrength:.9,zipProgress:.35,view:'first'},.05);
  assert.equal(model.group.getObjectByName('spider-character').visible,false);assert.equal(model.group.getObjectByName('spider-web-main').visible,false);
  for(let i=0;i<2;i++){
    const web=model.group.getObjectByName(`spider-zip-web-${i}`),wrist=model.group.getObjectByName(`spider-web-wrist-${i===0?'L':'R'}`).getWorldPosition(new THREE.Vector3());assert.ok(web.visible);
    assert.ok(centroid(web.geometry,0,meta.webSides).applyMatrix4(web.matrixWorld).distanceTo(wrist)<1e-5);
    assert.ok(centroid(web.geometry,meta.webSegments,meta.webSides).applyMatrix4(web.matrixWorld).distanceTo(anchors[i])<1e-5);
  }
  parent.rotation.y+=.4;parent.position.x+=3;parent.updateMatrixWorld(true);
  model.update({grounded:false,traversalPhase:'zip',zipActive:true,zipAnchors:[anchors[0]],zipStrength:.5,swingHand:-1},.05);
  const one=model.group.getObjectByName('spider-zip-web-0');assert.ok(one.visible);assert.equal(model.group.getObjectByName('spider-zip-web-1').visible,false,'a single available anchor does not invent a second strand');
  assert.ok(centroid(one.geometry,meta.webSegments,meta.webSides).applyMatrix4(one.matrixWorld).distanceTo(anchors[0])<1e-5);
  model.update({grounded:false,traversalPhase:'fall',zipActive:false,zipCandidateAnchors:anchors},.05);
  for(let i=0;i<2;i++)assert.equal(model.group.getObjectByName(`spider-zip-web-${i}`).visible,false,'finished zip and merely candidate points do not leave ghost lines');
  model.dispose();
});

test('active dive folds the upper body and trails the hands without moving the player origin',()=>{
  const model=createSpiderModel(THREE),position=model.group.position.clone(),rotation=model.group.quaternion.clone();
  model.update({grounded:false,traversalPhase:'dive',diving:true,diveBlend:1,speed:18,verticalSpeed:-16},0);
  const chestAxis=new THREE.Vector3(0,1,0).applyQuaternion(model.group.getObjectByName('spider-bone-chest').quaternion);
  assert.ok(chestAxis.z<-.50&&chestAxis.y>.45,'dive is visibly streamlined while the local bend stays bounded');
  for(const key of['L','R'])assert.ok(model.group.getObjectByName(`spider-web-wrist-${key}`).position.z>.24,'hands trail behind the hips in the dive');
  assert.deepEqual(model.group.position,position);assert.deepEqual(model.group.quaternion.toArray(),rotation.toArray());
  const before=new Set();model.group.traverse(o=>{if(o.geometry)before.add(o.geometry.id);});
  for(let i=0;i<24;i++)model.update({grounded:false,traversalPhase:i%2?'dive':'zip',diving:i%2===1,diveBlend:1,zipActive:i%2===0,zipAnchors:[{x:-6,y:14,z:-20},{x:6,y:15,z:-20}],zipStrength:.8},.016);
  const after=new Set();model.group.traverse(o=>{if(o.geometry)after.add(o.geometry.id);assert.ok(o.matrixWorld.elements.every(Number.isFinite));});assert.deepEqual(after,before);
  model.dispose();
});


test('an explicit neutral preview clears impact, dive and zip without a residual pose',()=>{
  const model=createSpiderModel(THREE),hip=()=>model.group.getObjectByName('spider-bone-pelvis').position.y;
  model.update({grounded:true,traversalPhase:'ground',landingImpact:0,releaseTime:10},0);const neutral=hip();
  model.update({grounded:true,traversalPhase:'landing',landingImpact:10},0);assert.ok(hip()<neutral-.12);
  model.update({grounded:true,traversalPhase:'ground',landingImpact:0,releaseTime:10,zipActive:false,zipAnchors:[],diving:false,diveBlend:0,speed:0},0);assert.ok(Math.abs(hip()-neutral)<1e-6);
  for(const name of['spider-web-main','spider-zip-web-0','spider-zip-web-1'])assert.equal(model.group.getObjectByName(name).visible,false);
  model.dispose();
});

test('short zip reaches within its opening frames before the later pullback, without snapping the torso',()=>{
  const model=createSpiderModel(THREE),anchors=[{x:-7,y:14,z:-20},{x:8,y:14,z:-20}],shoulder=()=>model.group.getObjectByName('spider-shoulder-R').position.clone(),reach=()=>shoulder().distanceTo(model.group.getObjectByName('spider-web-wrist-R').position);
  model.update({grounded:false,traversalPhase:'launch',verticalSpeed:3},0);const before=shoulder();
  const advance=t=>model.update({grounded:false,traversalPhase:'zip',zipActive:true,zipAnchors:anchors,zipProgress:t/.28,zipStrength:Math.sin(Math.min(t/.28,1)*Math.PI)},1/60);
  advance(1/60);assert.ok(shoulder().distanceTo(before)<.055,'only the reaching arms accelerate; torso blending stays smooth');
  advance(2/60);assert.ok(reach()>.53,'within two frames the hands have mostly reached toward the anchors');
  for(let i=3;i<=7;i++)advance(i/60);const extended=reach();assert.ok(extended>.59,'the .12s screenshot moment has a visibly extended arm');
  for(let i=8;i<=15;i++)advance(i/60);assert.ok(reach()<extended-.045,'the second half reads as a pull instead of staying fully extended');
  model.dispose();
});

test('all four aerial tricks complete a continuous turn around the hips without moving the player root',()=>{
  for(const type of['frontflip','backflip','leftroll','rightroll']){
    const model=createSpiderModel(THREE),parent=new THREE.Group(),character=model.group.getObjectByName('spider-character'),pelvis=model.group.getObjectByName('spider-bone-pelvis');
    parent.add(model.group);parent.position.set(12,18,-7);parent.rotation.set(.13,.72,-.09);model.group.position.set(2,1,-3);model.group.rotation.y=.23;parent.updateMatrixWorld(true);
    const rootPosition=model.group.position.clone(),rootRotation=model.group.quaternion.clone(),initialHip=new THREE.Vector3();let previous=character.quaternion.clone(),inverted=false;
    for(let frame=0;frame<=45;frame++){
      model.update({grounded:false,traversalPhase:'trick',trickActive:true,trickPhase:'perform',trickType:type,trickProgress:frame/45,trickBlend:1,elapsed:0},frame?1/60:0);
      assert.ok(previous.angleTo(character.quaternion)<.15,'a 60 fps flip must not jump at the half-turn or wrap to zero');previous.copy(character.quaternion);
      const actualHip=pelvis.getWorldPosition(new THREE.Vector3()),unrotatedHip=pelvis.position.clone().applyMatrix4(model.group.matrixWorld);
      assert.ok(actualHip.distanceTo(unrotatedHip)<1e-8,'turning the body must not orbit its hips around the feet');
      if(!frame)initialHip.copy(actualHip);else assert.ok(actualHip.distanceTo(initialHip)<.03,'tucking the body leaves the physical hip position stable');
      if(frame===22)inverted=new THREE.Vector3(0,1,0).applyQuaternion(character.quaternion).y<-.98;
      assert.deepEqual(model.group.position,rootPosition);assert.deepEqual(model.group.quaternion.toArray(),rootRotation.toArray());
    }
    assert.ok(inverted,'the middle of the trick actually turns the entire character upside down');assert.ok(character.quaternion.angleTo(new THREE.Quaternion())<1e-8,'one completed turn rejoins upright flight');model.dispose();
  }
});

test('catching a web during trick recovery keeps its endpoints on the rotating wrist and real world anchor',()=>{
  const model=createSpiderModel(THREE),parent=new THREE.Group(),character=model.group.getObjectByName('spider-character');parent.add(model.group);parent.position.set(9,7,-12);parent.rotation.set(-.22,.83,.14,'YXZ');parent.updateMatrixWorld(true);
  model.update({grounded:false,trickActive:true,trickPhase:'perform',trickType:'rightroll',trickProgress:.38,trickBlend:1,elapsed:0},0);
  const anchor=new THREE.Vector3(-7,24,-35),meta=model.group.userData,web=model.group.getObjectByName('spider-web-main');let previousAngle=character.quaternion.angleTo(new THREE.Quaternion());
  for(let frame=0;frame<12;frame++){
    parent.position.x+=.1;parent.rotation.y+=.01;parent.updateMatrixWorld(true);
    model.update({grounded:false,anchor,swingHand:-1,traversalPhase:'swing',webTension:1,ropeLength:30,trickPhase:'recover',trickBlend:Math.max(0,1-frame/8),trickRotation:{x:0,y:0,z:-2.4},elapsed:0},1/60);
    const angle=character.quaternion.angleTo(new THREE.Quaternion());assert.ok(angle<previousAngle,'catching the line blends back toward upright rather than continuing an unrelated flip');if(!frame)assert.ok(angle>.1,'the first catch frame does not snap the body upright');previousAngle=angle;
    const wrist=model.group.getObjectByName('spider-web-wrist-L').getWorldPosition(new THREE.Vector3());
    assert.ok(centroid(web.geometry,0,meta.webSides).applyMatrix4(web.matrixWorld).distanceTo(wrist)<1e-5,'the rope stays attached while both character and parent rotate');
    assert.ok(centroid(web.geometry,meta.webSegments,meta.webSides).applyMatrix4(web.matrixWorld).distanceTo(anchor)<1e-5);
    for(const name of['upperArmL','forearmL','upperArmR','forearmR'])assert.ok(Math.abs(model.group.getObjectByName(`spider-bone-${name}`).scale.y-1)<1e-5,'the recovery does not stretch limbs to the web');
  }
  assert.ok(previousAngle<.01,'the body settles into the new swing within 0.2 seconds');model.dispose();
});

test('point approach uses two actual wrists and one real roof point, including first person and moving parents',()=>{
  const model=createSpiderModel(THREE),parent=new THREE.Group(),target=new THREE.Vector3(-8,22,-37),meta=model.group.userData;parent.add(model.group);parent.position.set(7,8,-11);parent.rotation.set(.12,.6,-.2,'YXZ');
  for(let frame=0;frame<3;frame++){
    parent.position.x+=2;parent.rotation.y+=.2;parent.updateMatrixWorld(true);
    model.update({grounded:false,view:frame===1?'first':'third',pointPhase:'approach',pointTarget:target,pointProgress:frame*.3,traversalPhase:'point-approach'},.05);
    assert.equal(model.group.getObjectByName('spider-character').visible,frame!==1);assert.equal(model.group.getObjectByName('spider-web-main').visible,false);assert.equal(model.group.getObjectByName('spider-anchor-marker').visible,true);
    for(let i=0;i<2;i++){
      const web=model.group.getObjectByName(`spider-point-web-${i}`),wrist=model.group.getObjectByName(`spider-web-wrist-${i===0?'L':'R'}`).getWorldPosition(new THREE.Vector3());assert.ok(web.visible);
      assert.ok(centroid(web.geometry,0,meta.webSides).applyMatrix4(web.matrixWorld).distanceTo(wrist)<1e-5);
      assert.ok(centroid(web.geometry,meta.webSegments,meta.webSides).applyMatrix4(web.matrixWorld).distanceTo(target)<1e-5,'both lines converge on the selected roof point');
      assert.equal(model.group.getObjectByName(`spider-zip-web-${i}`).visible,false,'point approach does not draw a second set of zip strands');
    }
  }
  model.update({grounded:false,pointPhase:'idle',candidatePoint:target,traversalPhase:'fall'},.05);for(let i=0;i<2;i++)assert.equal(model.group.getObjectByName(`spider-point-web-${i}`).visible,false,'a roof candidate alone does not leave active lines');model.dispose();
});

test('roof perch compresses the knees and point launch extends naturally before returning to free flight',()=>{
  const model=createSpiderModel(THREE),pelvis=model.group.getObjectByName('spider-bone-pelvis'),foot=key=>model.group.getObjectByName(`spider-bone-foot${key}`),target={x:0,y:12,z:-4};
  model.update({grounded:true,pointPhase:'perch',pointTarget:target,pointProgress:1,elapsed:0},0);const crouch=pelvis.position.y;
  assert.ok(crouch<.45,'perching has a deep recognisable crouch');for(const key of['L','R'])assert.ok(foot(key).position.y>=.09-1e-8,'both feet remain on the roof plane');
  const skin=model.group.getObjectByName('spider-continuous-skin'),vertex=new THREE.Vector3();for(let i=0;i<skin.geometry.attributes.position.count;i++)if(skin.geometry.attributes.position.getY(i)<.1)assert.ok(skin.getVertexPosition(i,vertex).y>=-.002,'the skinned soles also remain above the roof surface');
  for(let i=0;i<2;i++)assert.equal(model.group.getObjectByName(`spider-point-web-${i}`).visible,false,'the character releases the approach strands on arrival');
  model.update({grounded:false,pointPhase:'launch',pointTarget:target,pointLaunchTime:0,pointLaunchQuality:1,elapsed:0},1/60);assert.ok(Math.abs(pelvis.position.y-crouch)<.02,'launch starts from the stored crouch rather than teleporting upright');
  let previous=pelvis.position.clone();for(let frame=1;frame<=18;frame++){
    model.update({grounded:false,pointPhase:'launch',pointTarget:target,pointLaunchTime:frame/60,pointLaunchQuality:1,elapsed:0},1/60);assert.ok(pelvis.position.distanceTo(previous)<.09,'leg extension is spread across frames');previous.copy(pelvis.position);
  }
  assert.ok(pelvis.position.y>crouch+.45,'the push-off extends the hips and legs');
  const before=model.group.getObjectByName('spider-web-wrist-R').getWorldPosition(new THREE.Vector3());model.update({grounded:false,pointPhase:'idle',traversalPhase:'release',releaseTime:.3,elapsed:0},1/60);
  assert.ok(model.group.getObjectByName('spider-web-wrist-R').getWorldPosition(new THREE.Vector3()).distanceTo(before)<.16,'launch arms blend into the following flight pose');model.dispose();
});

test('inspection resets in-progress tricks and point actions immediately without stale lines or changing the physical root',()=>{
  const model=createSpiderModel(THREE),neutral=createSpiderModel(THREE),character=model.group.getObjectByName('spider-character'),resourceIds=()=>{const ids=[];model.group.traverse(o=>{if(o.geometry)ids.push(o.geometry.id);});return ids;},beforeResources=resourceIds();
  model.group.position.set(13,8,-20);model.group.rotation.y=.9;const rootPosition=model.group.position.clone(),rootRotation=model.group.quaternion.clone();
  model.update({grounded:false,trickActive:true,trickPhase:'perform',trickType:'backflip',trickProgress:.4,trickBlend:1,elapsed:0,view:'first'},0);assert.equal(character.visible,false);
  model.update({inspection:true,grounded:false,anchor:{x:0,y:20,z:-10},candidateAnchor:{x:0,y:20,z:-10},zipActive:true,zipAnchors:[{x:1,y:18,z:-12}],diving:true,diveBlend:1,pointPhase:'approach',pointTarget:{x:2,y:24,z:-15},trickActive:true,trickPhase:'perform',trickProgress:.4,trickBlend:1,trickRotation:{x:2.5,y:0,z:0},speed:25,verticalSpeed:-12,landingImpact:10,elapsed:0,view:'third'},1/60);
  neutral.update({grounded:true,landingImpact:0,elapsed:0},0);assert.ok(character.visible);assert.ok(character.quaternion.angleTo(new THREE.Quaternion())<1e-8);assert.ok(character.position.length()<1e-8);
  for(const name of['spider-web-main','spider-zip-web-0','spider-zip-web-1','spider-point-web-0','spider-point-web-1','spider-anchor-marker'])assert.equal(model.group.getObjectByName(name).visible,false,'inspection hides every active traversal indicator');
  for(const bone of model.group.getObjectByName('spider-continuous-skin').skeleton.bones){const expected=neutral.group.getObjectByName(bone.name);assert.ok(bone.position.distanceTo(expected.position)<1e-8,`${bone.name} returns to neutral`);assert.ok(bone.quaternion.angleTo(expected.quaternion)<1e-7);}
  assert.deepEqual(model.group.position,rootPosition);assert.ok(model.group.quaternion.angleTo(rootRotation)<1e-8);assert.deepEqual(resourceIds(),beforeResources);model.dispose();neutral.dispose();
});

test('assisted pendulum length does not bow an attached web when mechanical slack is zero',()=>{
  const model=createSpiderModel(THREE),anchor={x:8,y:19,z:-25},meta=model.group.userData;
  model.update({grounded:false,anchor,ropeLength:70,webSlack:0,webTension:0,swingHand:1},.05);
  const web=model.group.getObjectByName('spider-web-main'),start=centroid(web.geometry,0,meta.webSides),end=centroid(web.geometry,meta.webSegments,meta.webSides);
  for(let i=1;i<meta.webSegments;i++)assert.ok(centroid(web.geometry,i,meta.webSides).distanceTo(start.clone().lerp(end,i/meta.webSegments))<1e-5,'even the initial catch uses the straight wrist-to-building segment');
  model.update({grounded:false,anchor,ropeLength:70,webSlack:30,webTension:0,swingHand:1},.05);
  const a=centroid(web.geometry,0,meta.webSides),b=centroid(web.geometry,meta.webSegments,meta.webSides),mid=centroid(web.geometry,meta.webSegments/2,meta.webSides);
  assert.ok(mid.distanceTo(a.clone().lerp(b,.5))<=.181,'loose capture never draws a metre-deep loop through the street');model.dispose();
});
