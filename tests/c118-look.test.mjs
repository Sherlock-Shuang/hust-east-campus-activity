import test from 'node:test';
import assert from 'node:assert/strict';
import {c118LookPose} from '../src/c118-look.js';

test('a coalesced touch swipe turns as far as the same swipe across many frames',()=>{
  const options={touch:true,width:844,height:390,preferences:{sensitivity:.75}},start={heading:.2,pitch:0};
  const delayed=c118LookPose(start,220,25,options);
  let smooth=start;for(let i=0;i<22;i++)smooth=c118LookPose(smooth,10,25/22,options);
  assert.ok(Math.abs(delayed.heading-smooth.heading)<1e-10);
  assert.ok(Math.abs(delayed.pitch-smooth.pitch)<1e-10);
  assert.ok(start.heading-delayed.heading>2,'a slow frame must not truncate a long swipe to .8 radians');
});
test('touch pitch stays bounded and malformed events cannot corrupt the pose',()=>{
  const start={heading:1,pitch:.3};
  assert.deepEqual(c118LookPose(start,NaN,20,{touch:true}),start);
  assert.equal(c118LookPose(start,0,2000,{touch:true}).pitch,-1.35);
  assert.equal(c118LookPose(start,0,-2000,{touch:true}).pitch,1.3);
  assert.ok(Math.abs(c118LookPose(start,2000,0).heading-.2)<1e-10);
});
