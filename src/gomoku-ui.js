import {createClientId} from './browser-compat.js';
import {GOMOKU_POINT,nearGomoku} from './gomoku-rules.js';
import {createGomokuScene} from './gomoku-scene.js';
import './gomoku.css';
export function createGomokuExperience({THREE,scene,camera,canvas,root,getPlayer,getAudience,onOpenChange,invalidate,notify}){
  const art=createGomokuScene(THREE);scene.add(art.group);invalidate();
  const marker=document.createElement('button');marker.className='live-map-label gomoku-marker';marker.textContent='五子棋';marker.hidden=true;root.querySelector('.live-marker-labels').append(marker);
  const prompt=document.createElement('button');prompt.className='live-portal-prompt gomoku-prompt';prompt.hidden=true;prompt.innerHTML='<span>操场棋桌</span><strong>来下五子棋</strong><small>Enter / 点击加入</small>';
  const resume=document.createElement('button');resume.className='gomoku-resume';resume.hidden=true;
  const panel=document.createElement('section');panel.className='gomoku-overlay';panel.hidden=true;
  panel.innerHTML=`<div class="gomoku-dialog" role="dialog" aria-modal="true" aria-labelledby="gomoku-title">
    <header><div><h2 id="gomoku-title">操场五子棋</h2><p>两人一局，先连成五子获胜，无禁手。</p></div><button class="gomoku-close" aria-label="收起五子棋">收起</button></header>
    <div class="gomoku-layout"><div class="gomoku-board" role="grid" aria-label="十五路五子棋棋盘"></div>
    <aside class="gomoku-side"><p class="gomoku-state" role="status" aria-live="polite"></p><div class="gomoku-players"><p><i class="gomoku-stone black"></i><span class="gomoku-black">黑棋</span></p><p><i class="gomoku-stone white"></i><span class="gomoku-white">白棋</span></p></div>
    <p class="gomoku-detail"></p><p class="gomoku-error" role="alert"></p><button class="gomoku-join">加入对局</button><button class="gomoku-leave" hidden>取消等待</button><small>自动两两配对。暂时断线可回来继续；超过 90 秒未恢复，结束本局。</small></aside></div></div>`;
  root.append(prompt,resume,panel);
  const $=s=>panel.querySelector(s),board=$('.gomoku-board'),stateLabel=$('.gomoku-state'),detail=$('.gomoku-detail'),errorLabel=$('.gomoku-error'),join=$('.gomoku-join'),leave=$('.gomoku-leave');
  let open=false,disposed=false,busy=false,reading=false,beating=false,epoch=0,connected=true,nearby=false,bootstrapped=false,timer,heartbeatTimer,focusedCell=112,lastSignature='';
  let data={game:null,waiting:false,waitingCount:0,serverTime:Date.now()},state={paused:false,registered:false,blocked:true};
  const buttons=[];
  for(let row=0;row<15;row++){
    const line=document.createElement('div');line.className='gomoku-row';line.setAttribute('role','row');board.append(line);
    for(let col=0;col<15;col++){
      const cell=row*15+col,button=document.createElement('button');button.type='button';button.className='gomoku-cell';button.dataset.cell=cell;button.setAttribute('role','gridcell');button.tabIndex=cell===focusedCell?0:-1;
      if(row===0)button.classList.add('top');if(row===14)button.classList.add('bottom');if(col===0)button.classList.add('left');if(col===14)button.classList.add('right');
      button.innerHTML='<span class="gomoku-stone"></span>';line.append(button);buttons.push(button);
      button.addEventListener('click',()=>move(cell));
      button.addEventListener('focus',()=>{buttons[focusedCell].tabIndex=-1;focusedCell=cell;button.tabIndex=0;});
      button.addEventListener('keydown',event=>{const deltas={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},d=deltas[event.key];if(!d)return;event.preventDefault();buttons[Math.max(0,Math.min(14,row+d[1]))*15+Math.max(0,Math.min(14,col+d[0]))].focus();});
    }
  }
  const active=()=>data.waiting||data.game?.status==='playing';
  function paint(){
    if(disposed)return;
    const game=data.game,playing=game?.status==='playing',mine=playing&&game.turn===game.you;
    const signature=JSON.stringify([game,data.waiting,data.waitingCount,open,busy,state.paused,state.blocked,state.registered,connected,nearby]);
    if(signature===lastSignature)return;lastSignature=signature;
    resume.hidden=open||state.blocked||!active();resume.textContent=data.waiting?'五子棋 · 等待配对':'五子棋 · 继续对局';
    stateLabel.textContent=state.paused?'活动暂停，稍后继续':!connected?'连接中断，正在重连…':data.waiting?'等待另一位同学…':!game?'找个对手，下盘棋':playing?(mine?'轮到你了':`等待${game.turn===1?'黑棋':'白棋'}落子`):game.status==='draw'?'本局和棋':game.winner===game.you?'你赢了！':'本局结束，对手获胜';
    $('.gomoku-black').textContent=game?`${game.blackName}${game.you===1?'（你）':''}`:'黑棋先手';
    $('.gomoku-white').textContent=game?`${game.whiteName}${game.you===2?'（你）':''}`:'白棋后手';
    detail.textContent=game?(playing?`你执${game.you===1?'黑':'白'}棋 · 已落 ${game.moves.length} 子`:game.reason==='disconnect'?'对手断线超过 90 秒。':game.reason==='resign'?'有玩家认输离开。':game.reason==='abandoned'?'双方离线，本局结束。':game.status==='draw'?'棋盘已满。':'五子连线，胜负已定。'):data.waiting?`已有 ${data.waitingCount} 人等待，有两人即可开局。`:'加入后自动配对；4 人可同时开两局。';
    join.hidden=playing||data.waiting;join.textContent=game?'再来一局':'加入对局';join.disabled=busy||state.paused||!connected||!nearby;
    leave.hidden=!data.waiting&&!game;leave.textContent=playing?'认输并离开':data.waiting?'取消等待':'离开棋桌';leave.disabled=busy;
    const last=game?.moves.at(-1)?.cell;
    buttons.forEach((button,cell)=>{const value=Number(game?.board[cell]||0),stone=button.firstElementChild;stone.className=`gomoku-stone ${value===1?'black':value===2?'white':''}`;button.classList.toggle('last',cell===last);button.classList.toggle('winning',!!game?.line.includes(cell));button.setAttribute('aria-disabled',String(!mine||state.paused||busy||!connected||value!==0));button.setAttribute('aria-label',`第 ${Math.floor(cell/15)+1} 行，第 ${cell%15+1} 列，${value===1?'黑子':value===2?'白子':'空位'}`);});
  }
  function accept(next){if(disposed)return;if(next.game?.id===data.game?.id&&next.game?.revision<data.game?.revision)return;data=next;connected=true;paint();}
  function schedule(){clearTimeout(timer);if(!disposed&&(open||active()))timer=setTimeout(poll,1800+Math.random()*400);}
  async function poll(){
    if(disposed||reading||beating||busy||!state.registered||document.hidden){schedule();return;}
    reading=true;const generation=epoch;try{const next=await getAudience().gomoku();if(generation===epoch){accept(next);errorLabel.textContent='';}}catch(e){if(generation===epoch&&!disposed){connected=false;errorLabel.textContent=e.message;paint();}}finally{reading=false;schedule();}
  }
  async function act(input){
    if(disposed||busy)return false;busy=true;epoch++;errorLabel.textContent='';paint();
    try{accept(await getAudience().gomoku(input));return true;}
    catch(e){errorLabel.textContent=e.message;if(!e.status||e.status>=500)connected=false;return false;}
    finally{busy=false;paint();schedule();}
  }
  async function beat(){
    if(disposed)return;
    if(active()&&!busy&&!reading&&!beating){beating=true;const generation=epoch;try{const next=await getAudience().gomoku({action:'heartbeat'});if(generation===epoch)accept(next);}catch(e){if(generation===epoch&&!disposed){connected=false;errorLabel.textContent=e.message;paint();}}finally{beating=false;}}
    clearTimeout(heartbeatTimer);if(!disposed)heartbeatTimer=setTimeout(beat,10000+Math.random()*1000);
  }
  function tryOpen(){
    if(state.blocked||state.paused||!state.registered)return;
    if(!nearby&&!active())return notify('请走到操场五子棋桌旁加入。');
    open=true;panel.hidden=false;prompt.hidden=true;onOpenChange();paint();poll();$('.gomoku-close').focus();
  }
  function close(){open=false;panel.hidden=true;onOpenChange();paint();if(!state.paused)canvas.focus({preventScroll:true});}
  async function move(cell){const game=data.game;if(!open||state.paused||busy||!connected||!game||game.status!=='playing'||game.turn!==game.you||game.board[cell]!=='0')return;await act({action:'move',gameId:game.id,expectedRevision:game.revision,moveId:createClientId(),cell});}
  join.addEventListener('click',()=>act({action:'join',position:getPlayer()?.state&&{x:getPlayer().state.x,y:getPlayer().state.y,z:getPlayer().state.z}}));
  leave.addEventListener('click',async()=>{if(await act({action:'leave',gameId:data.game?.id??null})){close();}});
  $('.gomoku-close').addEventListener('click',close);marker.addEventListener('click',tryOpen);prompt.addEventListener('click',tryOpen);resume.addEventListener('click',tryOpen);
  panel.addEventListener('keydown',event=>{
    event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Tab'){const focusable=[...panel.querySelectorAll('button:not(:disabled)')].filter(el=>!el.hidden&&el.tabIndex>=0),first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  });
  const resumed=()=>{if(!document.hidden){poll();if(active())beat();}};
  window.addEventListener('online',resumed);document.addEventListener('visibilitychange',resumed);
  const point=new THREE.Vector3();heartbeatTimer=setTimeout(beat,10000);
  return {get isOpen(){return open;},get nearby(){return nearby;},tryOpen,
    refresh(next){state=next;nearby=nearGomoku(getPlayer()?.state);prompt.hidden=open||state.blocked||state.paused||!state.registered||!nearby;if(state.registered&&!bootstrapped){bootstrapped=true;poll();}paint();},
    tick(){const visible=!state.blocked&&!state.paused&&state.registered&&!open&&!document.hidden;point.set(GOMOKU_POINT.x,5.8,GOMOKU_POINT.z).project(camera);marker.hidden=!visible||point.z< -1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1;if(!marker.hidden){marker.style.left=`${(point.x*.5+.5)*canvas.clientWidth}px`;marker.style.top=`${(-point.y*.5+.5)*canvas.clientHeight}px`;}},
    dispose(){disposed=true;clearTimeout(timer);clearTimeout(heartbeatTimer);window.removeEventListener('online',resumed);document.removeEventListener('visibilitychange',resumed);art.dispose();marker.remove();prompt.remove();resume.remove();panel.remove();},
  };
}
