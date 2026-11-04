import './exploration-guide.css';
const STORAGE_KEY='campus-exploration-guide-v1';
import {createExplorationProgress} from './exploration-progress.js';
export function createExplorationGuide({document,window,host,getPlayer,getHeading}){
  let storage;try{storage=window.localStorage;}catch{}
  let completed=false;try{completed=storage?.getItem(STORAGE_KEY)==='done';}catch{}
  const progress=createExplorationProgress();let endAt=null,last=-Infinity,disposed=false;
  const root=document.createElement('aside');root.className='exploration-guide';root.hidden=true;root.setAttribute('aria-label','首次探索操作引导');root.innerHTML='<div><span></span><strong></strong><p></p></div><button type="button" aria-label="跳过操作教学">跳过</button>';host.append(root);
  const again=document.createElement('button');again.type='button';again.className='exploration-guide-replay';again.textContent='重看操作引导';document.getElementById('player-guide-settings')?.append(again);
  function save(){try{storage?.setItem(STORAGE_KEY,'done');}catch{}}
  function skip(){completed=true;endAt=null;root.hidden=true;save();}
  function replay(){completed=false;endAt=null;last=-Infinity;progress.reset();}
  root.querySelector('button').addEventListener('click',skip);again.addEventListener('click',replay);
  function tick(now,{enabled=true}={}){
    if(disposed)return;
    const player=getPlayer();if(completed||!enabled||!player?.active||player.suspended||document.hidden||player.state.mode!=='walk'||player.state.waterMode&&player.state.waterMode!=='dry'){root.hidden=true;progress.pause();return;}
    if(now-last<100)return;last=now;progress.sample(player.state,getHeading());
    const stage=progress.stage,touch=document.body.classList.contains('touch-controls');
    if(stage==='done'){endAt??=now+6500;if(now>endAt){skip();return;}}
    root.hidden=false;root.dataset.stage=stage;
    root.querySelector('span').textContent=stage==='look'?'初次探索 1 / 2':stage==='walk'?'初次探索 2 / 2':'准备好出发了';
    root.querySelector('strong').textContent=stage==='look'?'先看看周围':stage==='walk'?'向前走几步':'想去哪里，打开地图看看';
    root.querySelector('p').textContent=stage==='look'?(touch?'在画面右侧拖动，转动视角。':'移动鼠标环视。中键或 L 可锁定鼠标。'):stage==='walk'?(touch?'在画面左侧拖动移动，松手停下。':'WASD 移动，按住 Shift 跑步。'):(touch?'点击右上角「地图」，选择校园地标。':'按 M 打开校园地图，靠近物品时按 F 使用。');
    root.querySelector('button').textContent=stage==='done'?'知道了':'跳过';
  }
  return {tick,dispose(){if(disposed)return;disposed=true;root.querySelector('button').removeEventListener('click',skip);again.removeEventListener('click',replay);root.remove();again.remove();}};
}
