import {planEastNineBuildersPoster,EAST_NINE_BUILDERS_POSTER_IMAGE} from './east-nine-builders-poster-placement.js';
import {createEastNinePosterFacadeCover} from './east-nine-poster-facade-cover.js';

// One original image on a fixed, sourced north-facing wall. No source map or
// architecture edits, billboard rotation, new light or per-frame allocations.
export function createEastNineBuildersPoster({THREE,scene,model,frame,geoToLocal,host,canvas,getPlayer=()=>null,invalidate=()=>{},anisotropy=4,loadDistance=240}){
  return createCampusWallPoster({THREE,scene,placement:planEastNineBuildersPoster(model,{frame,geoToLocal}),host,canvas,getPlayer,invalidate,anisotropy,loadDistance});
}

// Both community cards share the same physical print, loading and return flow.
export function createCampusWallPoster({THREE,scene,placement,host,canvas,getPlayer=()=>null,invalidate=()=>{},anisotropy=4,loadDistance=240,imagePath=EAST_NINE_BUILDERS_POSTER_IMAGE,groupName='east-nine-builders-poster',panelName='east-nine-builders-original-image',linkClass='east-nine-builders-original',linkLabel='HUST AI Builders · 查看原图',statusKey='eastNinePoster',uvRepeat=[1,1],uvOffset=[0,0]}){
  const group=new THREE.Group();
  group.name=groupName;group.visible=false;
  if(!placement)return {group,placement,link:null,get state(){return'absent';},get nearby(){return false;},update(){},dispose(){}};
  group.position.set(placement.x,placement.y,placement.z);group.rotation.y=placement.yaw;
  group.userData={component:groupName,sourceId:placement.sourceId,surface:placement.surface,image:imagePath,originalImage:true};
  // Matte outdoor print: the original photo stays untouched, while the paper
  // follows the same daylight, moonlight, exposure and haze as its host wall.
  const grainData=new Uint8Array(64*64);
  for(let i=0;i<grainData.length;i++){const noise=Math.sin(i*127.1+311.7)*43758.5453;grainData[i]=Math.round(128+(noise-Math.floor(noise)-.5)*28);}
  const grain=new THREE.DataTexture(grainData,64,64,THREE.RedFormat);
  grain.wrapS=grain.wrapT=THREE.RepeatWrapping;grain.repeat.set(placement.width*4,placement.height*4);grain.magFilter=THREE.LinearFilter;grain.minFilter=THREE.LinearFilter;grain.needsUpdate=true;
  const paper=new THREE.MeshStandardMaterial({color:'#efede4',roughness:.97,metalness:0,envMapIntensity:.18,bumpMap:grain,bumpScale:.0012,depthTest:true,depthWrite:true,toneMapped:true,fog:true});
  const geometry=new THREE.PlaneGeometry(placement.width,placement.height);
  const poster=new THREE.Mesh(geometry,paper);
  poster.name=panelName;
  // A two-centimetre feathered contact edge anchors the print to its wall.
  // It is transparent shading, not a visible frame, and never covers the QR.
  const edgeGeometry=new THREE.BufferGeometry(),edgePositions=[],edgeColors=[],edgeIndices=[];
  for(const expanded of [false,true])for(const [sx,sy]of [[-1,-1],[1,-1],[1,1],[-1,1]]){
    edgePositions.push(sx*(placement.width/2+(expanded?.025:0)),sy*(placement.height/2+(expanded?.025:0)),-.001);
    edgeColors.push(0,0,0,expanded?0:.16);
  }
  for(let i=0;i<4;i++){const next=(i+1)%4;edgeIndices.push(i,i+4,next+4,i,next+4,next);}
  edgeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(edgePositions,3));edgeGeometry.setAttribute('color',new THREE.Float32BufferAttribute(edgeColors,4));edgeGeometry.setIndex(edgeIndices);
  const edgeMaterial=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,toneMapped:true,fog:true});
  const edge=new THREE.Mesh(edgeGeometry,edgeMaterial);edge.name=groupName+'-contact-edge';edge.renderOrder=205;
  poster.renderOrder=206;poster.castShadow=false;poster.receiveShadow=true;group.add(edge,poster);scene.add(group);group.updateMatrixWorld(true);
  const facadeCover=createEastNinePosterFacadeCover(THREE,{scene,placement});
  group.userData.facadeCover=facadeCover.stats;
  const doc=host?.ownerDocument??globalThis.document,link=doc?.createElement('a');
  if(link){link.className=linkClass;link.href=imagePath;link.target='_blank';link.rel='noopener';link.textContent=linkLabel+' ↗';link.setAttribute('aria-label',linkLabel+'，在新标签页打开');link.hidden=true;host?.append(link);}
  const direction=new THREE.Vector3();
  let texture=null,loading=false,failed=false,disposed=false,wanted=false,nearby=false;
  const status=()=>{const state=disposed?'disposed':texture?'ready':failed?'error':loading?'loading':'idle';group.userData.imageState=state;if(canvas)canvas.dataset[statusKey]=state;return state;};
  const stop=event=>event.stopPropagation(),open=event=>{event.stopPropagation();doc?.exitPointerLock?.();};
  for(const name of ['pointerdown','pointerup','keydown','keyup'])link?.addEventListener(name,stop);
  link?.addEventListener('click',open);
  function load(){
    if(disposed||texture||loading||failed)return;
    loading=true;status();
    new THREE.TextureLoader().load(imagePath,loaded=>{
      if(disposed){loaded.dispose();return;}
      loading=false;texture=loaded;loaded.colorSpace=THREE.SRGBColorSpace;
      loaded.repeat.fromArray(uvRepeat);loaded.offset.fromArray(uvOffset);loaded.generateMipmaps=true;
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
      link?.removeEventListener('click',open);link?.remove();facadeCover.dispose();group.removeFromParent();geometry.dispose();paper.dispose();edgeGeometry.dispose();edgeMaterial.dispose();grain.dispose();texture?.dispose();group.clear();
    }
  };
}
