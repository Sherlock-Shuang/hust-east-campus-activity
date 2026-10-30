import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {createC118Seating,c118CinemaFov} from '../src/c118-seating.js';

test('immersive viewing fits the whole programme at ninety percent without perspective distortion',()=>{
 const plan=planOptoC118Interior(),seating=createC118Seating(plan),seat=seating.recommendedSeat;
 const physical=seating.viewFor(seat.id),view=seating.focusViewFor(seat.id);
 assert.equal(seating.focusViewFor('missing'),null);
 assert.notEqual(view.y,physical.y,'the viewing lens is separate from the seated body');
 for(const aspect of[16/9,4/3,21/9,9/16,390/844]){
  const camera=new THREE.PerspectiveCamera(c118CinemaFov(view,aspect),aspect,.07,90);
  camera.position.set(view.x,view.y,view.z);camera.updateMatrixWorld();
  const corners=[];
  for(const x of[-4.9,4.9])for(const y of[-9.8*9/32,9.8*9/32])corners.push(new THREE.Vector3(x,view.y+y,view.z-view.distance).project(camera));
  const width=Math.max(...corners.map(p=>p.x)),height=Math.max(...corners.map(p=>p.y));
  assert.ok(width<=.900001&&height<=.900001,'all film corners are on screen');
  assert.ok(Math.abs(Math.max(width,height)-.9)<1e-6,'film fills the limiting dimension');
  assert.ok(Math.abs(corners[0].x-corners[1].x)<1e-8,'screen sides are parallel');
 }
 assert.deepEqual(seating.viewFor(seat.id),physical,'focusing never changes the body pose');
});
