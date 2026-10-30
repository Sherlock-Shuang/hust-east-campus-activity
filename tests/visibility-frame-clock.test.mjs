import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisibilityFrameClock} from '../src/visibility-frame-clock.js';
function fixture(){
  const document=new EventTarget();document.hidden=false;
  const clock=createVisibilityFrameClock({document,now:()=>0});
  const visibility=hidden=>{document.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'));};
  return {clock,document,visibility};
}
test('a page with no background RAF does not advance motion or frame metrics when it returns',()=>{
  const f=fixture();let position=0;
  position+=20*f.clock.sample(16).dt;assert.equal(position,.32);
  f.visibility(true);f.visibility(false);
  const restored=f.clock.sample(600016);position+=20*restored.dt;
  assert.equal(position,.32);assert.deepEqual(restored,{hidden:false,resumed:true,elapsed:0,dt:0});
  const next=f.clock.sample(600032);assert.equal(next.dt,.016);assert.equal(next.resumed,false);f.clock.dispose();
});
test('background callbacks do no physics work; visible long frames remain measured and bounded',()=>{
  const f=fixture();f.visibility(true);
  for(const timestamp of [1000,2000,100000])assert.equal(f.clock.sample(timestamp).dt,0);
  f.visibility(false);assert.equal(f.clock.sample(200000).dt,0);
  const slow=f.clock.sample(200500);assert.equal(slow.dt,.1);assert.equal(slow.elapsed,500);f.clock.dispose();
});
test('reset excludes graphics restoration gaps and dispose releases the visibility listener',()=>{
  const f=fixture();f.clock.sample(16);f.clock.reset();assert.equal(f.clock.sample(10000).dt,0);
  f.clock.dispose();f.visibility(true);f.visibility(false);
  assert.equal(f.clock.sample(10016).dt,.016);
});
