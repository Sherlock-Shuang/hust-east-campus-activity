export const C118_PIANO_SHARE_URL='./presentations/taste-is-all-you-need.html';

// Deliberately has no HUD hint: this is the presenter's piano-side shortcut.
export function shouldOpenC118PianoShare(event,{plan,position,active=true,seated=false,swimming=false,floodRunning=false}={}){
  const key=event.code==='KeyF'||(!event.code||event.code==='Unidentified')&&event.key?.toLowerCase()==='f';
  if(!key||event.repeat||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey)return false;
  if(event.target?.isContentEditable||event.target?.closest?.('a,button,input,textarea,select,[role="textbox"]'))return false;
  if(!active||seated||swimming||floodRunning||!plan?.piano||!position||position.mode!=='walk'||!position.grounded)return false;
  return Math.abs(position.y-plan.stage.height)<.16&&Math.hypot(position.x-plan.piano.x,position.z-plan.piano.z)<=2.35;
}
