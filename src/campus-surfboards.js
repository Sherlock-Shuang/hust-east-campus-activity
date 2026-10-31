import {CAMPUS_SURF} from './campus-water-motion.js';

// Only the nearby 9 × 9 cells are resident. Boards share two geometries and
// materials; creating or restarting a storm never accumulates scene objects.
export function createCampusSurfboards(THREE,scene,water){
  const root=new THREE.Group();root.name='campus-surfboards';root.visible=false;scene.add(root);
  let fleet=null,stripes=null,rider=null,wake=null,resources=[];
  const dummy=new THREE.Object3D();
  function build(){
    if(fleet)return;
    const outline=new THREE.Shape();outline.moveTo(0,-1.4);outline.bezierCurveTo(.5,-1.15,.52,.9,.29,1.25);outline.quadraticCurveTo(0,1.38,-.29,1.25);outline.bezierCurveTo(-.52,.9,-.5,-1.15,0,-1.4);
    const body=new THREE.ExtrudeGeometry(outline,{depth:.09,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.035,bevelThickness:.025,curveSegments:8});body.rotateX(Math.PI/2);
    const stripe=new THREE.BoxGeometry(.12,.02,2.05),white=new THREE.MeshStandardMaterial({color:0xf3eee1,roughness:.42}),blue=new THREE.MeshStandardMaterial({color:0x168c9a,roughness:.4});
    fleet=new THREE.InstancedMesh(body,white,81);stripes=new THREE.InstancedMesh(stripe,blue,81);
    for(const m of[fleet,stripes]){m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.frustumCulled=false;root.add(m);}
    rider=new THREE.Group();rider.name='player-surfboard';rider.add(new THREE.Mesh(body,white));const s=new THREE.Mesh(stripe,blue);s.position.y=.025;rider.add(s);root.add(rider);
    const foam=new THREE.MeshBasicMaterial({color:0xe9ffff,transparent:true,opacity:.55,depthWrite:false,side:THREE.DoubleSide});
    const wakeGeometry=new THREE.PlaneGeometry(.16,5);wake=new THREE.Group();for(const side of[-1,1]){const m=new THREE.Mesh(wakeGeometry,foam);m.rotation.set(-Math.PI/2,0,side*.13);m.position.set(side*.52,0,2.8);wake.add(m);}root.add(wake);
    resources=[body,stripe,white,blue,foam,wakeGeometry];
  }
  function update(state,visible=true){
    root.visible=visible&&water.active;
    if(!root.visible)return;
    build();let count=0;
    const ix=Math.floor(state.x/CAMPUS_SURF.spacing),iz=Math.floor(state.z/CAMPUS_SURF.spacing);
    for(let x=ix-4;x<=ix+4;x++)for(let z=iz-4;z<=iz+4;z++){
      const b=water.boardAt(x,z);if(!b)continue;
      dummy.position.set(b.x,b.y,b.z);dummy.rotation.set(Math.sin(water.elapsed*1.8+x)*.035,b.yaw,Math.cos(water.elapsed*1.4+z)*.04);dummy.updateMatrix();fleet.setMatrixAt(count,dummy.matrix);
      dummy.position.y+=.025;dummy.updateMatrix();stripes.setMatrixAt(count,dummy.matrix);count++;
    }
    fleet.count=stripes.count=count;fleet.instanceMatrix.needsUpdate=stripes.instanceMatrix.needsUpdate=true;
    rider.visible=state.mode==='walk'&&['board','surf'].includes(state.waterMode);
    if(rider.visible){rider.position.set(state.x,state.y-.10,state.z);rider.rotation.set(state.pitch||0,state.yaw,state.lean||0,'YXZ');}
    wake.visible=rider.visible&&state.speed>5;
    if(wake.visible){wake.position.set(state.x,state.waterY+.08,state.z);wake.rotation.y=state.yaw;wake.scale.z=Math.min(2,state.speed/16);}
  }
  return{root,update,dispose(){root.removeFromParent();resources.forEach(r=>r.dispose());fleet?.dispose();stripes?.dispose();root.clear();}};
}
