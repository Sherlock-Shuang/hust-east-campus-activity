import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import {readFileSync} from 'node:fs';
import {createCampus3D} from '../src/campus-3d.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
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

test('bridge junction has no overlapping asphalt/paver top faces and road paint retains depth priority',()=>{
  const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
  const ids=['way/1228820956','way/97080595'];
  const roads=source.features.filter(f=>ids.includes(f.id)).map(feature=>({id:feature.id,feature,category:'road',shapes:[]}));
  assert.equal(roads.length,2);
  const before=JSON.stringify(roads),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  const campus=createCampus3D(THREE,{records:roads,roads,buildings:[],water:[]},{frame,geoToLocal});
  const biasOf=m=>{const s={fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s);return Number(s.fragmentShader.match(/gl_FragDepth - ([\d.]+)/)?.[1]??0);};
  for(const id of ids){
    const deck=campus.records.get(id).group.children.find(o=>o.isMesh);
    deck.geometry.computeBoundingBox();assert.ok(Math.abs(deck.geometry.boundingBox.max.y-.142)<1e-6);
    assert.equal(biasOf(deck.material),0,'road bodies do not need artificial depth separation');
    assert.equal(deck.material.depthTest,true);assert.equal(deck.material.depthWrite,true);
  }
  const tops=id=>{const p=campus.records.get(id).group.children.find(o=>o.isMesh).geometry.attributes.position,result=[];for(let i=0;i<p.count;i+=3)if([i,i+1,i+2].every(j=>Math.abs(p.getY(j)-.142)<1e-6)){const ring=[i,i+1,i+2,i].map(j=>[p.getX(j),p.getZ(j)]);result.push([ring]);}return polygonClipping.union(...result);};
  const overlap=polygonClipping.intersection(tops(ids[0]),tops(ids[1]));
  let area=0;for(const polygon of overlap)for(const ring of polygon)for(let i=1;i<ring.length;i++)area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];
  assert.ok(Math.abs(area/2)<.005,'only float32 edge-rounding slivers may remain, not overlapping road sheets');
  assert.equal(campus.records.get(ids[1]).group.children.find(o=>o.isMesh).userData.renderedTopClipAgainst,ids[0]);
  const lines=[];campus.group.traverse(o=>{if(/avenue-centre-lines|avenue-cycle-boundaries|avenue-motor-lane-dashes/.test(o.name))lines.push(o);});
  assert.ok(lines.length>=2);
  for(const line of lines)assert.equal(biasOf(line.material),4/2**24,'lane paint stays ahead of biased asphalt');
  assert.equal(JSON.stringify(roads),before,'source widths, coordinates and datums stay intact');
  campus.dispose();
});
