import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrafficVisualCadence} from '../src/traffic-visual-cadence.js';

test('traffic instance updates respect the chosen budget without limiting the callers physics clock',()=>{
  for(const fps of[30,60,120])for(const hz of[15,24,30]){
    const cadence=createTrafficVisualCadence(hz);assert.equal(cadence.take(),true);
    let updates=0,physicsFrames=0;
    for(let i=0;i<fps*4;i++){physicsFrames++;cadence.advance(1/fps);if(cadence.take())updates++;}
    assert.ok(Math.abs(updates-Math.min(hz,fps)*4)<=1,`${fps}fps / ${hz}Hz gives ${updates} visual updates`);
    assert.equal(physicsFrames,fps*4);
  }
});
test('budget changes refresh once, repeated budgets do not bypass throttling and long gaps never catch up in a loop',()=>{
  const cadence=createTrafficVisualCadence(15);cadence.take();
  for(let i=0;i<3;i++){assert.equal(cadence.setHz(15),false);cadence.advance(1/60);assert.equal(cadence.take(),false);}
  cadence.setHz(24);assert.equal(cadence.take(),true);assert.equal(cadence.take(),false);
  cadence.advance(30);assert.equal(cadence.take(),true);assert.equal(cadence.take(),false);
  cadence.invalidate();assert.equal(cadence.take(),true);cadence.advance(NaN);assert.equal(cadence.take(),false);
});
