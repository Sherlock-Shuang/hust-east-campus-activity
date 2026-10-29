import test from 'node:test';
import assert from 'node:assert/strict';
import {skillPresentation} from './wanyan-skill-state.mjs';

const native=(values={})=>({version:1,focus:0,maxEnergy:100,cost:50,cooldown:0,charged:false,canCast:false,active:true,...values});
const combat={phase:'combat'};

test('missing or malformed native skill data never claims readiness',()=>{
 for(const raw of [undefined,null,{},native({version:2}),native({cooldown:NaN}),native({maxEnergy:0}),native({cost:0}),native({focus:'50'}),native({canCast:undefined})]){
  const ui=skillPresentation(raw,combat);assert.equal(ui.state,'unknown');assert.equal(ui.ready,false);assert.equal(ui.charge,0);
 }
});
test('the actual cast threshold lights the skill before the maximum storage is full',()=>{
 const low=skillPresentation(native({focus:44.3}),combat);assert.equal(low.state,'charging');assert.equal(low.label,'还需 6');assert.equal(low.charge,44.3/50);
 const ready=skillPresentation(native({focus:50,charged:true,canCast:true}),combat);
 assert.equal(ready.state,'ready');assert.equal(ready.label,'可释放');assert.equal(ready.charge,1);assert.match(ready.hint,/能量 50 \/ 100，消耗 50/);
 assert.equal(skillPresentation(native({focus:100,charged:true,canCast:true}),combat).charge,1);
});
test('resource readiness and native permission to cast remain distinct without JS guessing combat locks',()=>{
 const raw=native({focus:80,charged:true,canCast:false});const waiting=skillPresentation(raw,combat);
 assert.equal(waiting.state,'charged');assert.equal(waiting.charged,true);assert.equal(waiting.ready,false);assert.equal(waiting.label,'已充能');
 assert.equal(skillPresentation({...raw,canCast:true},combat).ready,true);
 const unconfirmed=skillPresentation(native({focus:80}),combat);assert.equal(unconfirmed.ready,false);assert.equal(unconfirmed.charged,false,'numbers alone cannot infer Unity readiness');
});
test('a real cast dims the ready button and renders remaining cooldown without predicting it',()=>{
 const ready=skillPresentation(native({focus:100,charged:true,canCast:true}),combat);assert.equal(ready.state,'ready');
 const cooling=skillPresentation(native({focus:50,cooldown:5.96}),combat);assert.equal(cooling.state,'cooldown');assert.equal(cooling.ready,false);assert.equal(cooling.charged,false);assert.equal(cooling.label,'6.0s');
 assert.equal(skillPresentation(native({focus:50,cooldown:.01}),combat).label,'0.1s','nonzero cooldown must not be shown as ready or zero');
 assert.equal(skillPresentation(native({focus:50,cooldown:0,charged:true,canCast:true}),combat).ready,true);
});
test('pause, cutscenes, end screens and host suspension cannot retain a stale ready glow',()=>{
 const raw=native({focus:100,charged:true,canCast:true});
 for(const phase of ['intro','paused','choosing','ended']){const ui=skillPresentation(raw,{phase});assert.equal(ui.state,'inactive');assert.equal(ui.ready,false);assert.equal(ui.charged,false);}
 assert.equal(skillPresentation(raw,{...combat,suspended:true}).label,'已暂停');
 assert.equal(skillPresentation({...raw,active:false},combat).state,'inactive');
 assert.equal(skillPresentation(raw,combat).ready,true,'resuming uses fresh native permission without losing stored energy');
});
test('presentation is read only and tolerates numerical resource boundaries',()=>{
 const raw=Object.freeze(native({focus:-.001,cooldown:-.1}));assert.equal(skillPresentation(raw,combat).charge,0);assert.equal(raw.focus,-.001);
 const over=skillPresentation(Object.freeze(native({focus:101,charged:true,canCast:true})),combat);assert.equal(over.charge,1);assert.equal(over.ready,true);
});
