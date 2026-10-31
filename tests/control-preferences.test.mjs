import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTROL_PREFERENCES_KEY,COMFORT_CONTROL_DEFAULTS,createControlPreferences,normalizeControlPreferences,controlLookDelta} from '../src/control-preferences.js';

test('control preferences survive reload, clamp invalid settings and exclude unknown fields',()=>{
  const entries=new Map(),events=[],storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
  const p=createControlPreferences({storage,onChange:value=>events.push(value)});
  p.set({sensitivity:1.3,invertY:true,joystickScale:1.2,comfortableCamera:true,unrelated:'not persisted'});
  const restored=createControlPreferences({storage});assert.deepEqual(restored.value,p.value);
  assert.deepEqual(Object.keys(JSON.parse(entries.get(CONTROL_PREFERENCES_KEY))),['sensitivity','fovOffset','invertY','joystickScale','comfortableCamera']);
  p.set({sensitivity:999,joystickScale:-1,invertY:'yes'});assert.equal(p.value.sensitivity,1.8);assert.equal(p.value.joystickScale,.8);assert.equal(p.value.invertY,false);
  p.reset();assert.deepEqual(p.value,{sensitivity:1,fovOffset:0,invertY:false,joystickScale:1,comfortableCamera:false});assert.equal(events.length,3);
});

test('corrupt, blocked or quota-limited storage does not prevent a playable preference state',()=>{
  for(const storage of[{getItem:()=>'{broken'}, {getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('quota');}},undefined]){
    const p=createControlPreferences({storage,defaults:{comfortableCamera:true}});assert.equal(p.value.comfortableCamera,true);
    assert.doesNotThrow(()=>p.set({sensitivity:1.2}));assert.equal(p.value.sensitivity,1.2);
  }
  assert.equal(normalizeControlPreferences({sensitivity:NaN}).sensitivity,1);
});

test('equal touch viewport fractions yield equal angles at phone, tablet and portrait sizes',()=>{
  const angles=[[844,390],[667,375],[1024,768],[390,844]].map(([width,height])=>controlLookDelta(width*.12,height*.08,{touch:true,width,height}));
  for(const angle of angles){assert.ok(Math.abs(angle.x-angles[0].x)<1e-10);assert.ok(Math.abs(angle.y-angles[0].y)<1e-10);}
  const mouse=controlLookDelta(40,20),touch=controlLookDelta(40,20,{touch:true,width:844,height:390});
  assert.equal(mouse.x,.128);assert.equal(mouse.y,.05);assert.ok(Math.abs(touch.x/mouse.x-1.5)<1e-10);assert.ok(Math.abs(touch.y/mouse.y-1.5)<1e-10);
});

test('invert and sensitivity apply exactly once and invalid look events remain inert',()=>{
  const base=controlLookDelta(30,20,{touch:true});
  const inverted=controlLookDelta(30,20,{touch:true,preferences:{sensitivity:1.5,invertY:true}});
  assert.equal(inverted.x,base.x*1.5);assert.ok(Math.abs(inverted.y+base.y*1.5)<1e-10);
  assert.deepEqual(controlLookDelta(Infinity,2),{x:0,y:0});
  assert.deepEqual(controlLookDelta(30,20,{touch:true,width:0,height:NaN}),base);
});

test('comfort defaults apply to fresh visits and reset while preserving explicit previous preferences',()=>{
  const fresh=createControlPreferences({defaults:COMFORT_CONTROL_DEFAULTS});
  assert.equal(fresh.value.comfortableCamera,true);assert.equal(fresh.value.sensitivity,.75);
  const entries=new Map([[CONTROL_PREFERENCES_KEY,JSON.stringify({comfortableCamera:false,sensitivity:1.25,invertY:true})]]);
  const stored=createControlPreferences({defaults:COMFORT_CONTROL_DEFAULTS,storage:{getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)}});
  assert.equal(stored.value.comfortableCamera,false);assert.equal(stored.value.sensitivity,1.25);assert.equal(stored.value.invertY,true);
  stored.reset();assert.equal(stored.value.comfortableCamera,true);assert.equal(stored.value.sensitivity,.75);
});

test('field of view adjustment is bounded and retained independently of sensitivity',()=>{
  const entries=new Map(),storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
  const prefs=createControlPreferences({storage,defaults:COMFORT_CONTROL_DEFAULTS});prefs.set({fovOffset:8});
  assert.equal(createControlPreferences({storage}).value.fovOffset,8);assert.equal(prefs.value.sensitivity,.75);
  assert.equal(prefs.set({fovOffset:99}).fovOffset,12);assert.equal(prefs.set({fovOffset:-99}).fovOffset,-10);
});
