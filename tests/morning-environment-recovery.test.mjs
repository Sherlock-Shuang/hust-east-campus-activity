import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMorningEnvironment} from '../src/surface-materials.js';

// Exercise the application's render-target ownership with a PMREM boundary
// double. Browser WEBGL_lose_context verification remains a separate check.
function pmremFixture(){
  const targets=[],generators=[],sources=[];let fail=false;
  class PMREMGenerator{
    constructor(renderer){this.renderer=renderer;this.disposals=0;generators.push(this);}
    fromEquirectangular(source){
      sources.push(source);if(fail)throw new Error('GPU target regeneration failed');
      const target={texture:new THREE.Texture(),disposals:0,dispose(){this.disposals++;}};targets.push(target);return target;
    }
    dispose(){this.disposals++;}
  }
  return{api:{...THREE,PMREMGenerator},targets,generators,sources,setFailure(value){fail=value;}};
}

test('daylight rebuilds GPU-only PMREM while preserving its CPU source and releasing old targets once',()=>{
  const f=pmremFixture(),renderer={},daylight=createMorningEnvironment(f.api,renderer),source=daylight.background;
  let sourceDisposals=0;source.addEventListener('dispose',()=>sourceDisposals++);
  const first=daylight.environment;
  for(let n=0;n<3;n++){
    const old=daylight.environment,next=daylight.rebuildEnvironment();
    assert.notEqual(next,old);assert.equal(next,daylight.environment);
    assert.equal(daylight.background,source);assert.ok(f.sources.every(s=>s===source));
    assert.equal(sourceDisposals,0,'retain readable source pixels until final teardown');
  }
  assert.notEqual(daylight.environment,first);
  assert.deepEqual(f.targets.map(t=>t.disposals),[1,1,1,0]);
  assert.ok(f.generators.every(g=>g.renderer===renderer&&g.disposals===1));
  daylight.dispose();daylight.dispose();
  assert.deepEqual(f.targets.map(t=>t.disposals),[1,1,1,1]);assert.equal(sourceDisposals,1);
  assert.throws(()=>daylight.rebuildEnvironment(),/disposed/);
});

test('failed regeneration releases generator resources and preserves the previous target for explicit recovery',()=>{
  const f=pmremFixture(),daylight=createMorningEnvironment(f.api,{}),previous=daylight.environment;
  f.setFailure(true);assert.throws(()=>daylight.rebuildEnvironment(),/regeneration failed/);
  assert.equal(daylight.environment,previous);assert.equal(f.targets[0].disposals,0);
  assert.ok(f.generators.every(g=>g.disposals===1));
  f.setFailure(false);assert.notEqual(daylight.rebuildEnvironment(),previous);assert.equal(f.targets[0].disposals,1);
  daylight.dispose();
});
