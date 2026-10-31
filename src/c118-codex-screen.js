import {createLocalCodexConversation} from './c118-codex-conversation.js';
import './c118-codex-screen.css';

export function createC118CodexScreen({THREE,screen,document=globalThis.document,onOpenChange=()=>{}}){
  const conversation=createLocalCodexConversation(),canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1152;
  const ctx=canvas.getContext('2d'),texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;
  const baseScale=screen.scale.clone();let enabled=false,disposed=false,opened=false,returnFocus=null;
  const dialog=document.createElement('dialog');dialog.className='hall-codex';dialog.setAttribute('aria-label','Codex');
  dialog.innerHTML=`<div class="hc-windowbar"><span class="hc-lights"><i></i><i></i><i></i></span><span>▱　C118</span><button type="button" class="hc-close" aria-label="返回报告厅">关闭</button></div><div class="hc-shell"><div class="hc-rail" aria-hidden="true">⌂<br>▱<br>◷</div><div class="hc-sidebar"><h2>Codex</h2><p>＋　新聊天</p><small>项目</small><p>▱　AI 俱乐部</p><small>最近聊天</small><p class="hc-thread">C118 报告厅</p></div><main class="hc-chat"><div class="hc-messages" aria-live="polite"></div><form class="hc-composer"><textarea rows="2" maxlength="2000" placeholder="和 Codex 一起工作" aria-label="回复 Codex"></textarea><div class="hc-toolbar"><span>＋　 默认权限</span><span>GPT-6.1 Sol　 高　 <button type="submit" aria-label="发送回复">↑</button></span></div></form><div class="hc-meta">本地<span>main</span></div></main></div>`;
  document.body.append(dialog);const messages=dialog.querySelector('.hc-messages'),input=dialog.querySelector('textarea'),form=dialog.querySelector('form');
  const font=(size,bold=false)=>{ctx.font=`${bold?'500':'400'} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;};
  function text(s,x,y,size=26,color='#242424',bold=false){font(size,bold);ctx.fillStyle=color;ctx.fillText(s,x,y);}
  function box(x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();ctx.fill();}
  function lines(value,maxWidth,size){font(size);const result=[];for(const paragraph of value.split('\n')){let line='';for(const char of paragraph){if(ctx.measureText(line+char).width>maxWidth){result.push(line);line='';}line+=char;}result.push(line);}return result;}
  function paint(){
    if(disposed)return;ctx.fillStyle='#fff';ctx.fillRect(0,0,2048,1152);ctx.fillStyle='#f9f9f9';ctx.fillRect(0,0,470,1152);ctx.fillStyle='#f4f4f4';ctx.fillRect(0,0,76,1152);
    for(const [i,color]of ['#ff5f57','#febc2e','#28c840'].entries())box(22+i*28,22,18,18,9,color);
    text('▱   C118',910,43,22,'#666');text('⌂',24,120,30);text('▱',24,200,30);text('◷',24,280,30);
    text('Codex',110,122,35,'#242424',true);text('＋   新聊天',110,199,27);text('项目',110,290,22,'#8b8c8e');text('▱   AI 俱乐部',110,345,27);text('最近聊天',110,442,22,'#8b8c8e');box(96,468,354,58,26,'#eaeaea');text('C118 报告厅',119,506,26);
    box(574,906,1370,170,28,'#f5f5f5');text('和 Codex 一起工作',608,963,28,'#929292');text('＋    默认权限',608,1041,23,'#666');text('GPT-6.1 Sol    高',1570,1041,23,'#666');box(1870,1007,46,46,23,'#242424');text('↑',1881,1040,30,'#fff');text('本地',590,1120,21,'#8b8c8e');text('main',1858,1120,21,'#8b8c8e');
    const items=conversation.messages;
    if(!items.length){text('我们来构建点什么？',1000,480,42,'#242424',true);}else{
      // Lay out from the bottom so the latest host text and local reply always
      // remain visible; a clipping window prevents long text entering chrome.
      let y=856;const blocks=[];
      for(const item of [...items].reverse()){
        const wrapped=lines(item.text,1160,34),visible=wrapped.slice(-15),height=visible.length*51+65;
        blocks.unshift({item,wrapped:visible,y:y-height});y-=height;if(y<0)break;
      }
      ctx.save();ctx.beginPath();ctx.rect(535,92,1460,788);ctx.clip();
      for(const {item,wrapped,y}of blocks){const user=item.role==='user';if(user)box(700,y,1230,wrapped.length*51+38,22,'#f1f1f1');text(user?'你':'Codex',user?727:590,y+32,22,'#8b8c8e');wrapped.forEach((s,i)=>text(s,user?727:590,y+78+i*51,34));}ctx.restore();
    }
    texture.needsUpdate=true;if(enabled){screen.scale.copy(baseScale);screen.material.map=texture;screen.material.needsUpdate=true;screen.visible=true;}
  }
  function render(){messages.replaceChildren();if(!conversation.messages.length){const welcome=document.createElement('h1');welcome.textContent='我们来构建点什么？';messages.append(welcome);}
    for(const item of conversation.messages){const article=document.createElement('article');article.className=item.role==='user'?'hc-user':'hc-assistant';const role=document.createElement('small');role.textContent=item.role==='user'?'你':'Codex';const body=document.createElement('p');body.textContent=item.text;article.append(role,body);messages.append(article);}messages.scrollTop=messages.scrollHeight;paint();}
  function open(){if(disposed||!enabled||opened)return;opened=true;returnFocus=document.activeElement;dialog.showModal();onOpenChange(true);input.focus();}
  function closed(){if(!opened)return;opened=false;onOpenChange(false);returnFocus?.focus?.({preventScroll:true});}
  function close(){if(opened)dialog.close();}
  const submit=event=>{event.preventDefault();if(conversation.reply(input.value)){input.value='';render();input.focus();}};
  const key=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit();}};
  form.addEventListener('submit',submit);input.addEventListener('keydown',key);dialog.querySelector('.hc-close').addEventListener('click',close);dialog.addEventListener('close',closed);
  render();return {
    get isOpen(){return opened;},open,close,
    select(state){const active=state?.mediaId==='codex',wasEnabled=enabled;enabled=active;if(!active)close();if(active&&(conversation.accept(state)||!wasEnabled))render();},
    dispose(){if(disposed)return;close();disposed=true;dialog.remove();texture.dispose();if(screen.material.map===texture){screen.material.map=null;screen.material.needsUpdate=true;}},
  };
}
