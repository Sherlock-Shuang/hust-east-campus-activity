import {createLocalCodexConversation} from './c118-codex-conversation.js';
import {CODEX_VIEW,paintC118Codex} from './c118-codex-painter.js';
import {CODEX_ICONS} from './c118-codex-icons.js';
import {c118CodexActionAt} from './c118-codex-actions.js';

export function createC118CodexScreen({THREE,screen,document=globalThis.document,onOpenChange=()=>{},onInvalidate=()=>{}}){
  const conversation=createLocalCodexConversation(),canvas=document.createElement('canvas');
  canvas.width=CODEX_VIEW.width*CODEX_VIEW.ratio;canvas.height=CODEX_VIEW.height*CODEX_VIEW.ratio;
  const ctx=canvas.getContext('2d'),texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
  const baseScale=screen.scale.clone(),icons=new Map();let enabled=false,disposed=false,opened=false,returnFocus=null;
  // Only a compact reply composer is overlaid. The Codex app itself stays on
  // the stage's existing video surface, including while a player types.
  const dialog=document.createElement('dialog');dialog.className='hall-codex-reply';dialog.setAttribute('aria-label','回复报告厅大屏');
  dialog.innerHTML=`<form class="hc-reply-form"><div class="hc-reply-heading"><span>回复大屏</span><output class="hc-reply-status" aria-live="polite"></output><button type="button" class="hc-new-chat">新聊天</button><button type="button" class="hc-close" aria-label="收起回复框">${CODEX_ICONS.chevronDown}</button></div><textarea rows="2" maxlength="2000" placeholder="和 Codex 一起工作" aria-label="回复 Codex"></textarea><div class="hc-reply-toolbar"><span class="hc-permission">${CODEX_ICONS.plus}${CODEX_ICONS.shield}<span>默认权限</span></span><span class="hc-reply-model">GPT-6.1 Sol <span>高</span><button type="submit" aria-label="发送回复" disabled>${CODEX_ICONS.arrowUp}</button></span></div></form>`;
  document.body.append(dialog);const input=dialog.querySelector('textarea'),form=dialog.querySelector('form'),send=dialog.querySelector('[type="submit"]'),replyStatus=dialog.querySelector('output');
  function icon(name,x,y,size,color){
    const key=`${name}:${color}`;let image=icons.get(key);
    if(!image){
      image=document.createElement('img');icons.set(key,image);
      image.onload=()=>{if(!disposed&&enabled)paint();};
      image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(CODEX_ICONS[name].replace('<svg ',`<svg style="color:${color}" `));
    }
    if(image.complete&&image.naturalWidth)ctx.drawImage(image,x,y,size,size);
  }
  function present(){
    if(!enabled||disposed)return;
    const {width,height}=screen.geometry.parameters,aspect=CODEX_VIEW.width/CODEX_VIEW.height,available=width*Math.abs(baseScale.x)/(height*Math.abs(baseScale.y));
    // Same fit as a 16:9 film on this exact mesh, preserving world position,
    // geometry, rotation, material and the original frame's letterboxing.
    screen.scale.set(baseScale.x*Math.min(1,aspect/available),baseScale.y*Math.min(1,available/aspect),baseScale.z);
    screen.material.map=texture;screen.material.needsUpdate=true;screen.visible=true;
  }
  function paint(){if(disposed)return;paintC118Codex(ctx,{messages:conversation.messages,draft:input.value,icon});texture.needsUpdate=true;present();onInvalidate();}
  function open(){if(disposed||!enabled)return;if(opened){input.focus();return;}opened=true;returnFocus=document.activeElement;dialog.show();onOpenChange(true);input.focus();paint();}
  function closed(){if(!opened)return;opened=false;onOpenChange(false);returnFocus?.focus?.({preventScroll:true});paint();}
  function close(){if(opened){dialog.close();closed();}}
  function submitReply(){if(disposed||!enabled)return false;if(!conversation.reply(input.value)){open();return false;}input.value='';send.disabled=true;replyStatus.textContent='已显示在你的大屏';paint();input.focus();return true;}
  function newChat(){if(disposed||!enabled)return;conversation.clear();input.value='';send.disabled=true;replyStatus.textContent='';paint();open();}
  const submit=event=>{event.preventDefault();submitReply();};
  const key=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit();}};
  const inputChanged=()=>{send.disabled=!input.value.trim();replyStatus.textContent='';paint();};
  form.addEventListener('submit',submit);input.addEventListener('keydown',key);input.addEventListener('input',inputChanged);
  dialog.querySelector('.hc-close').addEventListener('click',close);dialog.addEventListener('close',closed);
  dialog.querySelector('.hc-new-chat').addEventListener('click',newChat);
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});
  return {
    get isOpen(){return opened;},open,close,newChat,
    activate(uv){
      if(disposed||!enabled)return false;
      const action=c118CodexActionAt(uv);if(!action)return false;
      if(action.type==='new-chat')newChat();
      else if(action.type==='send')submitReply();
      else if(action.type==='suggest'&&!conversation.messages.length){input.value=action.text;inputChanged();open();}
      else if(action.type==='compose')open();else return false;
      return true;
    },
    select(state){
      const active=state?.mediaId==='codex',wasEnabled=enabled;enabled=active;
      if(!active){close();return;}
      if(conversation.accept(state)||!wasEnabled)paint();else present();
    },
    dispose(){if(disposed)return;close();conversation.clear();input.value='';disposed=true;enabled=false;dialog.remove();for(const image of icons.values())image.onload=null;icons.clear();texture.dispose();if(screen.material.map===texture){screen.material.map=null;screen.material.needsUpdate=true;}},
  };
}
