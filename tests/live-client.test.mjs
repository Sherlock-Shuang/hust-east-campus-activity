import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveClient} from '../src/live-client.js';
import {createDefaultLiveState} from '../src/live-state.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
  t.mock.timers.enable({apis:['setTimeout']});
  const sources=[],connections=[];
  let revision=1,requests=0;
  class Source extends EventTarget{
    readyState=0;
    constructor(){super();sources.push(this);}
    close(){this.readyState=2;}
    snapshot(){this.readyState=1;this.dispatchEvent(new MessageEvent('snapshot',{data:JSON.stringify({state:{...createDefaultLiveState(),revision},serverTime:1000})}));}
    fail(readyState){this.readyState=readyState;this.dispatchEvent(new Event('error'));}
  }
  const client=createLiveClient({EventSourceImpl:Source,onConnection:value=>connections.push(value),fetchImpl:async()=>{
    requests++;
    return {ok:true,json:async()=>({state:{...createDefaultLiveState(),revision},serverTime:1000})};
  }});
  t.after(()=>client.dispose());
  return {client,sources,connections,get requests(){return requests;},setRevision(value){revision=value;}};
}

test('a permanently closed event stream reconnects and receives current host state',async t=>{
  const f=fixture(t);await settle();f.sources[0].snapshot();
  assert.equal(f.client.connected,true);
  f.sources[0].fail(2);f.sources[0].fail(2);
  assert.equal(f.client.connected,false);
  t.mock.timers.tick(9999);await settle();assert.equal(f.sources.length,1);
  f.setRevision(2);t.mock.timers.tick(1);await settle();
  assert.equal(f.sources.length,2);
  f.sources[1].snapshot();
  assert.equal(f.client.state.revision,2);assert.equal(f.client.connected,true);
  // Late events from the replaced stream must not change connection status.
  f.sources[0].fail(2);assert.equal(f.client.connected,true);
  t.mock.timers.tick(10000);await settle();assert.equal(f.sources.length,2);
});

test('transient errors leave reconnection to the existing EventSource',async t=>{
  const f=fixture(t);await settle();f.sources[0].snapshot();f.sources[0].fail(0);
  t.mock.timers.tick(10000);await settle();assert.equal(f.sources.length,1);
  f.setRevision(2);f.sources[0].snapshot();
  assert.equal(f.client.connected,true);assert.equal(f.client.state.revision,2);
});

test('disposing cancels a scheduled reconnect and ignores late stream errors',async t=>{
  const f=fixture(t);await settle();f.sources[0].fail(2);f.client.dispose();
  f.sources[0].fail(2);t.mock.timers.tick(10000);await settle();
  assert.equal(f.sources.length,1);assert.equal(f.requests,1);
});

test('initial HTTP failure retries and eventually establishes a stream',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let requests=0,sources=0;
  class Source extends EventTarget{constructor(){super();sources++;}close(){}}
  const client=createLiveClient({EventSourceImpl:Source,fetchImpl:async()=>{
    if(++requests===1)throw new Error('offline');
    return {ok:true,json:async()=>({state:createDefaultLiveState(),serverTime:1000})};
  }});
  t.after(()=>client.dispose());await settle();assert.equal(sources,0);
  t.mock.timers.tick(10000);await settle();assert.equal(sources,1);
});
