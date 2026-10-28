import test from 'node:test';
import assert from 'node:assert/strict';
import {getQualityStorage,readQualityPreference,mountPerformanceUI} from '../src/performance-ui.js';

test('quality preference tolerates blocked browser storage and rejects unknown values',t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('SecurityError');}});
  t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;});
  assert.equal(getQualityStorage(),null);assert.equal(readQualityPreference(),'auto');
  assert.equal(readQualityPreference({getItem:()=> 'smooth'}),'smooth');
  assert.equal(readQualityPreference({getItem:()=> 'invalid'}),'auto');
});
test('quality selector changes budget even without persistence and releases its keyboard focus',()=>{
  const handlers=new Map();let blurred=false,value;
  const select={value:'',addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name),blur:()=>{blurred=true;}};
  const ui=mountPerformanceUI({document:{getElementById:()=>select},storage:{setItem(){throw Error('denied');}},mode:'auto',onChange:next=>{value=next;}});
  select.value='smooth';handlers.get('change')();assert.equal(value,'smooth');assert.equal(blurred,true);
  let stopped=false;handlers.get('keydown')({stopPropagation(){stopped=true;}});assert.equal(stopped,true);
  ui.update({name:'流畅'});assert.ok(select.title.includes('流畅'));ui.dispose();assert.equal(handlers.size,0);
});
