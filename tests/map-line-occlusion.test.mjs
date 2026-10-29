import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGeoScene,setCartographicLinesVisible} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
test('non-polygon source lines cannot show through 3D architecture and return in plan mode',()=>{
  const fc={type:'FeatureCollection',features:[{type:'Feature',id:'tree-row',properties:{category:'green',tags:{natural:'tree_row'}},geometry:{type:'LineString',coordinates:[[114.43,30.516],[114.431,30.516]]}}]};
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),scene=new THREE.Scene();
  const model=createGeoScene(THREE,scene,fc,frame,geoToLocal),lines=[];model.group.traverse(o=>{if(o.isLine)lines.push(o);});
  assert.ok(lines.length);assert.ok(lines.every(o=>o.material.depthTest===false));
  setCartographicLinesVisible(model.group,false);assert.ok(lines.every(o=>!o.visible));
  setCartographicLinesVisible(model.group,true);assert.ok(lines.every(o=>o.visible));model.dispose();
});
