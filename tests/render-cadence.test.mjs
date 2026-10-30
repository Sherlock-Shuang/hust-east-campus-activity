import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderCadence} from '../src/render-cadence.js';
import {createFrameMetrics} from '../src/frame-metrics.js';

test('30/60 Hz drawing on diverse refresh rates retains fractional phase',()=>{
  for(const refresh of [60,90,120,144])for(const fps of [30,60]){
    const c=createRenderCadence();let draws=0;
    for(let frame=0;frame<refresh*10;frame++)if(c.shouldRender(frame*1000/refresh,fps))draws++;
    assert.ok(Math.abs(draws-fps*10)<=1,`${refresh} Hz / ${fps} fps: ${draws}`);
  }
});
test('pause, backwards clock and changed budget admit one clean frame, never catch-up',()=>{
  const c=createRenderCadence();assert.equal(c.shouldRender(0,30),true);assert.equal(c.shouldRender(1,30),false);
  assert.equal(c.shouldRender(2,60),true);assert.equal(c.shouldRender(4000,60),true);assert.equal(c.shouldRender(4001,60),false);
  assert.equal(c.shouldRender(-1,60),true);c.reset();assert.equal(c.shouldRender(0,30),true);
});
test('sub-millisecond RAF jitter does not discard 60 Hz display frames',()=>{
  const c=createRenderCadence();let draws=0;
  for(let frame=0;frame<600;frame++){
    if(c.shouldRender(frame*1000/60+.35*Math.sin(frame*.73),60))draws++;
  }
  assert.equal(draws,600);
});
test('59.94/60.1 Hz jitter never advances past a future render deadline',()=>{
  for(const refresh of [59.94,60.1]){
    const c=createRenderCadence(),frames=Math.floor(refresh*60);let draws=0;
    for(let frame=0;frame<frames;frame++){
      if(c.shouldRender(frame*1000/refresh+.35*Math.sin(frame*.73),60))draws++;
    }
    assert.equal(draws,Math.min(frames,3600),`${refresh} Hz`);
  }
});
test('session preserves early stalls after rolling window expires and bounds minute history',()=>{
  const m=createFrameMetrics({capacity:30,maxMinutes:2});m.sample({frameMs:180});
  for(let i=0;i<18000;i++)m.sample({frameMs:20,cpuMs:3});
  m.sample({frameMs:9000,active:false});
  assert.equal(m.snapshot().longFrames100,0);const s=m.session();
  assert.equal(s.sampleCount,18001);assert.equal(s.longFrames100,1);assert.equal(s.completedMinutes,6);assert.equal(s.minutes.length,2);
  assert.equal(s.p95UpperMs,20);assert.equal(s.maxMs,180);
  m.reset();assert.equal(m.snapshot().sampleCount,0);assert.equal(m.session().sampleCount,18001);
  m.resetSession();assert.equal(m.session().sampleCount,0);
});
