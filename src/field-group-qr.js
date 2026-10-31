export const FIELD_GROUP_QR_IMAGE='/images/activity/hust-ai-builders-group.jpg';
export const FIELD_SOURCE_ID='way/110398530';
// Reuse the original group card and its quiet zone, without redrawing the code.
// A smaller vertical card on the canteen-facing roof edge of Yunyuan 16.
// Keep this group card independent of the host-controlled personal sky code.
export function planFieldGroupQr(model){
  if(!model?.records?.some(r=>r.id===FIELD_SOURCE_ID&&r.shapes?.length))return null;
  const width=32,height=width*(.59*2289)/(.84*1284),yaw=-Math.PI/2;
  return {x:650,y:64,z:-105.95518,width,height,yaw,sourceId:FIELD_SOURCE_ID};
}
export function createFieldGroupQr({THREE,scene,model,invalidate=()=>{},loadDistance=520}){
  const placement=planFieldGroupQr(model),group=new THREE.Group();group.name='yunyuan16-group-qr';group.visible=false;
  if(!placement)return {group,placement,update(){},dispose(){}};
  group.position.set(placement.x,placement.y,placement.z);group.rotation.y=placement.yaw;group.userData={component:'field-group-qr',sourceId:FIELD_SOURCE_ID};scene.add(group);
  const material=new THREE.MeshBasicMaterial({color:0xffffff,depthTest:true,depthWrite:true,fog:false,toneMapped:false});
  const geometry=new THREE.PlaneGeometry(placement.width,placement.height),panel=new THREE.Mesh(geometry,material);
  panel.name='hust-ai-builders-group-qr';panel.renderOrder=206;group.add(panel);
  let texture=null,loading=false,disposed=false,failed=false,wanted=false;
  return {
    group,placement,
    update(camera,{visible=true}={}){
      if(disposed)return;
      const position=camera?.position;
      wanted=!!visible&&!!position&&Math.hypot(position.x-placement.x,position.z-placement.z)<loadDistance;
      if(!wanted)failed=false;
      group.visible=wanted&&!!texture;
      if(!wanted||texture||loading||failed)return;
      loading=true;
      new THREE.TextureLoader().load(FIELD_GROUP_QR_IMAGE,loaded=>{
        if(disposed){loaded.dispose();return;}
        loading=false;texture=loaded;loaded.colorSpace=THREE.SRGBColorSpace;
        loaded.repeat.set(.84,.59);loaded.offset.set(.08,.25);
        loaded.generateMipmaps=true;loaded.minFilter=THREE.LinearMipmapLinearFilter;loaded.magFilter=THREE.LinearFilter;loaded.anisotropy=4;
        material.map=loaded;material.needsUpdate=true;group.visible=wanted;invalidate();
      },undefined,()=>{loading=false;failed=true;});
    },
    dispose(){if(disposed)return;disposed=true;group.visible=false;group.removeFromParent();geometry.dispose();material.dispose();texture?.dispose();group.clear();}
  };
}
