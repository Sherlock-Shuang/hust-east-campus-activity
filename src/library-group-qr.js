import {getBuildingProfile} from './building-profiles.js';
export const LIBRARY_GROUP_QR_IMAGE='/images/activity/hust-ai-builders-group.jpg';
export const LIBRARY_SOURCE_ID='way/98867853';
// Original photo is served byte-for-byte. Texture UVs frame the supplied card,
// preserving every code dot and its white quiet zone without regenerating it.
export function planLibraryGroupQr(model){
  const record=model?.records?.find(r=>r.id===LIBRARY_SOURCE_ID&&r.shapes?.length);
  if(!record)return null;
  const points=record.shapes.flatMap(shape=>shape.getPoints());
  const xs=points.map(p=>p.x),zs=points.map(p=>-p.y),roof=getBuildingProfile(record.feature).height;
  const width=32,height=width*(.59*2289)/(.84*1284);
  return {x:(Math.min(...xs)+Math.max(...xs))/2,z:(Math.min(...zs)+Math.max(...zs))/2,y:roof+6+height/2,width,height,roof,sourceId:LIBRARY_SOURCE_ID};
}
export function createLibraryGroupQr({THREE,scene,model,invalidate=()=>{},loadDistance=520}){
  const placement=planLibraryGroupQr(model),group=new THREE.Group();group.name='east-library-group-qr';group.visible=false;
  if(!placement)return {group,placement,update(){},dispose(){}};
  group.position.set(placement.x,placement.y,placement.z);group.userData={component:'library-group-qr',sourceId:LIBRARY_SOURCE_ID};scene.add(group);
  const material=new THREE.SpriteMaterial({color:0xffffff,depthTest:true,depthWrite:false,fog:false,toneMapped:false});
  const panel=new THREE.Sprite(material);panel.name='hust-ai-builders-group-qr';panel.scale.set(placement.width,placement.height,1);group.add(panel);
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
      new THREE.TextureLoader().load(LIBRARY_GROUP_QR_IMAGE,loaded=>{
        if(disposed){loaded.dispose();return;}
        loading=false;texture=loaded;loaded.colorSpace=THREE.SRGBColorSpace;
        loaded.repeat.set(.84,.59);loaded.offset.set(.08,.25);
        loaded.generateMipmaps=false;loaded.minFilter=THREE.LinearFilter;loaded.magFilter=THREE.LinearFilter;
        material.map=loaded;material.needsUpdate=true;group.visible=wanted;invalidate();
      },undefined,()=>{loading=false;failed=true;});
    },
    dispose(){if(disposed)return;disposed=true;group.visible=false;group.removeFromParent();material.dispose();texture?.dispose();group.clear();}
  };
}
