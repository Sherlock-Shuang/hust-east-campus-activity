import {isEventActive} from './live-state.js';

// Door IDs identify where to return to the campus. workId identifies the room
// receiving a programme, regardless of which of its doors admitted the player.
export function createActivityBridgeMessage({opened,state,serverTime,locallyPaused=false}){
  const isC118=opened?.kind==='building-interior'&&opened.workId==='opto-c118';
  return {
    type:'campus:activity',attemptId:opened?.attemptId,
    paused:!!state.paused||!!locallyPaused,
    announcement:isEventActive(state.announcement,serverTime)?state.announcement:null,
    c118Flood:isC118?state.c118Flood??null:null,
    c118Screen:isC118?state.c118Screen??null:null,
    serverTime,
  };
}
