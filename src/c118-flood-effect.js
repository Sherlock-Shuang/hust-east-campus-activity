/** Deterministic, time-authored disaster staging, not a hydraulic simulation.
 * Door positions, floor heights and room bounds come from the current hall plan.
 * All geometry is allocated once; clients seek by the same elapsed server time.
 */
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const pulse=(x,width)=>Math.exp(-(x*x)/(width*width));
const meshBudgets=[[32,48,16,8,128],[48,72,28,12,320],[80,120,44,20,640]];
const safeLevel=level=>Math.max(0,Math.min(2,Math.floor(Number.isFinite(level)?level:2)));

// One spectrum feeds CPU height queries and generated GLSL. Each component is
// [amplitude, x frequency, z frequency, time frequency, phase] in local metres.
export const C118_FLOOD_WAVES=Object.freeze([
  [.24,.56,.31,-2.35,0], [.14,1.21,-.86,3.7,.8],
  [.085,.5,2.8,-5.2,1.7], [.05,3.6,1.3,7.1,2.3],
].map(w=>Object.freeze(w)));
const glslFloat=n=>Number.isInteger(n)?`${n}.`:String(n);
const waveExpression=C118_FLOOD_WAVES.map(([a,x,z,t,p])=>`${glslFloat(a)}*sin(p.x*${glslFloat(x)}+p.y*${glslFloat(z)}+t*${glslFloat(t)}+${glslFloat(p)})`).join('+');

function configuration(plan){
  const c=plan.config,doors=plan.doors.slice(0,4).map(d=>({x:d.x,z:d.z,y:d.y??c.floorY,
    side:d.side??Math.sign(d.x),width:d.width||2.2,delay:d.tier==='middle'?1.2:0}));
  // Older plans had only the two front doors. Repeat inert slots for the shader.
  while(doors.length<4)doors.push({...doors[0],delay:100000});
  const rearY=Math.max(c.floorY,...plan.seatRows.map(r=>r.y));
  return {width:c.width,depth:c.depth,floorY:c.floorY,
    peak:Math.min(c.floorY+c.height-1.4,Math.max(c.floorY+6.5,rearY+1.9)),doors};
}

function sample(c,position,elapsed,rippleScale=1){
  const t=Number.isFinite(elapsed)?elapsed:-1;
  if(t<1.5)return {waterY:c.floorY-1,impact:0,depth:0,submerged:false,phase:'waiting',currentX:0,currentZ:0};
  const level=c.floorY-.35+(c.peak-c.floorY+.35)*Math.pow(clamp((t-2.8)/15.2),.85);
  const turbulence=smooth(1.5,4,t);
  let height=level,impact=0,currentX=0,currentZ=0;
  for(const d of c.doors){
    const age=t-1.5-d.delay;if(age<0)continue;
    const dx=position.x-d.x,dz=position.z-d.z,dist=Math.hypot(dx,dz*.76);
    const front=age*4.5,gate=smooth(0,.45,age)*(1-smooth(4.6,7.6,age));
    const crest=pulse(dist-front,1.15)*gate;
    height+=(2.1+(d.y-c.floorY)*.48)*crest;
    impact=Math.max(impact,crest);
    currentX-=d.side*crest*1.35;
  }
  const x=position.x,z=position.z;
  height+=rippleScale*turbulence*C118_FLOOD_WAVES.reduce((sum,[a,kx,kz,w,p])=>sum+a*Math.sin(x*kx+z*kz+t*w+p),0);
  // Persistent crossing currents are bounded analytic functions of shared
  // event time: joining late never requires a fluid history or replay loop.
  currentX+=turbulence*(.95*Math.sin(z*.3-t*.85)+.45*Math.cos(x*.45+z*.13+t*.4));
  currentZ+=turbulence*(.8*Math.cos(x*.32+t*.72)+.38*Math.sin(z*.4-t*.6));
  height=Math.min(c.peak+.55,height);
  const depth=Math.max(0,height-(position.y??c.floorY+1.65));
  return {waterY:height,impact,depth,submerged:depth>.02,phase:t<8?'rush':t<18?'rising':'flooded',currentX:clamp(currentX,-2.6,2.6),currentZ};
}

export function sampleC118Flood(plan,position,elapsed){return sample(configuration(plan),position,elapsed);}

const waterField=/* glsl */`
uniform float uTime;
uniform float uFloor;
uniform float uPeak;
uniform float uRipple;
uniform vec4 uDoors[4];
float saturate1(float x){return clamp(x,0.,1.);}
float waterHeight(vec2 p){
  float t=uTime;
  float level=uFloor-.35+(uPeak-uFloor+.35)*pow(saturate1((t-2.8)/15.2),.85);
  for(int i=0;i<4;i++){
    vec4 d=uDoors[i];float age=t-1.5-d.w;
    float dist=length((p-d.xy)*vec2(1.,.76));
    float gate=smoothstep(0.,.45,age)*(1.-smoothstep(4.6,7.6,age));
    float delta=(dist-age*4.5)/1.15;
    level+=(2.1+(d.z-uFloor)*.48)*exp(-delta*delta)*gate;
  }
  float turbulence=smoothstep(1.5,4.,t);
  level+=uRipple*turbulence*(${waveExpression});
  return min(uPeak+.55,level);
}
float crestMask(vec2 p){
  float crest=0.;
  for(int i=0;i<4;i++){
    vec4 d=uDoors[i];float age=uTime-1.5-d.w;
    float dist=length((p-d.xy)*vec2(1.,.76));float delta=(dist-age*4.5)/1.4;
    crest=max(crest,exp(-delta*delta)*smoothstep(0.,.45,age)*(1.-smoothstep(4.6,7.6,age)));
  }
  return crest;
}`;

const surfaceNoise=/* glsl */`
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);}
float foamNoise(vec2 p){
  #if EFFECT_DETAIL > 0
    return .55*noise21(p)+.3*noise21(p*2.13)+.15*noise21(p*4.09);
  #else
    return noise21(p);
  #endif
}
`;

export function createC118FloodEffect(THREE,{plan,level=2}){
  const c=configuration(plan),group=new THREE.Group();group.name='c118-tsunami';group.visible=false;
  const geometries=new Set(),materials=[];let disposed=false,rippleScale=1,lastElapsed=-1,qualityLevel=safeLevel(level);
  const [columns,rows,jetColumns,jetRows,particles]=meshBudgets[qualityLevel];
  const ownGeometry=g=>(geometries.add(g),g),ownMaterial=m=>(materials.push(m),m);
  const uniforms={uTime:{value:0},uFloor:{value:c.floorY},uPeak:{value:c.peak},uRipple:{value:1},
    uRoom:{value:new THREE.Vector4(c.width/2,c.depth/2,c.floorY,c.floorY+plan.config.height)},
    uDoors:{value:c.doors.map(d=>new THREE.Vector4(d.x,d.z,d.y,d.delay))}};
  const geometry=ownGeometry(new THREE.PlaneGeometry(c.width-.06,c.depth-.06,columns,rows));geometry.rotateX(-Math.PI/2);
  const waterMaterial=ownMaterial(new THREE.ShaderMaterial({uniforms,defines:{EFFECT_DETAIL:qualityLevel},transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,
    vertexShader:waterField+/* glsl */`
      varying vec3 vWorld;varying vec3 vNormal;varying float vCrest;
      void main(){vec3 p=position;p.y=waterHeight(p.xz);float e=.08;
        float dx=waterHeight(p.xz+vec2(e,0.))-waterHeight(p.xz-vec2(e,0.));
        float dz=waterHeight(p.xz+vec2(0.,e))-waterHeight(p.xz-vec2(0.,e));
        vNormal=normalize(vec3(-dx,2.*e,-dz));vCrest=crestMask(p.xz);
        vec4 world=modelMatrix*vec4(p,1.);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:surfaceNoise+/* glsl */`
      uniform float uTime;varying vec3 vWorld;varying vec3 vNormal;varying float vCrest;
      void main(){vec3 n=normalize(vNormal);vec3 eye=normalize(cameraPosition-vWorld);
        if(!gl_FrontFacing)n=-n;
        float fresnel=pow(1.-max(0.,dot(eye,n)),3.);
        vec2 drift=vec2(vWorld.x*.75+uTime*.78,vWorld.z*1.24-uTime*.68);
        float f=foamNoise(drift),fine=foamNoise(drift*3.1+vec2(uTime*.2,0.));
        float streak=pow(.5+.5*sin(vWorld.z*4.6+vWorld.x*1.3+f*7.-uTime*4.),8.);
        float breaking=smoothstep(.035,.34,1.-abs(n.y));
        float foam=smoothstep(.40,.72,f)*vCrest*.94+streak*.32*smoothstep(.38,.66,fine)+breaking*smoothstep(.39,.69,f)*.68;
        float shine=pow(max(0.,dot(reflect(-normalize(vec3(-.3,.85,.15)),n),eye)),44.);
        vec3 deep=vec3(.025,.13,.155),shallow=vec3(.10,.32,.35);
        vec3 color=mix(deep,shallow,.38+.42*fresnel+.12*f)+vec3(.45,.61,.60)*shine*.8;
        color=mix(color,vec3(.78,.88,.84),clamp(foam,0.,.95));
        gl_FragColor=vec4(color,gl_FrontFacing?.86:.43);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`}));
  const water=new THREE.Mesh(geometry,waterMaterial);water.name='c118-rising-water';water.frustumCulled=false;water.renderOrder=10;group.add(water);

  // Broad, tapered fluid tongues originate exactly in the four real door gaps.
  // Each front rolls upward then curls forward; only its root fits the doorway.
  const jetGeometry=ownGeometry(new THREE.PlaneGeometry(1,1,jetColumns,jetRows));
  const jetUniforms=[],jets=[];
  for(const door of c.doors){
    const u={uTime:uniforms.uTime,uOrigin:{value:new THREE.Vector3(door.x,door.y,door.z)},uSide:{value:door.side},
      uDoorWidth:{value:door.width},uDelay:{value:door.delay},uFloor:uniforms.uFloor,uPeak:uniforms.uPeak,uRipple:uniforms.uRipple,uDoors:uniforms.uDoors};jetUniforms.push(u);
    const material=ownMaterial(new THREE.ShaderMaterial({uniforms:u,defines:{EFFECT_DETAIL:qualityLevel},transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:waterField+/* glsl */`
        uniform float uSide,uDelay,uDoorWidth;uniform vec3 uOrigin;
        varying vec3 vWorld;varying vec2 vUv;varying float vRoll;varying float vFade;
        void main(){float age=max(0.,uTime-1.5-uDelay);float progress=smoothstep(0.,.38,age);
          float ongoing=smoothstep(5.,10.,age);
          float front=min(16.,age*4.5)*(1.-ongoing*.14*(.5+.5*sin(age*1.3)));float u=uv.x,v=uv.y*2.-1.;
          float width=uDoorWidth*.48+pow(u,1.6)*min(5.2,front*.34);
          float roll=exp(-pow((u-(.84-ongoing*.2*(.5+.5*sin(age*1.8))))/.15,2.));
          float edge=pow(max(0.,1.-v*v),.45);
          float h=(.27+1.8*roll+1.1*exp(-pow((u-.14)/.3,2.)))*edge;
          float x=uOrigin.x-uSide*(u*front+.42*roll*sin(u*12.+age*3.));
          float z=uOrigin.z+v*width+u*u*1.4;
          float base=mix(uOrigin.y,max(uOrigin.y,waterHeight(vec2(x,z))-.19),ongoing);
          float y=min(uPeak+.83,base+.08+h*progress*(1.-ongoing*.74)+.16*uRipple*sin(u*17.-age*7.+v*4.)*edge);
          vUv=vec2(u,v);vRoll=roll;vFade=progress*(1.-ongoing*.42);
          vWorld=vec3(x,y,z);gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(vWorld,1.);
        }`,
      fragmentShader:surfaceNoise+/* glsl */`
        uniform float uTime;varying vec3 vWorld;varying vec2 vUv;varying float vRoll,vFade;
        void main(){if(vFade<.015)discard;
          float n=foamNoise(vec2(vUv.x*19.-uTime*5.,vUv.y*7.+uTime*.3));
          float strands=pow(.5+.5*sin(vUv.y*43.+n*8.+vUv.x*12.-uTime*6.),5.);
          float foam=clamp(vRoll*(.35+.8*n)+strands*.44+pow(abs(vUv.y),8.)*.7,0.,1.);
          vec3 col=mix(vec3(.065,.27,.30),vec3(.81,.9,.86),foam);
          float alpha=vFade*(.78+.19*foam)*(1.-smoothstep(.83,1.,abs(vUv.y)));
          gl_FragColor=vec4(col,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`}));
    const jet=new THREE.Mesh(jetGeometry,material);jet.name=`c118-door-surge-${door.side}-${door.delay}`;jet.frustumCulled=false;jet.renderOrder=20;group.add(jet);jets.push(jet);
  }

  // Ballistic spray is evaluated from immutable seeds and elapsed time, so
  // late arrivals and rewinds see the same droplets without simulating history.
  const count=640,positions=new Float32Array(count*3),seeds=new Float32Array(count*4);
  let random=17481;const rand=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/4294967296;};
  for(let i=0;i<count;i++){seeds.set([rand(),rand(),rand(),i%4],i*4);}
  const sprayGeometry=ownGeometry(new THREE.BufferGeometry());sprayGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));sprayGeometry.setAttribute('aSeed',new THREE.BufferAttribute(seeds,4));
  sprayGeometry.setDrawRange(0,particles);
  const sprayMaterial=ownMaterial(new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,
    vertexShader:/* glsl */`
      uniform float uTime,uFloor,uPeak;uniform vec4 uDoors[4];uniform vec4 uRoom;attribute vec4 aSeed;varying float vAlpha;
      void main(){vec4 door=uDoors[int(aSeed.w)];float age=uTime-1.5-door.w;
        float life=1.1+aSeed.y*.55;float born=floor((max(0.,age)+aSeed.x*life)/life)*life-aSeed.x*life;
        float t=max(0.,age-born);float ongoing=smoothstep(5.,10.,age);
        float emission=step(0.,age)*smoothstep(0.,.3,age)*(1.-ongoing*.3);
        float side=sign(door.x);float speed=5.5+aSeed.x*4.8;
        float level=uFloor-.35+(uPeak-uFloor+.35)*pow(clamp((uTime-2.8)/15.2,0.,1.),.85);
        float base=mix(door.z,max(door.z,level-.3),ongoing);
        vec3 p=vec3(door.x-side*(.1+speed*t),base+.5+(3.8+aSeed.y*4.1)*(1.-ongoing*.35)*t-4.9*t*t,
          door.y+(aSeed.z-.5)*1.8+(aSeed.z-.5)*7.*t+t*t*.9);
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp((2.+aSeed.y*5.)*70./max(1.,-mv.z),1.,26.);
        // Fade droplets before they meet the solid room shell. The real wall
        // still depth-tests every sprite; no particles continue outside it.
        float inside=smoothstep(.035,.28,uRoom.x-abs(p.x))*smoothstep(.035,.28,uRoom.y-abs(p.z));
        inside*=smoothstep(uRoom.z+.025,uRoom.z+.25,p.y)*(1.-smoothstep(uRoom.w-.35,uRoom.w-.035,p.y));
        vAlpha=emission*inside*(1.-smoothstep(life*.55,life,t))*smoothstep(0.,.08,t);
      }`,
    fragmentShader:/* glsl */`
      varying float vAlpha;void main(){vec2 q=(gl_PointCoord-.5)*vec2(2.5,1.8);float d=dot(q,q);if(d>1.||vAlpha<.01)discard;
        gl_FragColor=vec4(vec3(.82,.92,.9),vAlpha*pow(1.-d,1.4)*.7);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`}));
  const spray=new THREE.Points(sprayGeometry,sprayMaterial);spray.name='c118-door-spray';spray.frustumCulled=false;spray.renderOrder=30;group.add(spray);
  group.userData={type:'authored-tsunami',peakWaterLevel:c.peak,doors:c.doors.map(d=>({...d})),additionalDrawCalls:6,qualityLevel};
  function setPerformanceBudget({level=2}={}){
    if(disposed)return;
    const next=safeLevel(level);
    if(next===qualityLevel)return;
    qualityLevel=next;
    for(const material of materials)if(material.defines?.EFFECT_DETAIL!==undefined){material.defines.EFFECT_DETAIL=next;material.needsUpdate=true;}
    const [columns,rows,jetColumns,jetRows,particles]=meshBudgets[next];
    // Only one set is resident; changing quality replaces two immutable meshes,
    // not the shader, shared clock or CPU collision/water sampler.
    const oldSurface=water.geometry,oldJet=jets[0].geometry;
    water.geometry=ownGeometry(new THREE.PlaneGeometry(c.width-.06,c.depth-.06,columns,rows).rotateX(-Math.PI/2));
    const nextJet=ownGeometry(new THREE.PlaneGeometry(1,1,jetColumns,jetRows));
    for(const jet of jets)jet.geometry=nextJet;
    geometries.delete(oldSurface);geometries.delete(oldJet);oldSurface.dispose();oldJet.dispose();
    sprayGeometry.setDrawRange(0,particles);group.userData.qualityLevel=next;
  }
  return {
    group,
    setPerformanceBudget,
    update({elapsed,active=true,reducedMotion=false}){
      if(disposed)return;lastElapsed=Number.isFinite(elapsed)?elapsed:-1;
      group.visible=Boolean(active)&&lastElapsed>=1.5;
      rippleScale=reducedMotion ? .35 : 1;uniforms.uRipple.value=rippleScale;uniforms.uTime.value=Math.max(0,lastElapsed);
      spray.visible=!reducedMotion;
    },
    sampleAt(position,elapsed=lastElapsed){return sample(c,position,elapsed,rippleScale);},
    dispose(){if(disposed)return;disposed=true;group.visible=false;group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();},
  };
}
