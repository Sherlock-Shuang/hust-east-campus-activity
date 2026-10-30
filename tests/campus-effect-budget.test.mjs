import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCampusTsunami} from '../src/campus-tsunami.js';
import {createCampusFloodwater,CAMPUS_FLOOD_WATER} from '../src/campus-floodwater.js';

const event={id:'quality-independent-flood',startAt:100000,pausedAt:null,pausedMs:0};
const point={x:1100,y:1.8,z:3000};
const triangles=group=>{let n=0;group.traverseVisible(o=>{if(o.isMesh){const instances=o.geometry.isInstancedBufferGeometry?o.geometry.instanceCount:1,passes=o.material.transparent&&o.material.side===THREE.DoubleSide&&!o.material.forceSinglePass?2:1;n+=o.geometry.index.count/3*instances*passes;}});return n;};

test('exterior levels bound submitted water/crest work without changing timeline, placement or sampled depth',()=>{
  let expectedPhase,expectedDepth;const counts=[];
  for(const level of[0,1,2]){
    const effect=createCampusTsunami({THREE,scene:new THREE.Scene()});effect.setPerformanceBudget({level});
    assert.equal(effect.resident,false);assert.equal(effect.group.children.length,0);
    effect.update({event,now:125000});counts.push(triangles(effect.group));
    if(expectedPhase){assert.deepEqual(effect.sample,expectedPhase);assert.deepEqual(effect.sampleAt(point),expectedDepth);}
    else{expectedPhase=effect.sample;expectedDepth=effect.sampleAt(point);}
    assert.equal(effect.group.getObjectByName('campus-tsunami-spray').geometry.instanceCount,[220,480,1100][level]);
    assert.equal(effect.group.getObjectByName('campus-tsunami-crest').visible,true);
    assert.equal(effect.group.getObjectByName('campus-tsunami-wall').material.defines.LOW_QUALITY,level<2?1:undefined);
    assert.equal(effect.group.getObjectByName('campus-advancing-floodwater').material.forceSinglePass,true);
    effect.dispose();
  }
  assert.ok(counts[0]<counts[2]*.3);assert.ok(counts[1]<counts[2]*.6);
});

test('repeated quality switches and portal resource eviction release every owned allocation exactly once',()=>{
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene()}),tracked=new Map();
  const track=()=>effect.group.traverse(o=>{for(const asset of[o.geometry,o.material])if(asset&&!tracked.has(asset)){const state={count:0};tracked.set(asset,state);asset.addEventListener('dispose',()=>state.count++);}});
  effect.update({event,now:125000});track();const water=effect.sampleAt(point);
  for(const level of[0,1,2,0,0,2]){effect.setPerformanceBudget({level});track();assert.deepEqual(effect.sampleAt(point),water);}
  effect.releaseResources();assert.equal(effect.resident,false);assert.equal(effect.group.children.length,0);assert.ok([...tracked.values()].every(state=>state.count===1));
  effect.update({event,now:145000});track();assert.equal(effect.sample.elapsed,45,'return advances to server time instead of replaying its old visual phase');
  assert.ok(effect.sampleAt(point).wet);
  effect.update({event:null,now:145001});assert.equal(effect.active,false);effect.releaseResources();assert.equal(effect.resident,false);
  effect.dispose();effect.dispose();assert.ok([...tracked.values()].every(state=>state.count===1));
});

const fract=x=>x-Math.floor(x),hash=(x,y)=>fract(Math.sin(x*127.1+y*311.7)*43758.5453);
const mix=(a,b,t)=>a+(b-a)*t,smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function noise(x,y){const i=Math.floor(x),j=Math.floor(y),u=smooth(0,1,fract(x)),v=smooth(0,1,fract(y));return mix(mix(hash(i,j),hash(i+1,j),u),mix(hash(i,j+1),hash(i+1,j+1),u),v);}
function bezier(a,b,c,d,t){const r=1-t;return a.map((v,i)=>r*r*r*v+3*r*r*t*b[i]+3*r*t*t*c[i]+t*t*t*d[i]);}
function wavePoint(u,v,{height,front},time){
  const broad=noise(u*8.3+time*.025,1.9),h=height*(.80+.28*broad+.042*Math.sin(u*36-time*.58)+.025*Math.sin(u*79+time*.8));
  const broken=smooth(.28,.72,noise(u*15.7+time*.045,3.8+time*.1)),crest=[-.055*h,h],shoulder=[.23*h,1.045*h];
  const p=v<.7?bezier([-260,-26],[h*.27,h*.12],shoulder,crest,v/.7):bezier(crest,crest.map((x,i)=>x+(x-shoulder[i])*.3/.7),[-h*(.4+.08*broken),h*.87],[-h*(.19+.15*broken),h*(.61-.12*broken)],(v-.7)/.3);
  const folds=(Math.sin(u*111+v*23-time*1.6)*2.1+Math.sin(u*63-v*31+time*.9)*2.7)*Math.sin(v*Math.PI)+smooth(.82,1,v)*(noise(u*61,time*.38)-.5)*55;
  return new THREE.Vector3(u*4500,p[1]+folds,front+p[0]+u*u*600+(broad-.5)*100+Math.sin(u*16+time*.2)*18);
}
function backPoint(u,v,wave,time){const crest=wavePoint(u,.7,wave,time),p=bezier([crest.z,crest.y],[crest.z+wave.height*.34,crest.y*.99],[crest.z+700,crest.y*.08],[crest.z+1100,-26],v);return new THREE.Vector3(crest.x,p[1],p[0]);}

test('moving crest bounds include shader displacement, bowed sides and airborne spray on both views',()=>{
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene(),level:0});
  for(const elapsed of[-2,0,5,22,38,65,3600]){
    effect.update({event,now:event.startAt+elapsed*1000});effect.group.updateMatrixWorld(true);
    for(const wave of effect.sample.waves){
      const surge=effect.group.getObjectByName(`campus-tsunami-surge-${wave.slot}`),body=surge.children[0],sphere=body.boundingSphere;
      assert.equal(body.frustumCulled,true);
      for(let i=0;i<=20;i++)for(let j=0;j<=20;j++){
        const u=i/10-1,v=j/20,p=wavePoint(u,v,wave,elapsed);assert.ok(sphere.containsPoint(p));assert.ok(surge.children[2].boundingSphere.containsPoint(backPoint(u,v,wave,elapsed)));
        if(j===0)for(const life of[0,.25,.5,.75,1]){
          for(const seed of[0,.5,1])for(const airborne of[false,true]){
            const age=life*4.76,spray=wavePoint(u,.72,wave,elapsed-age);spray.y+=(airborne?50+seed*65:35+seed*45)*age-(airborne?26:62)*age*age;spray.z-=age*(72+seed*65);spray.x+=age*(10+seed*12);
            for(const axis of['x','y','z'])for(const side of[-1,1]){const edge=spray.clone();edge[axis]+=side*230;assert.ok(surge.children[3].boundingSphere.containsPoint(edge),'ballistic spray and billboards remain within bounds');}
          }
        }
      }
      if(wave.visible)for(const side of[-1,1]){
        const target=wavePoint(.95,.8,wave,elapsed).add(effect.group.position),camera=new THREE.PerspectiveCamera(50,1,.1,500);
        camera.position.copy(target).add(new THREE.Vector3(0,0,side*30));camera.lookAt(target);camera.updateMatrixWorld();
        const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
        assert.ok(frustum.containsPoint(target));assert.ok(frustum.intersectsObject(body),'visible curved edge survives front/back frustum tests');
      }
    }
  }
  effect.dispose();
});

test('flood surface bounds cover underwater troughs and every world-space sample while changing quality',()=>{
  const water=createCampusFloodwater({THREE});
  for(const level of[2,0,1])for(const elapsed of[0,5,40,3600]){
    water.setPerformanceBudget({level});water.update({active:true,front:-6000,elapsed});
    const mesh=water.group.children[0];assert.equal(mesh.frustumCulled,true);
    for(let i=0;i<40;i++){
      const x=CAMPUS_FLOOD_WATER.x-CAMPUS_FLOOD_WATER.width/2+i*CAMPUS_FLOOD_WATER.width/39,z=-4000+i*10000/39;
      const sample=water.sampleAt({x,z});assert.ok(mesh.geometry.boundingBox.containsPoint(new THREE.Vector3(x-CAMPUS_FLOOD_WATER.x,sample.waterY,z)));
    }
  }
  water.dispose();
});
