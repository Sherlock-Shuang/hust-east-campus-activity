// Original small leisure launch for the campus activity; dimensions are game
// modelling choices, not a claim that a real yacht operates on the campus lake.
export function createBoatModel(THREE,{occupied=false}={}){
  const group=new THREE.Group();group.name='yacht';
  const geometries=new Set(),materials=new Set();let disposed=false,time=0;
  const material=(color,roughness=.55,metalness=.1,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness,...extra});materials.add(m);return m;};
  const white=material('#e3e4dc',.32,.23),navy=material('#21434b',.4,.25),wood=material('#a68b62',.86,0),seam=material('#685d49',.85,0),steel=material('#aeb9b7',.26,.8),cushion=material('#d7d5bf',.85,0),glass=material('#2e5b65',.13,.48,{transparent:true,opacity:.72,side:THREE.DoubleSide}),dark=material('#293a3c',.68,.2),red=material('#bc4836',.55,.1);
  function mesh(name,geometry,mat,position=[0,0,0],parent=group){geometries.add(geometry);const m=new THREE.Mesh(geometry,mat);m.name=name;m.position.set(...position);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function box(name,size,mat,position,parent){return mesh(name,new THREE.BoxGeometry(...size),mat,position,parent);}
  function rod(name,a,b,r=.025,mat=steel,parent=group){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),delta=bv.clone().sub(av);const m=mesh(name,new THREE.CylinderGeometry(r,r,delta.length(),8),mat,av.add(bv).multiplyScalar(.5).toArray(),parent);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;}
  function tube(name,points,r,mat){return mesh(name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v=>new THREE.Vector3(...v))),32,r,6,false),mat);}
  // Cross-sections narrow the bow, flare the topsides, and keep draft below the
  // waterline. Closed end fans avoid seeing through the transom from shore.
  const sections=[[-3.3,.02,.05],[-2.85,.42,.26],[-2.1,.95,.51],[-1.1,1.14,.70],[0,1.16,.77],[1.2,1.10,.78],[2.3,.98,.71],[3.05,.90,.65]];
  const hullP=[],hullI=[];
  for(const[z,top,low]of sections)for(const[x,y]of[[-top,.62],[-low,-.18],[0,-.38],[low,-.18],[top,.62]])hullP.push(x,y,z);
  for(let n=0;n<sections.length-1;n++)for(let j=0;j<4;j++){const a=n*5+j,b=a+5;hullI.push(a,a+1,b,a+1,b+1,b);}
  for(const n of[0,sections.length-1])for(let j=1;j<4;j++){const a=n*5;hullI.push(...(n?[a,a+j,a+j+1]:[a,a+j+1,a+j]));}
  const hull=new THREE.BufferGeometry();hull.setAttribute('position',new THREE.Float32BufferAttribute(hullP,3));hull.setIndex(hullI);hull.computeVertexNormals();mesh('yacht-flared-hull',hull,white);
  const deck=new THREE.Shape();deck.moveTo(-sections[0][1],sections[0][0]);for(const[z,w]of sections.slice(1))deck.lineTo(-w,z);for(const[z,w]of[...sections].reverse())deck.lineTo(w,z);deck.closePath();
  const deckGeo=new THREE.ExtrudeGeometry(deck,{depth:.09,bevelEnabled:true,bevelSize:.025,bevelThickness:.02,bevelSegments:1,steps:1});deckGeo.rotateX(Math.PI/2);deckGeo.translate(0,.67,0);mesh('yacht-teak-deck',deckGeo,wood);
  for(const side of[-1,1]){
    tube(`yacht-rubrail-${side}`,sections.map(([z,w])=>[side*w,.64,z]),.042,navy);
    tube(`yacht-waterline-stripe-${side}`,sections.map(([z,w,l])=>[side*(l+(w-l)*.42),.15,z]),.035,navy);
    const rail=sections.slice(0,6).map(([z,w])=>[side*w*.94,1.20,z]);tube(`yacht-bow-rail-${side}`,rail,.022,steel);
    for(const[z,w]of sections.slice(1,6))rod(`yacht-rail-stanchion-${side}-${z}`,[side*w*.94,.67,z],[side*w*.94,1.20,z]);
    box(`yacht-cockpit-coaming-${side}`,[.12,.36,3.7],white,[side*.99,.85,.94]);
    for(const z of[-1.6,1.6,2.6]){box(`yacht-cleat-${side}-${z}`,[.2,.035,.055],steel,[side*.92,.75,z]);rod(`yacht-cleat-stem-${side}-${z}`,[side*.92,.68,z],[side*.92,.75,z],.016);}
  }
  for(let x=-.8;x<=.8;x+=.16)box('yacht-deck-plank-joint',[.009,.006,3.9],seam,[x,.68,.85]);
  box('yacht-bow-sunpad',[1.25,.13,1.25],cushion,[0,.77,-1.75]);
  box('yacht-rear-bench',[1.65,.33,.5],white,[0,.85,2.35]);box('yacht-rear-seat',[1.62,.12,.55],cushion,[0,1.05,2.35]);box('yacht-rear-backrest',[1.65,.46,.12],cushion,[0,1.28,2.61]);
  box('yacht-console',[1.75,.55,.65],white,[0,.99,-.62]);box('yacht-dark-dash',[1.63,.05,.56],dark,[0,1.3,-.57]);
  const wind=new THREE.Shape();wind.moveTo(-1,0);wind.lineTo(1,0);wind.lineTo(.87,.54);wind.quadraticCurveTo(0,.72,-.87,.54);wind.closePath();const windshield=mesh('yacht-windshield',new THREE.ShapeGeometry(wind,12),glass,[0,1.32,-.85]);windshield.rotation.x=-.27;
  tube('yacht-windshield-rim',[[-1,1.32,-.85],[-.87,1.84,-.995],[0,1.98,-1.03],[.87,1.84,-.995],[1,1.32,-.85]],.025,steel);
  for(const side of[-1,1]){box(`yacht-captain-seat-${side}`,[.58,.12,.55],cushion,[side*.48,1.10,.43]);box(`yacht-captain-back-${side}`,[.59,.65,.12],cushion,[side*.48,1.42,.71]);rod('yacht-seat-pedestal',[side*.48,.7,.43],[side*.48,1.04,.43],.075);}
  const wheel=mesh('yacht-steering-wheel',new THREE.TorusGeometry(.17,.018,8,20),dark,[.48,1.43,-.27]);wheel.rotation.x=-.52;
  for(const x of[-.26,.12])box('yacht-dash-instrument',[.22,.012,.14],glass,[x,1.34,-.57]);
  box('yacht-swim-platform',[1.65,.085,.55],wood,[0,.24,3.22]);
  for(const side of[-1,1])rod('yacht-ladder-upright',[side*.2,.3,3.4],[side*.2,-.24,3.4],.025);
  for(const y of[-.17,.07,.27])rod('yacht-ladder-rung',[-.2,y,3.4],[.2,y,3.4],.025);
  rod('yacht-flagstaff',[.72,.72,2.7],[.72,1.7,2.7],.018);box('yacht-small-pennant',[.31,.20,.012],red,[.88,1.57,2.7]);
  const driver=new THREE.Group();driver.name='yacht-driver';driver.visible=occupied;group.add(driver);
  const coat=material('#346d6b',.9,0),skin=material('#c59a7a',.85,0),pants=material('#343f46',.9,0),hair=material('#302923',.95,0);
  function ellipsoid(name,radii,mat,pos){const g=new THREE.SphereGeometry(1,14,10);g.scale(...radii);return mesh(name,g,mat,pos,driver);}
  ellipsoid('yacht-driver-torso',[.23,.33,.16],coat,[.48,1.48,.40]);ellipsoid('yacht-driver-head',[.12,.16,.12],skin,[.48,1.98,.37]);ellipsoid('yacht-driver-hair',[.125,.07,.124],hair,[.48,2.08,.39]);
  for(const side of[-1,1]){const x=.48+side*.17;rod('yacht-driver-arm',[x,1.69,.38],[x,1.39,-.14],.055,coat,driver);ellipsoid('yacht-driver-hand',[.05,.065,.055],skin,[x,1.39,-.16]);rod('yacht-driver-thigh',[x,1.17,.36],[x,1.11,-.05],.075,pants,driver);rod('yacht-driver-shin',[x,1.11,-.05],[x,.77,-.04],.06,pants,driver);}
  group.userData={representative:true,units:'metres',lengthMetres:6.75,beamMetres:2.4,waterlineOrigin:true,staticProp:true};
  function update(state={},dt=0){if(disposed)return;time+=Math.min(.1,Math.max(0,dt));driver.visible=state.occupied??occupied;wheel.rotation.z=-(state.steeringAngle||0);group.userData.time=time;}
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();}
  return{group,update,dispose};
}
