/** Trim only the column's buried portion when a local gallery platform rises.
 * Beam/roof elevations and source footprint stay fixed. The small column base
 * uses the walking surface minus its explicit shoe-contact clearance. */
export function alignEastNineColumnFeet(THREE,detail,heightAt,{geometryBelowContact=0}={}){
  if(!detail?.userData.columnPositions||typeof heightAt!=='function')return;
  const data=detail.userData,raised=data.collisionBuildings?.find(b=>b.id===data.raisedBridgeSourceId);
  const top=raised?.minHeight??data.bridgeClearHeight,matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  const visibleHeightAt=(x,z)=>heightAt(x,z)-geometryBelowContact;
  data.columnPositions=data.columnPositions.map(p=>({...p,baseHeight:visibleHeightAt(p.x,p.z)}));
  detail.traverse(mesh=>{
    if(!mesh.isInstancedMesh||!['arcade-round-column','arcade-column-base'].includes(mesh.userData.component))return;
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);const foot=visibleHeightAt(position.x,position.z);
      if(mesh.userData.component==='arcade-round-column'){scale.y=Math.max(.1,top-foot);position.y=(top+foot)/2;}
      else position.y=foot+scale.y/2;
      matrix.compose(position,rotation,scale);mesh.setMatrixAt(i,matrix);
    }
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.userData.groundContact='local photo-inferred gallery platform; same height function as walking';
  });
}
