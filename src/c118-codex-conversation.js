// This conversation is local to one viewer. Only the host's programme arrives
// through activity state; sending a reply never invokes a server or model.
export function createLocalCodexConversation(){
  let hostKey='',messages=[];
  return {
    get messages(){return messages;},
    accept(state){if(state?.mediaId!=='codex')return false;const key=`${state.revision}:${state.codexText||''}`;if(key===hostKey)return false;hostKey=key;
      const text=state.codexText?.trim();if(!text)messages=[];else messages=[...messages,{role:'codex',text}].slice(-40);return true;},
    reply(value){const text=String(value??'').trim().slice(0,2000);if(!text)return false;messages=[...messages,{role:'user',text}].slice(-40);return true;},
  };
}
