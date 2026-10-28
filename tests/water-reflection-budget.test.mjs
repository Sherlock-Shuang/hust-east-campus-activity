import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWaterDetails} from '../src/water-details.js';

function fixture(t){
  const shape=new THREE.Shape([new THREE.Vector2(-30,-30),new THREE.Vector2(30,-30),new THREE.Vector2(30,30),new THREE.Vector2(-30,30)]);
  const sourceGeometry=new THREE.ShapeGeometry(shape),sourceMaterial=new THREE.MeshBasicMaterial();
  const mesh=new THREE.Mesh(sourceGeometry,sourceMaterial);mesh.rotation.x=-Math.PI/2;
  const record={id:'relation/13705236',mesh,shapes:[shape],feature:{properties:{}}};
  const water=createWaterDetails(THREE,{records:[record],textureSize:16}),scene=new THREE.Scene();scene.add(mesh,water.group);
  const camera=new THREE.PerspectiveCamera(60,1,.1,1000);camera.position.set(0,15,45);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  let calls=0,target=null;
  const renderer={xr:{enabled:true},shadowMap:{autoUpdate:false,needsUpdate:true},toneMapping:THREE.ACESFilmicToneMapping,autoClear:true,
    state:{buffers:{depth:{setMask(){}}}},getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
    getScissorTest:()=>false,setScissorTest(){},getViewport:v=>v.set(0,0,800,600),getScissor:v=>v.set(0,0,800,600),setViewport(){},setScissor(){},render(){calls++;}};
  t.after(()=>{water.dispose();sourceGeometry.dispose();sourceMaterial.dispose();});
  return {water,scene,camera,renderer,mesh,calls:()=>calls};
}
test('quality disables the extra lake render pass and re-enabling refreshes without rebuilding water',t=>{
  const f=fixture(t),material=f.water.materialFor('relation/13705236');
  f.water.setReflectionBudget({enabled:false});
  assert.equal(f.water.renderReflection(f.renderer,f.scene,f.camera,1000),false);assert.equal(f.calls(),0);
  f.water.setReflectionBudget({enabled:true,intervalMs:500});
  assert.equal(f.water.renderReflection(f.renderer,f.scene,f.camera,1100),true);
  assert.equal(f.water.renderReflection(f.renderer,f.scene,f.camera,1400),false);
  assert.equal(f.water.renderReflection(f.renderer,f.scene,f.camera,1600),true);assert.equal(f.calls(),2);
  assert.equal(f.water.materialFor('relation/13705236'),material);
  assert.equal(f.mesh.visible,true);assert.equal(f.renderer.xr.enabled,true);assert.equal(f.renderer.shadowMap.autoUpdate,false);assert.equal(f.renderer.shadowMap.needsUpdate,true);
  f.water.setReflectionBudget({enabled:false});f.water.setReflectionBudget({enabled:true});
  assert.equal(f.water.renderReflection(f.renderer,f.scene,f.camera,1601),true,'quality switch does not leave an old projected reflection');
});
test('reflection budget never renders offscreen water and cannot request an unbounded refresh rate',t=>{
  const f=fixture(t);f.water.setReflectionBudget({enabled:true,intervalMs:0});
  assert.equal(f.water.renderReflection(f.renderer,f.scene,f.camera,0),true);
  assert.equal(f.water.renderReflection(f.renderer,f.scene,f.camera,100),false);
  assert.equal(f.water.renderReflection(f.renderer,f.scene,f.camera,125),true);
  f.camera.lookAt(0,15,100);f.camera.updateMatrixWorld();
  assert.equal(f.water.renderReflection(f.renderer,f.scene,f.camera,1000),false);assert.equal(f.calls(),2);
});
