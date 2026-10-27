import {createAudienceClient} from './audience-client.js';
import './audience-ui.css';
export function mountAudienceUI(root,{onChange=()=>{}}={}){
  const panel=document.createElement('section');panel.className='audience-welcome';panel.setAttribute('aria-label','加入校园活动');
  panel.innerHTML=`<form><span class="audience-eyebrow">华科东校区 · 互动作品漫游</span><h2>给这次漫游<br>留下一个名字</h2><p>输入昵称即可出发。主持人能看到你的到访地点与作品打开记录。</p><label for="audience-nickname">你的昵称</label><input id="audience-nickname" name="nickname" required maxlength="24" autocomplete="nickname" placeholder="例如：喻园旅人"><button type="submit">进入校园 <span>↗</span></button><small class="audience-error" role="status">正在连接活动服务…</small><footer>同名观众也会独立记录；刷新不会丢失身份。<br>无需手机号、照片或账号。</footer></form>`;
  const badge=document.createElement('div');badge.className='audience-badge';badge.hidden=true;
  const phase=document.createElement('div');phase.className='audience-phase';phase.innerHTML='<strong></strong><span></span>';
  root.append(panel,badge,phase);
  let registered=false;
  const client=createAudienceClient({onIdentity(person){registered=!!person;panel.hidden=registered;badge.hidden=!registered;badge.textContent=person?`${person.nickname} · 校园漫游`:'';panel.querySelector('.audience-error').textContent='';onChange(registered);},onError(message){panel.querySelector('.audience-error').textContent=message;badge.title=message;}});
  panel.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const button=panel.querySelector('button');button.disabled=true;try{await client.join(panel.querySelector('input').value.trim());}catch(e){panel.querySelector('.audience-error').textContent=e.message;}finally{button.disabled=false;}});
  return {client,get registered(){return registered;},phase(value){phase.querySelector('strong').textContent=value?.label||'自由探索';phase.querySelector('span').textContent=value?.guidance||'';},dispose(){client.dispose();panel.remove();badge.remove();phase.remove();}};
}
