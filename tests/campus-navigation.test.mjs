import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {navigationReading,formatCampusDistance,nearbyCampusName,campusMapGeometry,campusMapFocus,campusNavigationPlaces} from '../src/campus-navigation-data.js';
import {createExplorationProgress} from '../src/exploration-progress.js';
import {readFootstepPreference} from '../src/footstep-preference.js';

const origin={x:0,y:.14,z:0};
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('destination pointer stays relative to camera, including ±π wrap',()=>{
  approx(navigationReading(origin,{x:0,z:-100},0).angle,0);
  approx(navigationReading(origin,{x:100,z:0},0).angle,Math.PI/2);
  approx(navigationReading(origin,{x:100,z:0},-Math.PI/2).angle,0);
  approx(navigationReading(origin,{x:-100,z:0},Math.PI/2).angle,0);
  approx(navigationReading(origin,{x:0,z:100},Math.PI).angle,0);
  assert.equal(navigationReading({x:NaN,z:0},origin),null);
});
test('arrival requires proximity in both plan and height; distant labels are stable',()=>{
  assert.equal(navigationReading(origin,{x:8,z:0,y:.14}).arrived,true);
  assert.equal(navigationReading({...origin,y:20},{x:8,z:0,y:.14}).arrived,false);
  assert.equal(navigationReading(origin,{x:20,z:0}).arrived,false);
  assert.equal(formatCampusDistance(122),'120 m');assert.equal(formatCampusDistance(1720),'1.7 km');
  assert.equal(nearbyCampusName(origin,[{x:10,z:20,label:'食堂'},{x:11,z:21,label:'东门'}]),'食堂附近');
  assert.equal(nearbyCampusName(origin,[{x:300,z:300,label:'食堂'}]),'东校区漫游');
});
test('cartography retains courtyard holes, source coordinates and road line bounds',()=>{
  const shape=new THREE.Shape([new THREE.Vector2(0,0),new THREE.Vector2(100,0),new THREE.Vector2(100,100),new THREE.Vector2(0,100)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(20,20),new THREE.Vector2(30,20),new THREE.Vector2(30,30)]));
  const group=new THREE.Group();group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-80,0,-50),new THREE.Vector3(130,0,50)])));
  const map=campusMapGeometry({records:[{category:'building',shapes:[shape]},{category:'road',group}]});
  assert.equal((map.paths.building.match(/M/g)||[]).length,2);assert.ok(map.paths.building.includes('100,-100'));assert.ok(map.paths.road.includes('-80,-50'));
  assert.deepEqual(map.viewBox,[-135,-155,320,260]);assert.ok(map.markerScale>0);
  assert.equal(campusMapGeometry({records:[]}).viewBox.every(Number.isFinite),true);
  group.children[0].geometry.dispose();
});
test('invalid source arrivals are omitted instead of inventing destinations',()=>{
  const places=campusNavigationPlaces({}, {records:[]});
  assert.ok(places.every(place=>Number.isFinite(place.x)&&Number.isFinite(place.z)));
  assert.equal(places.some(place=>place.id==='opto-c1'),false);
});
test('first visit teaching tracks real look and travel, ignores teleport and paused movement',()=>{
  const guide=createExplorationProgress();guide.sample(origin,3.1);guide.sample(origin,-3.1);assert.equal(guide.stage,'look');
  guide.sample(origin,-2.7);assert.equal(guide.stage,'walk');
  guide.sample({x:100,z:0},-2.7);assert.equal(guide.stage,'walk');
  guide.pause();guide.sample({x:102,z:0},-2.7);assert.equal(guide.stage,'walk');
  guide.sample({x:103,z:0},-2.7);guide.sample({x:104.6,z:0},-2.7);assert.equal(guide.stage,'done');
  guide.reset();assert.equal(guide.stage,'look');guide.sample({x:NaN,z:0},0);guide.sample(origin,0);assert.equal(guide.stage,'look');
});
test('audio preference defaults on, persists off, and tolerates blocked storage',()=>{
  assert.equal(readFootstepPreference(),true);
  assert.equal(readFootstepPreference({getItem:()=> 'off'}),false);
  assert.equal(readFootstepPreference({getItem(){throw Error('denied');}}),true);
});

test('map defaults to usable landmark extent with room for adjacent roads, with full extent fallback',()=>{
  assert.deepEqual(campusMapFocus([{x:100,z:200},{x:500,z:700}],[-1000,-1000,4000,4000]),[-40,60,680,780]);
  assert.deepEqual(campusMapFocus([],[-1000,-1000,4000,4000]),[-1000,-1000,4000,4000]);
});
