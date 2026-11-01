import test from 'node:test';
import assert from 'node:assert/strict';
import {CIVILIZATION_PAUSE_MESSAGE,CIVILIZATION_CONTINUE_LABEL,CIVILIZATION_PAUSE_DELAY_SECONDS,firstCampusWavePassedAt,createCivilizationPause} from '../src/civilization-pause.js';
import {CAMPUS_TSUNAMI_PLACEMENT as wave} from '../src/campus-tsunami-timeline.js';
import {getC118FloodElapsed,reconcileC118Flood} from '../src/c118-flood-state.js';

const center={x:wave.x,z:0};
const firstPass=wave.shoreFront/wave.speed,arrival=firstPass+7;
const update=(patch={})=>({eventId:'campus-wave-one',elapsed:arrival,position:center,outdoors:true,eligible:true,hostPaused:false,...patch});
function memoryStorage(initial){
  const values=new Map(Object.entries(initial||{})),writes=[];
  return {values,writes,getItem:key=>values.get(key)??null,setItem(key,value){writes.push([key,value]);values.set(key,value);}};
}

test('civilization interlude preserves the requested words exactly',()=>{
  assert.equal(CIVILIZATION_PAUSE_MESSAGE,'第1036号文明在海浪中进入暂停，下一个文明的辉煌，就靠诸位了');
  assert.equal(CIVILIZATION_CONTINUE_LABEL,'继续遨游');
});

test('first crest passes the local position and the pause follows exactly seven event seconds later',()=>{
  assert.equal(CIVILIZATION_PAUSE_DELAY_SECONDS,7);
  assert.equal(firstCampusWavePassedAt(center),firstPass);
  const pause=createCivilizationPause();
  assert.equal(pause.update(update({elapsed:firstPass-.001})),false);
  assert.equal(pause.update(update({elapsed:firstPass})),false);
  assert.equal(pause.update(update({elapsed:arrival-.001})),false);
  assert.equal(pause.update(update({elapsed:arrival})),true);
  assert.ok(arrival<wave.interval,'pause occurs well before the second wave');
});

test('curved wings pass later, while positions outside the wave width never start a countdown',()=>{
  for(const direction of [-1,1]){
    const position={x:wave.x+direction*wave.width/4,z:0},delay=wave.arcDepth*.25/wave.speed;
    assert.equal(firstCampusWavePassedAt(position),firstPass+delay);
    const pause=createCivilizationPause();
    assert.equal(pause.update(update({elapsed:arrival+delay-.001,position})),false);
    assert.equal(pause.update(update({elapsed:arrival+delay,position})),true);
    const edge={x:wave.x+direction*wave.width/2,z:0};
    assert.equal(firstCampusWavePassedAt(edge),firstPass+wave.arcDepth/wave.speed);
    assert.equal(firstCampusWavePassedAt({...edge,x:edge.x+direction*.001}),null);
    assert.equal(createCivilizationPause().update(update({elapsed:100000,position:{...edge,x:edge.x+direction*.001}})),false);
  }
  assert.equal(firstCampusWavePassedAt({...center,z:-10}),firstPass+.2);
  assert.equal(firstCampusWavePassedAt({...center,z:10}),firstPass-.2);
  const extreme=createCivilizationPause(),position={...center,z:100000};
  assert.equal(extreme.update(update({elapsed:-3,position})),false);
  assert.equal(extreme.update(update({elapsed:3.999,position})),false);
});

test('unusable clocks and positions do not start a civilization pause',()=>{
  for(const elapsed of [undefined,null,NaN,Infinity,-Infinity])assert.equal(createCivilizationPause().update(update({elapsed})),false);
  for(const position of [undefined,null,{}, {x:NaN,z:0},{x:wave.x,z:Infinity},{x:wave.x},{z:0}]){
    assert.equal(firstCampusWavePassedAt(position),null);
    assert.equal(createCivilizationPause().update(update({position})),false);
  }
});

test('moving after the first crossing does not restart or shorten the seven-second delay',()=>{
  for(const z of [-1000,1000]){
    const pause=createCivilizationPause();
    assert.equal(pause.update(update({elapsed:firstPass})),false);
    assert.equal(pause.update(update({elapsed:arrival-.001,position:{...center,z}})),false);
    assert.equal(pause.update(update({elapsed:arrival,position:{...center,z}})),true);
  }
});

test('host pause freezes the seven-second event clock and a reset cancels its pending countdown',()=>{
  let event={id:'campus-wave-one',startAt:1000,pausedAt:null,pausedMs:0};
  const pause=createCivilizationPause(),at=s=>1000+s*1000;
  const step=(seconds,hostPaused=false)=>pause.update(update({eventId:event.id,elapsed:getC118FloodElapsed(event,at(seconds)),hostPaused}));
  assert.equal(step(firstPass),false);
  event=reconcileC118Flood({c118Flood:event},{c118Flood:event,paused:true},at(firstPass+3));
  assert.equal(step(firstPass+100,true),false);
  event=reconcileC118Flood({c118Flood:event},{c118Flood:event,paused:false},at(firstPass+103));
  assert.equal(step(arrival+100-.001),false);
  assert.equal(step(arrival+100),true);
  const pending=createCivilizationPause();pending.update(update({elapsed:firstPass}));
  assert.equal(pending.update(update({eventId:null,elapsed:arrival})),false);
  assert.equal(pending.update(update({eventId:'new-event',elapsed:0})),false);
  assert.equal(pending.update(update({eventId:'new-event',elapsed:arrival-.001})),false);
  assert.equal(pending.update(update({eventId:'new-event',elapsed:arrival})),true);
});

test('only an eligible outdoor player starts the pause and late outdoor joins see the interlude',()=>{
  for(const patch of [{outdoors:false},{eligible:false},{hostPaused:true},{eventId:null},{eventId:''},{elapsed:arrival-.001}]){
    const pause=createCivilizationPause({storage:memoryStorage()});
    assert.equal(pause.update(update(patch)),false);
    assert.equal(pause.active,false);
  }
  const pause=createCivilizationPause({storage:memoryStorage()});
  assert.equal(pause.active,false);
  assert.equal(pause.update(update({elapsed:arrival+1000})),true,'joining after the first crossing plus seven seconds gives the same interlude');
  assert.equal(pause.eventId,'campus-wave-one');
});

test('a shown interlude stays latched until continue or event reset, including a later host pause',()=>{
  const pause=createCivilizationPause({storage:memoryStorage()});
  assert.equal(pause.update(update()),true);
  assert.equal(pause.update(update({outdoors:false,eligible:false,hostPaused:true,elapsed:0})),true);
  assert.equal(pause.active,true);
  assert.equal(pause.update(update({eventId:null})),false);
  assert.equal(pause.active,false);
  assert.equal(pause.update(update()),true,'an uncontinued event may show again after an authoritative reset');
  assert.equal(pause.update(update({eventId:'new-wave',elapsed:0})),false,'a new event releases the old overlay before its own wave arrives');
});

test('continue acknowledges only a displayed event and refresh never repeats an acknowledged event',()=>{
  const storage=memoryStorage(),key='civilization-test-key',pause=createCivilizationPause({storage,key});
  assert.equal(pause.continueExploring(),false);
  assert.deepEqual(storage.writes,[]);
  pause.update(update());
  assert.equal(pause.continueExploring(),true);
  assert.equal(pause.active,false);
  assert.deepEqual(storage.writes,[[key,'campus-wave-one']]);
  assert.equal(pause.continueExploring(),false);
  assert.equal(pause.update(update({elapsed:arrival+1000})),false);
  const refreshed=createCivilizationPause({storage,key});
  assert.equal(refreshed.update(update()),false);
  refreshed.update(update({eventId:null}));
  assert.equal(storage.getItem(key),'campus-wave-one','empty snapshots never erase the acknowledgment');
  assert.equal(refreshed.update(update()),false);
  assert.equal(refreshed.update(update({eventId:'campus-wave-two'})),true);
});

test('refresh before continuing may show the same pending interlude again',()=>{
  const storage=memoryStorage(),first=createCivilizationPause({storage});
  assert.equal(first.update(update()),true);
  assert.deepEqual(storage.writes,[],'displaying the overlay is not an acknowledgment');
  const refreshed=createCivilizationPause({storage});
  assert.equal(refreshed.update(update()),true);
});

test('blocked storage still acknowledges an event for the current session',()=>{
  const storage={getItem(){throw Error('storage blocked');},setItem(){throw Error('storage blocked');}};
  const pause=createCivilizationPause({storage});
  assert.equal(pause.update(update()),true);
  assert.equal(pause.continueExploring(),true);
  assert.equal(pause.update(update()),false,'write failures cannot trap the player in a repeated prompt');
  assert.equal(pause.update(update({eventId:'a-new-wave'})),true);
});
