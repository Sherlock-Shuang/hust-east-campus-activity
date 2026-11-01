import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {freezeStaticLibrary,createLibraryRaycastIndex,createLibraryRayMemo,createLibraryDrawGate} from './library-render-runtime.mjs';
import {applyLibraryPerformance} from './library-performance.mjs';

test('static library keeps nested world transforms and material interaction; release restores flags',()=>{
  const scene=new THREE.Scene(),building=new THREE.Group(),room=new THREE.Group();
  building.position.set(3,2,-9);building.rotation.y=.73;room.position.set(1,0,4);room.rotation.x=.2;
  const book=new THREE.Mesh(new THREE.BoxGeometry(1,2,.3),new THREE.MeshStandardMaterial());
  scene.add(building);building.add(room);room.add(book);scene.updateMatrixWorld(true);
  const before=book.matrixWorld.clone(),frozen=freezeStaticLibrary(building);
  assert.equal(frozen.count,3);assert.equal(frozen.isStatic(book),true);
  let localUpdates=0;const update=book.updateMatrix;book.updateMatrix=function(){localUpdates++;return update.call(this);};
  scene.updateMatrixWorld();assert.equal(localUpdates,0);assert.deepEqual(book.matrixWorld.elements,before.elements);
  book.material.emissive.set(0x8d7950);assert.equal(book.material.emissive.getHex(),0x8d7950);
  frozen.dispose();assert.equal(book.matrixAutoUpdate,true);assert.equal(book.matrixWorldAutoUpdate,true);assert.equal(frozen.isStatic(book),false);
  scene.updateMatrixWorld();assert.equal(localUpdates,1);
});

test('animation, skinning, morphs and explicitly dynamic GLBs are never frozen',()=>{
  for(const type of ['animation','skinned','morph','dynamic']){
    const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());root.add(mesh);
    if(type==='skinned')mesh.isSkinnedMesh=true;
    if(type==='morph')mesh.morphTargetInfluences=[0];
    if(type==='dynamic')mesh.userData.libraryDynamic=true;
    const frozen=freezeStaticLibrary(root,{animations:type==='animation'?[{}]:[]});
    assert.equal(frozen.count,0,type);assert.equal(mesh.matrixAutoUpdate,true,type);assert.equal(frozen.isStatic(mesh),false,type);
  }
});

test('broadphase preserves exact nearest triangle hit, layers, inside bounds and far limits',()=>{
  const root=new THREE.Group(),objects=[],geometry=new THREE.BoxGeometry(1,2,.6),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  for(let i=0;i<96;i++){
    const object=new THREE.Mesh(geometry,material);object.position.set((i%12-6)*2,0,-2-Math.floor(i/12)*2);object.rotation.y=i*.17;root.add(object);objects.push(object);
  }
  objects[1].layers.set(1);
  const frozen=freezeStaticLibrary(root),index=createLibraryRaycastIndex(THREE,objects,frozen.isStatic);
  assert.equal(index.staticOnly,true);
  const ray=new THREE.Raycaster();let queries=0;
  for(const origin of [new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-2),new THREE.Vector3(3,.4,-4)]){
    for(let i=-16;i<=16;i++)for(const far of [.01,1,8,Infinity]){
      ray.set(origin,new THREE.Vector3(i/25,.01,-1).normalize());ray.far=far;
      const expected=ray.intersectObjects(objects,false)[0],actual=index.nearest(ray);queries++;
      assert.equal(actual?.object,expected?.object);if(expected)assert.equal(actual.distance,expected.distance);
    }
  }
  assert.equal(index.stats.queries,queries);assert(index.stats.totalCandidates<queries*objects.length*.15);
  index.dispose();assert.equal(index.nearest(ray),undefined);assert.equal(index.stats.objects,0);
});

test('moving occluders bypass cached bounds and still block after moving into the ray',()=>{
  const object=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());object.position.set(9,0,-2);object.updateMatrixWorld();
  const index=createLibraryRaycastIndex(THREE,[object]),ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,0,-1),0,5);
  assert.equal(index.staticOnly,false);
  assert.equal(index.nearest(ray),undefined);object.position.x=0;object.updateMatrixWorld();assert.equal(index.nearest(ray)?.object,object);
});

test('static pick memo includes full ray range and player pose; moving objects and boundaries invalidate it',()=>{
  const memo=createLibraryRayMemo(),ray=new THREE.Raycaster(new THREE.Vector3(1,2,3),new THREE.Vector3(0,0,-1),0,2),book={id:'wanyan'};
  assert.equal(memo.reuse(ray,1,3,true),false);memo.commit(book);
  assert.equal(memo.reuse(ray,1,3,true),true);assert.equal(memo.value,book);
  for(const change of [()=>ray.ray.origin.x+=.01,()=>ray.ray.origin.y+=.01,()=>ray.ray.origin.z+=.01,()=>ray.ray.direction.x+=.01,()=>ray.ray.direction.y+=.01,()=>ray.ray.direction.z+=.01,()=>ray.near+=.01,()=>ray.far+=.01]){
    change();assert.equal(memo.reuse(ray,1,3,true),false);memo.commit(book);assert.equal(memo.reuse(ray,1,3,true),true);
  }
  assert.equal(memo.reuse(ray,2,3,true),false);memo.commit(book);assert.equal(memo.reuse(ray,2,4,true),false);memo.commit(book);
  assert.equal(memo.reuse(ray,2,4,false),false);memo.commit(book);assert.equal(memo.reuse(ray,2,4,false),false);
  assert.equal(memo.reuse(ray,2,4,true),false);memo.commit(null);assert.equal(memo.reuse(ray,2,4,true),true);assert.equal(memo.value,null);
  memo.invalidate();assert.equal(memo.reuse(ray,2,4,true),false);
});

test('unchanged scene sleeps but movement, material changes and animation render at original cadence',()=>{
  const gate=createLibraryDrawGate();let draws=0;
  for(let i=0;i<120;i++)if(gate.shouldDraw(i*1000/60))draws++;
  assert.equal(draws,2);assert.equal(gate.stats.skipped,118);
  for(let i=120;i<180;i++)assert.equal(gate.shouldDraw(i*1000/60,true),true);
  for(let i=180;i<240;i++)assert.equal(gate.shouldDraw(i*1000/60,false,true),true);
  assert.equal(gate.stats.draws,122);
});

test('activity v2 upgrades strictly and idempotently without altering physics, stories or true victories',async()=>{
  const current=await readFile(new URL('../../work-assets/library/hub/main.mjs',import.meta.url),'utf8');
  const candidate=applyLibraryPerformance(current);
  assert.equal(applyLibraryPerformance(candidate),candidate);
  assert.match(candidate,/campus-library-render-v3/);
  for(const anchor of [
    'if(!phone.active&&!opening)tickMotion(player,input(),yaw,dt);',
    'const exitedBefore=journey.exited,event=storyClock.tick(journey,',
    'completeGame(journey,game)',
    'raycaster.far=hit.distance+.002;',
    "if(assetsDisposed){disposeGltf(g);return;}libraryAssets=g;"
  ])if(current.includes(anchor))assert(candidate.includes(anchor),anchor);
  assert.match(candidate,/libraryStatic=freezeStaticLibrary\(g.scene,\{animations:g.animations\}\)/);
  assert.match(candidate,/libraryPickIndex\?\.dispose\(\);libraryStatic\?\.dispose\(\);assetsDisposed=true/);
  assert.match(candidate,/if\(!heroReady\|\|!actor.visible/);
  assert.throws(()=>applyLibraryPerformance('// campus-library-assets-v2\nfunction unknownRuntime(){}'),/Unexpected library runtime/);
});
