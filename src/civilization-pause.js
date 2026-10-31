import {CAMPUS_TSUNAMI_PLACEMENT as WAVE,campusTsunamiFront} from './campus-tsunami-timeline.js';

export const CIVILIZATION_PAUSE_MESSAGE='第1036号文明在海浪中进入暂停，下一个文明的辉煌，就靠诸位了';
export const CIVILIZATION_CONTINUE_LABEL='继续遨游';

// Match the second crest's curved world-space front, not the first wave or a
// fixed global alarm. Players elsewhere on the map encounter it at their place.
export function secondCampusWaveArrived({elapsed,position}={}){
  if(!Number.isFinite(elapsed)||elapsed<WAVE.interval-3||!Number.isFinite(position?.x)||!Number.isFinite(position?.z))return false;
  const u=(position.x-WAVE.x)/(WAVE.width/2);
  if(Math.abs(u)>1)return false;
  return position.z>=campusTsunamiFront(elapsed-WAVE.interval)+u*u*WAVE.arcDepth;
}

export function createCivilizationPause({storage=null,key='campus-civilization-continued-v1'}={}){
  let currentId=null,active=false,continued=false,savedId=null;
  try{savedId=storage?.getItem(key)||null;}catch{}
  return {
    update({eventId=null,elapsed,position,outdoors=false,eligible=false,hostPaused=false}={}){
      const nextId=typeof eventId==='string'&&eventId.length>0&&eventId.length<=64?eventId:null;
      if(nextId!==currentId){currentId=nextId;active=false;continued=currentId!==null&&currentId===savedId;}
      if(!currentId){active=false;return false;}
      if(!active&&!continued&&outdoors&&eligible&&!hostPaused&&secondCampusWaveArrived({elapsed,position}))active=true;
      return active;
    },
    continueExploring(){
      if(!active)return false;
      active=false;continued=true;savedId=currentId;
      try{storage?.setItem(key,currentId);}catch{}
      return true;
    },
    get active(){return active;},
    get eventId(){return currentId;},
  };
}
