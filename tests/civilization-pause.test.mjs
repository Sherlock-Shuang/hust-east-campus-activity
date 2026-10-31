import test from 'node:test';
import assert from 'node:assert/strict';
import {CIVILIZATION_PAUSE_MESSAGE,CIVILIZATION_CONTINUE_LABEL,secondCampusWaveArrived,createCivilizationPause} from '../src/civilization-pause.js';
import {CAMPUS_TSUNAMI_PLACEMENT as wave} from '../src/campus-tsunami-timeline.js';

const center={x:wave.x,z:0};
const arrival=wave.interval+wave.shoreFront/wave.speed;
const update=(patch={})=>({eventId:'campus-wave-one',elapsed:arrival,position:center,outdoors:true,eligible:true,hostPaused:false,...patch});
function memoryStorage(initial){
  const values=new Map(Object.entries(initial||{})),writes=[];
  return {values,writes,getItem:key=>values.get(key)??null,setItem(key,value){writes.push([key,value]);values.set(key,value);}};
}

test('civilization interlude preserves the requested words exactly',()=>{
  assert.equal(CIVILIZATION_PAUSE_MESSAGE,'第1036号文明在海浪中进入暂停，下一个文明的辉煌，就靠诸位了');
  assert.equal(CIVILIZATION_CONTINUE_LABEL,'继续遨游');
});

test('second wave arrives at the player position rather than a campus-wide fixed countdown',()=>{
  assert.equal(secondCampusWaveArrived({elapsed:arrival-.001,position:center}),false);
  assert.equal(secondCampusWaveArrived({elapsed:arrival,position:center}),true);
  assert.equal(secondCampusWaveArrived({elapsed:arrival+.001,position:center}),true);
  assert.equal(secondCampusWaveArrived({elapsed:arrival,position:{...center,z:-10}}),false,'a northern player still waits');
  assert.equal(secondCampusWaveArrived({elapsed:arrival,position:{...center,z:10}}),true,'the crest has passed a southern player');
  assert.equal(secondCampusWaveArrived({elapsed:wave.shoreFront/wave.speed,position:center}),false,'the first wave never triggers the interlude');
  assert.equal(secondCampusWaveArrived({elapsed:wave.interval-3-.001,position:{...center,z:100000}}),false,'unrevealed second waves cannot trigger at an extreme southern point');
});

test('both curved wave wings arrive later and positions outside the wave width are excluded',()=>{
  for(const direction of [-1,1]){
    const position={x:wave.x+direction*wave.width/4,z:0},delay=wave.arcDepth*.25/wave.speed;
    assert.equal(secondCampusWaveArrived({elapsed:arrival,position}),false);
    assert.equal(secondCampusWaveArrived({elapsed:arrival+delay-.001,position}),false);
    assert.equal(secondCampusWaveArrived({elapsed:arrival+delay,position}),true);
    const edge={x:wave.x+direction*wave.width/2,z:0};
    assert.equal(secondCampusWaveArrived({elapsed:arrival+wave.arcDepth/wave.speed,position:edge}),true);
    assert.equal(secondCampusWaveArrived({elapsed:100000,position:{...edge,x:edge.x+direction*.001}}),false);
  }
});

test('unusable clocks and positions do not cause a civilization pause',()=>{
  for(const elapsed of [undefined,null,NaN,Infinity,-Infinity])assert.equal(secondCampusWaveArrived({elapsed,position:center}),false);
  for(const position of [undefined,null,{}, {x:NaN,z:0},{x:wave.x,z:Infinity},{x:wave.x},{z:0}])assert.equal(secondCampusWaveArrived({elapsed:arrival,position}),false);
});

test('only an eligible outdoor player starts the pause and late outdoor joins see the interlude',()=>{
  for(const patch of [{outdoors:false},{eligible:false},{hostPaused:true},{eventId:null},{eventId:''},{elapsed:arrival-.001}]){
    const pause=createCivilizationPause({storage:memoryStorage()});
    assert.equal(pause.update(update(patch)),false);
    assert.equal(pause.active,false);
  }
  const pause=createCivilizationPause({storage:memoryStorage()});
  assert.equal(pause.active,false);
  assert.equal(pause.update(update({elapsed:arrival+1000})),true,'joining after the second crest has passed gives the same interlude');
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
