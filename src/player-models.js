import { createBoatModel } from './boat-model.js';
import { createSpiderModel } from './spider-model.js';
import { createHoverboardModel } from './hoverboard-model.js';
import { createRoadsterModel } from './roadster-model.js';
import {createActorLibrary} from './commute-actors.js';

// Original, metre-scale player assets. The helicopter is an exploration vehicle,
// not a claim about aircraft operating at HUST. All resources belong to this rig.
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function createPlayerModels(THREE){
  const geometries=new Set(),materials=new Set();
  const ownGeometry=g=>(geometries.add(g),g);
  const ownMaterial=m=>(materials.add(m),m);
  const group=new THREE.Group();group.name='player';
  const walker=new THREE.Group(),scooter=new THREE.Group(),helicopter=new THREE.Group();
  walker.name='player-walk';scooter.name='player-scooter';helicopter.name='player-helicopter';
  walker.position.y=-.024;
  const roadster=createRoadsterModel(THREE);roadster.group.name='player-roadster';
  const hoverboard=createHoverboardModel(THREE);hoverboard.group.name='player-hoverboard';
  // Walking must not synchronously generate the Spider skin while its worker
  // is still preparing it. Parked suits use their own lightweight mesh.
  const spiderRoot=new THREE.Group();spiderRoot.name='player-spider';let spider=null;
  const boat=createBoatModel(THREE,{occupied:true});boat.group.name='player-boat';
  group.add(walker,scooter,helicopter,roadster.group,hoverboard.group,spiderRoot,boat.group);
  group.userData={forward:'-Z',units:'metres',contactOrigin:true};
  const library=createActorLibrary(THREE,{registerGeometry:ownGeometry,registerMaterial:ownMaterial});
  const playerColors={paint:'#c9d6cc',coat:'#346d6b',pants:'#343f46',skin:'#c59a7a',hair:'#302923',bag:'#ad704c'};
  for(const [key,color]of Object.entries(playerColors))library.palette[key].color.set(color);
  const character={id:0,colorIndex:0};
  const appearance=library.appearance(character);
  function actorParts(parent,parts,selectedAppearance=appearance,paintOverride=null){
    return parts.filter(part=>library.partApplies(part,selectedAppearance)).map(part=>{
      const mesh=new THREE.Mesh(part.geometry,paintOverride&&part.colorKey==='paint'?paintOverride:part.material);
      mesh.name=`player-${part.name}-${part.joint??'body'}`;
      mesh.matrixAutoUpdate=false;mesh.castShadow=true;mesh.receiveShadow=true;
      parent.add(mesh);return{mesh,part};
    });
  }
  const walkingParts=actorParts(walker,library.walker);
  let ridingParts=actorParts(scooter,library.scooter);
  const selectedScooterPaint=ownMaterial(library.palette.paint.clone());
  function setScooterAppearance(source={}){
    const selected=library.appearance(source),colors=library.colors.paint;
    selectedScooterPaint.color.set(colors[((selected.colorIndex%colors.length)+colors.length)%colors.length]);
    scooter.clear();
    // Match the borrowed scooter's shell and paint while retaining the player's
    // own clothes/body. Shared geometry survives subsequent pickups.
    ridingParts=[...actorParts(scooter,library.vehicle,selected,selectedScooterPaint),...actorParts(scooter,library.person)];
    scooter.userData.appearance={family:selected.family,colorIndex:selected.colorIndex};
  }
  function material(color,roughness=.5,metalness=.15,extra={}){
    return ownMaterial(new THREE.MeshStandardMaterial({color,roughness,metalness,...extra}));
  }
  const paint=material('#d7ded5',.38,.28),accent=material('#2f6264',.38,.25),dark=material('#303d40',.62,.4),metal=material('#8e9997',.3,.78);
  const glass=material('#29444a',.16,.42),rubber=material('#282e2e',.94,0),rotorMaterial=material('#353e3d',.7,.4),tipMaterial=material('#dbc9a0',.55,.15);
  const red=material('#9e3a2a',.35,.2,{emissive:'#3d0c04',emissiveIntensity:.2});
  const green=material('#408566',.35,.2,{emissive:'#0c3725',emissiveIntensity:.2});
  function mesh(parent,geometry,mat,name,position=[0,0,0],rotation=[0,0,0]){
    const result=new THREE.Mesh(ownGeometry(geometry),mat);
    result.name=name;result.position.set(...position);result.rotation.set(...rotation);
    result.castShadow=true;result.receiveShadow=true;parent.add(result);return result;
  }
  function rod(parent,a,b,r,mat,name,rTop=r){
    const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),delta=vb.clone().sub(va);
    const result=mesh(parent,new THREE.CylinderGeometry(rTop,r,delta.length(),10),mat,name,va.clone().add(vb).multiplyScalar(.5).toArray());
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return result;
  }
  function tube(parent,points,r,mat,name){
    return mesh(parent,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),24,r,8,false),mat,name);
  }
  function ellipsoid(parent,radii,mat,name,position){
    const g=new THREE.SphereGeometry(1,24,16);g.scale(...radii);return mesh(parent,g,mat,name,position);
  }
  // Longitudinal shell sections: z, width radius, height radius, centre y.
  // The bulbous cabin narrows into a raised engine bay and a separate tail boom.
  const sections=[[-2.02,.055,.09,1.16],[-1.84,.40,.36,1.24],[-1.42,.69,.63,1.40],[-.80,.80,.80,1.47],[-.10,.79,.84,1.47],[.64,.65,.69,1.48],[1.18,.39,.43,1.59],[1.45,.18,.22,1.71]];
  function sectionAt(z){
    for(let i=1;i<sections.length;i++)if(z<=sections[i][0]){
      const a=sections[i-1],b=sections[i],t=clamp((z-a[0])/(b[0]-a[0]),0,1);
      return a.map((v,j)=>j===0?z:v+(b[j]-v)*t);
    }
    return sections.at(-1);
  }
  function surfacePoint(z,angle,offset=0){const[,rx,ry,y]=sectionAt(z);return[(rx+offset)*Math.cos(angle),y+(ry+offset)*Math.sin(angle),z];}
  function shell(zs,from=0,to=Math.PI*2,offset=0){
    const positions=[],indices=[],steps=32;
    for(const z of zs)for(let i=0;i<=steps;i++)positions.push(...surfacePoint(z,from+(to-from)*i/steps,offset));
    for(let j=0;j<zs.length-1;j++)for(let i=0;i<steps;i++){const a=j*(steps+1)+i,b=a+steps+1;indices.push(a,a+1,b,a+1,b+1,b);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  mesh(helicopter,shell(sections.map(s=>s[0])),paint,'helicopter-fuselage');
  // Two curved front panes share a narrow structural centre pillar. The door
  // windows and painted sills stay on the same measured section surface.
  for(const [side,a,b]of[['right',.12,Math.PI/2-.035],['left',Math.PI/2+.035,Math.PI-.12]]){
    mesh(helicopter,shell([-1.88,-1.64,-1.42,-1.10,-.80,-.49],a,b,.012),glass,`helicopter-front-glass-${side}`);
    for(const angle of[a,b])tube(helicopter,[-1.88,-1.64,-1.42,-1.10,-.80,-.49].map(z=>surfacePoint(z,angle,.026)),.019,paint,`helicopter-windscreen-frame-${side}`);
  }
  for(const side of[-1,1]){
    const a=side===1?-.08:Math.PI-1.13,b=side===1?1.13:Math.PI+.08;
    mesh(helicopter,shell([-.38,-.10,.32,.63],a,b,.015),glass,`helicopter-door-glass-${side}`);
    for(const z of[-.40,.66])tube(helicopter,Array.from({length:8},(_,i)=>surfacePoint(z,a+(b-a)*i/7,.024)),.016,dark,`helicopter-door-seam-${side}`);
    const lowAngle=side===1?-.37:Math.PI+.37;
    tube(helicopter,[-1.48,-.8,-.1,.64,1.06].map(z=>surfacePoint(z,lowAngle,.017)),.037,accent,`helicopter-livery-stripe-${side}`);
    rod(helicopter,[side*.775,1.31,.22],[side*.775,1.31,.42],.018,metal,`helicopter-door-handle-${side}`);
    rod(helicopter,[side*.74,.77,-.47],[side*.97,.49,-.47],.022,metal,`helicopter-footstep-brace-${side}`);
    rod(helicopter,[side*.97,.49,-.66],[side*.97,.49,-.24],.025,dark,`helicopter-footstep-${side}`);
  }
  // Engine hump, cowl seams, air intakes and exhaust make the upper silhouette
  // distinguishable from the windowed cabin rather than a single capsule.
  ellipsoid(helicopter,[.40,.30,.64],accent,'helicopter-engine-cowl',[0,2.18,.46]);
  for(const side of[-1,1]){
    ellipsoid(helicopter,[.035,.13,.28],dark,`helicopter-intake-${side}`,[side*.37,2.2,.46]);
    for(let i=0;i<5;i++)rod(helicopter,[side*.405,2.11,.27+i*.08],[side*.405,2.28,.27+i*.08],.009,metal,`helicopter-intake-louvre-${side}-${i}`);
    rod(helicopter,[side*.20,2.19,.87],[side*.24,2.25,1.21],.10,metal,`helicopter-exhaust-${side}`,.085);
    ellipsoid(helicopter,[.076,.076,.012],dark,`helicopter-exhaust-opening-${side}`,[side*.24,2.25,1.22]);
  }
  rod(helicopter,[0,1.72,1.13],[0,2.18,4.32],.235,paint,'helicopter-tail-boom',.075);
  // Thin, closed fin profiles have an airfoil-like plan, not large cuboid blocks.
  function fin(points,thickness,mat,name,axis='x'){
    const shape=new THREE.Shape();shape.moveTo(...points[0]);for(const p of points.slice(1))shape.lineTo(...p);shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.012,bevelThickness:.012});
    if(axis==='x'){geometry.rotateY(Math.PI/2);geometry.translate(-thickness/2,0,0);}else{geometry.rotateX(-Math.PI/2);geometry.translate(0,-thickness/2,0);}
    return mesh(helicopter,geometry,mat,name);
  }
  // Extrusion XY is transformed so -local-X becomes world Z on a vertical fin.
  fin([[-3.79,2.16],[-4.06,3.03],[-4.40,3.16],[-4.46,1.66],[-4.13,1.65]],.07,accent,'helicopter-vertical-fin');
  fin([[-1.09,-3.64],[-.20,-3.78],[.20,-3.78],[1.09,-3.64],[1.09,-3.39],[-1.09,-3.39]],.045,paint,'helicopter-tailplane','y').position.y=2.12;
  ellipsoid(helicopter,[.07,.035,.04],red,'helicopter-port-navigation-light',[-1.1,2.13,3.54]);
  ellipsoid(helicopter,[.07,.035,.04],green,'helicopter-starboard-navigation-light',[1.1,2.13,3.54]);
  // Skids are continuous bent tubes. Their lowest surface defines root y=0.
  for(const side of[-1,1]){
    const skidPath=new THREE.CurvePath(),v=(y,z)=>new THREE.Vector3(side*1.02,y,z);
    skidPath.add(new THREE.CubicBezierCurve3(v(.27,-1.97),v(.10,-1.83),v(.065,-1.65),v(.065,-1.34)));
    skidPath.add(new THREE.LineCurve3(v(.065,-1.34),v(.065,.90)));
    skidPath.add(new THREE.CubicBezierCurve3(v(.065,.90),v(.065,1.08),v(.075,1.28),v(.10,1.36)));
    mesh(helicopter,new THREE.TubeGeometry(skidPath,36,.065,8,false),metal,`helicopter-skid-${side}`);
    for(const z of[-.90,.69])tube(helicopter,[[side*.48,.94,z],[side*.61,.56,z],[side*1.02,.15,z]],.043,metal,`helicopter-skid-strut-${side}-${z}`);
    mesh(helicopter,new THREE.BoxGeometry(.18,.045,.44),rubber,`helicopter-skid-wear-pad-${side}`,[side*1.02,.076,-.43]);
  }
  rod(helicopter,[0,2.28,.12],[0,2.91,.12],.074,metal,'helicopter-main-mast');
  ellipsoid(helicopter,[.22,.10,.22],dark,'helicopter-main-hub',[0,2.94,.12]);
  const mainRotor=new THREE.Group();mainRotor.name='helicopter-main-rotor';mainRotor.position.set(0,3.04,.12);helicopter.add(mainRotor);
  for(let i=0;i<4;i++){
    const arm=new THREE.Group();arm.rotation.y=i*Math.PI/2;mainRotor.add(arm);
    rod(arm,[.10,0,0],[.48,0,0],.024,metal,`helicopter-rotor-pitch-link-${i}`);
    const shape=new THREE.Shape();shape.moveTo(.42,-.09);shape.lineTo(3.68,-.12);shape.lineTo(3.86,.02);shape.lineTo(3.83,.095);shape.lineTo(.42,.14);shape.closePath();
    const blade=new THREE.ExtrudeGeometry(shape,{depth:.024,bevelEnabled:false});blade.rotateX(Math.PI/2);blade.translate(0,.012,0);
    mesh(arm,blade,rotorMaterial,`helicopter-main-blade-${i}`,[0,0,0],[.035,0,0]);
    mesh(arm,new THREE.BoxGeometry(.14,.026,.18),tipMaterial,`helicopter-main-blade-tip-${i}`,[3.73,0,-.005],[.035,0,0]);
  }
  const rotorBlurMaterial=ownMaterial(new THREE.MeshBasicMaterial({color:'#65716d',transparent:true,opacity:.035,side:THREE.DoubleSide,depthWrite:false}));
  const rotorBlur=mesh(helicopter,new THREE.RingGeometry(.65,3.86,96),rotorBlurMaterial,'helicopter-rotor-motion-disc',[0,3.04,.12],[-Math.PI/2,0,0]);
  rotorBlur.castShadow=false;rotorBlur.receiveShadow=false;
  const tailRotor=new THREE.Group();tailRotor.name='helicopter-tail-rotor';tailRotor.position.set(-.19,2.19,4.22);helicopter.add(tailRotor);
  rod(helicopter,[-.31,2.19,4.22],[.05,2.19,4.22],.045,metal,'helicopter-tail-rotor-shaft');
  for(let i=0;i<3;i++){
    const blade=mesh(tailRotor,new THREE.BoxGeometry(.032,.56,.092),rotorMaterial,`helicopter-tail-blade-${i}`);
    blade.position.set(0,Math.cos(i*Math.PI*2/3)*.31,Math.sin(i*Math.PI*2/3)*.31);blade.rotation.x=i*Math.PI*2/3;
  }
  rod(helicopter,[0,2.28,-.20],[0,2.72,-.40],.012,dark,'helicopter-roof-antenna');
  rod(helicopter,[0,.70,1.07],[0,.36,1.34],.013,dark,'helicopter-belly-antenna');
  helicopter.userData={representative:true,lengthMetres:6.5,rotorDiameterMetres:7.72,skidWidthMetres:2.17};
  const modeGroups={walk:walker,scooter,helicopter,roadster:roadster.group,hoverboard:hoverboard.group,spider:spiderRoot,boat:boat.group};
  // All templates remain attached for parked-prop extraction and mode changes.
  // Object3D normally walks hidden subtrees too; a dormant rig need not compose
  // hundreds of wheel/panel/bone matrices in every main, shadow and water pass.
  // Clones keep standard Group behavior, so parked templates are unaffected.
  for(const root of Object.values(modeGroups)){
    const updateWorld=root.updateMatrixWorld;
    root.updateMatrixWorld=function(force){if(this.visible)return updateWorld.call(this,force);};
  }
  let rotorAngle=0,disposed=false,walkProgress=0,previousWalkDistance=null,previousWalkSpeed=0;
  function ensureMode(mode){
    if(disposed)return false;
    if(mode==='spider'&&!spider){spider=createSpiderModel(THREE);spider.group.name='spider-rig';spiderRoot.add(spider.group);spiderRoot.userData=spider.group.userData;}
    return !!modeGroups[mode];
  }
  // Keep the original leg/arm poses and their pre-speed-up cadence. Travel is
  // faster now, but that must not fast-forward the familiar walking animation.
  const walkingAnimationSpeed=speed=>speed<=3.2?speed*2.2/3.2:2.2+(Math.min(speed,5.2)-3.2)*1.6/2;
  function update(state={},dt=0){
    if(disposed)return;
    const mode=state.mode??'walk';
    ensureMode(mode);
    group.position.set(finite(state.x),finite(state.y),finite(state.z));
    group.rotation.set(finite(state.pitch),finite(state.yaw),finite(state.lean),'YXZ');
    for(const[key,root]of Object.entries(modeGroups))root.visible=key===mode;
    // Update the common world origin before the active rig computes world-space
    // wrists/anchors; no hidden rig is traversed by either of these calls.
    group.updateWorldMatrix(true,false);
    modeGroups[mode]?.updateMatrixWorld(true);
    if(mode==='spider')spider.update(state,dt);
    if(mode==='hoverboard')hoverboard.update(state,dt);
    if(mode==='roadster')roadster.update(state,dt);
    if(mode==='boat')boat.update(state,dt);
    const speed=Math.abs(finite(state.speed));
    if(mode==='walk'){
      const distance=finite(state.distance);
      if(previousWalkDistance!==null&&distance>=previousWalkDistance){
        const averageSpeed=(previousWalkSpeed+speed)/2;
        // Integrate distance deltas: multiplying total distance by a changing
        // speed ratio would snap the feet every time Shift is pressed/released.
        walkProgress+=(distance-previousWalkDistance)*(averageSpeed>1e-6?walkingAnimationSpeed(averageSpeed)/averageSpeed:2.2/3.2);
      }else walkProgress=0;
      previousWalkDistance=distance;previousWalkSpeed=speed;
    }else{previousWalkDistance=null;previousWalkSpeed=0;}
    if(mode==='walk'||mode==='scooter'){
      const agent={...character,speed:mode==='walk'?walkingAnimationSpeed(speed):speed,progress:mode==='walk'?walkProgress:finite(state.distance),steeringAngle:finite(state.steeringAngle),lean:finite(state.lean),footDown:clamp(1-speed/.75,0,1)};
      const pose=library.samplePose(agent,mode);
      const wet=mode==='walk'&&state.waterMode&&state.waterMode!=='dry';
      walker.rotation.y=wet&&state.waterMode!=='swim'?Math.PI/2:0;
      if(wet){
        const boarding=state.waterMode!=='swim',phase=finite(state.elapsed)*3;
        pose.pitch=boarding?-.12:-.20;
        for(const side of[-1,1]){
          const key=side<0?'L':'R',stroke=Math.sin(phase+side*Math.PI/2);
          pose.points[`hand${key}`]=[side*(boarding?.52:.42),boarding?1.12:1.1+stroke*.18,boarding?.08:stroke*.4-.2];
          pose.points[`elbow${key}`]=[side*.36,1.20,boarding?.04:stroke*.2];
          pose.points[`knee${key}`]=[side*(boarding?.20:.12),.48,boarding?-.10:stroke*.12];
          pose.points[`ankle${key}`]=[side*(boarding?.34:.14),.07,boarding?.10:-stroke*.16];
        }
      }

      for(const {mesh,part}of mode==='walk'?walkingParts:ridingParts){library.partMatrix(part,agent,pose,mesh.matrix);mesh.matrixWorldNeedsUpdate=true;}
    }
    const power=clamp(finite(state.rotorPower,mode==='helicopter'?1:0),0,1);
    rotorAngle=(rotorAngle+clamp(finite(dt),0,.10)*power*36)%(Math.PI*2);
    mainRotor.rotation.y=rotorAngle;tailRotor.rotation.x=-rotorAngle*5;
    rotorBlur.visible=mode==='helicopter'&&power>.55;
    modeGroups[mode]?.updateMatrixWorld(true);
  }
  function dispose(){
    if(disposed)return;disposed=true;group.removeFromParent();roadster.dispose();hoverboard.dispose();spider?.dispose();boat.dispose();
    for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
    group.clear();geometries.clear();materials.clear();
  }
  update({mode:'walk'});
  return{group,update,dispose,setScooterAppearance,ensureMode,get spiderReady(){return !!spider;}};
}
