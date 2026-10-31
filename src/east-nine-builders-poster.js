import {planEastNineBuildersPoster,EAST_NINE_BUILDERS_POSTER_IMAGE} from './east-nine-builders-poster-placement.js';
import {createEastNinePosterFacadeCover} from './east-nine-poster-facade-cover.js';

// One original image on a fixed, sourced north-facing wall. No source map or
// architecture edits, billboard rotation, new light or per-frame allocations.
export function createEastNineBuildersPoster({THREE,scene,model,frame,geoToLocal,host,canvas,getPlayer=()=>null,invalidate=()=>{},anisotropy=4,loadDistance=240}){
  const placement=planEastNineBuildersPoster(model,{frame,geoToLocal}),group=new THREE.Group();
  group.name='east-nine-builders-poster';group.visible=false;
  if(!placement)return {group,placement,link:null,get state(){return'absent';},get nearby(){return false;},update(){},dispose(){}};
  group.position.set(placement.x,placement.y,placement.z);group.rotation.y=placement.yaw;
  group.userData={component:'east-nine-builders-poster',sourceId:placement.sourceId,surface:placement.surface,image:EAST_NINE_BUILDERS_POSTER_IMAGE,originalImage:true};
  const paper=new THREE.MeshBasicMaterial({color:0xffffff,depthTest:true,depthWrite:true,toneMapped:false,fog:false});
  const geometry=new THREE.PlaneGeometry(placement.width,placement.height);
  const poster=new THREE.Mesh(geometry,paper);
  poster.name='east-nine-builders-original-image';
  poster.renderOrder=206;poster.castShadow=false;group.add(poster);scene.add(group);group.updateMatrixWorld(true);
  const facadeCover=createEastNinePosterFacadeCover(THREE,{scene,placement});
  group.userData.facadeCover=facadeCover.stats;
  const doc=host?.ownerDocument??globalThis.document,link=doc?.createElement('a');
  if(link){link.className='east-nine-builders-original';link.href=EAST_NINE_BUILDERS_POSTER_IMAGE;link.target='_blank';link.rel='noopener';link.textContent='HUST AI Builders · 查看原图 ↗';link.setAttribute('aria-label','查看 HUST AI Builders 小红书名片原图，在新标签页打开');link.hidden=true;host?.append(link);}
  const direction=new THREE.Vector3();
  let texture=null,loading=false,failed=false,disposed=false,wanted=false,nearby=false;
  const status=()=>{const state=disposed?'disposed':texture?'ready':failed?'error':loading?'loading':'idle';group.userData.imageState=state;if(canvas)canvas.dataset.eastNinePoster=state;return state;};
  const stop=event=>event.stopPropagation(),open=event=>{event.stopPropagation();doc?.exitPointerLock?.();};
  for(const name of ['pointerdown','pointerup','keydown','keyup'])link?.addEventListener(name,stop);
  link?.addEventListener('click',open);
  function load(){
    if(disposed||texture||loading||failed)return;
    loading=true;status();
    new THREE.TextureLoader().load(EAST_NINE_BUILDERS_POSTER_IMAGE,loaded=>{
      if(disposed){loaded.dispose();return;}
      loading=false;texture=loaded;loaded.colorSpace=THREE.SRGBColorSpace;
      loaded.repeat.set(1,1);loaded.offset.set(0,0);loaded.generateMipmaps=true;
      loaded.minFilter=THREE.LinearMipmapLinearFilter;loaded.magFilter=THREE.LinearFilter;loaded.anisotropy=Math.max(1,Math.min(8,anisotropy));
      paper.map=loaded;paper.needsUpdate=true;group.visible=wanted;facadeCover.setVisible(wanted);status();invalidate();
    },undefined,()=>{if(disposed)return;loading=false;failed=true;status();invalidate();});
  }
  function update(camera,{visible=true,interactive=true}={}){
    if(disposed)return;
    const p=camera?.position,front=!!p&&(p.x-placement.x)*placement.nx+(p.z-placement.z)*placement.nz>.08;
    wanted=!!visible&&!!p&&Math.hypot(p.x-placement.x,p.z-placement.z)<loadDistance;
    if(!wanted)failed=false;
    group.visible=wanted&&!!texture;
    facadeCover.setVisible(group.visible);
    if(wanted)load();
    const player=getPlayer(),at=player?.state;
    nearby=false;
    if(wanted&&texture&&front&&interactive&&player?.active&&at&&Math.hypot(at.x-placement.x,at.y-placement.y,at.z-placement.z)<Math.max(18,placement.height*2)){
      camera.getWorldDirection(direction);
      const normalSpeed=direction.x*placement.nx+direction.z*placement.nz;
      if(normalSpeed<-.01){
        const distance=-((p.x-placement.x)*placement.nx+(p.z-placement.z)*placement.nz)/normalSpeed;
        const dx=p.x+direction.x*distance-placement.x,dz=p.z+direction.z*distance-placement.z;
        nearby=Math.abs(dx*placement.nz-dz*placement.nx)<placement.width/2+.6&&Math.abs(p.y+direction.y*distance-placement.y)<placement.height/2+.6;
      }
    }
    if(link)link.hidden=!nearby;
  }
  status();
  return {group,placement,link,update,get state(){return status();},get nearby(){return nearby;},
    dispose(){
      if(disposed)return;disposed=true;nearby=false;status();
      for(const name of ['pointerdown','pointerup','keydown','keyup'])link?.removeEventListener(name,stop);
      link?.removeEventListener('click',open);link?.remove();facadeCover.dispose();group.removeFromParent();geometry.dispose();paper.dispose();texture?.dispose();group.clear();
    }
  };
}
