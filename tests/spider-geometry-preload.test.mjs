import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import * as THREE from 'three';
import {createSpiderGeometryAsset,decodeSpiderGeometryAsset} from '../src/spider-geometry-asset.js';
import {createSpiderModel} from '../src/spider-model.js';

// Assets stay in memory for these tests; no network or large committed fixture.
const authored=createSpiderGeometryAsset(THREE);
let sequence=0;
const freshLoader=()=>import(`../src/spider-geometry-loader.js?test=${sequence++}`);

test('versioned geometry round-trips every attribute and rejects malformed layouts',()=>{
  const decoded=decodeSpiderGeometryAsset(authored.buffer);
  assert.equal(decoded.positions.length/3,authored.vertices);
  assert.equal(decoded.indices.length/3,authored.triangles);
  assert.equal(decoded.skinIndices.length,authored.vertices*4);
  assert.throws(()=>decodeSpiderGeometryAsset(authored.buffer.slice(0,-1)),/Truncated/);
  const wrongVersion=authored.buffer.slice(0);new DataView(wrongVersion).setUint32(8,999,true);
  assert.throws(()=>decodeSpiderGeometryAsset(wrongVersion),/version/);
  const wrongIndex=authored.buffer.slice(0);decodeSpiderGeometryAsset(wrongIndex).indices[0]=authored.vertices;
  assert.throws(()=>decodeSpiderGeometryAsset(wrongIndex),/indices/);
  const nonFinite=authored.buffer.slice(0);decodeSpiderGeometryAsset(nonFinite).positions[0]=NaN;
  assert.throws(()=>decodeSpiderGeometryAsset(nonFinite),/Non-finite/);
});

test('preload request is deduplicated, optional, bounded and retries after a failed authoring fetch',async()=>{
  const {preloadSpiderGeometry}=await freshLoader();
  assert.equal(await preloadSpiderGeometry(),false,'Node does not accidentally download an asset');
  assert.equal(await preloadSpiderGeometry(async()=>({ok:false})),false);
  assert.equal(await preloadSpiderGeometry(()=>new Promise(()=>{}),{timeoutMs:2}),false);
  let release,calls=0;
  const fetcher=async()=>{calls++;await new Promise(resolve=>release=resolve);return {ok:true,arrayBuffer:async()=>authored.buffer.slice(0)};};
  const first=preloadSpiderGeometry(fetcher),second=preloadSpiderGeometry(fetcher);
  assert.equal(first,second);await Promise.resolve();release();
  assert.equal(await first,true);assert.equal(calls,1);
  assert.equal(await preloadSpiderGeometry(()=>{throw new Error('must use cached template');}),true);
});

test('worker computes byte-identical authored geometry while the parent remains responsive',async()=>{
  const workerEntry=new URL('../src/spider-geometry-worker.js',import.meta.url).href;
  const wrapper=`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:(value,transfer)=>parentPort.postMessage(value,transfer)};parentPort.on('message',event=>self.onmessage?.({data:event}));import(${JSON.stringify(workerEntry)}).then(()=>parentPort.postMessage({type:'booted'}));`;
  const worker=new NodeWorker(wrapper,{eval:true});
  let turns=0;const heartbeat=setInterval(()=>turns++,5);
  try{
    const message=await new Promise((resolve,reject)=>{
      worker.on('error',reject);worker.on('message',message=>{if(message.type==='booted')worker.postMessage({type:'generate'});else resolve(message);});
    });
    assert.equal(message.type,'ready');assert.ok(turns>0,'main event loop can run while skin generation is in another thread');
    assert.deepEqual(new Uint8Array(message.buffer),new Uint8Array(authored.buffer));
  }finally{clearInterval(heartbeat);await worker.terminate();}
});

test('browser worker preload transfers the template, terminates its worker and never fetches a model',async()=>{
  const previous=globalThis.Worker;let created=0,terminated=0,generated=0;
  class WorkerMock {
    constructor(url,options){assert.match(url.pathname,/spider-geometry-worker\.js$/);assert.equal(options.type,'module');created++;}
    postMessage(message){assert.equal(message.type,'generate');generated++;queueMicrotask(()=>this.onmessage({data:{type:'ready',buffer:authored.buffer.slice(0)}}));}
    terminate(){terminated++;}
  }
  globalThis.Worker=WorkerMock;
  try{const {preloadSpiderGeometry}=await freshLoader();assert.equal(await preloadSpiderGeometry(),true);assert.equal(await preloadSpiderGeometry(),true);assert.equal(created,1);assert.equal(generated,1);assert.equal(terminated,1);}
  finally{globalThis.Worker=previous;}
});

test('preloaded rigs retain exact independent geometry and disposing one cannot invalidate another',async()=>{
  const {preloadSpiderGeometry}=await freshLoader();assert.equal(await preloadSpiderGeometry(async()=>({ok:true,arrayBuffer:async()=>authored.buffer.slice(0)})),true);
  // A distinct Three namespace avoids the generator's previous cache key, so
  // this path must bind the newly installed template with fresh bone objects.
  const first=createSpiderModel({...THREE}),second=createSpiderModel({...THREE});
  try{
    const a=first.group.getObjectByName('spider-continuous-skin'),b=second.group.getObjectByName('spider-continuous-skin'),decoded=decodeSpiderGeometryAsset(authored.buffer);
    for(const[name,stored]of[['position','positions'],['normal','normals'],['skinIndex','skinIndices'],['skinWeight','skinWeights'],['color','colors'],['suitCoordinates','suitCoords']]){
      assert.deepEqual(a.geometry.attributes[name].array,decoded[stored]);
      assert.notEqual(a.geometry.attributes[name].array,b.geometry.attributes[name].array);
    }
    assert.notEqual(a.skeleton,b.skeleton);assert.notEqual(a.geometry,b.geometry);
    const before=b.geometry.attributes.position.array[0];a.geometry.attributes.position.array[0]+=1;assert.equal(b.geometry.attributes.position.array[0],before);
    let secondDisposed=0;b.geometry.addEventListener('dispose',()=>secondDisposed++);first.dispose();assert.equal(secondDisposed,0);
    second.update({mode:'spider',grounded:false,anchor:{x:4,y:28,z:-30},webTension:1,ropeLength:32},1/60);
    assert.equal(second.group.getObjectByName('spider-web-main').visible,true);
  }finally{first.dispose();second.dispose();}
});
