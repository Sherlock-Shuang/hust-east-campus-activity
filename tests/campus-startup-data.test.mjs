import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCampusStartupDataLoader} from '../src/campus-startup-data.js';

const map='./data/east-campus.geojson',manifest='./data/source-manifest.json',extension='./data/opto-southeast.geojson';
const response=(value={type:'FeatureCollection',features:[]})=>({ok:true,json:async()=>value});
const noWait=async()=>{};

test('entry and scene share concurrent downloads; only the failed file retries with jitter',async()=>{
  const calls=[],delays=[],releases=new Map();
  const getData=createCampusStartupDataLoader({random:()=>.5,waitImpl:async ms=>delays.push(ms),fetchImpl:(url)=>{
    calls.push(url);
    if(url===extension&&calls.filter(x=>x===extension).length===1)return Promise.reject(new TypeError('Failed to fetch'));
    return new Promise(resolve=>releases.set(url,()=>resolve(response({url}))));
  }});
  const first=getData();assert.equal(first,getData());
  assert.deepEqual(calls,[map,manifest,extension]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(delays,[2500]);assert.equal(calls.length,4);
  for(const finish of releases.values())finish();
  const values=await first;
  assert.equal(values[0].url,map);assert.equal(values[2].url,extension);
  assert.equal(getData(),first);assert.equal(calls.filter(url=>url===map).length,1);
  assert.equal(calls.filter(url=>url===manifest).length,1);
});

test('both an unresponsive fetch and an unresponsive response body time out and stop after two attempts',async t=>{
  for(const stage of ['fetch','body'])await t.test(stage,async()=>{
    let calls=0;const signals=[];
    const getData=createCampusStartupDataLoader({timeoutMs:5,waitImpl:noWait,fetchImpl:(url,{signal})=>{
      if(url!==map)return Promise.resolve(response());
      calls++;signals.push(signal);
      const never=new Promise(()=>{});
      return stage==='fetch'?never:Promise.resolve({ok:true,json:()=>never});
    }});
    await assert.rejects(getData(),/校园地图加载超时/);
    assert.equal(calls,2);assert.equal(signals.every(signal=>signal.aborted),true);
  });
});

test('429 and 5xx retry once; 404 and malformed JSON fail immediately',async t=>{
  for(const status of [429,500,503,404])await t.test(String(status),async()=>{
    let calls=0,cancellations=0;
    const getData=createCampusStartupDataLoader({waitImpl:noWait,fetchImpl:async url=>{
      if(url!==extension)return response();calls++;
      return {ok:false,status,body:{cancel:async()=>{cancellations++;}}};
    }});
    await assert.rejects(getData(),new RegExp(`光电大楼补充地图.*HTTP ${status}`));
    assert.equal(calls,status===404?1:2);assert.equal(cancellations,calls);
  });
  let calls=0;
  const getData=createCampusStartupDataLoader({waitImpl:noWait,fetchImpl:async url=>{
    if(url!==map)return response();calls++;
    return {ok:true,json:async()=>{throw new SyntaxError('Unexpected end of JSON input');}};
  }});
  await assert.rejects(getData(),/校园地图数据不完整/);assert.equal(calls,1);
});

test('manifest failure preserves the exact built-in coordinate origin and never admits a missing map extension',async()=>{
  const original=JSON.parse(readFileSync(new URL('../public/data/source-manifest.json',import.meta.url)));
  const getData=createCampusStartupDataLoader({fetchImpl:async url=>url===manifest?{ok:false,status:404}:response()});
  const [,fallback]=await getData();
  assert.deepEqual(fallback.suggestedLocalOrigin.coordinates,original.suggestedLocalOrigin.coordinates);
  assert.equal(fallback.suggestedLocalOrigin.coordinateSystem,original.suggestedLocalOrigin.coordinateSystem);
  const missingExtension=createCampusStartupDataLoader({fetchImpl:async url=>url===extension?{ok:false,status:404}:response()});
  await assert.rejects(missingExtension(),/光电大楼补充地图/);
});

test('stalled optional metadata falls back once on its shorter deadline while both maps remain usable',async()=>{
  const original=JSON.parse(readFileSync(new URL('../public/data/source-manifest.json',import.meta.url)));
  let calls=0,manifestSignal;const deadlines=[];
  const getData=createCampusStartupDataLoader({timeoutMs:1000,manifestTimeoutMs:5,
    setTimer:(handler,ms)=>{deadlines.push(ms);return setTimeout(handler,ms);},
    waitImpl:async()=>assert.fail('optional metadata must not retry'),
    fetchImpl:async(url,{signal})=>{
      if(url!==manifest)return response({url});
      calls++;manifestSignal=signal;return {ok:true,json:()=>new Promise(()=>{})};
    },
  });
  const [data,fallback,extra]=await getData();
  assert.deepEqual(deadlines,[1000,5,1000]);assert.equal(calls,1);assert.equal(manifestSignal.aborted,true);
  assert.equal(data.url,map);assert.equal(extra.url,extension);
  assert.deepEqual(fallback.suggestedLocalOrigin.coordinates,original.suggestedLocalOrigin.coordinates);
});

test('successful reads preserve real manifest metadata and clear every request deadline',async()=>{
  const timers=new Set();let next=0;
  const actual={title:'校园',origin:[115,31],suggestedLocalOrigin:{coordinates:[115,31]}};
  const getData=createCampusStartupDataLoader({
    setTimer:()=>{const id=++next;timers.add(id);return id;},clearTimer:id=>timers.delete(id),
    fetchImpl:async url=>response(url===manifest?actual:{url}),
  });
  const [,result]=await getData();
  assert.deepEqual(result,actual);assert.equal(next,3);assert.equal(timers.size,0);
});
