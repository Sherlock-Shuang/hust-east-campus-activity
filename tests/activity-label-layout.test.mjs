import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {projectWallTextRects,avoidWallText} from '../src/activity-label-layout.js';

test('an open activity label moves clear of wall copy instead of obscuring it',()=>{
  // Public arrival: the library label originally covered the central headline.
  const rect={left:584,right:816,top:111,bottom:159};
  const y=avoidWallText(710,157,136,30,[rect],720);
  assert.ok(y<rect.top-7||y-30>rect.bottom+7);
  assert.equal(avoidWallText(300,157,136,30,[rect],720),157,'unrelated labels retain their original anchor');
  const edge={left:584,right:816,top:4,bottom:50};
  assert.ok(avoidWallText(710,30,136,30,[edge],720)>edge.bottom+30,'near the top, place it below the copy');
});

test('text avoidance uses only nearby front-facing, on-screen signs',()=>{
  const camera=new THREE.PerspectiveCamera(65,16/9,.1,1000);
  camera.position.set(0,1.7,0);camera.updateMatrixWorld();
  const visible={x:0,y:2,z:-10,width:6,height:2,nx:0,nz:1};
  const items=[visible,{...visible,nz:-1},{...visible,z:10},{...visible,z:-200},{...visible,x:50}];
  const rects=projectWallTextRects(THREE,camera,items,1280,720);
  assert.equal(rects.length,1);
  const [rect]=rects;
  assert.ok(rect.left<640&&rect.right>640&&rect.top<360&&rect.bottom>360);
});
