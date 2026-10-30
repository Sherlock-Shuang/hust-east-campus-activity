import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightExperience} from '../src/experience-preflight.js';
const pendingFetch=(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
test('closing entry aborts the outstanding availability request',async()=>{
  const controller=new AbortController();const pending=preflightExperience('/works/library/',{signal:controller.signal,fetchImpl:pendingFetch});
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('slow service gives a retryable failure rather than an indefinite loading overlay',async()=>{
  await assert.rejects(preflightExperience('/works/library/',{fetchImpl:pendingFetch,timeoutMs:5}),/连接超时/);
});
test('late response cannot admit a cancelled entry and HTTP success does not emit runtime-ready',async()=>{
  const controller=new AbortController();let finish;
  const pending=preflightExperience('/works/library/',{signal:controller.signal,fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});
  controller.abort();finish({ok:true,status:200});await assert.rejects(pending,{name:'AbortError'});
  await preflightExperience('/works/library/',{fetchImpl:async()=>({ok:true,status:200})});
  await assert.rejects(preflightExperience('/missing/',{fetchImpl:async()=>({ok:false,status:404})}),/404/);
});
