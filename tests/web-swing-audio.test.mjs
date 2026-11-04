import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebSwingAudio} from '../src/web-swing-audio.js';

function fixture(){
  const contexts=[];
  const parameter=()=>({value:0,events:[],cancelScheduledValues(t){this.events.push(['cancel',t]);},setValueAtTime(value,t){this.value=value;this.events.push(['set',value,t]);},setTargetAtTime(value,t,delay){this.value=value;this.events.push(['target',value,t,delay]);},exponentialRampToValueAtTime(value,t){this.value=value;this.events.push(['ramp',value,t]);}});
  const node=()=>({connections:[],disconnects:0,connect(other){this.connections.push(other);return other;},disconnect(){this.disconnects++;}});
  class Context{
    constructor(){contexts.push(this);this.sampleRate=48000;this.currentTime=7;this.destination={};this.nodes=[];this.sources=[];this.resumeCount=0;this.closeCount=0;}
    createGain(){const result={...node(),gain:parameter()};this.nodes.push(result);return result;}
    createBiquadFilter(){const result={...node(),frequency:parameter(),Q:parameter()};this.nodes.push(result);return result;}
    createBuffer(_channels,length){const data=new Float32Array(length);return{getChannelData:()=>data};}
    createBufferSource(){const result={...node(),starts:[],stops:[],start(t){this.starts.push(t);},stop(t){this.stops.push(t);}};this.nodes.push(result);this.sources.push(result);return result;}
    async resume(){this.resumeCount++;}
    async close(){this.closeCount++;}
  }
  return{Context,contexts};
}

test('global sound level has no unlock side effect and all opted-in web effects pass through one master',async()=>{
  const {Context,contexts}=fixture(),audio=createWebSwingAudio({AudioContext:Context});
  audio.setVolume(.3);audio.setActive(true);assert.equal(contexts.length,0);assert.equal(audio.enabled,false);
  await audio.setEnabled(true);const context=contexts[0],master=context.nodes.find(n=>n.connections.includes(context.destination));
  assert.equal(context.resumeCount,1);assert.equal(master.gain.value,.3);
  const unchanged=master.gain.events.length;for(let i=0;i<60;i++)audio.setVolume(.3);assert.equal(master.gain.events.length,unchanged,'repeated frame-level forwarding does not schedule redundant AudioParam writes');
  audio.tick({swingCount:1,zipCount:1,pointCount:1,pointLaunchCount:1,trickCount:1,traversalPhase:'release',vx:12,grounded:false});
  assert.ok(context.sources.length>=8);
  assert.equal(context.nodes.filter(n=>n.connections.includes(context.destination)).length,1,'wind and every one-shot route through the same global gain');
  audio.dispose();
});

test('zero volume, pause and opt-out immediately silence existing effects without replaying muted events',async()=>{
  const {Context,contexts}=fixture(),audio=createWebSwingAudio({AudioContext:Context});audio.setActive(true);await audio.setEnabled(true);
  const context=contexts[0],master=context.nodes.find(n=>n.connections.includes(context.destination));
  audio.tick({swingCount:1,traversalPhase:'ground'});const count=context.sources.length;
  audio.setVolume(0);assert.equal(master.gain.value,0);assert.deepEqual(master.gain.events.at(-1),['set',0,7]);
  audio.tick({swingCount:9,zipCount:2,traversalPhase:'release'});assert.equal(context.sources.length,count);
  audio.setVolume(.6);assert.equal(master.gain.value,.6);audio.tick({swingCount:9,zipCount:2,traversalPhase:'release'});assert.equal(context.sources.length,count);
  audio.setActive(false);assert.equal(master.gain.value,0);audio.setVolume(.8);assert.equal(master.gain.value,0);
  audio.setActive(true);assert.equal(master.gain.value,.8);await audio.setEnabled(false);assert.equal(master.gain.value,0);
  assert.equal(context.resumeCount,1,'global mute/volume never resumes a context');
  audio.dispose();audio.dispose();assert.equal(context.closeCount,1);assert.equal(master.disconnects,1);
});

test('invalid levels and unsupported audio do not activate effects',async()=>{
  const {Context,contexts}=fixture(),audio=createWebSwingAudio({AudioContext:Context});audio.setVolume(NaN);audio.setVolume(-1);audio.setActive(true);await audio.setEnabled(true);
  const master=contexts[0].nodes.find(n=>n.connections.includes(contexts[0].destination));assert.equal(master.gain.value,0);audio.setVolume(9);assert.equal(master.gain.value,1);audio.dispose();
  const absent=createWebSwingAudio({AudioContext:null});absent.setVolume(.4);assert.equal(await absent.setEnabled(true),false);assert.equal(absent.enabled,false);absent.dispose();
});
