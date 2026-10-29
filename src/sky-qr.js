import './sky-qr.css';
import {LEARNING_BOARD} from './activity-catalog.js';

export const SKY_QR_IMAGE = '/images/activity/wechat-qr-cutout.png';
export const SKY_QR_PLACEMENT = Object.freeze({x:LEARNING_BOARD.x,y:2400,z:LEARNING_BOARD.z,size:1200});

// A fixed, downward-facing sky panel above the sports field. Its world pose and
// metre-scale size never depend on the viewer, camera heading, or screen size.
export function createSkyQrExperience({THREE,scene,root,invalidate,onOpenChange}) {
  const group=new THREE.Group();group.name='activity-sky-qr';group.visible=false;scene.add(group);
  group.position.set(SKY_QR_PLACEMENT.x,SKY_QR_PLACEMENT.y,SKY_QR_PLACEMENT.z);
  group.rotation.x=Math.PI/2;
  const material=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,depthTest:true,depthWrite:false,toneMapped:false,fog:false});
  const geometry=new THREE.PlaneGeometry(1,1),poster=new THREE.Mesh(geometry,material);
  // A plain quiet zone under the alpha image keeps the code readable against sky.
  const backingMaterial=new THREE.MeshBasicMaterial({color:0xffffff,depthTest:true,depthWrite:true,toneMapped:false,fog:false});
  const backing=new THREE.Mesh(geometry,backingMaterial);backing.position.z=-.2;
  poster.scale.set(SKY_QR_PLACEMENT.size,SKY_QR_PLACEMENT.size,1);backing.scale.copy(poster.scale);
  group.add(backing,poster);group.updateMatrixWorld(true);
  const button=document.createElement('button');button.type='button';button.className='sky-qr-open';button.hidden=true;
  button.innerHTML='<span>抬头扫码添加微信</span><strong>查看原图 ↗</strong>';
  const overlay=document.createElement('section');overlay.className='sky-qr-overlay';overlay.hidden=true;
  overlay.innerHTML=`<div class="sky-qr-dialog" role="dialog" aria-modal="true" aria-label="微信二维码原图" tabindex="-1">
    <div class="sky-qr-dialog-header"><span>扫码添加微信</span><button class="sky-qr-close" type="button" aria-label="关闭二维码原图">关闭 ×</button></div>
    <img class="sky-qr-image" alt="Sherlock 的微信二维码，扫码添加好友" width="1254" height="1254">
    <div class="sky-qr-dialog-footer">手机可长按图片识别或保存<a href="${SKY_QR_IMAGE}" target="_blank" rel="noopener">打开原图 ↗</a></div>
  </div>`;
  root.append(button,overlay);
  const dialog=overlay.querySelector('[role=dialog]'),image=overlay.querySelector('img'),closeButton=overlay.querySelector('button');
  let enabled=false,open=false,disposed=false,loading=false,failed=false,texture=null,portalOpen=false,previousFocus=null;
  const status=()=>{
    root.dataset.skyQrVisible=String(enabled);root.dataset.skyQrState=!enabled?'hidden':texture?'ready':failed?'error':'loading';
    button.querySelector('span').textContent=failed?'天空图片暂未加载':enabled&&!texture?'正在加载天空二维码…':'抬头扫码添加微信';
    button.querySelector('strong').textContent=failed?'查看原图 / 重试':'查看原图 ↗';
  };
  function close(){
    if(!open)return;open=false;overlay.hidden=true;root.classList.remove('is-sky-qr-open');onOpenChange();invalidate();
    if(previousFocus?.isConnected&&!previousFocus.closest('[hidden]'))previousFocus.focus({preventScroll:true});
  }
  function load(){
    if(disposed||loading||texture)return;
    loading=true;failed=false;status();
    new THREE.TextureLoader().load(SKY_QR_IMAGE,loaded=>{
      if(disposed){loaded.dispose();return;}
      loading=false;texture=loaded;
      poster.scale.x=SKY_QR_PLACEMENT.size*loaded.image.width/loaded.image.height;backing.scale.copy(poster.scale);
      loaded.colorSpace=THREE.SRGBColorSpace;loaded.generateMipmaps=false;
      loaded.minFilter=THREE.LinearFilter;loaded.magFilter=THREE.LinearFilter;
      material.map=loaded;material.needsUpdate=true;
      group.visible=enabled&&!portalOpen;status();invalidate();
    },undefined,()=>{if(disposed)return;loading=false;failed=true;status();invalidate();});
  }
  function show(){
    if(!enabled||disposed||open)return;
    if(failed)load();
    previousFocus=document.activeElement;open=true;image.src=SKY_QR_IMAGE;
    overlay.hidden=false;root.classList.add('is-sky-qr-open');document.exitPointerLock?.();
    onOpenChange();closeButton.focus({preventScroll:true});invalidate();
  }
  button.addEventListener('click',show);closeButton.addEventListener('click',close);
  overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
  function keyboard(event){
    if(!open)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key==='Tab'){
      const targets=[...dialog.querySelectorAll('button,a')],first=targets[0],last=targets[targets.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
    event.stopPropagation();
  }
  window.addEventListener('keydown',keyboard,true);
  status();
  return {
    get isOpen(){return open;},
    refresh({visible,portalOpen:inPortal=false,blocked=false}){
      if(disposed)return;
      const next=visible===true,changed=next!==enabled||portalOpen!==inPortal;
      enabled=next;portalOpen=inPortal;button.hidden=!enabled||blocked;
      root.classList.toggle('has-sky-qr',enabled);
      if(!enabled)close();
      if(enabled&&!texture&&!loading&&!failed)load();
      group.visible=enabled&&!!texture&&!portalOpen;
      status();if(changed)invalidate();
    },
    // Keep the activity lifecycle interface; a stationary world object needs no
    // per-frame transforms or extra render invalidations when the viewer moves.
    tick(){return false;},
    dispose(){
      if(disposed)return;close();disposed=true;window.removeEventListener('keydown',keyboard,true);
      group.removeFromParent();geometry.dispose();material.dispose();backingMaterial.dispose();texture?.dispose();
      button.remove();overlay.remove();root.classList.remove('has-sky-qr','is-sky-qr-open');
      delete root.dataset.skyQrVisible;delete root.dataset.skyQrState;
    }
  };
}
