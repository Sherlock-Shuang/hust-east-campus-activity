import {CAMPUS_TSUNAMI_PLACEMENT as WAVE} from './campus-tsunami-timeline.js';

export const CIVILIZATION_PAUSE_MESSAGE='第1036号文明在海浪中进入暂停，下一个文明的辉煌，就靠诸位了';
export const CIVILIZATION_CONTINUE_LABEL='继续遨游';
export const CIVILIZATION_PAUSE_DELAY_SECONDS=7;

// Elapsed event seconds when the first curved front passes this position.
// Match the rendering timeline, including its three-second horizon reveal.
export function firstCampusWavePassedAt(position){
  if(!Number.isFinite(position?.x)||!Number.isFinite(position?.z))return null;
  const u=(position.x-WAVE.x)/(WAVE.width/2);
  if(Math.abs(u)>1)return null;
  return Math.max(-3,(WAVE.shoreFront+u*u*WAVE.arcDepth-position.z)/WAVE.speed);
}

export function createCivilizationPause({storage=null,key='campus-civilization-continued-v1'}={}){
  let currentId=null,active=false,continued=false,savedId=null,passedAt=null;
  try{savedId=storage?.getItem(key)||null;}catch{}
  return {
    update({eventId=null,elapsed,position,outdoors=false,eligible=false,hostPaused=false}={}){
      const nextId=typeof eventId==='string'&&eventId.length>0&&eventId.length<=64?eventId:null;
      if(nextId!==currentId){currentId=nextId;active=false;passedAt=null;continued=currentId!==null&&currentId===savedId;}
      if(!currentId){active=false;return false;}
      if(!active&&!continued&&outdoors&&eligible&&!hostPaused&&Number.isFinite(elapsed)){
        // Latch the crossing, so moving during the delay cannot move the alarm.
        // Use the shared event clock rather than a wall-clock timeout: host
        // pauses freeze the seven seconds, and late arrivals catch up once.
        if(passedAt===null){
          const crossing=firstCampusWavePassedAt(position);
          if(crossing!==null&&elapsed>=crossing)passedAt=crossing;
        }
        if(passedAt!==null&&elapsed-passedAt>=CIVILIZATION_PAUSE_DELAY_SECONDS)active=true;
      }
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
