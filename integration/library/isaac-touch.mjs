import {createTouchControls,createTouchKeys,directionKeys} from '/works/library/touch-controls.mjs';
export function attachIsaacTouch(player,requestMenu){
 const keys=createTouchKeys(()=>player.shadowRoot?.querySelector('#container'));
 const mapping={confirm:'Space',restart:'Enter',bomb:'KeyE',item:'Space',pill:'KeyQ',pause:'KeyP'};
 const touch=createTouchControls({kind:'isaac',onReset:()=>keys.release(),
  canPlay:()=>player.dataset.ready==='true'&&document.documentElement.dataset.controlsSuspended!=='true'&&!document.querySelector('dialog[open]'),
  onMove:v=>keys.set('move',directionKeys(v)),onShoot:v=>keys.set('shoot',directionKeys(v,true)),
  onPress:id=>{if(id==='menu')requestMenu();else keys.set(id,[mapping[id]]);},onRelease:id=>keys.release(id),
  toolbar:[{id:'menu',label:'游戏菜单'},{id:'confirm',label:'开始 / 确认'},{id:'restart',label:'返回标题'}],
  actions:[{id:'item',label:'道具'},{id:'bomb',label:'炸弹'},{id:'pill',label:'药丸'}],
 });
 window.addEventListener('pagehide',()=>{touch.destroy();keys.release();},{once:true});return touch;
}
