import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveClient} from '../src/live-client.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('dispose cancels initial synchronization and never opens a late SSE connection',async()=>{
  let signal,resolve,connections=0,updates=0;
  const client=createLiveClient({fetchImpl:(_url,options)=>{signal=options.signal;return new Promise(r=>resolve=r);},EventSourceImpl:class{constructor(){connections++;}},onState:()=>updates++});
  client.dispose();assert.equal(signal.aborted,true);
  resolve({ok:true,json:async()=>({state:{revision:1},serverTime:Date.now()})});await flush();
  assert.equal(connections,0);assert.equal(updates,0);
});

test('dispose closes an established SSE and ignores late events',async()=>{
  let source,updates=0;const payload={state:{revision:1},serverTime:Date.now()};
  class Source extends EventTarget{constructor(){super();source=this;this.closed=0;}close(){this.closed++;}}
  const client=createLiveClient({fetchImpl:async()=>({ok:true,json:async()=>payload}),EventSourceImpl:Source,onState:()=>updates++});await flush();
  assert.equal(updates,1);client.dispose();assert.equal(source.closed,1);
  source.dispatchEvent(Object.assign(new Event('snapshot'),{data:JSON.stringify({...payload,state:{revision:2}})}));
  assert.equal(updates,1);
});
