import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

// Original, metre-scale procedural assets informed by public campus photographs.
// See docs/traffic-photo-study.md for the HUST lakeside commute, Yunyuan
// handlebar/basket and 2022 winter-rider photographs actually inspected.
// These are representative silhouettes, not surveyed brands or scanned people.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const blend=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
const rotateY=(p,angle,pivot=[0,.81,-.49])=>{const x=p[0]-pivot[0],z=p[2]-pivot[2],c=Math.cos(angle),s=Math.sin(angle);return[pivot[0]+x*c+z*s,p[1],pivot[2]-x*s+z*c];};
const torsoPoint=(p,pitch)=>{const y=p[1]-.87,z=p[2]-.20,c=Math.cos(pitch),s=Math.sin(pitch);return[p[0],.87+y*c-z*s,.20+y*s+z*c];};

export function actorAppearance(agent={}){
  const id=Math.abs(Number(agent.id??agent.colorIndex??0))||0;
  return{family:id%3,outfit:Math.floor(id/3)%3,bag:id%5<3,hair:id%7===3?'long':id%7===5?'ponytail':'short',colorIndex:agent.colorIndex??id,skinIndex:Math.floor(id/7)%5};
}
/** Contacts are shared by the mesh rig and tests; hands follow actual steering.
 * Only the support foot lowers at a stop, the other remains on the floorboard.
 */
export function sampleActorPose(agent={},kind='scooter'){
  const speed=Math.max(0,agent.speed??0),walk=kind==='walk',appearance=actorAppearance(agent);
  const steering=clamp(agent.steeringAngle??0,-.5,.5),footDown=walk?0:clamp(agent.footDown??(1-speed/.75),0,1);
  const pitch=walk?-.025:-.025-Math.min(speed/6,1)*.09;
  const phase=agent.swimming?agent.swimPhase:(agent.progress??0)*5.2+(Number(agent.id??0)%7)*.14;
  const stride=walk?Math.sin(phase)*.28*Math.min(speed/1.2,1):0;
  const pose={steering,footDown,pitch,lean:walk?0:clamp(agent.lean??0,-.18,.18),appearance,points:{}};
  for(const side of[-1,1]){
    const key=side<0?'L':'R';
    const shoulder=torsoPoint([side*.164,1.315,.078],pitch);
    let hand,elbow,hip,knee,ankle;
    if(walk){
      hand=[side*.245,.91,-stride*side*.55+.025];elbow=[side*.225,1.115,-stride*side*.35-.015];
      hip=[side*.105,.89,.10];knee=[side*.105,.49,.075-stride*side*.52];
      ankle=[side*.105,.065+Math.max(0,-Math.cos(phase+(side<0?Math.PI:0)))*.085*Math.min(speed,1),.075+stride*side];
    }else{
      hand=rotateY([side*.315,1.075,-.51],steering);
      elbow=[side*.255,1.145,mix(shoulder[2],hand[2],.54)+.01];
      hip=[side*.115,.85,.24];
      // A slightly asymmetric stance avoids the mannequin's identical bent knees.
      const support=side===(Number(agent.id??0)%4===0?1:-1)?footDown:0;
      knee=blend([side*.19,.585,-.13],[side*.265,.50,.095],support);
      ankle=blend([side*.145,.397,-.14],[side*.285,.045,.115],support);
    }
    if(agent.swimming){
      const stroke=Math.sin(phase+side*Math.PI/2);
      hand=[side*(.34+.18*stroke),1.1+.48*Math.cos(phase+side),-.25+.35*stroke];
      elbow=[side*.33,1.24,-.12+.18*stroke];
      knee=[side*.13,.48,.1+stroke*.13];ankle=[side*.13,.06,.1-stroke*.2];
    }
    Object.assign(pose.points,{[`shoulder${key}`]:shoulder,[`elbow${key}`]:elbow,[`hand${key}`]:hand,[`hip${key}`]:hip,[`knee${key}`]:knee,[`ankle${key}`]:ankle});
  }
  return pose;
}

export function createActorLibrary(THREE,{registerGeometry=()=>{},registerMaterial=()=>{}}={}){
  const material=(color,roughness,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness});registerMaterial(m);return m;};
  const palette={paint:material('#ffffff',.39,.12),rubber:material('#23272a',.94),metal:material('#9ba3a3',.38,.7),darkMetal:material('#444c4f',.52,.5),seat:material('#303335',.92),glass:material('#c3d0ce',.2,.3),lamp:material('#e4e3d3',.25,.1),tail:material('#a82e25',.31),skin:material('#ffffff',.91),coat:material('#ffffff',.97),pants:material('#ffffff',.98),hair:material('#ffffff',.98),bag:material('#ffffff',.98),sole:material('#bfc0b7',.95)};
  const colors={paint:['#d6e3d8','#b84235','#303943','#d3c3a4','#4d747c','#dbddd5','#646d74','#b3bdaf'],coat:['#ded9cb','#80909a','#414f45','#a1856c','#344550','#bda29a','#42444c','#d8d2c5'],pants:['#252c35','#343b40','#4f514c','#6e7169','#333637'],skin:['#bb8d6e','#ca9e80','#d8ae91','#b88667','#d0a88e'],hair:['#242321','#322b27','#191e1f','#44382d'],bag:['#4d5752','#383e45','#817561','#526077','#978d77']};
  const box=(x,y,z,r=.025)=>new RoundedBoxGeometry(x,y,z,2,Math.min(r,x*.4,y*.4,z*.4));
  const ellipsoid=(x,y,z,segments=12)=>{const g=new THREE.SphereGeometry(1,segments,8);g.scale(x,y,z);return g;};
  function loft(sections,sides=12){
    const vertices=[],uv=[],indices=[];
    for(let j=0;j<sections.length;j++){
      const[y,rx,rz,cz=0,cx=0]=sections[j];
      for(let i=0;i<=sides;i++){const t=i/sides*Math.PI*2;vertices.push(cx+rx*Math.cos(t),y,cz+rz*Math.sin(t));uv.push(i/sides,j/(sections.length-1));}
    }
    for(let j=0;j<sections.length-1;j++)for(let i=0;i<sides;i++){const a=j*(sides+1)+i,b=a+sides+1;indices.push(a,b,a+1,a+1,b,b+1);}
    for(const end of[0,sections.length-1]){const start=end*(sides+1);for(let i=1;i<sides-1;i++)indices.push(start,start+i+(end?0:1),start+i+(end?1:0));}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  function finishGeometry(g){g.computeBoundingSphere();registerGeometry(g);return g;}
  function author(){
    const components=new Map();
    function add(name,geometry,pos=[0,0,0],rotation=[0,0,0],meta={}){
      geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(1,1,1)));
      const key=[name,meta.joint??'fixed',meta.family??'',meta.outfit??'',meta.accessory??'',meta.segment?.join('/')??'',meta.anchor??''].join(':');
      if(!components.has(key))components.set(key,{name,material:palette[name],colorKey:colors[name]?name:null,...meta,list:[]});
      const nonIndexed=geometry.index?geometry.toNonIndexed():geometry;if(geometry.index)geometry.dispose();components.get(key).list.push(nonIndexed);
    }
    function rod(name,a,b,r=.012,meta={},r2=r){const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),direction=vb.clone().sub(va),g=new THREE.CylinderGeometry(r2,r,direction.length(),8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));add(name,g,va.add(vb).multiplyScalar(.5).toArray(),[0,0,0],meta);}
    function finish(){return[...components.values()].map(({list,...part})=>{const g=mergeGeometries(list,false);list.forEach(g=>g.dispose());return{...part,geometry:finishGeometry(g)};});}
    return{add,rod,finish};
  }
  function wheel(a,front,detail){
    const joint=front?'frontWheel':'rearWheel';
    a.add('rubber',new THREE.TorusGeometry(.208,.046,detail?6:4,detail?20:10),[0,0,0],[0,Math.PI/2,0],{joint});
    a.add('metal',new THREE.TorusGeometry(.173,.012,4,detail?18:8),[0,0,0],[0,Math.PI/2,0],{joint});
    a.add('darkMetal',new THREE.CylinderGeometry(front?.052:.094,front?.052:.094,.115,10),[0,0,0],[0,0,Math.PI/2],{joint});
    if(detail)for(let i=0;i<6;i++){const r=i*Math.PI/3;a.rod('metal',[0,.055*Math.cos(r),.055*Math.sin(r)],[0,.169*Math.cos(r+.19),.169*Math.sin(r+.19)],.008,{joint});}
  }
  function buildVehicle(detail=true){
    const a=author();wheel(a,true,detail);wheel(a,false,detail);
    const steering={joint:'steering'};
    for(const family of[0,1]){a.add('seat',box(.395,.085,.555,.035),[0,.738,.28],[0,0,0],{family});a.add('seat',box(.35,.025,.48,.01),[0,.783,.28],[0,0,0],{family});}
    a.add('seat',loft([[.718,.10,.15,.23],[.754,.147,.20,.24],[.784,.125,.17,.24]],12),[0,0,0],[0,0,0],{family:2});
    for(const side of[-1,1]){a.rod('darkMetal',[side*.09,.34,-.20],[side*.10,.66,.20],.018,{family:2});a.rod('darkMetal',[side*.10,.66,.20],[side*.09,.34,.50],.018,{family:2});a.rod('metal',[side*.09,.34,.15],[side*.19,.34,.15],.014,{family:2});a.add('rubber',box(.055,.025,.12,.006),[side*.20,.34,.15],[0,0,0],{family:2});}
    a.add('darkMetal',box(.35,.065,.7),[0,.316,.01]);
    a.add('rubber',box(.33,.025,.47,.01),[0,.358,-.08]);
    a.rod('darkMetal',[-.07,.3,.56],[-.09,.55,.36],.025);a.rod('darkMetal',[.07,.3,.56],[.09,.55,.36],.025);
    a.rod('metal',[0,.52,-.48],[0,1.075,-.51],.022,steering);
    a.rod('darkMetal',[-.34,1.075,-.51],[.34,1.075,-.51],.017,steering);
    for(const side of[-1,1]){
      a.rod('metal',[side*.075,.255,-.59],[side*.095,.65,-.46],.02,steering);
      a.rod('rubber',[side*.255,1.075,-.51],[side*.37,1.075,-.50],.027,steering);
      a.rod('metal',[side*.29,1.055,-.545],[side*.365,1.05,-.56],.009,steering);
      if(detail){a.rod('darkMetal',[side*.265,1.08,-.51],[side*.32,1.28,-.58],.008,steering);a.add('darkMetal',ellipsoid(.065,.039,.012),[side*.33,1.295,-.58],[0,0,side*.16],steering);a.add('glass',ellipsoid(.054,.031,.005),[side*.33,1.295,-.565],[0,0,side*.16],steering);}
      a.rod('metal',[side*.13,.5,.48],[side*.13,.31,.56],.018);
    }
    a.add('paint',loft([[.38,.16,.23,.39],[.45,.205,.28,.34],[.61,.20,.25,.33],[.69,.15,.21,.31]],12),[0,0,0],[0,0,0],{family:0});
    a.add('paint',loft([[.36,.18,.27,.34],[.46,.23,.29,.34],[.64,.225,.245,.29],[.71,.16,.21,.28]],16),[0,0,0],[0,0,0],{family:1});
    a.add('paint',loft([[.38,.13,.18,.34],[.63,.15,.19,.32],[.69,.12,.17,.31]],10),[0,0,0],[0,0,0],{family:2});
    // Broad front fairings are curved sections, while the third family keeps
    // an exposed narrow steering column and a small battery enclosure.
    for(const family of[0,1])a.add('paint',loft(family===0?[[.34,.17,.065,-.33],[.51,.195,.085,-.42],[.76,.18,.075,-.5],[.91,.15,.065,-.52]]:[[.34,.18,.065,-.33],[.50,.215,.10,-.42],[.76,.21,.085,-.51],[.94,.15,.065,-.52]],14),[0,0,0],[0,0,0],{...steering,family});
    a.add('paint',box(.14,.32,.15,.05),[0,.66,-.49],[0,0,0],{...steering,family:2});
    a.add('paint',ellipsoid(.14,.085,.083),[0,1.055,-.53],[0,0,0],steering);
    a.add('lamp',ellipsoid(.095,.048,.012),[0,1.055,-.607],[0,0,0],steering);
    a.add('tail',box(.16,.045,.016,.01),[0,.66,.57]);
    a.add('darkMetal',box(.15,.12,.018,.009),[0,.45,.66],[.25,0,0]);
    // A separate curved mudguard follows the wheel; no solid disk fills it.
    for(const front of[true,false]){const g=new THREE.TorusGeometry(.274,.023,4,16,Math.PI);g.rotateY(Math.PI/2);a.add('paint',g,[0,.255,front?-.59:.56],[0,0,0],front?steering:{});}
    if(detail){
      for(const family of[0,1])for(const side of[-1,1]){
        const width=family===1?1.08:1,edge=new THREE.CatmullRomCurve3([new THREE.Vector3(side*.16*width,.365,-.335),new THREE.Vector3(side*.193*width,.515,-.425),new THREE.Vector3(side*.177*width,.76,-.50),new THREE.Vector3(side*.145,.905,-.52)]);
        a.add('rubber',new THREE.TubeGeometry(edge,10,.005,4,false),[0,0,0],[0,0,0],{...steering,family});
        const seam=new THREE.CatmullRomCurve3([new THREE.Vector3(side*.193,.48,.17),new THREE.Vector3(side*.215,.51,.32),new THREE.Vector3(side*.178,.53,.51)]);
        a.add('darkMetal',new THREE.TubeGeometry(seam,8,.004,4,false),[0,0,0],[0,0,0],{family});
      }
      for(const side of[-1,1]){const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(side*.26,1.055,-.535),new THREE.Vector3(side*.17,.94,-.48),new THREE.Vector3(side*.06,.82,-.47),new THREE.Vector3(side*.06,.60,-.48)]);a.add('rubber',new THREE.TubeGeometry(curve,9,.004,3,false),[0,0,0],[0,0,0],steering);}
      for(const z of[-.81,-.63])for(const y of[.76,.94])a.rod('darkMetal',[-.19,y,z],[.19,y,z],.006,steering);
      for(const x of[-.19,.19])for(const y of[.76,.94])a.rod('darkMetal',[x,y,-.81],[x,y,-.63],.006,steering);
      for(let x=-.19;x<.20;x+=.063){a.rod('darkMetal',[x,.76,-.81],[x,.94,-.81],.004,steering);a.rod('darkMetal',[x,.76,-.81],[x,.76,-.63],.004,steering);}
      for(const x of[-.19,.19])for(const z of[-.81,-.72,-.63])a.rod('darkMetal',[x,.76,z],[x,.94,z],.004,steering);
      for(const z of[-.19,-.08,.03])a.rod('seat',[-.135,.375,z],[.135,.375,z],.004);
      a.rod('darkMetal',[-.17,.67,.46],[-.17,.7,.65],.012);a.rod('darkMetal',[.17,.67,.46],[.17,.7,.65],.012);a.rod('darkMetal',[-.17,.7,.65],[.17,.7,.65],.012);
    }
    return a.finish();
  }
  function buildHuman(detail=true){
    const a=author(),torso={joint:'torso'};
    for(const outfit of[0,1,2]){
      const width=outfit===1?1.06:outfit===2?.96:1;
      a.add('coat',loft([[.875,.141*width,.10,.20],[.94,.148*width,.108,.175],[1.08,.158*width,.12,.133],[1.23,.177*width,.125,.09],[1.30,.186*width,.113,.072],[1.345,.158*width,.087,.062],[1.368,.104*width,.063,.058],[1.385,.058,.052,.052]],detail?14:8),[0,0,0],[0,0,0],{...torso,outfit});
    }
    a.add('pants',loft([[.785,.10,.105,.215],[.805,.141,.127,.218],[.855,.151,.132,.212],[.895,.143,.108,.205],[.92,.133,.096,.195]],14));
    a.add('skin',loft([[1.36,.049,.046,.055],[1.405,.047,.047,.042]],12),[0,0,0],[0,0,0],torso);
    // Tapered jaw, cheek, brow and cranium give an adult head; not a sphere.
    a.add('skin',loft([[1.405,.041,.055,.012],[1.433,.061,.067,.002],[1.472,.079,.078,.006],[1.52,.082,.081,.016],[1.572,.073,.077,.025],[1.61,.042,.049,.026],[1.62,.008,.013,.026]],detail?14:8),[0,0,0],[0,0,0],torso);
    if(detail){
      a.add('skin',ellipsoid(.018,.025,.022,8),[0,1.497,-.075],[0,0,0],torso);
      for(const side of[-1,1])a.add('skin',ellipsoid(.015,.028,.015,8),[side*.081,1.505,.018],[0,0,0],torso);
      for(const side of[-1,1])a.rod('hair',[side*.023,1.52,-.064],[side*.048,1.515,-.057],.003,torso);
    }
    // Follow the skull's actual section widths, rather than shrinking a
    // hemisphere with a different parameterisation (which exposed the crown).
    {
      const skull=[[1.405,.041,.055,.012],[1.433,.061,.067,.002],[1.472,.079,.078,.006],[1.52,.082,.081,.016],[1.572,.073,.077,.025],[1.61,.042,.049,.026],[1.62,.008,.013,.026]];
      const sectionAt=y=>{if(y>=1.62)return[.008,.013,.026];for(let i=1;i<skull.length;i++)if(y<=skull[i][0]){const lo=skull[i-1],hi=skull[i],t=(y-lo[0])/(hi[0]-lo[0]);return[mix(lo[1],hi[1],t),mix(lo[2],hi[2],t),mix(lo[3],hi[3],t)];}return[.008,.013,.026];};
      const sides=detail?28:14,levels=[0,1.49,1.52,1.55,1.572,1.59,1.61,1.62,1.623],positions=[],indices=[],uv=[];
      for(let j=0;j<levels.length;j++)for(let i=0;i<=sides;i++){
        const theta=i/sides*Math.PI*2,back=Math.sin(theta),base=1.52-.047*back,y=j?Math.max(base,levels[j]):base;
        const [rx,rz,cz]=sectionAt(y),taper=y>1.62?Math.max(0,(1.623-y)/.003):1;
        positions.push((rx+.003)*taper*Math.cos(theta),y,cz+(rz+.003)*taper*Math.sin(theta));uv.push(i/sides,j/(levels.length-1));
      }
      for(let j=0;j<levels.length-1;j++)for(let i=0;i<sides;i++){const q=j*(sides+1)+i,n=q+sides+1;indices.push(q,n,q+1,q+1,n,n+1);}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();a.add('hair',g,[0,0,0],[0,0,0],torso);
    }
    if(detail){
      a.add('hair',loft([[1.29,.073,.026,.105],[1.38,.078,.034,.11],[1.49,.072,.029,.10],[1.54,.067,.026,.08]],12),[0,0,0],[0,0,0],{...torso,accessory:'long'});
      a.add('hair',ellipsoid(.03,.125,.027),[0,1.425,.133],[.15,0,0],{...torso,accessory:'ponytail'});
      a.add('coat',ellipsoid(.108,.047,.065),[0,1.34,.15],[0,0,0],{...torso,outfit:1});
      a.rod('bag',[-.125,.97,.255],[-.14,1.335,.15],.014,{...torso,accessory:'bag'});a.rod('bag',[.125,.97,.255],[.14,1.335,.15],.014,{...torso,accessory:'bag'});
      a.add('bag',loft([[.98,.105,.05,.30],[1.04,.143,.067,.30],[1.24,.134,.063,.265],[1.30,.09,.04,.24]],12),[0,0,0],[0,0,0],{...torso,accessory:'bag'});
      a.add('bag',box(.17,.12,.04,.025),[0,1.07,.363],[0,0,0],{...torso,accessory:'bag'});
      a.rod('darkMetal',[-.04,1.294,.25],[.04,1.294,.25],.006,{...torso,accessory:'bag'});
    }
    const segment=(name,r1,r2,from,to)=>a.add(name,loft([[0,r1*.75,r1*.75],[.10,r1*.96,r1*.96],[.25,r1,r1],[.77,mix(r1,r2,.8),mix(r1,r2,.8)],[.94,r2,r2],[1,r2*.8,r2*.8]],detail?10:6),[0,0,0],[0,0,0],{joint:'limb',segment:[from,to]});
    for(const side of['L','R']){
      a.add('coat',ellipsoid(.073,.071,.075),[0,0,0],[0,0,0],{joint:'jointCover',anchor:`shoulder${side}`});
      a.add('coat',ellipsoid(.052,.057,.055),[0,0,0],[0,0,0],{joint:'jointCover',anchor:`elbow${side}`});
      a.add('pants',ellipsoid(.062,.065,.063),[0,0,0],[0,0,0],{joint:'jointCover',anchor:`knee${side}`});
      segment('coat',.068,.052,`shoulder${side}`,`elbow${side}`);
      segment('coat',.053,.035,`elbow${side}`,`hand${side}`);
      segment('pants',.081,.064,`hip${side}`,`knee${side}`);
      segment('pants',.065,.044,`knee${side}`,`ankle${side}`);
      a.add('skin',ellipsoid(.037,.025,.055,10),[0,0,0],[0,0,0],{joint:'hand',anchor:`hand${side}`});
      a.add('rubber',loft([[-.035,.047,.10,-.025],[0,.055,.12,-.035],[.04,.047,.096,-.02]],10),[0,0,0],[0,0,0],{joint:'shoe',anchor:`ankle${side}`});
      if(detail)a.add('sole',box(.104,.012,.233,.005),[0,-.035,-.032],[0,0,0],{joint:'shoe',anchor:`ankle${side}`});
    }
    return a.finish();
  }
  function buildLowVehicle(){
    const a=author(),steering={joint:'steering'};
    for(const front of[true,false]){const joint=front?'frontWheel':'rearWheel';a.add('rubber',new THREE.TorusGeometry(.207,.047,4,10),[0,0,0],[0,Math.PI/2,0],{joint});a.add('darkMetal',new THREE.CylinderGeometry(.09,.09,.09,6),[0,0,0],[0,0,Math.PI/2],{joint});}
    a.add('seat',new THREE.BoxGeometry(.395,.08,.55),[0,.74,.28]);a.add('darkMetal',new THREE.BoxGeometry(.35,.07,.70),[0,.32,.01]);
    a.add('paint',loft([[.39,.16,.24,.33],[.52,.215,.26,.32],[.69,.16,.21,.29]],6));
    a.add('paint',loft([[.34,.17,.065,-.33],[.62,.20,.085,-.46],[.92,.15,.06,-.52]],6),[0,0,0],[0,0,0],steering);
    a.rod('metal',[0,.3,-.59],[0,1.075,-.51],.023,steering);a.rod('darkMetal',[-.37,1.075,-.51],[.37,1.075,-.51],.025,steering);
    a.add('lamp',new THREE.BoxGeometry(.16,.09,.025),[0,1.055,-.59],[0,0,0],steering);
    return a.finish();
  }
  function buildLowPerson(){
    const a=author(),torso={joint:'torso'};
    a.add('coat',loft([[.89,.145,.105,.205],[1.15,.17,.11,.12],[1.32,.195,.09,.075],[1.38,.075,.055,.065]],8),[0,0,0],[0,0,0],torso);
    a.add('pants',new THREE.BoxGeometry(.29,.15,.23),[0,.87,.23]);
    a.add('skin',loft([[1.38,.048,.048,.045],[1.42,.05,.06,.012],[1.48,.08,.077,.012],[1.57,.074,.075,.024],[1.61,.04,.045,.03]],8),[0,0,0],[0,0,0],torso);
    a.add('hair',loft([[1.55,.081,.081,.023],[1.59,.071,.071,.028],[1.63,.01,.01,.03]],8),[0,0,0],[0,0,0],torso);
    const limb=(name,r1,r2,from,to)=>a.add(name,new THREE.CylinderGeometry(r2,r1,1,6,1),[0,.5,0],[0,0,0],{joint:'limb',segment:[from,to]});
    for(const side of['L','R']){limb('coat',.068,.051,`shoulder${side}`,`elbow${side}`);limb('coat',.051,.033,`elbow${side}`,`hand${side}`);limb('pants',.08,.062,`hip${side}`,`knee${side}`);limb('pants',.062,.043,`knee${side}`,`ankle${side}`);a.add('rubber',new THREE.BoxGeometry(.104,.075,.22),[0,0,-.025],[0,0,0],{joint:'shoe',anchor:`ankle${side}`});}
    return a.finish();
  }
  const vehicle=buildVehicle(true),person=buildHuman(true),lowVehicle=buildLowVehicle(),lowPerson=buildLowPerson();
  const sharedMatrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),direction=new THREE.Vector3(),position=new THREE.Vector3(),scale=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  const staticIdentity=new THREE.Matrix4(),jointRotation=new THREE.Matrix4(),jointTranslation=new THREE.Matrix4();
  function partApplies(part,appearance){return(part.family===undefined||part.family===appearance.family)&&(part.outfit===undefined||part.outfit===appearance.outfit)&&(!part.accessory||(part.accessory==='bag'?appearance.bag:appearance.hair===part.accessory));}
  function partMatrix(part,agent,pose,target=sharedMatrix){
    target.identity();
    if(part.joint==='steering')return target.makeTranslation(0,.81,-.49).multiply(jointRotation.makeRotationY(pose.steering)).multiply(jointTranslation.makeTranslation(0,-.81,.49));
    if(part.joint==='frontWheel'||part.joint==='rearWheel'){
      const front=part.joint==='frontWheel',p=front?rotateY([0,.255,-.59],pose.steering):[0,.255,.56];
      return target.makeTranslation(...p).multiply(jointRotation.makeRotationY(front?pose.steering:0)).multiply(jointRotation.makeRotationX(-(agent.progress??0)/.254));
    }
    if(part.joint==='torso')return target.makeTranslation(0,.87,.20).multiply(jointRotation.makeRotationX(pose.pitch)).multiply(jointTranslation.makeTranslation(0,-.87,-.20));
    if(part.joint==='limb'){
      const a=pose.points[part.segment[0]],b=pose.points[part.segment[1]];
      position.fromArray(a);direction.fromArray(b).sub(position);scale.set(1,direction.length(),1);rotation.setFromUnitVectors(up,direction.normalize());return target.compose(position,rotation,scale);
    }
    if(part.joint==='hand'||part.joint==='shoe'||part.joint==='jointCover')return target.makeTranslation(...pose.points[part.anchor]).multiply(jointRotation.makeRotationY(part.joint==='hand'?pose.steering:0));
    return target.copy(staticIdentity);
  }
  return{palette,colors,vehicle,person,scooter:[...vehicle,...person],walker:person,parked:vehicle,lowScooter:[...lowVehicle,...lowPerson],lowWalker:lowPerson,lowParked:lowVehicle,partApplies,partMatrix,samplePose:sampleActorPose,appearance:actorAppearance};
}
