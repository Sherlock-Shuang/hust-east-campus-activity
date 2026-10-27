// Original procedural reconstruction from the inspected October 2026 Tesla
// demonstration photographs. The 4.50 × 2.00 × 1.23 m envelope and unseen
// interior / jet hardware are photo estimates, not Tesla engineering drawings.
// Local forward is -Z. Wheel contact is y=0; the caller owns world transforms.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const number=(v,fallback=0)=>Number.isFinite(v)?v:fallback;

export function createRoadsterModel(THREE){
  const group=new THREE.Group();group.name='roadster-2026-rocket';
  group.userData={units:'metres',forward:'-Z',contactOrigin:true,estimatedDimensions:true,length:4.5,width:2,height:1.23,wheelRadius:.37,wheelbase:2.65,reference:'Inspected 2026 demonstration side, rear and flight photographs; original approximation'};
  const geometries=new Set(),materials=new Set();
  const ownGeometry=g=>(geometries.add(g),g),ownMaterial=m=>(materials.add(m),m);
  const mat=(color,roughness=.45,metalness=.1,extra={})=>ownMaterial(new THREE.MeshStandardMaterial({color,roughness,metalness,...extra}));
  const body=ownMaterial(new THREE.MeshPhysicalMaterial({color:'#eceee9',roughness:.27,metalness:.15,clearcoat:.85,clearcoatRoughness:.19,side:THREE.DoubleSide}));
  const black=mat('#141b1e',.50,.33),carbon=mat('#252d30',.82,.12),rubber=mat('#171c20',.95,.02),disc=mat('#343e43',.38,.62),rim=mat('#738084',.32,.75),seam=mat('#30383a',.72,.15);
  const glazing=ownMaterial(new THREE.MeshPhysicalMaterial({color:'#202a2b',roughness:.09,metalness:.28,transparent:true,opacity:.86,depthWrite:false,side:THREE.DoubleSide,clearcoat:1,clearcoatRoughness:.07}));
  const red=mat('#b22f28',.24,.2,{emissive:'#e23020',emissiveIntensity:.8});
  const light=mat('#dae9e6',.18,.15,{emissive:'#b9ddd5',emissiveIntensity:.65});
  const interior=mat('#242d30',.97,.02),fabric=mat('#a4afad',.94,0),visor=mat('#17282d',.13,.4),helmet=mat('#d6ded8',.41,.05),skin=mat('#b9957c',.92,0);
  function mesh(parent,geometry,material,name,position=[0,0,0],rotation=[0,0,0]){
    const result=new THREE.Mesh(ownGeometry(geometry),material);result.name=name;result.position.set(...position);result.rotation.set(...rotation);
    result.castShadow=true;result.receiveShadow=true;parent.add(result);return result;
  }
  function geometry(positions,indices){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;}
  function patch(parent,rows,material,name){
    const positions=rows.flat(2),indices=[],width=rows[0].length;
    for(let j=0;j<rows.length-1;j++)for(let i=0;i<width-1;i++){const a=j*width+i,b=a+width;indices.push(a,b,a+1,a+1,b,b+1);}
    return mesh(parent,geometry(positions,indices),material,name);
  }
  function rod(parent,a,b,r,material,name,r2=r){
    const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),direction=vb.clone().sub(va);
    const part=mesh(parent,new THREE.CylinderGeometry(r2,r,direction.length(),12),material,name,va.add(vb).multiplyScalar(.5).toArray());
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());return part;
  }
  function tube(parent,points,r,material,name){return mesh(parent,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(12,points.length*4),r,8,false),material,name);}
  function ellipse(parent,scale,material,name,pos,rotation=[0,0,0]){const g=new THREE.SphereGeometry(1,24,14);g.scale(...scale);return mesh(parent,g,material,name,pos,rotation);}
  const crossSections=[[-2.25,.79,.45],[-2.03,.91,.58],[-1.72,.98,.72],[-1.325,1,.81],[-.89,.967,.775],[-.50,.94,.775],[.12,.946,.79],[.69,.986,.84],[1.325,1,.895],[1.87,.956,.86],[2.25,.875,.79]];
  function section(z){
    for(let i=1;i<crossSections.length;i++)if(z<=crossSections[i][0]){const a=crossSections[i-1],b=crossSections[i],t=clamp((z-a[0])/(b[0]-a[0]),0,1),e=t*t*(3-2*t);return{width:a[1]+(b[1]-a[1])*e,top:a[2]+(b[2]-a[2])*e};}
    const s=crossSections.at(-1);return{width:s[1],top:s[2]};
  }
  const wheelZ=[-1.325,1.325],archRadius=.435,wheelRadius=.37;
  function sideBottom(z){let bottom=.245;for(const axle of wheelZ){const d=Math.abs(z-axle);if(d<archRadius)bottom=Math.max(bottom,.37+Math.sqrt(archRadius*archRadius-d*d));}return bottom;}
  // Real openings around all four wheels, including the lower sidewall cutout.
  // The skin is lofted along the shoulder rather than a box over exposed discs.
  for(const side of[-1,1]){
    const rows=[];
    for(let i=0;i<=210;i++){const z=-2.25+i/210*4.5,{width,top}=section(z),lower=Math.min(top-.008,sideBottom(z)),span=top-lower;rows.push([[side*(width-.055),lower,z],[side*(width-.018),lower+span*.17,z],[side*width,lower+span*.60,z],[side*(width-.004),lower+span*.88,z],[side*(width-.012),top,z]]);}
    patch(group,rows,body,`roadster-sculpted-side-${side}`);
    for(const axle of wheelZ){
      const points=[];for(let i=0;i<=42;i++){const t=i/42*Math.PI,z=axle+Math.cos(t)*archRadius,sec=section(z);points.push([side*(sec.width+.003),.37+Math.sin(t)*archRadius,z]);}
      tube(group,points,.012,seam,`roadster-wheel-arch-lip-${side}-${axle}`);
    }
    // Carbon sill drops below the pale body and flares toward the rear haunch.
    patch(group,[[[side*.88,.16,-.86],[side*.98,.21,-.86],[side*.94,.275,-.86]],[[side*.90,.16,.82],[side*1.015,.23,.82],[side*.985,.29,.82]]],carbon,`roadster-deep-side-skirt-${side}`);
    const door=[[-.69,.765],[-.76,.33],[-.54,.275],[.62,.29],[.79,.80]].map(([z,y])=>[side*(section(z).width+.003),y,z]);
    tube(group,door,.005,seam,`roadster-door-seam-${side}`);
    rod(group,[side*.956,.711,.19],[side*.958,.711,.38],.012,black,`roadster-flush-door-handle-${side}`);
  }
  function topSheet(from,to,name){
    const rows=[];
    for(let j=0;j<=45;j++){const z=from+(to-from)*j/45,{width,top}=section(z),row=[];
      for(let i=0;i<=24;i++){const t=i/24*2-1;row.push([t*(width-.012),top+.027*(1-t*t),z]);}rows.push(row);
    }
    return patch(group,rows,body,name);
  }
  topSheet(-2.25,-.61,'roadster-long-sloping-hood');topSheet(.92,2.25,'roadster-rear-deck');
  // Fine flush shut lines describe the low hood without adding a raised grille.
  for(const side of[-1,1]){
    const points=[];for(let i=0;i<=20;i++){const z=-1.99+i/20*1.35,{width,top}=section(z),x=side*(.55+(z+1.99)*.105);points.push([x,top+.027*(1-(x/(width-.012))**2)+.002,z]);}
    tube(group,points,.0026,seam,`roadster-flush-hood-seam-${side}`);
  }
  // Narrow shoulder strips beside the cabin, with a sculpted cockpit recess.
  for(const side of[-1,1]){
    const rows=[];for(let i=0;i<=35;i++){const z=-.61+i/35*1.68,{width,top}=section(z);rows.push([[side*.755,top+.014,z],[side*(width-.012),top,z]]);}
    patch(group,rows,body,`roadster-cabin-shoulder-${side}`);
  }
  patch(group,[[[-.79,.45,-2.252],[.79,.45,-2.252]],[[-.82,.275,-2.252],[.82,.275,-2.252]]],body,'roadster-nose-fascia');
  patch(group,[[[-.82,.275,-2.26],[.82,.275,-2.26]],[[-.87,.215,-2.29],[.87,.215,-2.29]]],carbon,'roadster-front-splitter');
  patch(group,[[[-.88,.79,2.25],[.88,.79,2.25]],[[-.91,.66,2.27],[.91,.66,2.27]]],body,'roadster-horizontal-rear-fascia');
  // The rear photograph shows a dark inset below the light, with pale corner
  // shoulders. Keeping the four openings inside it avoids exhaust-like studs.
  patch(group,[[[-.86,.657,2.271],[.86,.657,2.271]],[[-.78,.57,2.278],[.78,.57,2.278]],[[-.76,.37,2.27],[.76,.37,2.27]]],black,'roadster-recessed-rear-outlet-panel');
  for(const side of[-1,1])patch(group,[[[side*.86,.66,2.27],[side*.91,.66,2.27]],[[side*.78,.57,2.278],[side*.89,.57,2.26]],[[side*.76,.37,2.27],[side*.82,.40,2.25]]],body,`roadster-rear-corner-shoulder-${side}`);
  patch(group,[[[-.82,.40,2.255],[.82,.40,2.255]],[[-.78,.19,2.31],[.78,.19,2.31]],[[-.67,.17,1.87],[.67,.17,1.87]]],carbon,'roadster-rear-diffuser');
  for(const x of[-.68,-.34,0,.34,.68])patch(group,[[[x-.012,.20,1.88],[x+.012,.20,1.88]],[[x-.012,.12,2.27],[x+.012,.12,2.27]],[[x-.012,.33,2.27],[x+.012,.33,2.27]]],black,`roadster-diffuser-fence-${x}`);
  mesh(group,new THREE.BoxGeometry(1.5,.055,3.64),carbon,'roadster-flat-undertray',[0,.222,-.02]);
  // Rear light is a thin continuous red band, as seen in the ramp photograph.
  patch(group,[[[-.881,.771,2.275],[.881,.771,2.275]],[[-.883,.707,2.281],[.883,.707,2.281]]],black,'roadster-tail-lamp-recess');
  tube(group,[[-.87,.737,2.284],[-.45,.738,2.289],[0,.738,2.29],[.45,.738,2.289],[.87,.737,2.284]],.011,red,'roadster-full-width-tail-lamp');
  tube(group,[[-.88,.699,2.273],[0,.698,2.277],[.88,.699,2.273]],.006,rim,'roadster-tail-lamp-lower-edge');
  for(const side of[-1,1]){
    tube(group,[[side*.19,.459,-2.258],[side*.58,.477,-2.232],[side*.79,.505,-2.16]],.012,light,`roadster-slim-headlamp-${side}`);
    patch(group,[[[side*.38,.37,-2.258],[side*.76,.38,-2.247]],[[side*.39,.31,-2.263],[side*.72,.32,-2.263]]],black,`roadster-front-air-slot-${side}`);
  }
  // Glazing has a sloped windscreen, a low roof, and a strongly tapered rear.
  const windshield=[];
  for(let j=0;j<=14;j++){const t=j/14,z=-.68+t*.73,y=.807+t*.392,w=.732-t*.125,row=[];for(let i=0;i<=24;i++){const u=i/24*2-1;row.push([u*w,y+.025*(1-u*u),z+.032*(1-u*u)]);}windshield.push(row);}
  const windscreen=patch(group,windshield,glazing,'roadster-low-sloped-windscreen');windscreen.renderOrder=3;
  patch(group,[[[-.607,1.199,.05],[0,1.228,.05],[.607,1.199,.05]],[[-.58,1.18,.65],[0,1.21,.65],[.58,1.18,.65]]],black,'roadster-dark-cockpit-roof');
  for(const side of[-1,1]){
    const glassRows=[[[side*.733,.807,-.68],[side*.607,1.199,.05]],[[side*.758,.82,.52],[side*.58,1.18,.65]],[[side*.765,.86,1.08],[side*.66,1.015,1.08]]];
    const window=patch(group,glassRows,glazing,`roadster-side-glass-${side}`);window.renderOrder=3;
    tube(group,[[side*.734,.80,-.68],[side*.609,1.20,.05],[side*.58,1.185,.65]],.017,black,`roadster-canopy-frame-${side}`);
    tube(group,[[side*.731,.795,-.68],[side*.759,.81,.52],[side*.776,.854,1.09]],.015,black,`roadster-glass-beltline-${side}`);
    // White flying buttresses straddle the black rear opening.
    patch(group,[[[side*.58,1.18,.65],[side*.74,1.125,.66]],[[side*.61,1.09,.98],[side*.91,.95,1.13]],[[side*.64,.91,1.58],[side*.99,.905,1.42]]],body,`roadster-white-rear-buttress-${side}`);
    rod(group,[side*.75,.82,-.52],[side*.98,.85,-.58],.018,black,`roadster-mirror-stalk-${side}`);
    ellipse(group,[.08,.038,.075],body,`roadster-mirror-shell-${side}`,[side*.99,.866,-.58]);
    ellipse(group,[.064,.026,.006],glazing,`roadster-mirror-glass-${side}`,[side*.99,.866,-.514]);
  }
  patch(group,[[[-.58,1.18,.66],[.58,1.18,.66]],[[-.64,.92,1.59],[.64,.92,1.59]]],black,'roadster-black-rear-cockpit-panel');
  // Two elongated recesses are visible in the rear demonstration photograph.
  // Their exact depth and internal hardware are not supplied by that image.
  for(const side of[-1,1]){
    const centreX=side*.43,points=[],rows=[];
    for(let i=0;i<=24;i++){const t=i/24,z=.80+t*.44,y=1.18-(z-.66)/.93*.26+.008,w=.056*Math.sqrt(Math.max(0,1-(t*2-1)**2)),x=centreX+side*t*.022;rows.push([[x-w,y,z],[x+w,y,z]]);}
    patch(group,rows,interior,`roadster-rear-cockpit-slot-${side}`);
    for(let i=0;i<=48;i++){const a=i/48*Math.PI*2,z=1.02+Math.cos(a)*.22,y=1.18-(z-.66)/.93*.26+.011;points.push([centreX+side*(z-.8)/.44*.022+Math.sin(a)*.056,y,z]);}
    tube(group,points,.0065,seam,`roadster-rear-slot-frame-${side}`);
  }
  // Detailed closed aerodynamic wheels. A lathed tyre gives a broad tread and
  // curved sidewall; thin grooves and a dished metal disk distinguish rubber.
  const wheels=[];
  for(const side of[-1,1])for(const [axle,z]of wheelZ.entries()){
    const pivot=new THREE.Group();pivot.name=`roadster-${axle===0?'front':'rear'}-steering-${side}`;pivot.position.set(side*.88,.37,z);group.add(pivot);
    const spin=new THREE.Group();spin.name=`roadster-wheel-spin-${side}-${axle}`;pivot.add(spin);
    const profile=[new THREE.Vector2(.295,-.124),new THREE.Vector2(.342,-.12),new THREE.Vector2(.365,-.088),new THREE.Vector2(.37,-.055),new THREE.Vector2(.37,.055),new THREE.Vector2(.365,.088),new THREE.Vector2(.342,.12),new THREE.Vector2(.295,.124)];
    const tyre=new THREE.LatheGeometry(profile,64);tyre.rotateZ(Math.PI/2);mesh(spin,tyre,rubber,`roadster-tyre-${side}-${axle}`);
    for(const offset of[-.061,-.018,.018,.061])mesh(spin,new THREE.TorusGeometry(.3675,.0021,4,64),seam,`roadster-tread-groove-${side}-${axle}-${offset}`,[offset,0,0],[0,Math.PI/2,0]);
    const diskProfile=[new THREE.Vector2(0,0),new THREE.Vector2(.055,.006),new THREE.Vector2(.23,.022),new THREE.Vector2(.312,.027),new THREE.Vector2(.326,.014)];
    const disk=new THREE.LatheGeometry(diskProfile,64);disk.rotateZ(-side*Math.PI/2);
    const diskIndices=disk.index.array;for(let i=0;i<diskIndices.length;i+=3){const swap=diskIndices[i+1];diskIndices[i+1]=diskIndices[i+2];diskIndices[i+2]=swap;}disk.computeVertexNormals();
    mesh(spin,disk,disc,`roadster-closed-aero-disc-${side}-${axle}`,[side*.124,0,0]);
    mesh(spin,new THREE.TorusGeometry(.326,.006,6,64),rim,`roadster-rim-edge-${side}-${axle}`,[side*.138,0,0],[0,Math.PI/2,0]);
    mesh(spin,new THREE.CylinderGeometry(.055,.055,.016,24),black,`roadster-wheel-centre-${side}-${axle}`,[side*.151,0,0],[0,0,Math.PI/2]);
    mesh(spin,new THREE.TorusGeometry(.299,.0035,6,64),black,`roadster-aero-disc-inset-${side}-${axle}`,[side*.15,0,0],[0,Math.PI/2,0]);
    rod(spin,[side*.147,.281,.03],[side*.154,.283,.03],.007,black,`roadster-wheel-valve-${side}-${axle}`);
    wheels.push({pivot,spin,front:axle===0});
  }
  // A single helmeted driver in a reclined bucket seat: elbows bent to the yoke,
  // knees under the dash and two feet toward the pedal box, all within the cabin.
  const driver=new THREE.Group();driver.name='roadster-single-driver';group.add(driver);
  ellipse(driver,[.235,.075,.31],interior,'roadster-seat-cushion',[0,.39,.29]);
  ellipse(driver,[.245,.32,.075],interior,'roadster-seat-back',[0,.66,.62],[-.20,0,0]);
  ellipse(driver,[.12,.13,.065],interior,'roadster-headrest',[0,.99,.67]);
  ellipse(driver,[.167,.24,.105],fabric,'roadster-driver-torso',[0,.66,.36],[-.25,0,0]);
  ellipse(driver,[.12,.13,.108],helmet,'roadster-driver-helmet',[0,1.006,.46]);
  ellipse(driver,[.112,.058,.026],visor,'roadster-driver-visor',[0,1.019,.368]);
  rod(driver,[-.14,.82,.30],[-.10,.48,.235],.018,black,'roadster-driver-harness-left');rod(driver,[.14,.82,.30],[.10,.48,.235],.018,black,'roadster-driver-harness-right');
  for(const side of[-1,1]){
    const shoulder=[side*.17,.79,.37],elbow=[side*.22,.64,.10],hand=[side*.145,.706,-.17];
    rod(driver,shoulder,elbow,.054,fabric,`roadster-upper-arm-${side}`,.066);rod(driver,elbow,hand,.040,fabric,`roadster-forearm-${side}`,.05);
    ellipse(driver,[.031,.037,.044],skin,`roadster-driver-hand-${side}`,hand);
    rod(driver,[side*.105,.43,.30],[side*.14,.36,-.13],.077,fabric,`roadster-driver-thigh-${side}`,.09);rod(driver,[side*.14,.36,-.13],[side*.14,.235,-.58],.052,fabric,`roadster-driver-shin-${side}`,.066);
    ellipse(driver,[.057,.043,.10],black,`roadster-driver-shoe-${side}`,[side*.14,.239,-.62]);
  }
  const yoke=new THREE.Group();yoke.name='roadster-steering-yoke';yoke.position.set(0,.69,-.20);driver.add(yoke);
  tube(yoke,[[-.155,.05,0],[-.17,-.03,0],[0,-.085,0],[.17,-.03,0],[.155,.05,0]],.018,black,'roadster-yoke-rim');
  rod(yoke,[0,-.06,0],[0,.01,0],.022,black,'roadster-yoke-spoke');
  mesh(driver,new THREE.BoxGeometry(.29,.105,.015),black,'roadster-instrument-display',[0,.741,-.31],[-.15,0,0]);
  // Four rear circular outlets and four underside corner jets are informed by
  // the rear / flight frames. Their hidden pipework and exact sizes are estimates.
  const nozzles=[];
  function nozzle(pos,direction,name){
    const part=mesh(group,new THREE.CylinderGeometry(.048,.068,.09,24,1,true),rim,name,pos);
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...direction));
    const inner=mesh(group,new THREE.CircleGeometry(.044,24),black,`${name}-dark-throat`,pos);
    inner.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(...direction));
    const lip=mesh(group,new THREE.TorusGeometry(.05,.005,8,24),rim,`${name}-flush-lip`,pos.map((v,i)=>v+direction[i]*.046));
    lip.quaternion.copy(inner.quaternion);
    inner.position.addScaledVector(new THREE.Vector3(...direction),.006);
    nozzles.push({position:pos.map((v,i)=>v+direction[i]*.05),direction});
  }
  for(const x of[-.42,-.14,.14,.42])nozzle([x,.47,2.258],[0,0,1],`roadster-rear-nozzle-${x}`);
  for(const x of[-.65,.65])for(const z of[-1.09,1.09])nozzle([x,.186,z],[0,-1,0],`roadster-lift-nozzle-${x}-${z}`);
  // Soft expanding white-blue condensation. No emissive flame, orange light or
  // hard cone geometry. Seeds are fixed so animation stays deterministic.
  const particlesPerNozzle=72,count=nozzles.length*particlesPerNozzle,positions=new Float32Array(count*3),directions=new Float32Array(count*3),seeds=new Float32Array(count*3),types=new Float32Array(count);
  nozzles.forEach((nozzle,n)=>{for(let i=0;i<particlesPerNozzle;i++){const index=n*particlesPerNozzle+i;positions.set(nozzle.position,index*3);directions.set(nozzle.direction,index*3);seeds.set([(i+.31)/particlesPerNozzle,Math.sin(i*79.21+n*17.19)*.5+.5,Math.cos(i*39.61+n*81.37)*.5+.5],index*3);types[index]=n<4?0:1;}});
  const plumeGeometry=ownGeometry(new THREE.BufferGeometry());plumeGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));plumeGeometry.setAttribute('aDirection',new THREE.BufferAttribute(directions,3));plumeGeometry.setAttribute('aSeed',new THREE.BufferAttribute(seeds,3));plumeGeometry.setAttribute('aLift',new THREE.BufferAttribute(types,1));
  const plumeMaterial=ownMaterial(new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.NormalBlending,uniforms:{uTime:{value:0},uPower:{value:0},uForward:{value:0},uLift:{value:0},uPixelScale:{value:650}},
    vertexShader:`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aDirection; attribute vec3 aSeed; attribute float aLift;
      uniform float uTime; uniform float uPower; uniform float uForward; uniform float uLift; uniform float uPixelScale;
      varying float vFade; varying float vNoise;
      void main(){float phase=fract(aSeed.x+uTime*(1.7+aSeed.y*.3));float power=mix(uForward,uPower*uLift,aLift);
        float length=mix(.35+power*1.1,mix(.85,1.8,power),aLift);float spread=(.022+phase*phase*.30)*power;
        vec3 across=aLift>.5?vec3(aSeed.y-.5,0.0,aSeed.z-.5):vec3(aSeed.y-.5,aSeed.z-.5,0.0);
        vec3 p=position+aDirection*(.03+phase*length)+across*spread;
        vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;
        #include <logdepthbuf_vertex>
        gl_PointSize=clamp((.045+phase*.36)*(.65+power*.45)*uPixelScale/max(.4,-mv.z),1.0,72.0);
        vFade=pow(max(0.0,sin(phase*3.14159)),.7)*mix(.28,.32,aLift)*power;vNoise=aSeed.y*6.28;}`,
    fragmentShader:`
      #include <logdepthbuf_pars_fragment>
      varying float vFade; varying float vNoise; void main(){
      #include <logdepthbuf_fragment>
      vec2 uv=gl_PointCoord-.5;float r=length(uv)*2.0;float edge=1.0-smoothstep(.22,1.0,r);float grain=.85+.15*sin(uv.x*21.0+vNoise)*sin(uv.y*19.0+vNoise);gl_FragColor=vec4(.79,.89,.94,edge*edge*vFade*grain);}` }));
  const plumes=new THREE.Points(plumeGeometry,plumeMaterial);plumes.name='roadster-cold-gas-condensation';plumes.frustumCulled=false;plumes.renderOrder=5;group.add(plumes);
  let elapsed=0,disposed=false,lastDistance=0,signedTravel=0,lastTravelDirection=1,lastSpeed=0,coastingWheelSpeed=0;
  function update(state={},dt=0){
    if(disposed)return;
    const step=clamp(number(dt),0,.1);elapsed+=step;
    const steering=clamp(number(state.steeringAngle),-.55,.55),travel=Math.max(0,number(state.distance)),speed=number(state.speed);
    // Motion.distance is accumulated path length, including reverse travel.
    // Integrate its signed delta so repeated render updates cannot spin wheels
    // again; a decreasing odometer is the controller's explicit reset.
    if(travel<lastDistance-1e-7){signedTravel=0;lastTravelDirection=1;coastingWheelSpeed=0;}
    else if(state.grounded===false){
      // Wheels freewheel after takeoff; air distance must not drive them.
      signedTravel+=coastingWheelSpeed*(1-Math.exp(-step*1.8))/1.8;
      coastingWheelSpeed*=Math.exp(-step*1.8);
    }else if(travel>lastDistance){
      if(Math.abs(speed)>.01)lastTravelDirection=Math.sign(speed);
      signedTravel+=(travel-lastDistance)*lastTravelDirection;
    }
    if(state.grounded!==false)coastingWheelSpeed=speed;
    lastDistance=travel;
    for(const wheel of wheels){wheel.pivot.rotation.y=wheel.front?steering:0;wheel.spin.rotation.x=signedTravel?-signedTravel/wheelRadius:0;}
    yoke.rotation.z=steering*1.6;
    const power=clamp(number(state.jetPower),0,1),airborne=!state.grounded,liftActive=!!state.flightEnabled&&power>.001;
    const acceleration=step>0?(speed-lastSpeed)/step:0;
    const forwardPower=clamp(number(state.forwardJetPower,airborne?(state.braking?0:Math.max(0,speed)*.004+Math.max(0,acceleration)*.08):power),0,1);
    lastSpeed=speed;plumes.visible=(liftActive?power:0)>.01||forwardPower>.01;
    plumeMaterial.uniforms.uTime.value=elapsed;plumeMaterial.uniforms.uPower.value=power;
    plumeMaterial.uniforms.uForward.value=forwardPower;
    plumeMaterial.uniforms.uLift.value=liftActive?1:0;
    red.emissiveIntensity=speed<-.05?1.25:state.braking?2.1:.8;
    group.updateMatrixWorld(true);
  }
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();geometries.clear();materials.clear();}
  update({},0);return{group,update,dispose};
}
