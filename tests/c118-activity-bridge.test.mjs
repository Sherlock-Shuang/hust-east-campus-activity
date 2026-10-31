import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createC118ActivitySync} from '../src/c118-activity-sync.js';
import {createActivityBridgeMessage} from '../src/activity-bridge-state.js';
import {nearbyInterior,crossedInteriorDoor} from '../src/building-interiors.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createOptoBuilding,OPTO_BUILDING_ID} from '../src/opto-building.js';
import * as THREE from 'three';

const source=await readFile(new URL('../public/experiences/activity-bridge.js',import.meta.url),'utf8');
const flood={id:'shared-flood',startAt:103000,pausedAt:null,pausedMs:0};
const screen={mediaId:'club-promo',revision:7};
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

test('only the authenticated room frame reports video audio focus, without repeat notifications',()=>{
  const room=fixture(),other=fixture({work:'tasay'});
  assert.equal(room.bridge.audioFocus(false),false);
  assert.equal(other.bridge.audioFocus(true),false);
  assert.equal(room.bridge.audioFocus('true'),false);
  assert.equal(room.bridge.audioFocus(true),true);
  const post=room.posts.at(-1);assert.deepEqual(post,{data:{type:'campus:audio-focus',attemptId:'visit-1',workId:'opto-c118',active:true},targetOrigin:origin});
  const count=room.posts.length;assert.equal(room.bridge.audioFocus(true),false);assert.equal(room.posts.length,count);
  assert.equal(room.bridge.audioFocus(false),true);
  room.message({type:'campus:dispose'});assert.equal(room.bridge.audioFocus(true),false);
});

test('every real campus doorway carries the host flood and playlist through the embedded room bridge',async()=>{
  const source=JSON.parse(await readFile(new URL('../public/data/opto-southeast.geojson',import.meta.url),'utf8'));
  const feature=source.features.find(f=>f.id===OPTO_BUILDING_ID);
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  const model=createGeoScene(THREE,new THREE.Scene(),{...source,features:[feature]},frame,geoToLocal);
  const building=createOptoBuilding(THREE,model.buildings[0],{frame,geoToLocal});
  try{
    assert.equal(building.entries.length,5);
    for(const entry of building.entries){
      const pose=depth=>({x:entry.doorGate.center.x+entry.doorGate.normal.x*depth,y:entry.y,
        z:entry.doorGate.center.z+entry.doorGate.normal.z*depth,mode:'walk',grounded:true});
      for(const admitted of [nearbyInterior(building.entries,pose(.3)),crossedInteriorDoor(building.entries,pose(.3),pose(-.3))]){
        assert.equal(admitted.id,entry.id);assert.notEqual(admitted.id,'opto-c118','the door has its own return identity');
        const f=fixture(),seen=[];
        const sync=createC118ActivitySync({embedded:true,bridge:f.bridge,onState:state=>seen.push(structuredClone(state)),monotonic:()=>50,
          liveClientFactory(){assert.fail('an embedded room must share the campus connection');}});
        const opened={...admitted,attemptId:'visit-1'};
        f.message(createActivityBridgeMessage({opened,state:{paused:false,c118Flood:flood,c118Screen:screen},serverTime:107000}));
        assert.deepEqual(seen.at(-1).c118Flood,flood,entry.id+' receives a running event, including late entrance');
        assert.deepEqual(seen.at(-1).c118Screen,screen,entry.id+' receives host programme changes');
        assert.equal(sync.now(),107000);assert.equal(seen.at(-1).paused,false);
        f.message(createActivityBridgeMessage({opened,state:{paused:true,c118Flood:flood,c118Screen:screen},serverTime:108000}));
        assert.equal(seen.at(-1).paused,true,'the host still pauses the room');
        f.message(createActivityBridgeMessage({opened,state:{paused:false,c118Flood:null,c118Screen:screen},serverTime:109000}));
        assert.equal(seen.at(-1).c118Flood,null,'reset reaches each doorway');sync.dispose();
      }
    }
  }finally{building.dispose();model.dispose();}
});

test('the parent routes C118 programmes by room identity, without leaking them to unrelated works',()=>{
  const state={paused:false,c118Flood:flood,c118Screen:screen};
  for(const opened of [null,{id:'opto-c118',workId:'library',kind:'building-interior'},
    {id:'anything',workId:'opto-c118',kind:'portal'},{id:'other-room',workId:'other-room',kind:'building-interior'}]){
    const message=createActivityBridgeMessage({opened,state,serverTime:100000});
    assert.equal(message.c118Flood,null);assert.equal(message.c118Screen,null);
  }
  const message=createActivityBridgeMessage({opened:{workId:'opto-c118',kind:'building-interior'},state,serverTime:100000,locallyPaused:true});
  assert.equal(message.paused,true);assert.deepEqual(message.c118Flood,flood);
});

test('C118 bridge carries the shared flood and server clock into its embedded sync without another connection',()=>{
  const f=fixture();let mono=500;const seen=[];
  const sync=createC118ActivitySync({embedded:true,bridge:f.bridge,onState:state=>seen.push(structuredClone(state)),monotonic:()=>mono,
    liveClientFactory(){assert.fail('the room must use its existing campus connection');}});
  f.message({type:'campus:activity',paused:false,c118Flood:flood,c118Screen:screen,serverTime:100000});
  assert.deepEqual(seen.at(-1).c118Flood,flood);assert.deepEqual(seen.at(-1).c118Screen,screen);assert.equal(sync.now(),100000);
  mono+=3500;assert.equal(sync.now(),103500,'the local wall clock does not replace the host server clock');
  assert.deepEqual(f.posts,[{data:{type:'campus:ready',attemptId:'visit-1',workId:'opto-c118',level:'page_opened'},targetOrigin:origin}]);
  f.message({type:'campus:activity',paused:false,c118Flood:null,serverTime:104000});
  assert.equal(seen.at(-1).c118Flood,null,'explicit reset reaches the room');sync.dispose();
});

test('every other work receives ordinary activity state with no C118 flood',()=>{
  for(const work of ['library','tasay','demo','opto-other','']){
    const f=fixture({work});
    f.message({type:'campus:activity',paused:true,c118Flood:flood,c118Screen:screen,serverTime:100000,announcement:{title:'集合'}});
    assert.equal(f.bridge.state.c118Flood,null,`flood must not reach ${work||'unidentified works'}`);
    assert.equal(f.bridge.state.c118Screen,null,`screen commands must not reach ${work||'unidentified works'}`);
    assert.equal(f.bridge.state.paused,true);assert.equal(f.bridge.state.serverTime,100000);
    assert.equal(f.bridge.state.announcement.title,'集合');
  }
});

test('bridge accepts messages only from the current same-origin parent and matching attempt',()=>{
  const f=fixture(),seen=[];f.bridge.subscribe(state=>seen.push(state));
  const valid={type:'campus:activity',paused:false,c118Flood:flood,c118Screen:screen,serverTime:100000};
  for(const overrides of [{origin:'https://other.example'},{source:{}},{data:{...valid,attemptId:'old-visit'}},
    {data:{...valid,attemptId:undefined}},{data:{...valid,attemptId:'visit-1',paused:'false'}},
    {data:{...valid,attemptId:'visit-1',type:'other-event'}}])f.message(valid,overrides);
  assert.equal(seen.length,1);assert.equal(f.bridge.state.c118Flood,null);assert.equal(f.bridge.state.c118Screen,null);
  f.message(valid);assert.equal(seen.length,2);assert.deepEqual(structuredClone(f.bridge.state.c118Flood),flood);assert.deepEqual(structuredClone(f.bridge.state.c118Screen),screen);
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

test('only the C118 bridge can request a named C1/C2 return, with the active attempt retained',()=>{
  const f=fixture();assert.equal(f.bridge.exit('opto-c1'),true);
  assert.deepEqual(f.posts.at(-1),{data:{type:'campus:exit',attemptId:'visit-1',workId:'opto-c118',returnEntryId:'opto-c1'},targetOrigin:origin});
  f.bridge.exit('https://other.example');assert.equal(f.posts.at(-1).data.returnEntryId,undefined);
  const unrelated=fixture({work:'tasay'});unrelated.bridge.exit('opto-c2');assert.equal(unrelated.posts.at(-1).data.returnEntryId,undefined);
});
