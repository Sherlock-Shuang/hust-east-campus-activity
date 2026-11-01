export const C118_PIANO_SHARE_URL='./presentations/taste-is-all-you-need.html';
export const C118_PIANO_RETURN_KEY='c118-piano-return-v1';

export function prepareC118PianoShare({hallUrl,position,heading,pitch,storage,now=Date.now()}){
  const hall=new URL(hallUrl),deck=new URL(C118_PIANO_SHARE_URL,hall);
  hall.searchParams.set('pianoReturn','1');
  const pose={x:position.x,y:position.y,z:position.z,yaw:heading,pitch};
  try{(storage??globalThis.sessionStorage)?.setItem(C118_PIANO_RETURN_KEY,JSON.stringify({hallUrl:hall.href,pose,savedAt:now}));}catch{}
  deck.searchParams.set('returnTo',hall.href);
  return deck.href;
}

export function takeC118PianoReturn({hallUrl,storage,now=Date.now()}){
  const hall=new URL(hallUrl);
  if(hall.searchParams.get('pianoReturn')!=='1')return null;
  try{
    const saved=JSON.parse((storage??globalThis.sessionStorage)?.getItem(C118_PIANO_RETURN_KEY)||'null');
    (storage??globalThis.sessionStorage)?.removeItem(C118_PIANO_RETURN_KEY);
    if(!saved||saved.hallUrl!==hall.href||!Number.isFinite(saved.savedAt)||now<saved.savedAt||now-saved.savedAt>6*60*60*1000)return null;
    if(!['x','y','z','yaw','pitch'].every(key=>Number.isFinite(saved.pose?.[key])))return null;
    return {...saved.pose,pitch:Math.max(-1.35,Math.min(1.3,saved.pose.pitch))};
  }catch{return null;}
}

// Deliberately has no HUD hint: this is the presenter's piano-side shortcut.
export function shouldOpenC118PianoShare(event,{plan,position,active=true,seated=false,swimming=false,floodRunning=false}={}){
  const key=event.code==='KeyF'||(!event.code||event.code==='Unidentified')&&event.key?.toLowerCase()==='f';
  if(!key||event.repeat||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey)return false;
  if(event.target?.isContentEditable||event.target?.closest?.('a,button,input,textarea,select,[role="textbox"]'))return false;
  if(!active||seated||swimming||floodRunning||!plan?.piano||!position||position.mode!=='walk'||!position.grounded)return false;
  return Math.abs(position.y-plan.stage.height)<.16&&Math.hypot(position.x-plan.piano.x,position.z-plan.piano.z)<=2.35;
}
