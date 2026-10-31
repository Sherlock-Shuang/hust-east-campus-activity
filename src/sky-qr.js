import './sky-qr.css';

export const SKY_QR_IMAGE = '/images/activity/wechat-qr-cutout.png';
import {SKY_QR_PLACEMENT} from './sky-qr-placement.js';
export {SKY_QR_PLACEMENT} from './sky-qr-placement.js';

// A fixed, downward-facing sky panel above the sports field. Its world pose and
// metre-scale size never depend on the viewer, camera heading, or screen size.
export function createSkyQrExperience({THREE,scene,root,invalidate}) {
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
  let enabled=false,disposed=false,loading=false,failed=false,texture=null,portalOpen=false;
  const status=()=>{
    root.dataset.skyQrVisible=String(enabled);root.dataset.skyQrState=!enabled?'hidden':texture?'ready':failed?'error':'loading';
  };
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
  status();
  return {
    get isOpen(){return false;},
    refresh({visible,portalOpen:inPortal=false}){
      if(disposed)return;
      const next=visible===true,changed=next!==enabled||portalOpen!==inPortal;
      enabled=next;portalOpen=inPortal;
      root.classList.toggle('has-sky-qr',enabled);
      // A new host show can retry a failed load without adding screen controls.
      if(enabled&&!texture&&!loading&&(!failed||changed))load();
      group.visible=enabled&&!!texture&&!portalOpen;
      status();if(changed)invalidate();
    },
    // Keep the activity lifecycle interface; a stationary world object needs no
    // per-frame transforms or extra render invalidations when the viewer moves.
    tick(){return false;},
    dispose(){
      if(disposed)return;disposed=true;
      group.removeFromParent();geometry.dispose();material.dispose();backingMaterial.dispose();texture?.dispose();
      root.classList.remove('has-sky-qr');
      delete root.dataset.skyQrVisible;delete root.dataset.skyQrState;
    }
  };
}
