// A removable artwork treatment, not a building/model edit. The original
// window instances return whenever the image is hidden or fails to load.
const COMPONENTS=new Set(['wing-window','window-mullion','wing-window-jamb','wing-window-sill','wing-air-conditioner','wing-air-conditioner-grille','floor-band']);
const EPS=1e-6;

function outsidePieces(box,cut){
  const left=Math.max(box.minX,cut.minX),right=Math.min(box.maxX,cut.maxX),bottom=Math.max(box.minY,cut.minY),top=Math.min(box.maxY,cut.maxY);
  if(right-left<=EPS||top-bottom<=EPS)return null;
  const pieces=[];
  const add=(minX,maxX,minY,maxY)=>{if(maxX-minX>EPS&&maxY-minY>EPS)pieces.push({minX,maxX,minY,maxY,minZ:box.minZ,maxZ:box.maxZ});};
  add(box.minX,left,box.minY,box.maxY);add(right,box.maxX,box.minY,box.maxY);
  add(left,right,box.minY,bottom);add(left,right,top,box.maxY);
  return pieces;
}

export function createEastNinePosterFacadeCover(THREE,{scene,placement}){
  const group=new THREE.Group();group.name='east-nine-poster-facade-cover';group.visible=false;
  const batches=[],replacements=[],stats={sourceInstances:0,affectedInstances:0,outsideFragments:0,batches:0};
  let active=false,disposed=false;
  if(placement&&scene){
    group.position.set(placement.x,placement.y,placement.z);group.rotation.y=placement.yaw;group.updateMatrixWorld(true);
    const inverse=group.matrixWorld.clone().invert(),local=new THREE.Matrix4(),original=new THREE.Matrix4(),combined=new THREE.Matrix4(),color=new THREE.Color();
    const cut={minX:-placement.width/2-.005,maxX:placement.width/2+.005,minY:-placement.height/2-.005,maxY:placement.height/2+.005};
    const sources=[];scene.updateMatrixWorld(true);scene.traverse(mesh=>{if(mesh.isInstancedMesh&&mesh.userData.featureId===placement.sourceId&&COMPONENTS.has(mesh.userData.component)&&mesh.geometry.type==='BoxGeometry'&&!mesh.userData.posterOutsideFragments)sources.push(mesh);});
    for(const mesh of sources){
      const gp=mesh.geometry.parameters;if(gp.width!==1||gp.height!==1||gp.depth!==1)continue;
      combined.multiplyMatrices(inverse,mesh.matrixWorld);
      const changes=[],fragments=[];
      for(let index=0;index<mesh.count;index++){
        stats.sourceInstances++;mesh.getMatrixAt(index,original);local.multiplyMatrices(combined,original);
        const e=local.elements,sx=Math.abs(e[0]),sy=Math.abs(e[5]),sz=Math.abs(e[10]);
        // Reject perpendicular or inclined surfaces, and details on any other
        // parallel wall. The permitted shallow strip is relative to the image.
        if(sx<EPS||sy<EPS||sz<EPS||e[14]<-.03||e[14]>.85||
          Math.abs(e[1])+Math.abs(e[2])>sx*1e-5||Math.abs(e[4])+Math.abs(e[6])>sy*1e-5||Math.abs(e[8])+Math.abs(e[9])>sz*1e-5)continue;
        const box={minX:e[12]-sx/2,maxX:e[12]+sx/2,minY:e[13]-sy/2,maxY:e[13]+sy/2,minZ:e[14]-sz/2,maxZ:e[14]+sz/2};
        const pieces=outsidePieces(box,cut);if(pieces===null)continue;
        const saved=original.clone(),hidden=saved.clone().scale(new THREE.Vector3(0,0,0));
        changes.push({index,saved,hidden});
        const tint=mesh.instanceColor?(mesh.getColorAt(index,color),color.clone()):null;
        for(const piece of pieces)fragments.push({piece,tint});
      }
      if(!changes.length)continue;
      batches.push({mesh,changes});stats.affectedInstances+=changes.length;
      if(fragments.length){
        const replacement=new THREE.InstancedMesh(mesh.geometry,mesh.material,fragments.length);
        replacement.name=`${mesh.name||mesh.userData.component}-outside-poster`;replacement.renderOrder=mesh.renderOrder;replacement.castShadow=mesh.castShadow;replacement.receiveShadow=mesh.receiveShadow;replacement.layers.mask=mesh.layers.mask;
        replacement.userData={...mesh.userData,posterOutsideFragments:true,instanceCount:fragments.length};
        for(let index=0;index<fragments.length;index++){
          const {piece:p,tint}=fragments[index];local.makeScale(p.maxX-p.minX,p.maxY-p.minY,p.maxZ-p.minZ);local.setPosition((p.minX+p.maxX)/2,(p.minY+p.maxY)/2,(p.minZ+p.maxZ)/2);replacement.setMatrixAt(index,local);if(tint)replacement.setColorAt(index,tint);
        }
        replacement.instanceMatrix.needsUpdate=true;if(replacement.instanceColor)replacement.instanceColor.needsUpdate=true;replacement.computeBoundingSphere();group.add(replacement);replacements.push(replacement);stats.outsideFragments+=fragments.length;
      }
    }
    stats.batches=batches.length;group.userData={component:'east-nine-poster-facade-cover',sourceId:placement.sourceId,...stats};scene.add(group);
  }
  function setVisible(covered){
    const next=!!covered&&!disposed;if(next===active)return;
    active=next;group.visible=next;
    for(const {mesh,changes}of batches){for(const {index,saved,hidden}of changes)mesh.setMatrixAt(index,next?hidden:saved);mesh.instanceMatrix.needsUpdate=true;}
  }
  return{group,stats,setVisible,get active(){return active;},dispose(){
    if(disposed)return;setVisible(false);disposed=true;group.removeFromParent();
    // InstancedMesh.dispose releases its own instance buffer only. Geometry
    // and material belong to the original campus and remain alive.
    for(const mesh of replacements)mesh.dispose();group.clear();batches.length=0;replacements.length=0;
  }};
}
