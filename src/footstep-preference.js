const KEY='campus-footsteps-v1';
export function readFootstepPreference(storage){try{return storage?.getItem(KEY)!=='off';}catch{return true;}}

export function mountFootstepPreference({document,window,music,audio}){
  let storage;try{storage=window.localStorage;}catch{}
  let enabled=readFootstepPreference(storage);
  const label=document.createElement('label');label.className='footstep-preference';
  const input=document.createElement('input');input.type='checkbox';input.checked=enabled;
  label.append(input,document.createTextNode('脚步音效'));document.getElementById('player-guide-settings')?.append(label);
  function apply(state=music.state){audio.setEnabled(enabled&&!state.muted);audio.setVolume(state.volume*.3);}
  function change(){enabled=input.checked;try{storage?.setItem(KEY,enabled?'on':'off');}catch{}if(enabled)void audio.unlock();apply();}
  input.addEventListener('change',change);const unsubscribe=music.subscribe(apply);
  const hide=()=>{if(document.hidden)audio.setActive(false);},pagehide=()=>audio.setActive(false);
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',pagehide);
  return {dispose(){unsubscribe();input.removeEventListener('change',change);document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',pagehide);label.remove();audio.dispose();}};
}
