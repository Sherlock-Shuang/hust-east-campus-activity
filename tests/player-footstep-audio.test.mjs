import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerFootstepAudio,createWalkingStepTracker,createFootstepSample} from '../src/player-footstep-audio.js';
import {walkingAnimationSpeed} from '../src/player-walking-pose.js';

const stateAt=(time,speed=3.2)=>({mode:'walk',grounded:true,waterMode:'dry',speed,distance:time*speed,x:0,y:.14,z:-time*speed,elapsed:time});
const phaseAt=(time,speed=3.2)=>time*walkingAnimationSpeed(speed)*5.2;
function audioFixture(){
  const instances=[];
  const node=()=>({connections:[],disconnected:0,connect(other){this.connections.push(other);return other;},disconnect(){this.disconnected++;}});
  class Context{
    constructor(){instances.push(this);this.sampleRate=48000;this.currentTime=0;this.state='suspended';this.destination={};this.buffers=[];this.sources=[];this.gains=[];this.closeCount=0;}
    createGain(){const result={...node(),gain:{value:1,events:[],cancelScheduledValues(t){this.events.push(['cancel',t]);},setValueAtTime(value,t){this.value=value;this.events.push(['set',value,t]);}}};this.gains.push(result);return result;}
    createBuffer(_channels,length){const data=new Float32Array(length),buffer={getChannelData:()=>data};this.buffers.push(buffer);return buffer;}
    createBufferSource(){const result={...node(),playbackRate:{value:1},starts:[],stops:[],start(t){this.starts.push(t);},stop(t){this.stops.push(t);}};this.sources.push(result);return result;}
    async resume(){this.state='running';}
    async close(){this.state='closed';this.closeCount++;}
  }
  return{Context,instances};
}

test('audio creates no context or sources until an explicit user-gesture unlock, then reuses cached samples',async()=>{
  const {Context,instances}=audioFixture(),audio=createPlayerFootstepAudio({AudioContext:Context});
  audio.setEnabled(true);audio.setActive(true);
  for(let i=0;i<120;i++)audio.tick(stateAt(i/60),{dt:1/60,phase:phaseAt(i/60)});
  assert.equal(instances.length,0);assert.equal(audio.unlocked,false);
  assert.equal(await audio.unlock(),true);assert.equal(await audio.unlock(),true);assert.equal(instances.length,1);
  const context=instances[0];assert.equal(context.buffers.length,8);
  for(let i=0;i<120;i++)audio.tick(stateAt(i/60),{dt:1/60,phase:phaseAt(i/60)});
  assert.ok(context.sources.length>=6&&context.sources.length<=8);
  assert.equal(context.buffers.length,8,'impacts reuse fixed short samples instead of allocating PCM per frame');
  assert.ok(context.sources.every(s=>s.starts.length===1&&s.stops[0]===.17));
  audio.dispose();assert.equal(context.closeCount,1);
});

test('step events use the actual visual landing phase and agree at 30, 60 and 144 Hz',()=>{
  for(const speed of [3.2,5.2]){
    const traces=[30,60,144].map(fps=>{
      const tracker=createWalkingStepTracker(),events=[];
      for(let i=0;i<=4*fps;i++){const step=tracker.tick(stateAt(i/fps,speed),{dt:1/fps,phase:phaseAt(i/fps,speed)});if(step)events.push({index:step.index,foot:step.foot});}
      return events;
    });
    assert.ok(traces[0].length>=14);assert.deepEqual(traces[0],traces[1]);assert.deepEqual(traces[0],traces[2]);
    assert.ok(traces[0].every((event,i)=>event.foot===(i%2?'right':'left')));
  }
});

test('stops, mode changes, water, teleports and long frames discard impacts instead of catching up',()=>{
  const interruptions=[{...stateAt(.25),speed:0},{...stateAt(.25),mode:'scooter'},{...stateAt(.25),mode:'spider'},
    {...stateAt(.25),waterMode:'swim'},{...stateAt(.25),waterMode:'surf'},{...stateAt(.25),grounded:false},
    {...stateAt(.25),x:80},{...stateAt(.25),y:8},{...stateAt(.25),distance:0}];
  for(const interruption of interruptions){
    const tracker=createWalkingStepTracker();tracker.tick(stateAt(.2),{dt:1/60,phase:1.5});
    assert.equal(tracker.tick(interruption,{dt:1/60,phase:1.8}),null);
    assert.equal(tracker.tick(stateAt(2),{dt:1/60,phase:phaseAt(2)}),null,'return captures a fresh baseline');
  }
  const tracker=createWalkingStepTracker();tracker.tick(stateAt(0),{dt:1/60,phase:0});
  assert.equal(tracker.tick(stateAt(.2),{dt:.5,phase:8}),null);
  assert.equal(tracker.tick(stateAt(.21),{dt:1/60,phase:8.1}),null);
  const noBurst=createWalkingStepTracker();noBurst.tick(stateAt(0),{dt:1/60,phase:0});
  assert.equal(noBurst.tick(stateAt(.1),{dt:1/60,phase:12}),null,'even malformed phase jumps never queue multiple footsteps');
});

test('mute, pause and disposal immediately stop active voices and resume without a queued step',async()=>{
  const {Context,instances}=audioFixture(),audio=createPlayerFootstepAudio({AudioContext:Context});audio.setEnabled(true);audio.setActive(true);await audio.unlock();
  const context=instances[0];audio.tick(stateAt(0),{phase:0,dt:1/60});assert.ok(audio.tick(stateAt(.15),{phase:1.7,dt:.15}));
  const source=context.sources[0];audio.setActive(false);assert.equal(context.gains[0].gain.value,0);assert.ok(source.stops.includes(undefined));
  const before=context.sources.length;audio.tick(stateAt(.3),{phase:5,dt:.15});assert.equal(context.sources.length,before);
  audio.setActive(true);assert.equal(audio.tick(stateAt(.32),{phase:5.1,dt:.02}),null);
  audio.setEnabled(false);assert.equal(context.gains[0].gain.value,0);assert.equal(audio.enabled,false);
  audio.setEnabled(true);assert.equal(audio.tick(stateAt(.4),{phase:6,dt:.08}),null);
  audio.dispose();audio.dispose();assert.equal(context.closeCount,1);assert.equal(await audio.unlock(),false);
});

test('surface feedback follows explicit overrides or a host query and ignores unavailable audio safely',async()=>{
  const {Context,instances}=audioFixture(),audio=createPlayerFootstepAudio({AudioContext:Context,surfaceAt:()=> 'grass'});
  audio.setEnabled(true);audio.setActive(true);await audio.unlock();
  audio.tick(stateAt(0),{phase:0,dt:1/60});assert.equal(audio.tick(stateAt(.15),{phase:1.7,dt:.15}).surface,'grass');
  assert.equal(audio.tick(stateAt(.3),{phase:4.8,dt:.15,surface:'wood'}).surface,'wood');
  assert.equal(audio.tick(stateAt(.45),{phase:8,dt:.15,surface:'unknown'}).surface,'paved');
  assert.equal(instances[0].buffers.length,8);audio.dispose();
  const unsupported=createPlayerFootstepAudio({AudioContext:null});unsupported.setEnabled(true);unsupported.setActive(true);assert.equal(await unsupported.unlock(),false);assert.equal(unsupported.tick(stateAt(1)),null);unsupported.dispose();
});

test('procedural impacts are short, finite, bounded and fade completely instead of sustaining a tone',()=>{
  const signatures=new Set();
  for(const surface of ['paved','grass','wood','metal'])for(const variant of [0,1]){
    const samples=createFootstepSample(48000,surface,variant);assert.equal(samples.length,7200);assert.equal(samples[0],0);
    assert.ok(samples.every(v=>Number.isFinite(v)&&Math.abs(v)<.65));
    const rms=(from,to)=>Math.sqrt(samples.slice(from,to).reduce((sum,v)=>sum+v*v,0)/(to-from));
    assert.ok(rms(6000,7200)<rms(0,1200)*.04);signatures.add(samples.slice(200,208).join(','));
  }
  assert.equal(signatures.size,8);
});
