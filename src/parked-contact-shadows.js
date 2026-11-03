// One shared, soft contact layer keeps parked props grounded even on devices
// without shadow maps. It is intentionally local; it never replaces sun shadows.
const FOOTPRINTS={spider:[1.15,1.4],roadster:[2.4,5.2],hoverboard:[1.15,2.65],helicopter:[4.9,7.6]};
export function createParkedContactShadows(THREE,items){
  const groundItems=items.filter(item=>FOOTPRINTS[item.mode]),size=64,pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.hypot((x+.5)/size*2-1,(y+.5)/size*2-1),edge=Math.max(0,Math.min(1,(1-r)*5)),i=(y*size+x)*4;
    pixels.set([255,255,255,Math.round(255*Math.exp(-r*r*3.4)*edge*edge*(3-2*edge))],i);
  }
  const texture=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat);texture.needsUpdate=true;texture.magFilter=texture.minFilter=THREE.LinearFilter;
  const geometry=new THREE.PlaneGeometry(1,1);geometry.rotateX(-Math.PI/2);
  const material=new THREE.MeshBasicMaterial({name:'停放物品柔和接触阴影',map:texture,color:'#202a24',transparent:true,opacity:.24,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const mesh=new THREE.InstancedMesh(geometry,material,groundItems.length);mesh.name='parked-prop-contact-shadows';mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.renderOrder=1;
  mesh.userData={excludeFromCampusExport:true,sharedContactShadows:true,maxInstances:groundItems.length};
  const slots=new Map(groundItems.map((item,index)=>[item,{index,visible:null}])),dummy=new THREE.Object3D();let disposed=false;
  function update(item,{visible=true,groundY=item.y}={}){
    const slot=slots.get(item);if(disposed||!slot)return;
    if(slot.visible===visible&&(!visible||(slot.x===item.x&&slot.y===groundY&&slot.z===item.z&&slot.yaw===item.yaw)))return;
    Object.assign(slot,{visible,x:item.x,y:groundY,z:item.z,yaw:item.yaw});
    const footprint=FOOTPRINTS[item.mode];dummy.position.set(item.x,groundY+.009,item.z);dummy.rotation.set(0,item.yaw,0);dummy.scale.set(visible?footprint[0]:0,1,visible?footprint[1]:0);dummy.updateMatrix();mesh.setMatrixAt(slot.index,dummy.matrix);mesh.instanceMatrix.needsUpdate=true;
  }
  for(const item of groundItems)update(item);
  return {mesh,update,dispose(){if(disposed)return;disposed=true;mesh.removeFromParent();mesh.dispose();geometry.dispose();material.dispose();texture.dispose();slots.clear();}};
}
