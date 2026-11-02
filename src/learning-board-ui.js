import {createClientId} from './browser-compat.js';
import {LEARNING_BOARD} from './activity-catalog.js';
import {createLearningBoardScene} from './learning-board-scene.js';
import './learning-board-ui.css';

export function createLearningBoardExperience({THREE,scene,camera,canvas,root,getPlayer,getAudience,onOpenChange,invalidate,notify}) {
  const physical=createLearningBoardScene(THREE);scene.add(physical.group);
  const marker=document.createElement('button');marker.type='button';marker.className='live-map-label learning-board-marker';marker.textContent='操场中央 · 留言板';marker.hidden=true;
  const prompt=document.createElement('button');prompt.type='button';prompt.className='live-portal-prompt learning-board-prompt';prompt.hidden=true;
  prompt.innerHTML='<span>操场留言板</span><strong>给我们留言</strong><small>Enter / 点击留言</small>';
  const panel=document.createElement('section');panel.className='learning-board-overlay';panel.hidden=true;
  panel.innerHTML=`<div class="learning-board-dialog" role="dialog" aria-modal="true" aria-labelledby="learning-board-title" tabindex="-1">
    <button type="button" class="learning-board-close" aria-label="关闭留言板">×</button>
    <span class="learning-board-eyebrow">东操场 · 留言板</span>
    <h2 id="learning-board-title">给我们留言</h2>
    <p class="learning-board-intro">问题、建议、想法，都可以在这里告诉我们。</p>
    <form><label for="learning-board-text">留言内容</label>
      <textarea id="learning-board-text" rows="4" required placeholder="对活动有什么建议？遇到了什么问题？或者，有什么想告诉我们？" aria-describedby="learning-board-count learning-board-visibility"></textarea>
      <div class="learning-board-meta"><span class="learning-board-nickname"></span><span id="learning-board-count">0 / 300 字</span></div>
      <p id="learning-board-visibility">留言仅你和主持人可见。</p>
      <button type="submit" class="learning-board-submit">提交留言 <span aria-hidden="true">↗</span></button>
      <p class="learning-board-status" role="status" aria-live="polite"></p>
    </form>
    <details class="learning-board-history"><summary>我留下的留言 <span></span></summary><div class="learning-board-history-list"></div></details>
    <footer>Esc 返回校园 · 输入时角色会留在原地</footer>
  </div>`;
  root.append(marker,prompt,panel);
  const $=s=>panel.querySelector(s),form=$('form'),textarea=$('textarea'),submit=$('.learning-board-submit'),dialog=$('[role=dialog]'),status=$('.learning-board-status'),history=$('.learning-board-history-list');
  const projected=new THREE.Vector3();
  let open=false,nearby=false,disposed=false,busy=false,loading=false,generation=0,lastPoll=0;
  let state={paused:false,connected:false,registered:false,portalOpen:false},draftKey='',pending=null,messages=[];
  const currentPosition=()=>{const p=getPlayer()?.state;return p?{x:p.x,y:p.y,z:p.z}:null;};
  function showStatus(text,error=false){status.textContent=text;status.dataset.error=String(error);}
  function storeDraft(){if(draftKey)try{sessionStorage.setItem(draftKey,JSON.stringify({text:textarea.value,pending}));}catch{}}
  function updateForm(){
    const count=[...textarea.value.trim()].length;
    $('#learning-board-count').textContent=`${count} / 300 字`;
    $('#learning-board-count').dataset.exceeded=String(count>300);
    textarea.readOnly=busy||!!pending;
    submit.disabled=busy||state.paused||!state.connected||count<1||count>300;
    submit.textContent=busy?'正在提交…':pending?'确认提交结果':'提交留言 ↗';
  }
  function accepted(){
    pending=null;textarea.value='';storeDraft();updateForm();
    showStatus('已提交，主持人可以在后台看到。');
    if(open&&!state.paused)textarea.focus({preventScroll:true});
  }
  function drawHistory(){
    history.replaceChildren();$('.learning-board-history summary span').textContent=messages.length?`（${messages.length}）`:'';
    if(!messages.length){const empty=document.createElement('p');empty.textContent='还没有留言。有什么想说的，就从这里写下吧。';history.append(empty);return;}
    for(const message of messages){
      const article=document.createElement('article'),text=document.createElement('p'),time=document.createElement('time');
      text.textContent=message.text;time.dateTime=new Date(message.createdAt).toISOString();
      time.textContent=new Date(message.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      article.append(text,time);history.append(article);
    }
  }
  async function syncOwn(){
    if(loading||disposed||!open)return;loading=true;const version=generation;
    try{
      const data=await getAudience().learningRequests();
      if(disposed||version!==generation)return;
      messages=data.messages;drawHistory();
      if(pending&&messages.some(m=>m.id===pending.eventId))accepted();
    }catch(error){
      if(disposed||version!==generation)return;
      if(!messages.length){history.replaceChildren();const note=document.createElement('p');note.textContent=`暂时无法读取之前的留言：${error.message}`;history.append(note);}
    }finally{loading=false;}
  }
  function tryOpen(){
    if(open||disposed)return;
    if(!state.registered)return notify('请先填写昵称参与活动');
    if(state.paused||state.portalOpen)return;
    if(!nearby)return notify('请走到东操场中央，靠近留言板后再留言。');
    const identity=getAudience().identity;
    draftKey=`campus-learning-draft-v1:${identity.id}`;pending=null;textarea.value='';messages=[];
    try{const saved=JSON.parse(sessionStorage.getItem(draftKey));if(saved){textarea.value=typeof saved.text==='string'?saved.text:'';pending=saved.pending?.eventId?saved.pending:null;}}catch{}
    $('.learning-board-nickname').textContent=`以「${identity.nickname}」的名义留言`;
    open=true;generation++;panel.hidden=false;marker.hidden=true;prompt.hidden=true;root.classList.add('has-learning-board');
    document.exitPointerLock?.();onOpenChange();updateForm();drawHistory();
    showStatus(pending?'上次留言尚未确认，正在查询提交结果。':'');
    textarea.focus({preventScroll:true});syncOwn();invalidate();
  }
  function close(){
    if(!open)return;storeDraft();open=false;generation++;panel.hidden=true;root.classList.remove('has-learning-board');onOpenChange();invalidate();
    if(!state.paused)canvas.focus({preventScroll:true});
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||disposed||!open)return;
    if(!state.connected)return showStatus('活动连接中断，内容已保留。恢复连接后再提交。',true);
    if(state.paused)return showStatus('活动暂停中，恢复后可继续留言。',true);
    const text=textarea.value.trim();if(!text||[...text].length>300)return showStatus('请填写 1–300 字的留言。',true);
    if(!pending)pending={eventId:createClientId(),text,position:currentPosition()};
    const delivery=pending,version=generation;
    storeDraft();busy=true;updateForm();showStatus('正在把留言交给主持人…');
    try{
      // Reuse the same ID after a lost response. The shared delivery queue also
      // retries that ID, so a manual retry never creates a second message.
      await getAudience().event('learning_request',delivery,{required:true});
      if(disposed)return;
      if(version===generation){accepted();await syncOwn();}
    }catch(error){
      if(disposed||version!==generation)return;
      // History polling may confirm the write before a delayed POST times out.
      if(pending?.eventId!==delivery.eventId)return;
      const retryable=!error.status||error.status>=500||[401,408,429].includes(error.status)||(error.status===409&&/其他窗口正在更新/.test(error.message))||(error.status===403&&/令牌/.test(error.message));
      if(!retryable)pending=null;
      storeDraft();showStatus(retryable?`${error.message}。留言尚未确认，内容已保留，会用同一条记录重试。`:error.message,true);
    }finally{
      busy=false;if(!disposed&&version===generation)updateForm();
    }
  });
  textarea.addEventListener('input',()=>{storeDraft();updateForm();});
  $('.learning-board-close').addEventListener('click',close);prompt.addEventListener('click',tryOpen);marker.addEventListener('click',tryOpen);
  panel.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key==='Tab'){
      const focusable=[...dialog.querySelectorAll('button:not(:disabled),textarea,summary')],first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  // Disabling a focused submit button can temporarily move focus to <body>.
  // Escape must still close the dialog in that state, including during a request.
  const escape=event=>{if(open&&event.key==='Escape'&&!state.paused){event.preventDefault();event.stopPropagation();close();}};
  window.addEventListener('keydown',escape,true);
  const timer=setInterval(()=>{if(open&&Date.now()-lastPoll>5000){lastPoll=Date.now();syncOwn();}},1000);
  return {
    get isOpen(){return open;},get nearby(){return nearby;},tryOpen,
    refresh(next){
      const wasPaused=state.paused;state=next;
      const p=currentPosition();nearby=!!getPlayer()?.active&&!!p&&p.y>=-2&&p.y<=LEARNING_BOARD.maxPlayerY&&Math.hypot(p.x-LEARNING_BOARD.x,p.z-LEARNING_BOARD.z)<=LEARNING_BOARD.radius;
      prompt.hidden=open||!nearby||!state.registered||state.paused||state.portalOpen;
      panel.inert=state.paused;updateForm();
      if(open&&!state.registered)close();
      if(open&&wasPaused&&!state.paused)textarea.focus({preventScroll:true});
    },
    tick(){
      if(disposed)return;
      const distance=camera.position.distanceTo(physical.group.position);
      projected.set(LEARNING_BOARD.x,LEARNING_BOARD.y+4.6,LEARNING_BOARD.z).project(camera);
      marker.hidden=open||state.paused||state.portalOpen||!state.registered||nearby||distance>600||projected.z>1||projected.z< -1||Math.abs(projected.x)>1||Math.abs(projected.y)>1;
      marker.style.left=`${(projected.x*.5+.5)*canvas.clientWidth}px`;marker.style.top=`${(-projected.y*.5+.5)*canvas.clientHeight}px`;
    },
    dispose(){disposed=true;generation++;clearInterval(timer);window.removeEventListener('keydown',escape,true);storeDraft();physical.dispose();marker.remove();prompt.remove();panel.remove();root.classList.remove('has-learning-board');},
  };
}
