/** Presentation only. Unity remains the authority for charging and casting. */
export function skillPresentation(raw,{phase='intro',suspended=false}={}){
  const unknown={state:'unknown',label:'同步中',hint:'技能状态同步中',charge:0,ready:false,charged:false};
  if(raw?.version!==1||!['focus','maxEnergy','cost','cooldown'].every(key=>Number.isFinite(raw[key]))||raw.maxEnergy<=0||raw.cost<=0||!['charged','canCast','active'].every(key=>typeof raw[key]==='boolean'))return unknown;
  const focus=Math.max(0,raw.focus),cooldown=Math.max(0,raw.cooldown);
  const charge=Math.min(1,focus/raw.cost),energy=`能量 ${Math.floor(focus)} / ${Math.ceil(raw.maxEnergy)}，消耗 ${Math.ceil(raw.cost)}`;
  const view=(state,label,hint,ready=false,charged=false)=>({state,label,hint:`${hint}；${energy}`,charge,ready,charged});
  if(suspended||phase==='paused')return view('inactive','已暂停','技能已暂停');
  if(phase!=='combat'||!raw.active)return view('inactive','暂不可用','当前阶段不可释放技能');
  // Do not infer CanCastNow from energy or cooldown: animation commitments,
  // stamina, stun, dodges and hit-stop are all decided by the native game.
  if(raw.canCast)return view('ready','可释放','余烬爆发已就绪，点击技能释放',true,true);
  if(cooldown>0){
    const seconds=(Math.ceil(cooldown*10)/10).toFixed(1);
    return view('cooldown',`${seconds}s`,`技能冷却中，还需 ${seconds} 秒`);
  }
  if(raw.charged)return view('charged','已充能','能量已备，当前动作或体力状态暂不允许释放',false,true);
  const needed=Math.max(0,Math.ceil(raw.cost-focus));
  return view('charging',needed?`还需 ${needed}`:'积蓄中',needed?`技能还需 ${needed} 点能量，命中和完美闪避可积攒`:'等待游戏确认技能状态');
}
