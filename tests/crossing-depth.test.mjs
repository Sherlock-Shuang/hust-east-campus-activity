import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCrossingDetails} from '../src/street-furniture.js';
import {createSurfaceMaterials} from '../src/surface-materials.js';

const route={crossings:[
  {sourceId:'marked',x:281.272,z:-95.682,y:.16,yaw:1.39455,width:12,tags:{crossing:'marked',tactile_paving:'no'}},
  {sourceId:'unmarked',x:258,z:-99,y:.16,yaw:0,width:12,tags:{crossing:'unmarked'}},
]};

test('paint keeps the source footprint and top height with only upward surface faces',()=>{
  const before=JSON.stringify(route),surfaces=createSurfaceMaterials(THREE),details=createCrossingDetails(THREE,route,surfaces);
  const mesh=details.group.children.find(o=>o.material.polygonOffset),{position,normal}=mesh.geometry.attributes;
  assert.equal(JSON.stringify(route),before);
  assert.deepEqual(details.group.userData.sourceIds,['marked']);
  assert.equal(details.counts.stripes,14);
  for(let i=0;i<position.count;i++){
    assert.ok(Math.abs(position.getY(i)-.146)<1e-6,'no lifted/floating stripe or competing underside');
    assert.ok(normal.getY(i)>.99999);
  }
  assert.equal(position.count/3,details.counts.stripes*4,'six-point wear outline needs four top triangles only');
  assert.equal(mesh.castShadow,false);
  assert.equal(mesh.receiveShadow,true);
  details.dispose();surfaces.dispose();
});

test('log-depth paint retains ordinary occlusion and uses a bounded fragment-depth separation',()=>{
  const surfaces=createSurfaceMaterials(THREE),details=createCrossingDetails(THREE,route,surfaces);
  const material=details.group.children.find(o=>o.material.polygonOffset).material;
  assert.equal(material.depthTest,true);assert.equal(material.depthWrite,true);
  assert.equal(material.transparent,false);assert.equal(material.side,THREE.FrontSide);
  const shader={fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader);
  const include='#include <logdepthbuf_fragment>',depthAssignment=shader.fragmentShader.indexOf('gl_FragDepth = max');
  assert.ok(shader.fragmentShader.indexOf(include)<depthAssignment);
  const chunk=THREE.ShaderChunk.logdepthbuf_fragment;
  assert.match(chunk,/defined\( USE_LOGARITHMIC_DEPTH_BUFFER \)/);
  assert.match(chunk,/gl_FragDepth =/);
  const bias=Number(shader.fragmentShader.match(/gl_FragDepth - ([\d.]+)/)?.[1]);
  assert.equal(bias,4/2**24);
  // At 1 km this is <3 mm in view depth, far smaller than a shoe/tyre.
  const far=12000,distance=1000,shift=(distance+1)*(1-2**(-bias*Math.log2(far+1)));
  assert.ok(shift>0&&shift<.003);
  assert.equal(material.polygonOffsetFactor,-1);assert.equal(material.polygonOffsetUnits,-1);
  details.dispose();surfaces.dispose();
});
