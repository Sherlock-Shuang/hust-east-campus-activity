import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createC118ActivitySync} from '../src/c118-activity-sync.js';

const source=await readFile(new URL('../public/experiences/activity-bridge.js',import.meta.url),'utf8');
const flood={id:'shared-flood',startAt:103000,pausedAt:null,pausedMs:0};
const origin='https://campus.example';

function fixture({work='opto-c118',search='?campusAttempt=visit-1',parentOrigin,ownOrigin=origin,standalone=false}={}){
  const handlers=new Map(),posts=[],events=[],errors=[];let exits=0,blurs=0;
  const parent={postMessage(data,targetOrigin){posts.push({data:structuredClone(data),targetOrigin});}};
  const window={parent,addEventListener(type,fn){const listeners=handlers.get(type)||new Set();listeners.add(fn);handlers.set(type,listeners);},
    removeEventListener(type,fn){handlers.get(type)?.delete(fn);},dispatchEvent(event){events.push(event);return true;}};
  if(standalone)window.parent=window;
  const document={currentScript:{dataset:{work,...(parentOrigin?{parentOrigin}:{})}},readyState:'complete',
    documentElement:{dataset:{}},activeElement:{blur(){blurs++;}},exitPointerLock(){exits++;}};
  vm.runInNewContext(source,{window,document,location:{origin:ownOrigin,search},URL,URLSearchParams,
    Date:{now:()=>7000000},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
    console:{error(...args){errors.push(args);}}},{filename:'activity-bridge.js'});
  return {bridge:window.campusActivity,window,parent,posts,events,document,errors,
    get exits(){return exits;},get blurs(){return blurs;},get messageListeners(){return handlers.get('message')?.size||0;},
    message(data,overrides={}){const event={source:parent,origin:ownOrigin,data:{attemptId:'visit-1',...data},...overrides};for(const fn of [...(handlers.get('message')||[])])fn(event);}};
}

test('C118 bridge carries the shared flood and server clock into its embedded sync without another connection',()=>{
  const f=fixture();let mono=500;const seen=[];
  const sync=createC118ActivitySync({embedded:true,bridge:f.bridge,onState:state=>seen.push(structuredClone(state)),monotonic:()=>mono,
    liveClientFactory(){assert.fail('the room must use its existing campus connection');}});
  f.message({type:'campus:activity',paused:false,c118Flood:flood,serverTime:100000});
  assert.deepEqual(seen.at(-1).c118Flood,flood);assert.equal(sync.now(),100000);
  mono+=3500;assert.equal(sync.now(),103500,'the local wall clock does not replace the host server clock');
  assert.deepEqual(f.posts,[{data:{type:'campus:ready',attemptId:'visit-1',workId:'opto-c118',level:'page_opened'},targetOrigin:origin}]);
  f.message({type:'campus:activity',paused:false,c118Flood:null,serverTime:104000});
  assert.equal(seen.at(-1).c118Flood,null,'explicit reset reaches the room');sync.dispose();
});

test('every other work receives ordinary activity state with no C118 flood',()=>{
  for(const work of ['library','tasay','demo','opto-other','']){
    const f=fixture({work});
    f.message({type:'campus:activity',paused:true,c118Flood:flood,serverTime:100000,announcement:{title:'集合'}});
    assert.equal(f.bridge.state.c118Flood,null,`flood must not reach ${work||'unidentified works'}`);
    assert.equal(f.bridge.state.paused,true);assert.equal(f.bridge.state.serverTime,100000);
    assert.equal(f.bridge.state.announcement.title,'集合');
  }
});

test('bridge accepts messages only from the current same-origin parent and matching attempt',()=>{
  const f=fixture(),seen=[];f.bridge.subscribe(state=>seen.push(state));
  const valid={type:'campus:activity',paused:false,c118Flood:flood,serverTime:100000};
  for(const overrides of [{origin:'https://other.example'},{source:{}},{data:{...valid,attemptId:'old-visit'}},
    {data:{...valid,attemptId:undefined}},{data:{...valid,attemptId:'visit-1',paused:'false'}},
    {data:{...valid,attemptId:'visit-1',type:'other-event'}}])f.message(valid,overrides);
  assert.equal(seen.length,1);assert.equal(f.bridge.state.c118Flood,null);
  f.message(valid);assert.equal(seen.length,2);assert.deepEqual(structuredClone(f.bridge.state.c118Flood),flood);
  f.message({type:'campus:dispose'},{origin:'https://other.example'});assert.equal(f.bridge.state.disposed,false);
  const alone=fixture({standalone:true});alone.message(valid,{source:alone.window});assert.equal(alone.bridge.state.c118Flood,null);
});

test('bridge refuses mismatched configured origins, non-HTTP origins and invalid launch identifiers',()=>{
  for(const options of [{parentOrigin:'https://other.example'},
    {search:'?campusAttempt=visit-1&campusParentOrigin=https%3A%2F%2Fother.example'},
    {ownOrigin:'file://'}, {work:'../invalid'}, {search:'?campusAttempt=invalid%20attempt'}]){
    const f=fixture(options);assert.equal(f.bridge,undefined);assert.equal(f.messageListeners,0);assert.equal(f.posts.length,0);
  }
});

test('pause releases room input and disposal removes message listeners and prevents late updates',()=>{
  const f=fixture(),seen=[],unsubscribed=[];
  f.bridge.subscribe(state=>seen.push(structuredClone(state)));
  const remove=f.bridge.subscribe(state=>unsubscribed.push(state));remove();remove();
  f.message({type:'campus:activity',paused:true,c118Flood:{...flood,pausedAt:110000},serverTime:110000});
  assert.equal(f.exits,1);assert.equal(f.blurs,1);assert.equal(f.document.documentElement.dataset.campusPaused,'true');
  assert.equal(f.bridge.exit(),false);assert.equal(unsubscribed.length,1);
  f.message({type:'campus:dispose'});
  assert.equal(seen.at(-1).disposed,true);assert.equal(seen.at(-1).paused,true);assert.equal(f.messageListeners,0);
  assert.equal(f.events.filter(event=>event.type==='campus:dispose').length,1);
  const count=seen.length,postCount=f.posts.length;
  f.message({type:'campus:activity',paused:false,c118Flood:null,serverTime:120000});
  assert.equal(seen.length,count);assert.equal(f.bridge.ready('runtime_ready'),false);assert.equal(f.bridge.exit(),false);
  assert.equal(f.bridge.fail('late error'),false);assert.equal(f.posts.length,postCount);
});
