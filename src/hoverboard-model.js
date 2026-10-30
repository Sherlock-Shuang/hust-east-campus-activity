import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {createActorLibrary} from './commute-actors.js';
import {batchRigidModelBody} from './static-model-batch.js';

// Original visual reconstruction informed by the inspected reporter photograph
// of Shenqi Ayu's electric flying board. The dimensions, hidden framework and
// exact ten-motor arrangement are photo estimates, not construction plans.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const number=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
export function createHoverboardModel(THREE){
  const group=new THREE.Group();group.name='hoverboard-electric-standup';
  const geometries=new Set(),materials=new Set(),textures=new Set();
  const ownGeometry=g=>(geometries.add(g),g),ownMaterial=m=>(materials.add(m),m);
  const mat=(color,roughness=.5,metalness=.1,extra={})=>ownMaterial(new THREE.MeshStandardMaterial({color,roughness,metalness,...extra}));
  const white=mat('#d4e1df',.43,.16),black=mat('#202a2e',.62,.45),rubber=mat('#20272b',.96,.01),metal=mat('#77878b',.36,.72),copper=mat('#986d49',.46,.63),wood=mat('#b89b70',.60,.06),wireRed=mat('#913d32',.72,.10),battery=mat('#93998a',.74,.12);
  const cyan=mat('#40bed0',.34,.12,{emissive:'#1ccad7',emissiveIntensity:1.5}),display=mat('#183540',.3,.15,{emissive:'#157185',emissiveIntensity:.45});
  function mesh(parent,geometry,material,name,position=[0,0,0],rotation=[0,0,0]){const result=new THREE.Mesh(ownGeometry(geometry),material);result.name=name;result.position.set(...position);result.rotation.set(...(rotation.length===3?rotation:[0,0,0]));result.castShadow=true;result.receiveShadow=true;parent.add(result);return result;}
  function rounded(parent,size,material,name,pos,rotation=[0,0,0],radius=.025){return mesh(parent,new RoundedBoxGeometry(...size,3,Math.min(radius,...size.map(v=>v*.35))),material,name,pos,rotation);}
  function rod(parent,a,b,r,material,name,r2=r){const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),direction=vb.clone().sub(va);const result=mesh(parent,new THREE.CylinderGeometry(r2,r,direction.length(),12),material,name,va.add(vb).multiplyScalar(.5).toArray());result.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());return result;}
  function tube(parent,points,r,material,name,closed=false){return mesh(parent,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),closed),Math.max(12,points.length*3),r,7,closed),material,name);}
  function ellipsoid(parent,scale,material,name,pos,rotation=[0,0,0]){const g=new THREE.SphereGeometry(1,20,12);g.scale(...scale);return mesh(parent,g,material,name,pos,rotation);}
  const deckY=.42;
  const outline=new THREE.Shape();outline.moveTo(-1.06,0);
  outline.quadraticCurveTo(-1.065,-.31,-.92,-.405);outline.quadraticCurveTo(-.68,-.48,-.32,-.43);outline.quadraticCurveTo(0,-.365,.32,-.43);outline.quadraticCurveTo(.68,-.48,.92,-.405);outline.quadraticCurveTo(1.065,-.31,1.06,0);
  outline.quadraticCurveTo(1.065,.31,.92,.405);outline.quadraticCurveTo(.68,.48,.32,.43);outline.quadraticCurveTo(0,.365,-.32,.43);outline.quadraticCurveTo(-.68,.48,-.92,.405);outline.quadraticCurveTo(-1.065,.31,-1.06,0);
  for(const side of[-1,1])for(const end of[-1,1]){
    const hole=new THREE.Path();hole.moveTo(side*.40,end*.135);hole.quadraticCurveTo(side*.58,end*.085,side*.83,end*.12);hole.quadraticCurveTo(side*.99,end*.16,side*.89,end*.29);hole.quadraticCurveTo(side*.66,end*.36,side*.42,end*.27);hole.quadraticCurveTo(side*.32,end*.21,side*.40,end*.135);outline.holes.push(hole);
  }
  const deckGeometry=new THREE.ExtrudeGeometry(outline,{depth:.045,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.012,bevelThickness:.008,curveSegments:18});deckGeometry.rotateX(Math.PI/2);
  mesh(group,deckGeometry,white,'hoverboard-open-white-deck',[0,deckY-.008,0]);
  // The bevel grows 12 mm beyond the source outline. Put the 20 mm diffuser
  // outside that skin; the former centreline on the outline buried the LEDs.
  const perimeter=outline.getPoints(90);if(perimeter[0].distanceTo(perimeter.at(-1))<1e-6)perimeter.pop();
  const edgePoints=perimeter.map((p,i)=>{const prev=perimeter[(i+perimeter.length-1)%perimeter.length],next=perimeter[(i+1)%perimeter.length],dx=next.x-prev.x,dz=next.y-prev.y,len=Math.hypot(dx,dz)||1;return[p.x+dz/len*.024,.413,p.y-dx/len*.024];});
  const edgeLight=ownMaterial(new THREE.MeshBasicMaterial({color:'#38cfe1',toneMapped:false}));
  tube(group,edgePoints,.010,edgeLight,'hoverboard-continuous-cyan-edge',true);
  // A narrow non-luminous diffuser sits behind the LED strip so the edge has
  // thickness in daylight; the light itself does not substitute for a deck.
  tube(group,edgePoints.map(([x,y,z])=>[x,y-.016,z]),.012,white,'hoverboard-edge-diffuser',true);
  for(const side of[-1,1])rod(group,[side*.10,.337,-.33],[side*.96,.337,.27],.024,black,`hoverboard-diagonal-frame-${side}`);
  for(const z of[-.28,.28])rod(group,[-.94,.333,z],[.94,.333,z],.024,black,`hoverboard-crossmember-${z}`);
  // Four straight support legs land on small rubber pads at y=0.
  const feet=[];
  for(const x of[-.74,.74])for(const z of[-.36,.36]){
    rod(group,[x,.027,z],[x,.374,z],.014,black,`hoverboard-support-leg-${x}-${z}`);
    mesh(group,new THREE.CylinderGeometry(.027,.031,.024,16),rubber,`hoverboard-ground-pad-${x}-${z}`,[x,.012,z]);
    mesh(group,new THREE.CylinderGeometry(.026,.026,.045,12),metal,`hoverboard-leg-collar-${x}-${z}`,[x,.325,z]);feet.push({x,z,y:0});
  }
  // A visible open battery cage: four front windows, corner rails and a lid.
  // The cells and red power leads are visible through the openings.
  rounded(group,[.34,.325,.28],battery,'hoverboard-battery-cells',[0,.593,.025],[],.018);
  for(const x of[-.194,0,.194])rounded(group,[.025,.385,.022],white,`hoverboard-battery-front-post-${x}`,[x,.615,-.159],[],.005);
  for(const y of[.43,.615,.8])rounded(group,[.412,.025,.022],white,`hoverboard-battery-front-rail-${y}`,[0,y,-.159],[],.005);
  // Rear lattice follows the visible front cage as an explicit visual estimate;
  // its material and frame remain within the existing battery enclosure bounds.
  for(const x of[-.194,0,.194])rounded(group,[.025,.385,.022],white,`hoverboard-battery-rear-post-${x}`,[x,.615,.162],[],.005).userData.estimated=true;
  for(const y of[.43,.615,.8])rounded(group,[.412,.025,.022],white,`hoverboard-battery-rear-rail-${y}`,[0,y,.162],[],.005).userData.estimated=true;
  for(const x of[-.194,.194])for(const z of[-.159,.16])rounded(group,[.027,.385,.027],white,`hoverboard-battery-corner-${x}-${z}`,[x,.615,z],[],.005);
  rounded(group,[.412,.025,.35],white,'hoverboard-battery-lid',[0,.806,0],[],.006);
  rounded(group,[.412,.024,.35],black,'hoverboard-battery-base',[0,.425,0],[],.005);
  rounded(group,[.17,.008,.052],black,'hoverboard-recessed-carry-handle',[0,.822,0],[],.009);
  for(const x of[-.145,.145])mesh(group,new THREE.CylinderGeometry(.009,.009,.006,8),metal,`hoverboard-battery-lid-fastener-${x}`,[x,.823,.10]);
  for(const side of[-1,1]){
    tube(group,[[side*.17,.72,.09],[side*.24,.61,.07],[side*.25,.47,-.05],[side*.36,.38,-.11]],.011,wireRed,`hoverboard-main-power-cable-${side}`);
    tube(group,[[side*.18,.68,.11],[side*.26,.58,.12],[side*.28,.46,.01],[side*.43,.35,.04]],.010,black,`hoverboard-return-cable-${side}`);
  }
  // Ten spatially separated propeller disks. Their exact positions are a visual
  // reconstruction; the author's motor count and exposed arrangement are source-led.
  const rotorPositions=[...[-1.13,1.13].flatMap(x=>[-.43,.43].map(z=>({x,z}))),...[-.55,0,.55].flatMap(x=>[-.73,.73].map(z=>({x,z})))];
  const rotorGroups=[],blurDiscs=[];
  const blurMaterial=ownMaterial(new THREE.MeshBasicMaterial({color:'#ad9b7e',transparent:true,opacity:.10,side:THREE.DoubleSide,depthWrite:false}));
  const bladeShape=new THREE.Shape();bladeShape.moveTo(.025,-.022);bladeShape.quadraticCurveTo(.12,-.040,.244,-.022);bladeShape.quadraticCurveTo(.278,-.012,.263,.012);bladeShape.quadraticCurveTo(.16,.045,.030,.020);bladeShape.closePath();
  const bladeGeometry=ownGeometry(new THREE.ExtrudeGeometry(bladeShape,{depth:.006,bevelEnabled:true,bevelSize:.002,bevelThickness:.001,bevelSegments:2,steps:1,curveSegments:16}));bladeGeometry.rotateX(Math.PI/2);
  const bladeVertices=bladeGeometry.attributes.position;let bladeRadius=0;for(let i=0;i<bladeVertices.count;i++)bladeRadius=Math.max(bladeRadius,Math.hypot(bladeVertices.getX(i),bladeVertices.getZ(i)));bladeGeometry.scale(.27/bladeRadius,1,.27/bladeRadius);
  for(const [i,p]of rotorPositions.entries()){
    const inner={x:clamp(p.x,-.87,.87),z:clamp(p.z,-.30,.30)};
    rod(group,[inner.x,.351,inner.z],[p.x,.351,p.z],.028,black,`hoverboard-short-motor-arm-${i}`);
    for(const axis of[-1,1])rod(group,[p.x+axis*.037,.331,p.z],[p.x+axis*.037,.26,p.z],.008,metal,`hoverboard-motor-mount-${i}-${axis}`);
    mesh(group,new THREE.CylinderGeometry(.058,.058,.105,24),black,`hoverboard-outboard-motor-${i}`,[p.x,.232,p.z]);
    mesh(group,new THREE.CylinderGeometry(.068,.068,.025,24),black,`hoverboard-motor-top-cap-${i}`,[p.x,.3,p.z]);
    mesh(group,new THREE.CylinderGeometry(.064,.060,.03,24),black,`hoverboard-motor-bottom-cap-${i}`,[p.x,.173,p.z]);
    for(let k=0;k<10;k++){const a=k/10*Math.PI*2;rod(group,[p.x+Math.cos(a)*.058,.204,p.z+Math.sin(a)*.058],[p.x+Math.cos(a)*.058,.271,p.z+Math.sin(a)*.058],.004,copper,`hoverboard-motor-winding-${i}-${k}`);}
    tube(group,[[inner.x,.375,inner.z],[p.x*.96,.392,p.z*.93],[p.x+.03,.33,p.z],[p.x+.033,.282,p.z+.02]],.005,wireRed,`hoverboard-exposed-red-lead-${i}`);
    tube(group,[[inner.x,.367,inner.z+.02],[p.x*.95,.385,p.z*.92],[p.x-.03,.328,p.z],[p.x-.03,.282,p.z+.025]],.005,black,`hoverboard-exposed-black-lead-${i}`);
    const rotor=new THREE.Group();rotor.name=`hoverboard-two-blade-propeller-${i}`;rotor.position.set(p.x,.145,p.z);group.add(rotor);
    for(const direction of[0,Math.PI]){const blade=new THREE.Mesh(bladeGeometry,wood);blade.name=`hoverboard-wood-propeller-${i}-${direction}`;blade.rotation.y=direction;blade.castShadow=true;rotor.add(blade);}
    mesh(rotor,new THREE.CylinderGeometry(.026,.026,.026,16),metal,`hoverboard-propeller-hub-${i}`,[0,.001,0]);
    const blur=mesh(group,new THREE.RingGeometry(.035,.27,64),blurMaterial,`hoverboard-propeller-motion-disc-${i}`,[p.x,.144,p.z],[-Math.PI/2,0,0]);blur.castShadow=false;blur.receiveShadow=false;blur.visible=false;
    rotorGroups.push(rotor);blurDiscs.push(blur);
  }
  // Original clothed adult rig, with fixed shoes and articulated hips/knees.
  // This is a representative player, not a likeness of the photographed creator.
  const library=createActorLibrary(THREE,{registerGeometry:ownGeometry,registerMaterial:ownMaterial});
  for(const [key,color]of Object.entries({coat:'#263136',pants:'#242b33',skin:'#be9478',hair:'#272522',bag:'#303437'}))library.palette[key].color.set(color);
  const human=new THREE.Group();human.name='hoverboard-standing-rider';human.scale.setScalar(1.055);human.position.y=deckY-.010;group.add(human);
  const appearance=library.appearance({id:0});appearance.bag=false;
  const rig=library.person.filter(p=>library.partApplies(p,appearance)).map(part=>{const result=new THREE.Mesh(part.geometry,part.material);result.name=`hoverboard-rider-${part.name}-${part.joint??'body'}`;result.matrixAutoUpdate=false;result.castShadow=true;result.receiveShadow=true;human.add(result);return{part,mesh:result};});
  const armour=new THREE.Group();armour.name='hoverboard-rider-chest-armour';armour.matrixAutoUpdate=false;human.add(armour);
  const armourMat=mat('#384349',.89,.06),strap=mat('#171f24',.98,.01);
  for(const side of[-1,1]){
    rounded(armour,[.142,.275,.054],armourMat,`hoverboard-chest-pad-${side}`,[side*.082,1.195,-.016],[0,side*.08,side*.07],.035);
    ellipsoid(armour,[.09,.067,.088],armourMat,`hoverboard-shoulder-pad-${side}`,[side*.179,1.305,.073]);
    tube(armour,[[side*.123,.955,.073],[side*.145,1.11,.005],[side*.123,1.327,.03]],.012,strap,`hoverboard-armour-strap-${side}`);
  }
  rounded(armour,[.31,.088,.047],armourMat,'hoverboard-abdominal-plate',[0,.965,.055],[],.018);
  rounded(armour,[.045,.034,.018],metal,'hoverboard-armour-buckle',[0,.932,.018],[],.007);
  // Subtle glasses sit over the existing adult facial geometry, not a visor.
  for(const side of[-1,1]){
    const lens=new THREE.TorusGeometry(.027,.003,6,20);lens.scale(1,.79,1);mesh(armour,lens,black,`hoverboard-rider-glasses-${side}`,[side*.036,1.524,-.063]);
    rod(armour,[side*.060,1.524,-.056],[side*.079,1.525,.01],.003,black,`hoverboard-glasses-temple-${side}`);
  }
  rod(armour,[-.009,1.524,-.064],[.009,1.524,-.064],.003,black,'hoverboard-glasses-bridge');
  const controllers=[];
  for(const side of[-1,1]){
    const controller=new THREE.Group();controller.name=`hoverboard-hand-controller-${side}`;human.add(controller);
    rounded(controller,[.042,.076,.04],black,`hoverboard-controller-grip-${side}`,[0,0,0],[],.012);
    mesh(controller,new THREE.CylinderGeometry(.008,.008,.009,12),metal,`hoverboard-controller-trigger-${side}`,[0,.04,-.008]);controllers.push(controller);
  }
  const wristPhone=new THREE.Group();wristPhone.name='hoverboard-left-wrist-phone';human.add(wristPhone);
  rounded(wristPhone,[.073,.129,.019],black,'hoverboard-wrist-phone-case',[0,0,0],[],.009);
  rounded(wristPhone,[.059,.108,.002],display,'hoverboard-wrist-phone-screen',[0,0,-.011],[],.002);
  for(const y of[-.025,.015,.035])rounded(wristPhone,[.036,.004,.001],cyan,`hoverboard-phone-status-line-${y}`,[0,y,-.013],[],.001);
  for(const side of[-1,1]){
    const x=side*.36*1.055;
    rounded(group,[.19,.018,.30],rubber,`hoverboard-boot-binding-pad-${side}`,[x,.428,.011],[],.016);
    tube(group,[[x-.067,.456,-.10],[x-.065,.505,-.07],[x+.065,.505,-.07],[x+.067,.456,-.10]],.008,metal,`hoverboard-boot-toe-binding-${side}`);
    tube(group,[[x-.062,.453,.075],[x-.054,.512,.07],[x+.054,.512,.07],[x+.062,.453,.075]],.012,strap,`hoverboard-boot-ankle-binding-${side}`);
  }
  const glow=new THREE.PointLight('#26c7d7',.22,2.7,2);glow.name='hoverboard-deck-underglow';glow.position.y=.29;group.add(glow);
  group.userData={forward:'-Z',units:'metres',estimatedDimensions:true,width:2.8,length:2,height:2.13,deckHeight:deckY,rotorRadius:.27,rotorCenters:rotorPositions.map(p=>({...p,y:.145})),supportFeet:feet,photograph:'Inspected Jimu News reporter photograph; motor positions / dimensions visually reconstructed'};
  const bodyBatch=batchRigidModelBody(THREE,group,{name:'hoverboard-rigid-body',ownGeometry});
  group.userData.rigidBodyBatch={sourceMeshes:bodyBatch.sourceMeshes,batches:bodyBatch.batches,savedDraws:bodyBatch.savedDraws};
  const bodyMatrix=new THREE.Matrix4(),torsoMatrix=new THREE.Matrix4(),balanceRotation=new THREE.Matrix4(),balancePivot=new THREE.Matrix4().makeTranslation(0,.89,.13),inverseBalancePivot=new THREE.Matrix4().makeTranslation(0,-.89,-.13),temp=new THREE.Vector3(),rotation=new THREE.Euler(),quaternion=new THREE.Quaternion();
  let elapsed=0,rotorAngle=0,disposed=false;
  function update(state={},dt=0){
    if(disposed)return;
    const step=clamp(number(dt),0,.1);elapsed+=step;
    const power=clamp(number(state.rotorPower),0,1);rotorAngle=(rotorAngle+power*step*116)%(Math.PI*2);
    rotorGroups.forEach((rotor,i)=>{rotor.rotation.y=(i%2?-1:1)*rotorAngle+i*.571;blurDiscs[i].visible=power>.25;});
    blurMaterial.opacity=.035+power*.10;
    const pitch=clamp(number(state.pitch),-.22,.22),lean=clamp(number(state.lean),-.27,.27),speed=Math.abs(number(state.speed));
    const crouch=Math.min(.055,speed*.003+Math.abs(number(state.verticalSpeed))*.008),dx=-lean*.14,dz=-pitch*.13;
    const agent={id:0,speed:0,progress:0,steeringAngle:0};const pose=library.samplePose(agent,'walk');pose.pitch=-.025-pitch*.55;
    rotation.set(0,0,-lean*.62);quaternion.setFromEuler(rotation);bodyMatrix.makeTranslation(dx,-crouch,dz).multiply(balancePivot).multiply(balanceRotation.makeRotationFromQuaternion(quaternion)).multiply(inverseBalancePivot);
    const torsoPart=library.person.find(p=>p.joint==='torso');library.partMatrix(torsoPart,agent,pose,torsoMatrix);
    for(const side of[-1,1]){
      const key=side<0?'L':'R';
      temp.set(side*.164,1.315,.078).applyMatrix4(torsoMatrix).applyMatrix4(bodyMatrix);pose.points[`shoulder${key}`]=temp.toArray();
      pose.points[`elbow${key}`]=[side*.235+dx,1.07-crouch,-.025+dz];
      pose.points[`hand${key}`]=[side*.273+dx,.875-crouch,-.10+dz];
      pose.points[`hip${key}`]=[side*.105+dx,.89-crouch,.13+dz];
      pose.points[`knee${key}`]=[side*.255+dx*.35,.485-crouch*.45,-.035+dz*.35];
      pose.points[`ankle${key}`]=[side*.36,.065,.045];
    }
    for(const {part,mesh:partMesh}of rig){library.partMatrix(part,agent,pose,partMesh.matrix);if(part.joint==='torso'||!part.joint)partMesh.matrix.premultiply(bodyMatrix);partMesh.matrixWorldNeedsUpdate=true;}
    armour.matrix.copy(bodyMatrix).multiply(torsoMatrix);armour.matrixWorldNeedsUpdate=true;
    controllers.forEach((controller,i)=>{const key=i===0?'L':'R';controller.position.fromArray(pose.points[`hand${key}`]);controller.position.y-=.022;controller.rotation.set(.16,0,i===0?-.08:.08);});
    const hand=pose.points.handL;
    wristPhone.position.set(hand[0],hand[1]+.102,hand[2]-.027);wristPhone.rotation.set(-.06,.10,-.045);
    group.updateMatrixWorld(true);
  }
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();group.clear();geometries.clear();materials.clear();textures.clear();}
  update({},0);return{group,update,dispose};
}
