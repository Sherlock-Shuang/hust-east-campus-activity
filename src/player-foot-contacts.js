// Two tiny local contact layers anchor the shoes even with shadow maps off.
// They use the actual animated ankle points and the same support query as
// movement. No projected shadow is retained while airborne, wet or in a vehicle.
export function createPlayerFootContacts(THREE,{groundAt,ownGeometry,ownMaterial,ownTexture}){
  const size=32,pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.hypot((x+.5)/size*2-1,(y+.5)/size*2-1),edge=Math.max(0,1-r);
    pixels.set([255,255,255,Math.round(255*Math.exp(-r*r*3)*edge*edge)],(y*size+x)*4);
  }
  const texture=ownTexture(new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat));texture.needsUpdate=true;texture.minFilter=texture.magFilter=THREE.LinearFilter;
  const geometry=ownGeometry(new THREE.PlaneGeometry(1,1));geometry.rotateX(-Math.PI/2);
  const feet=['L','R'].map(side=>{
    const material=ownMaterial(new THREE.MeshBasicMaterial({name:'player-foot-contact',map:texture,color:'#17211c',transparent:true,opacity:.2,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`player-foot-contact-${side}`;mesh.renderOrder=1;mesh.visible=false;mesh.userData.excludeFromCampusExport=true;return{side,mesh};
  });
  function update(state,pose){
    const valid=state.mode==='walk'&&state.grounded===true&&(!state.waterMode||state.waterMode==='dry');
    for(const {side,mesh} of feet){
      const foot=pose?.points?.[`ankle${side}`];mesh.visible=!!(valid&&foot);if(!mesh.visible)continue;
      const yaw=state.yaw||0,c=Math.cos(yaw),s=Math.sin(yaw),x=(state.x||0)+foot[0]*c+foot[2]*s,z=(state.z||0)-foot[0]*s+foot[2]*c;
      const support=groundAt?.(x,z,0,state.y??0),height=typeof support==='number'?support:support?.height??state.y??0;
      // A missing ledge beneath a swinging foot must not receive a detached
      // floating blot; a raised support must not put the shadow into the shoe.
      const gap=(state.y??0)+foot[1]-.065-height;
      if(!Number.isFinite(height)||gap<-.035||gap>.18||support?.allowed===false){mesh.visible=false;continue;}
      const lift=Math.max(0,gap);mesh.material.opacity=.20*Math.max(0,1-lift/.18)**2;
      mesh.position.set(foot[0],height-(state.y??0)+.026,foot[2]-.026);
      mesh.scale.set(.19+lift*.4,1,.30+lift*.5);mesh.updateMatrix();
    }
  }
  return{meshes:feet.map(f=>f.mesh),update};
}
