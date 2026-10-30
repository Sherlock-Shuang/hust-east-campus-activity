import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderCadence} from '../src/render-cadence.js';
import {createC118Performance,c118RenderRate} from '../src/c118-performance.js';
import {createC118ResourceScope} from '../src/c118-resource-scope.js';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {createC118Swimming} from '../src/c118-swimming.js';

test('viewing and handheld drawing caps leave every input/clock step intact',()=>{
  let reference;
  for(const [options,expected]of [[{},60],[{cinema:true},30],[{cinema:true,floodRunning:true},60],[{handheld:true,floodRunning:true},30],[{level:0},30]]){
    const rate=c118RenderRate(options),cadence=createRenderCadence();let inputSteps=0,draws=0,eventTime=0;
    const swimmer=createC118Swimming(planOptoC118Interior());swimmer.enter({x:0,y:6,z:-9});
    assert.equal(rate,expected);
    for(let i=0;i<1200;i++){inputSteps++;eventTime=i/120;swimmer.step(1/120,{elapsed:30+eventTime,moveX:.1,moveZ:.1,vertical:i<60?1:0});draws+=Number(cadence.shouldRender(i*1000/120,rate));}
    assert.equal(inputSteps,1200);assert.equal(eventTime,1199/120);assert.ok(Math.abs(draws-rate*10)<=1);
    if(reference)assert.deepEqual(swimmer.state,reference,'actual swimming result is independent of render admission');else reference={...swimmer.state};
    cadence.reset();assert.equal(cadence.shouldRender(600000,rate),true,'resuming does not replay missed draws');
  }
});

test('intentional thirty-Hz hall rendering does not downgrade adaptive quality as a stall',()=>{
  const quality=createC118Performance({width:1280,height:720,deviceRatio:1}),cadence=createRenderCadence();let previous;
  const initialLevel=quality.budget.level;
  for(let i=0;i<120*19;i++)if(cadence.shouldRender(i*1000/120,30)){
    if(previous!==undefined)quality.update({elapsedMs:i*1000/120-previous,cpuMs:5,targetFrameMs:1000/30});
    previous=i*1000/120;
  }
  assert.equal(quality.budget.level,initialLevel);assert.equal(quality.state.pixelStep,0);
});

test('partial initialization cleans up every returned owner in reverse order even if one disposer fails',()=>{
  const scope=createC118ResourceScope(),calls=[];
  try{
    scope.own({dispose(){calls.push('renderer');}},'renderer');
    scope.own({dispose(){calls.push('interior');throw new Error('injected cleanup error');}},'interior');
    scope.own({dispose(){calls.push('media');}},'media');
    throw new Error('injected initialization failure');
  }catch{
    const failures=scope.dispose();assert.deepEqual(failures,[{kind:'interior',message:'injected cleanup error'}]);
  }
  assert.deepEqual(calls,['media','interior','renderer']);assert.deepEqual(scope.snapshot(),{disposed:true,owners:[]});
  assert.deepEqual(scope.dispose(),[]);assert.equal(calls.length,3);
  scope.own({dispose(){calls.push('late');}},'late-media');assert.equal(calls.at(-1),'late');assert.deepEqual(scope.snapshot().owners,[]);
});
