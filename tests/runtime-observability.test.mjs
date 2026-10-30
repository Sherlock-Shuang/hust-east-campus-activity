import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameMetrics} from '../src/frame-metrics.js';
import {createGraphicsRecovery} from '../src/graphics-recovery.js';

test('bounded frame distribution keeps stalls but excludes intentional pauses and invalid samples',()=>{
  const m=createFrameMetrics({capacity:30});
  for(let i=0;i<29;i++)m.sample({frameMs:16,cpuMs:3});
  m.sample({frameMs:150,cpuMs:12});m.sample({frameMs:9000,active:false});m.sample({frameMs:NaN});
  let s=m.snapshot();assert.equal(s.sampleCount,30);assert.equal(s.p95Ms,16);assert.equal(s.p99Ms,150);assert.equal(s.longFrames100,1);
  for(let i=0;i<30;i++)m.sample({frameMs:20,cpuMs:4,drawCalls:100});
  s=m.snapshot();assert.equal(s.p95Ms,20);assert.equal(s.longFrames100,0);assert.equal(s.averageFps,50);assert.equal(s.drawCalls,100);
  m.reset();assert.equal(m.snapshot().sampleCount,0);
});

test('context loss freezes once, exposes recovery fallback, and restores without repeated reloads',()=>{
  const canvas=new EventTarget(),events=[],timers=new Map();let id=0;
  const recovery=createGraphicsRecovery({canvas,onLost:()=>events.push('freeze'),onRestored:()=>events.push('resume'),onStatus:s=>events.push(s),setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:i=>timers.delete(i)});
  const loss=new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(loss);canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(loss.defaultPrevented,true);assert.equal(recovery.suspended,true);assert.equal(recovery.lossCount,1);
  assert.deepEqual(events,['freeze','restoring']);[...timers.values()][0]();assert.equal(events.at(-1),'reload-available');
  canvas.dispatchEvent(new Event('webglcontextrestored'));assert.equal(recovery.suspended,false);assert.deepEqual(events.slice(-2),['resume','ready']);
  recovery.dispose();canvas.dispatchEvent(new Event('webglcontextlost'));assert.equal(recovery.lossCount,1);
});

test('failed application restoration stays frozen and offers an explicit reload',()=>{
  const canvas=new EventTarget(),states=[];
  const r=createGraphicsRecovery({canvas,onRestored(){throw new Error('restore failed');},onStatus:s=>states.push(s)});
  canvas.dispatchEvent(new Event('webglcontextlost'));canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(r.suspended,true);assert.equal(states.at(-1),'reload-available');r.dispose();
});
