import test from 'node:test';
import assert from 'node:assert/strict';
import {mountMobileViewport} from '../src/mobile-viewport.js';

function fixture(){
  const viewport=Object.assign(new EventTarget(),{height:844,offsetTop:0,scale:1});
  const callbacks=new Map();let id=0;
  const window=Object.assign(new EventTarget(),{visualViewport:viewport,innerHeight:844,requestAnimationFrame(fn){callbacks.set(++id,fn);return id;},cancelAnimationFrame(id){callbacks.delete(id);}});
  const values=new Map(),root={style:{setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key)}};
  return{window,viewport,values,callbacks,root,flush(){for(const [id,fn]of callbacks){callbacks.delete(id);fn();}}};
}
test('keyboard and scrolling resize only overlay variables and events are coalesced',()=>{
  const f=fixture(),dispose=mountMobileViewport(f);
  assert.equal(f.values.get('--campus-visible-height'),'844px');
  f.viewport.height=420;f.viewport.offsetTop=24;
  f.viewport.dispatchEvent(new Event('resize'));f.viewport.dispatchEvent(new Event('scroll'));
  assert.equal(f.callbacks.size,1);f.flush();
  assert.equal(f.values.get('--campus-visible-height'),'420px');assert.equal(f.values.get('--campus-visible-top'),'24px');
  dispose();assert.equal(f.values.size,0);f.viewport.dispatchEvent(new Event('resize'));assert.equal(f.callbacks.size,0);
});
test('pinch zoom does not squeeze the UI and missing visualViewport falls back gracefully',()=>{
  const f=fixture(),dispose=mountMobileViewport(f);f.viewport.scale=2;f.viewport.height=300;f.viewport.offsetTop=80;
  f.viewport.dispatchEvent(new Event('resize'));f.flush();
  assert.equal(f.values.get('--campus-visible-height'),'844px');assert.equal(f.values.get('--campus-visible-top'),'0px');dispose();
  delete f.window.visualViewport;const second=mountMobileViewport(f);assert.equal(f.values.get('--campus-visible-height'),'844px');second();
});
