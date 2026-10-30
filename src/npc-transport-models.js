import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Small, occupied distant variants of the existing game vehicles. Body parts
// are baked into vertex-coloured meshes; no full player rig or GLTF is loaded.
// All coordinates are metres, forward -Z, water/wheel contact at y=0.
export function createNpcTransportModels(THREE){
  const geometries=new Set(),materials=new Set(),templates=new Map();
  const own=g=>(geometries.add(g),g);
  const bodyMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.67,metalness:.12});
  const glassMaterial=new THREE.MeshStandardMaterial({color:0x739eaa,roughness:.22,metalness:.12,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide});
  const jetMaterial=new THREE.MeshBasicMaterial({color:0xa9ddea,transparent:true,opacity:.22,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
  materials.add(bodyMaterial);materials.add(glassMaterial);materials.add(jetMaterial);
  const color=new THREE.Color(),matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),euler=new THREE.Euler(),unit=new THREE.Vector3(1,1,1),position=new THREE.Vector3();
  function builder(){
    const parts=[],names=[];
    function add(geometry,tint,name,p=[0,0,0],rotation=[0,0,0]){
      let g=geometry;if(g.index){g=g.toNonIndexed();geometry.dispose();}
      if(g.attributes.uv)g.deleteAttribute('uv');
      color.set(tint);const colours=new Float32Array(g.attributes.position.count*3);
      for(let i=0;i<colours.length;i+=3){colours[i]=color.r;colours[i+1]=color.g;colours[i+2]=color.b;}
      g.setAttribute('color',new THREE.BufferAttribute(colours,3));
      position.set(...p);quaternion.setFromEuler(euler.set(...rotation));matrix.compose(position,quaternion,unit);g.applyMatrix4(matrix);
      parts.push(g);names.push(name);return g;
    }
    function box(size,tint,name,p,r){return add(new THREE.BoxGeometry(...size),tint,name,p,r);}
    function sphere(size,tint,name,p){const g=new THREE.SphereGeometry(1,12,8);g.scale(...size);return add(g,tint,name,p);}
    function rod(a,b,r,tint,name,r2=r){
      const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),delta=bv.clone().sub(av);
      const g=new THREE.CylinderGeometry(r2,r,delta.length(),8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
      return add(g,tint,name,av.add(bv).multiplyScalar(.5).toArray());
    }
    function finish(name){
      const geometry=own(mergeGeometries(parts,false));for(const p of parts)p.dispose();geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const mesh=new THREE.Mesh(geometry,bodyMaterial);mesh.name=name;mesh.userData.sourceParts=names;mesh.matrixAutoUpdate=false;mesh.receiveShadow=true;return mesh;
    }
    return{add,box,sphere,rod,finish};
  }
  function pilot(b,{origin=[0,0,0],standing=false,coat=0x456b7a,helmet=false}={}){
    const [x,y,z]=origin,point=(a,c,d)=>[x+a,y+c,z+d],skin=0xc69a7d,dark=0x293640;
    b.sphere([.225,.30,.15],coat,'npc-pilot-torso',point(0,.92,0));
    b.sphere([.115,.16,.12],skin,'npc-pilot-head',point(0,1.39,-.025));
    b.sphere([.12,.075,.12],helmet?0xd4dbd7:0x302a27,'npc-pilot-hair-or-helmet',point(0,1.49,-.01));
    if(helmet)b.box([.19,.055,.024],0x162b33,'npc-pilot-visor',point(0,1.40,-.143));
    for(const s of[-1,1]){
      const hip=point(s*.12,.68,.02),knee=point(s*(standing?.18:.14),standing?.35:.62,standing?-.04:-.39),foot=point(s*(standing?.21:.15),.10,standing?-.10:-.37);
      b.rod(hip,knee,.073,dark,'npc-pilot-thigh');b.rod(knee,foot,.058,dark,'npc-pilot-shin');
      b.box([.14,.10,.27],0x243036,'npc-pilot-shoe',point(s*(standing?.21:.15),.055,standing?-.17:-.44));
      const shoulder=point(s*.21,1.10,0),elbow=point(s*(standing?.28:.24),.87,-.15),hand=point(s*.19,standing?.87:.93,standing?-.31:-.46);
      b.rod(shoulder,elbow,.059,coat,'npc-pilot-upper-arm');b.rod(elbow,hand,.045,coat,'npc-pilot-forearm');b.sphere([.05,.06,.05],skin,'npc-pilot-hand',hand);
    }
  }
  function glass(name,size,p,r=[0,0,0]){const mesh=new THREE.Mesh(own(new THREE.PlaneGeometry(...size)),glassMaterial);mesh.name=name;mesh.position.set(...p);mesh.rotation.set(...r);mesh.updateMatrix();mesh.matrixAutoUpdate=false;return mesh;}
  function rotorGeometry(radius){const b=builder();b.box([radius*2,.025,.13],0x303e43,'rotor-blade-a');b.box([.13,.025,radius*2],0x303e43,'rotor-blade-b');return b.finish('npc-rotor');}
  function helicopter(){
    const root=new THREE.Group(),b=builder(),white=0xd9dfdb,navy=0x294c5a,steel=0x65777c;
    b.sphere([.86,.71,1.10],white,'helicopter-fuselage',[0,1.12,.55]);
    // A framed open cockpit lets the seated pilot read through the glazing.
    b.sphere([.76,.29,1.14],navy,'helicopter-belly',[0,.70,-.33]);
    b.box([1.40,.12,1.15],navy,'helicopter-cockpit-floor',[0,.79,-1.15]);
    b.rod([0,1.10,1.15],[0,1.54,4.14],.11,white,'helicopter-tail-boom',.28);
    b.box([.08,.85,.68],navy,'helicopter-tail-fin',[0,1.78,3.98],[.15,0,0]);
    b.box([1.4,.07,.42],white,'helicopter-tail-plane',[0,1.38,3.40]);
    b.rod([0,1.75,0],[0,2.45,0],.10,steel,'helicopter-main-mast');
    for(const s of[-1,1]){
      b.rod([s*.94,.15,-1.64],[s*.94,.15,1.32],.055,steel,'helicopter-skid');
      b.rod([s*.94,.15,-1.64],[s*.94,.31,-1.94],.055,steel,'helicopter-skid-toe');
      for(const z of[-.8,.8])b.rod([s*.55,.70,z],[s*.94,.15,z],.045,steel,'helicopter-skid-strut');
      b.rod([s*.70,.85,-1.58],[s*.54,1.88,-.93],.037,white,'helicopter-window-pillar');
      b.rod([s*.54,1.88,-.93],[s*.70,1.70,.1],.035,white,'helicopter-roof-frame');
    }
    b.rod([-.54,1.88,-.93],[.54,1.88,-.93],.035,white,'helicopter-windshield-top');
    b.box([.53,.13,.43],0x354b54,'helicopter-pilot-seat',[-.26,1.22,-.82]);
    b.box([1.22,.20,.25],0x293f4a,'helicopter-instrument-panel',[0,1.31,-1.40]);
    b.rod([-.26,1.10,-1.28],[-.26,1.50,-1.39],.025,steel,'helicopter-control-stick');
    b.rod([-.45,1.50,-1.39],[-.07,1.50,-1.39],.024,navy,'helicopter-pilot-grip');
    pilot(b,{origin:[-.26,.57,-.93],helmet:true,coat:0x344f61});
    root.add(b.finish('helicopter-npc-body'),glass('helicopter-npc-windshield',[1.35,1.13],[0,1.37,-1.30],[-.56,0,0]));
    const rotor=rotorGeometry(3.15);rotor.position.set(0,2.46,0);rotor.matrixAutoUpdate=true;root.add(rotor);
    const tail=rotorGeometry(.57);tail.position.set(.17,1.75,4.05);tail.rotation.z=Math.PI/2;tail.matrixAutoUpdate=true;root.add(tail);
    return{root,rotors:[{mesh:rotor,axis:'y',rate:31},{mesh:tail,axis:'x',rate:46}]};
  }
  function hoverboard(){
    const root=new THREE.Group(),b=builder(),dark=0x26383d,shell=0x5d777b;
    b.box([.65,.13,1.30],dark,'hoverboard-central-deck',[0,.26,0]);
    b.box([.52,.045,.92],0x38464a,'hoverboard-grip',[0,.345,0]);
    const centres=[];
    for(const s of[-1,1])for(const z of[-.53,.53]){
      b.rod([s*.20,.26,z],[s*.67,.22,z],.08,shell,'hoverboard-fan-arm');
      b.add(new THREE.TorusGeometry(.39,.052,6,18),shell,'hoverboard-duct',[s*.68,.25,z],[Math.PI/2,0,0]);
      b.rod([s*.68,.16,z],[s*.68,.33,z],.065,dark,'hoverboard-fan-hub');centres.push([s*.68,.23,z]);
    }
    pilot(b,{origin:[0,.37,0],standing:true,helmet:true,coat:0x8d5e42});
    b.box([.41,.035,.10],0x293c43,'hoverboard-handheld-controller',[0,1.24,-.31]);
    b.box([.28,.36,.12],0x324752,'hoverboard-rider-backpack',[0,1.36,.18]);
    root.add(b.finish('hoverboard-npc-body'));
    const blade=rotorGeometry(.33),rotors=[];
    // Four meshes, with one shared geometry/material: only 8 animated objects
    // for both boards, no per-frame skinning or matrix-buffer rebuilding.
    for(const p of centres){const mesh=blade.clone();mesh.position.set(...p);mesh.matrixAutoUpdate=true;root.add(mesh);rotors.push({mesh,axis:'y',rate:42});}
    return{root,rotors};
  }
  function roadster(){
    const root=new THREE.Group(),b=builder(),white=0xe2e8e5,black=0x24343a;
    // Low lofted shoulders, with a genuinely open cockpit. A solid ellipsoid
    // buried the driver's torso and left the rear lamps detached in the air.
    const sections=[[-2.20,.76,.52],[-1.65,.95,.66],[-.62,.95,.76],[.87,.97,.79],[1.72,.95,.76],[2.20,.83,.70]],vertices=[],indices=[];
    function quad(a,c,d,e){const i=vertices.length/3;vertices.push(...a,...c,...d,...e);indices.push(i,i+1,i+2,i,i+2,i+3);}
    for(let i=1;i<sections.length;i++){
      const [za,wa,ya]=sections[i-1],[zb,wb,yb]=sections[i];
      for(const s of[-1,1]){
        const p=[[s*wa,.28,za],[s*wb,.28,zb],[s*wb,yb,zb],[s*wa,ya,za]];
        if(s>0)p.reverse();quad(...p);
        const top=[[s*wa,ya,za],[s*wb,yb,zb],[s*.70,yb,zb],[s*.70,ya,za]];
        if(s>0)top.reverse();quad(...top);
      }
      if(i!==3)quad([-.70,ya,za],[-.70,yb,zb],[.70,yb,zb],[.70,ya,za]);
    }
    for(const [z,w,y]of[sections[0],sections.at(-1)]){
      const p=[[-w,.28,z],[-w,y,z],[w,y,z],[w,.28,z]];if(z>0)p.reverse();quad(...p);
    }
    const bodyGeometry=new THREE.BufferGeometry();bodyGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));bodyGeometry.setIndex(indices);bodyGeometry.computeVertexNormals();b.add(bodyGeometry,white,'roadster-sculpted-body');
    b.box([1.62,.10,3.86],black,'roadster-undertray',[0,.25,.02]);
    b.box([1.63,.045,.022],0xb73735,'roadster-rear-light-bar',[0,.65,2.217]);
    for(const s of[-1,1]){
      b.box([.44,.045,.025],0xe0f5ee,'roadster-headlight',[s*.48,.45,-2.219]);
      for(const z of[-1.32,1.32]){
        b.add(new THREE.CylinderGeometry(.36,.36,.19,16),0x20272a,'roadster-wheel',[s*.92,.37,z],[0,0,Math.PI/2]);
        b.add(new THREE.CylinderGeometry(.24,.24,.20,10),0x7c8c8f,'roadster-rim',[s*.93,.37,z],[0,0,Math.PI/2]);
        b.add(new THREE.CylinderGeometry(.09,.15,.14,10),black,'roadster-lift-nozzle',[s*.67,.18,z]);
      }
      b.rod([s*.72,.76,-.72],[s*.63,1.24,-.10],.035,black,'roadster-windscreen-pillar');
      b.rod([s*.63,1.24,-.10],[s*.68,1.14,.79],.027,black,'roadster-roof-rail');
      b.rod([s*.68,1.14,.79],[s*.71,.78,.91],.027,black,'roadster-rear-pillar');
      b.box([.53,.14,.48],0x46565d,'roadster-seat-cushion',[s*.36,.42,.35]);
      b.box([.53,.53,.12],0x35464e,'roadster-seat-back',[s*.36,.70,.57],[-.15,0,0]);
    }
    b.rod([-.63,1.24,-.10],[.63,1.24,-.10],.027,black,'roadster-windshield-header');
    b.rod([-.68,1.14,.79],[.68,1.14,.79],.027,black,'roadster-rear-roof-header');
    b.box([1.31,.13,.29],black,'roadster-dashboard',[0,.73,-.50]);
    b.add(new THREE.TorusGeometry(.19,.019,6,16),0x1b2c35,'roadster-steering-wheel',[-.36,.73,-.14],[-.30,0,0]);
    // Open-top driver is legible from the air and matches the low car profile.
    pilot(b,{origin:[-.36,-.20,.32],coat:0x406b7b});
    root.add(b.finish('roadster-npc-body'),glass('roadster-npc-windshield',[1.35,.80],[0,1,-.43],[-.82,0,0]));
    const jets=[];
    for(const s of[-1,1])for(const z of[-1.32,1.32]){const g=new THREE.ConeGeometry(.22,.78,10,1,true);g.translate(s*.67,-.29,z);jets.push(g);}
    const jetGeo=own(mergeGeometries(jets,false));for(const p of jets)p.dispose();
    const jet=new THREE.Mesh(jetGeo,jetMaterial);jet.name='roadster-npc-lift-jets';jet.matrixAutoUpdate=false;root.add(jet);
    return{root,rotors:[]};
  }
  function boat(){
    const root=new THREE.Group(),b=builder(),white=0xe0e2d6,navy=0x244654,wood=0xa08b66;
    const sections=[[-2.8,.05],[-2.0,.72],[-.9,1.04],[.8,1.04],[2.6,.86]],positions=[],indices=[];
    for(const[z,w]of sections)for(const[x,y]of[[-w,.55],[-w*.62,-.15],[0,-.32],[w*.62,-.15],[w,.55]])positions.push(x,y,z);
    for(let i=0;i<sections.length-1;i++)for(let j=0;j<4;j++){const a=i*5+j,c=a+5;indices.push(a,a+1,c,a+1,c+1,c);}
    for(const n of[0,sections.length-1])for(let j=1;j<4;j++){const a=n*5;indices.push(...(n?[a,a+j,a+j+1]:[a,a+j+1,a+j]));}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();b.add(g,white,'boat-flared-hull');
    const deck=new THREE.Shape();deck.moveTo(-sections[0][1],-sections[0][0]);for(const[z,w]of sections.slice(1))deck.lineTo(-w,-z);for(const[z,w]of[...sections].reverse())deck.lineTo(w,-z);deck.closePath();
    const d=new THREE.ShapeGeometry(deck);d.rotateX(-Math.PI/2);b.add(d,wood,'boat-deck',[0,.56,0]);
    for(const s of[-1,1]){
      for(let i=1;i<sections.length;i++)b.rod([s*sections[i-1][1],.58,sections[i-1][0]],[s*sections[i][1],.58,sections[i][0]],.037,navy,'boat-rubrail');
      for(const z of[-1.5,-.4,1.2])b.rod([s*.85,.58,z],[s*.85,1.03,z],.019,0x9aabaa,'boat-rail-post');
      b.rod([s*.85,1.03,-1.5],[s*.85,1.03,1.2],.02,0x9aabaa,'boat-bow-rail');
    }
    b.box([1.55,.24,.60],0xd5d5bf,'boat-rear-seat',[0,.72,1.95]);b.box([1.55,.40,.12],white,'boat-rear-backrest',[0,.99,2.23]);
    b.box([1.60,.45,.60],white,'boat-console',[0,.81,-.55]);b.box([1.45,.04,.54],navy,'boat-dashboard',[0,1.06,-.55]);
    pilot(b,{origin:[.37,.36,.31],coat:0x3c7976});
    b.rod([.69,.63,2.12],[.69,1.52,2.12],.018,0x8c9a9b,'boat-flagstaff');b.box([.30,.19,.015],0xb85743,'boat-pennant',[.85,1.39,2.12]);
    root.add(b.finish('boat-npc-body'),glass('boat-npc-windshield',[1.63,.55],[0,1.25,-.68],[-.28,0,0]));
    return{root,rotors:[]};
  }
  const factories={helicopter,hoverboard,roadster,boat};let disposed=false;
  return{
    create(mode){
      if(disposed||!factories[mode])return null;
      let template=templates.get(mode);if(!template){template=factories[mode]();templates.set(mode,template);}
      const root=template.root.clone(true),rotors=template.rotors.map(r=>({mesh:root.children[template.root.children.indexOf(r.mesh)],axis:r.axis,rate:r.rate}));
      root.userData={npcTransport:true,mode,occupied:true};root.matrixAutoUpdate=true;root.matrixWorldAutoUpdate=true;
      root.traverse(o=>{o.matrixWorldAutoUpdate=true;o.castShadow=false;});
      return{root,rotors};
    },
    dispose(){if(disposed)return;disposed=true;for(const g of geometries)g.dispose();for(const m of materials)m.dispose();templates.clear();},
  };
}
