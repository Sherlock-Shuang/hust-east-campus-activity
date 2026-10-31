import {campusEffectBudget} from './campus-effect-budget.js';
import {getC118FloodElapsed} from './c118-flood-state.js';
import {createCampusFloodwater} from './campus-floodwater.js';

import {CAMPUS_TSUNAMI_PLACEMENT,campusTsunamiFront as waveFront} from './campus-tsunami-timeline.js';
export {CAMPUS_TSUNAMI_PLACEMENT} from './campus-tsunami-timeline.js';
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};

export function sampleCampusTsunami(event,now){
  const elapsed=getC118FloodElapsed(event,now);
  if(!event||!Number.isFinite(now)||!Number.isFinite(event.startAt)||!Number.isFinite(event.pausedMs)||!Number.isFinite(elapsed))return null;
  const firstFront=waveFront(elapsed),waves=[];
  // Two reusable crests cross the entire world. They recycle only after moving
  // well beyond its northern boundary; the inundated region never moves back.
  for(let slot=0;slot<2;slot++){
    const clock=elapsed+3-slot*CAMPUS_TSUNAMI_PLACEMENT.interval,cycle=Math.floor(Math.max(0,clock)/CAMPUS_TSUNAMI_PLACEMENT.period),age=((Math.max(0,clock)%CAMPUS_TSUNAMI_PLACEMENT.period)-3);
    const front=waveFront(age),height=260+((cycle===0&&slot===0?670:380)-260)*smooth((age+3)/3);
    const opacity=clock<0?0:smooth((age+3)/1.2)*(1-smooth((-front-6000)/2200));
    waves.push({slot,cycle,age,front,height,opacity,reveal:.3+.7*smooth((age+3)/3),visible:opacity>.001});
  }
  const primary=[...waves].filter(w=>w.visible).sort((a,b)=>Math.abs(a.front+1200)-Math.abs(b.front+1200))[0]||waves[0];
  return {elapsed,firstFront,waves,front:primary.front,height:primary.height,reveal:primary.reveal,
    arrival:smooth((elapsed+3)/3),phase:elapsed<0?'approaching':firstFront>882?'arrival':firstFront>-4600?'crossing':'surging'};
}

// All motion remains a pure function of the host clock. No CPU particle loop,
// reflection render target, downloaded texture, or per-frame geometry allocation.
const QUALITY=Object.freeze({
  desktop:{width:192,height:42,foam:14,back:12,spray:1100},
  mobile:{width:128,height:32,foam:10,back:10,spray:480},
  low:{width:88,height:24,foam:8,back:8,spray:220},
});
const waveMath=/* glsl */`
  uniform float uTime,uFront,uHeight,uReveal,uOpacity;
  float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);}
  float breaking(float u,float t){return smoothstep(.28,.72,noise21(vec2(u*15.7+t*.045,3.8+t*.10)));}
  vec2 bezier(vec2 a,vec2 b,vec2 c,vec2 d,float t){float r=1.-t;return r*r*r*a+3.*r*r*t*b+3.*r*t*t*c+t*t*t*d;}
  vec3 wavePoint(float u,float v,float t){
    // A concave forward face meets a curling lip; a separate rear surface
    // gives the crest real volume from aerial viewpoints. Both Bezier
    // pieces share their tangent at the crest: no former .78 sharp crease.
    float broad=noise21(vec2(u*8.3+t*.025,1.9));
    float ridge=.80+.28*broad+.042*sin(u*36.-t*.58)+.025*sin(u*79.+t*.8);
    float h=uHeight*ridge,broken=breaking(u,t);
    vec2 crest=vec2(-.055*h,h);
    vec2 shoulder=vec2(.23*h,1.045*h);
    vec2 profile;
    if(v<.70){profile=bezier(vec2(-260.,-26.),vec2(h*.27,h*.12),shoulder,crest,v/.70);}
    else{profile=bezier(crest,crest+(crest-shoulder)*(.30/.70),vec2(-h*(.40+.08*broken),h*.87),vec2(-h*(.19+.15*broken),h*(.61-.12*broken)),(v-.70)/.30);}
    float face=sin(v*3.14159265);
    float folds=(sin(u*111.+v*23.-t*1.6)*2.1+sin(u*63.-v*31.+t*.9)*2.7)*face;
    folds+=smoothstep(.82,1.,v)*(noise21(vec2(u*61.,t*.38))-.5)*55.;
    float shift=(broad-.5)*100.+sin(u*16.+t*.2)*18.;
    return vec3(u*4500.,profile.y+folds,uFront+profile.x+u*u*600.+shift);
  }
  vec3 backPoint(float u,float v,float t){
    vec3 crest=wavePoint(u,.70,t);
    vec2 profile=bezier(vec2(crest.z,crest.y),vec2(crest.z+uHeight*.34,crest.y*.99),vec2(crest.z+700.,crest.y*.08),vec2(crest.z+1100.,-26.),v);
    return vec3(crest.x,profile.y,profile.x);
  }
`;
const atmosphere=/* glsl */`
  uniform vec3 uFogColor;
  uniform float uFogNear,uFogFar,uImmersion;
  vec3 airPerspective(vec3 color,vec3 world){
    float distance=length(cameraPosition-world);
    float haze=smoothstep(uFogNear,uFogFar,distance);
    // Spray and the low wall share campus haze; high crests rise above it.
    haze*=mix(mix(.31,.23,smoothstep(40.,700.,world.y)),1.,uImmersion);
    return mix(color,uFogColor,haze);
  }
`;
const waveVertex=/* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  ${waveMath}
  uniform float uLayer;
  varying vec2 vWave;
  varying vec3 vWorld,vNormal;
  void main(){
    float u=uv.x*2.-1.,v=uLayer>.5?.57+uv.y*.43:uv.y;
    vec3 p=wavePoint(u,v,uTime);
    vec3 du=wavePoint(u+.0004,v,uTime)-wavePoint(u-.0004,v,uTime);
    vec3 dv=wavePoint(u,min(1.,v+.001),uTime)-wavePoint(u,max(0.,v-.001),uTime);
    vec3 normal=normalize(cross(dv,du));
    if(uLayer>.5)p+=normal*1.8;
    if(uLayer>1.5){
      float q=uv.y;p=backPoint(u,q,uTime);
      du=backPoint(u+.0004,q,uTime)-backPoint(u-.0004,q,uTime);
      dv=backPoint(u,min(1.,q+.001),uTime)-backPoint(u,max(0.,q-.001),uTime);
      normal=normalize(cross(du,dv));v=clamp(p.y/uHeight,0.,1.)*.70;
    }
    vNormal=mat3(modelMatrix)*normal;
    vWave=vec2(u,v);vWorld=(modelMatrix*vec4(p,1.)).xyz;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
    #include <logdepthbuf_vertex>
  }
`;
const waveFragment=/* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${waveMath}
  ${atmosphere}
  uniform float uLayer;
  varying vec2 vWave;
  varying vec3 vWorld,vNormal;
  void main(){
    #include <logdepthbuf_fragment>
    float u=vWave.x,v=vWave.y,distance=length(cameraPosition-vWorld);
    // Domain-warped, advected detail in metres instead of repeating stripes.
    vec2 flow=vec2(vWorld.x*.048,v*19.+uTime*.65);
    vec2 warp=vec2(noise21(flow*.37),noise21(flow*.42+7.1));
    float coarse=noise21(flow+warp*2.4);
    float detail=noise21(flow*3.13+warp*3.0);
    float micro=detail;
    #ifndef LOW_QUALITY
      micro=mix(detail,noise21(flow*8.7+warp*2.),.42*(1.-smoothstep(600.,2600.,distance)));
    #endif
    float broken=breaking(u,uTime);
    vec3 normal=normalize(vNormal+vec3((coarse-.5)*.12,(micro-.5)*.06,(detail-.5)*.08));
    vec3 eye=normalize(cameraPosition-vWorld);if(dot(normal,eye)<0.)normal=-normal;
    vec3 sun=normalize(vec3(650.,520.,420.));
    float fresnel=.025+.975*pow(1.-max(0.,dot(normal,eye)),5.);
    vec3 reflected=reflect(-eye,normal);
    vec3 sky=mix(vec3(.46,.56,.59),vec3(.19,.31,.40),smoothstep(-.12,.8,reflected.y));
    float thin=smoothstep(.44,.82,v)*(1.-smoothstep(.94,1.02,v));
    vec3 deep=vec3(.012,.063,.080);
    vec3 transmitted=mix(deep,vec3(.035,.26,.245),thin*(.55+.45*coarse));
    float backlight=pow(max(0.,dot(eye,-sun)),2.);
    transmitted+=vec3(.028,.13,.105)*thin*(.3+.7*backlight);
    transmitted*=.72+.50*coarse;
    vec3 color=mix(transmitted,sky,clamp(fresnel*.82,0.,.86));
    color*=.73+.27*max(0.,dot(normal,sun));
    float specular=pow(max(0.,dot(normal,normalize(sun+eye))),64.);
    color+=vec3(.9,.83,.68)*specular*.30;
    float lip=smoothstep(.58,.74,v)*(1.-smoothstep(.82,.99,v))*(.45+.55*broken);
    float foamField=coarse*.60+detail*.27+micro*.13;
    float foam=smoothstep(.52,.78,foamField+lip*.15)*lip;
    float runnels=smoothstep(.69,.86,coarse*.65+detail*.35)*smoothstep(.18,.66,v)*broken*.48;
    color=mix(color,vec3(.60,.72,.70),clamp(foam*.58+runnels,0.,.82));
    float edge=1.-smoothstep(.94,1.,abs(u)),alpha=1.;
    if(uLayer<.5){
      float fray=smoothstep(.89,.99,v);
      color=mix(color,vec3(.49,.65,.63),fray*smoothstep(.36,.72,foamField)*.65);
      alpha=(1.-fray*smoothstep(.35,.70,detail)*.72)*(1.-smoothstep(.988,1.,v));
    }
    if(uLayer>.5&&uLayer<1.5){
      float coverage=smoothstep(.38,.71,foamField+lip*.19);
      alpha=lip*coverage*(.35+.65*broken)*.65;
      color=mix(vec3(.30,.49,.48),vec3(.82,.89,.84),foamField*.70+.25);
    }
    alpha*=edge*uOpacity;if(alpha<.012)discard;
    color=airPerspective(color,vWorld);
    gl_FragColor=vec4(color,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const sprayVertex=/* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  ${waveMath}
  attribute vec4 aSeed;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vAlpha,vSeed;
  void main(){
    float life=fract(aSeed.y+uTime*.21),age=life*4.76;
    float base=step(.72,aSeed.w),u=aSeed.x;
    // A packet leaves the crest at its birth time and continues forward under
    // wind/gravity. It doesn't glue itself to today's moving ridge.
    vec3 p=wavePoint(u,.72,uTime-age);
    p.z-=age*(72.+aSeed.z*65.);
    p.x+=age*(10.+aSeed.z*12.);
    float airborne=step(.44,aSeed.w);
    p.y+=mix((35.+aSeed.z*45.)*age-62.*age*age,(50.+aSeed.z*65.)*age-26.*age*age,airborne);
    if(base>.5){p=vec3(u*4500.+age*16.,18.+sin(life*3.14159265)*(24.+aSeed.z*55.),uFront+u*u*600.-180.-age*32.);}
    float size=mix(18.+aSeed.z*28.,38.+aSeed.z*52.,base)*(1.+life*1.4);
    float emission=mix(.22+.78*breaking(u,uTime-age),1.,base);
    vAlpha=smoothstep(-8.,28.,p.y)*smoothstep(0.,.12,life)*(1.-smoothstep(.55,1.,life))*emission*(1.-smoothstep(.94,1.,abs(u)))*uOpacity;
    vSeed=aSeed.z*37.;vUv=uv;
    vWorld=(modelMatrix*vec4(p,1.)).xyz;
    vec4 view=modelViewMatrix*vec4(p,1.);
    float angle=aSeed.w*6.283+life*.6;
    mat2 rotation=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
    view.xy+=rotation*position.xy*vec2(size*1.5,size);
    gl_Position=projectionMatrix*view;
    #include <logdepthbuf_vertex>
  }
`;
const sprayFragment=/* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${waveMath}
  ${atmosphere}
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vAlpha,vSeed;
  void main(){
    #include <logdepthbuf_fragment>
    vec2 p=vUv-.5;float radius=length(p);
    float cloud=noise21(vUv*5.+vSeed)*.64+noise21(vUv*12.+vSeed)*.36;
    float alpha=(1.-smoothstep(.10,.49,radius+(.5-cloud)*.14))*vAlpha*.39;
    if(alpha<.008)discard;
    vec3 color=mix(vec3(.43,.56,.56),vec3(.82,.88,.84),cloud*.6+vUv.y*.3);
    gl_FragColor=vec4(airPerspective(color,vWorld),alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCampusTsunami({THREE,scene,quality='desktop',level}){
  if(Number.isFinite(level))quality=campusEffectBudget({level}).quality;
  quality=Object.hasOwn(QUALITY,quality)?quality:'desktop';
  let budget=QUALITY[quality];
  const group=new THREE.Group();group.name='campus-tsunami';group.visible=false;
  group.position.set(CAMPUS_TSUNAMI_PLACEMENT.x,0,CAMPUS_TSUNAMI_PLACEMENT.z);scene.add(group);
  let built=false,disposed=false,lastSample=null,lastTime=null,lastId=null,lastReduced=false,qualityDirty=false,water;
  const geometries=[],materials=[],surges=[];
  const air={uFogColor:{value:new THREE.Color('#cbd6d6')},uFogNear:{value:480},uFogFar:{value:2900},uImmersion:{value:0}};
  const animatedBounds=new THREE.Box3();
  function boundSurge(surge,wave){
    // Conservative envelopes of both Bezier pieces, rear water and ballistic
    // instanced billboard corners; do not use the undisplaced unit planes.
    for(const mesh of surge.children){
      const spray=mesh.name==='campus-tsunami-spray',back=mesh.name==='campus-tsunami-backwater';
      animatedBounds.min.set(spray?-4850:-4510,spray?-1800:-40,wave.front-(spray?wave.height*.56+950:Math.max(260,wave.height*.56)+75));
      animatedBounds.max.set(spray?4850:4510,wave.height*1.21+(spray?360:40),wave.front+(back?1800:spray?980:wave.height*.31+680));
      animatedBounds.getBoundingSphere(mesh.boundingSphere);
    }
  }
  function syncAir(){const fog=scene.fog;if(fog?.isFog){air.uFogColor.value.copy(fog.color);air.uFogNear.value=fog.near;air.uFogFar.value=fog.far;air.uImmersion.value=fog.name==='campus-tsunami-immersion'?1:0;}}
  function build(){
    if(built)return;built=true;
    const bodyGeometry=new THREE.PlaneGeometry(1,1,budget.width,budget.height),foamGeometry=new THREE.PlaneGeometry(1,1,budget.width,budget.foam),backGeometry=new THREE.PlaneGeometry(1,1,budget.width,budget.back);
    geometries.push(bodyGeometry,foamGeometry,backGeometry);
    const quad=new THREE.PlaneGeometry(1,1),sprayGeometry=new THREE.InstancedBufferGeometry();
    sprayGeometry.index=quad.index;sprayGeometry.attributes.position=quad.attributes.position;sprayGeometry.attributes.uv=quad.attributes.uv;quad.dispose();
    const seeds=new Float32Array(budget.spray*4);
    for(let i=0;i<budget.spray;i++)seeds.set([((i*.61803398875)%1)*2-1,(i*.754877666)%1,(i*.56984029)%1,(i*.41421356)%1],i*4);
    sprayGeometry.setAttribute('aSeed',new THREE.InstancedBufferAttribute(seeds,4));sprayGeometry.instanceCount=budget.spray;geometries.push(sprayGeometry);
    for(let slot=0;slot<2;slot++){
      const surge=new THREE.Group();surge.name=`campus-tsunami-surge-${slot}`;group.add(surge);
      const uniforms={...air,uTime:{value:0},uFront:{value:4200},uHeight:{value:260},uReveal:{value:0},uOpacity:{value:0}};
      const defines=quality!=='desktop'?{LOW_QUALITY:1}:{};
      for(const [geometry,layer,name] of [[bodyGeometry,0,'wall'],[foamGeometry,1,'crest'],[backGeometry,2,'backwater']]){
        const material=new THREE.ShaderMaterial({uniforms:{...uniforms,uLayer:{value:layer}},defines,vertexShader:waveVertex,fragmentShader:waveFragment,
          side:THREE.DoubleSide,transparent:true,depthWrite:layer!==1,fog:false,forceSinglePass:true});
        const mesh=new THREE.Mesh(geometry,material);mesh.name=`campus-tsunami-${name}`;mesh.frustumCulled=true;mesh.boundingSphere=new THREE.Sphere();mesh.onBeforeRender=syncAir;
        mesh.renderOrder=layer===1?9:6;surge.add(mesh);materials.push(material);
      }
      const sprayMaterial=new THREE.ShaderMaterial({uniforms,vertexShader:sprayVertex,fragmentShader:sprayFragment,transparent:true,depthWrite:false,fog:false,forceSinglePass:true});
      const spray=new THREE.Mesh(sprayGeometry,sprayMaterial);spray.name='campus-tsunami-spray';spray.frustumCulled=true;spray.boundingSphere=new THREE.Sphere();spray.renderOrder=10;surge.add(spray);materials.push(sprayMaterial);
      surges.push({group:surge,uniforms});
    }
    water=createCampusFloodwater({THREE,quality});water.group.position.x=0;group.add(water.group);
    group.userData.resident=true;group.userData.quality=quality;
  }
  function paintSample(sample,time,reducedMotion){
    for(const wave of sample.waves){
      const {group:surge,uniforms}=surges[wave.slot];surge.visible=wave.visible;boundSurge(surge,wave);
      uniforms.uTime.value=time;uniforms.uFront.value=wave.front;uniforms.uHeight.value=wave.height;uniforms.uReveal.value=wave.reveal;uniforms.uOpacity.value=wave.opacity;
    }
    return water.update({active:true,elapsed:sample.elapsed,front:sample.firstFront,reducedMotion});
  }
  function releaseResources(){
    water?.dispose();water=null;
    for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
    geometries.length=materials.length=surges.length=0;group.clear();built=false;group.userData.resident=false;
  }
  return {
    group,
    get resident(){return built;},
    releaseResources(){group.visible=false;releaseResources();},
    setPerformanceBudget(next){return this.setQuality(campusEffectBudget(next).quality);},
    setQuality(next){
      next=Object.hasOwn(QUALITY,next)?next:'desktop';if(disposed||next===quality)return false;
      quality=next;budget=QUALITY[next];qualityDirty=true;
      if(built){releaseResources();if(group.visible&&lastSample){build();paintSample(lastSample,lastTime,lastReduced);}}
      return true;
    },
    get sample(){return lastSample;},
    get active(){return group.visible&&!disposed;},
    sampleAt(position){return group.visible&&!disposed&&water?water.sampleAt(position):{wet:false,depth:0,waterY:-1,fill:0};},
    update({event,now,visible=true,paused=false,reducedMotion=false}){
      if(disposed)return false;
      let sample=sampleCampusTsunami(event,now);
      const wasVisible=group.visible;group.visible=!!sample&&visible;
      if(!sample){lastSample=null;lastId=null;lastTime=null;water?.update({active:false,elapsed:0,front:4200});return wasVisible;}
      if(!group.visible)return wasVisible;
      build();
      // A local pause awaiting the server's reconciliation freezes the same
      // world-space surface; resume/late join seeks the authoritative clock.
      if(paused&&event.pausedAt==null&&lastId===event.id&&lastSample)sample=lastSample;
      const time=reducedMotion?0:sample.elapsed;
      let changed=qualityDirty||!wasVisible||lastId!==event.id||lastTime!==time||lastReduced!==!!reducedMotion||lastSample?.elapsed!==sample.elapsed;
      changed=paintSample(sample,time,reducedMotion)||changed;qualityDirty=false;
      lastId=event.id;lastTime=time;lastSample=sample;lastReduced=!!reducedMotion;return changed;
    },
    dispose(){if(disposed)return;disposed=true;group.visible=false;group.removeFromParent();releaseResources();lastSample=null;}
  };
}

export function mountCampusTsunamiNotice({THREE,root,camera,effect,scene}){
  const wash=document.createElement('div');wash.className='campus-tsunami-wash';wash.hidden=true;wash.setAttribute('aria-hidden','true');root.append(wash);
  const notice=document.createElement('div');notice.className='campus-tsunami-notice';notice.hidden=true;
  notice.innerHTML='<span class="campus-tsunami-arrow" aria-hidden="true">↑</span><div><small>剧情演出 · 校园南侧</small><strong role="status" aria-live="polite">远处巨浪正在逼近 · 前往高处</strong></div>';
  root.append(notice);const arrow=notice.querySelector('.campus-tsunami-arrow'),label=notice.querySelector('strong');
  const forward=new THREE.Vector3();let previousText='',savedFog=null,ownsFog=false,disposed=false;
  const immersionFog=new THREE.Fog('#416e74',2,180);immersionFog.name='campus-tsunami-immersion';
  const waterColor=new THREE.Color('#285e67'),mistColor=new THREE.Color('#b8cdcb');
  function restoreFog(){if(ownsFog&&scene?.fog===immersionFog)scene.fog=savedFog;ownsFog=false;savedFog=null;}
  return {
    update({paused=false,reducedMotion=false}={}){
      if(disposed)return;
      const sample=effect.sample,active=effect.active&&!!sample;
      notice.hidden=!active||paused;
      const water=effect.sampleAt(camera.position),underwater=active&&water.wet&&water.depth>.08;
      let next=null,impact=0;
      if(active){
        const u=(camera.position.x-CAMPUS_TSUNAMI_PLACEMENT.x)/(CAMPUS_TSUNAMI_PLACEMENT.width/2);
        next=[...sample.waves].filter(w=>w.visible).sort((a,b)=>Math.abs(a.front-camera.position.z)-Math.abs(b.front-camera.position.z))[0];
        if(next&&Math.abs(u)<1&&!reducedMotion){
          const distance=camera.position.z-next.front-u*u*CAMPUS_TSUNAMI_PLACEMENT.arcDepth;
          impact=(1-smooth(Math.abs(distance+100)/310))*(1-smooth(camera.position.y/(next.height*.8)))*next.opacity;
        }
      }
      wash.hidden=!underwater&&impact<.005;
      wash.dataset.submerged=String(underwater);
      wash.style.opacity=String(underwater?Math.min(.56,.19+Math.max(0,water.depth)*.04):impact*.38);
      if(scene&&(underwater||impact>.005)){
        if(!ownsFog||scene.fog!==immersionFog){savedFog=scene.fog;ownsFog=true;}
        const strength=underwater?clamp(water.depth/3):impact;
        immersionFog.color.copy(underwater?waterColor:mistColor);
        if(savedFog?.color)immersionFog.color.lerp(savedFog.color,1-strength);
        immersionFog.near=underwater?1:Math.max(3,(savedFog?.near??480)*(1-impact));
        immersionFog.far=underwater?Math.max(45,190-water.depth*18):(savedFog?.far??2900)*(1-impact)+200*impact;
        scene.fog=immersionFog;
      }else restoreFog();
      if(notice.hidden)return;
      camera.getWorldDirection(forward);
      const dx=CAMPUS_TSUNAMI_PLACEMENT.x-camera.position.x,dz=(next?.front??sample.front)-camera.position.z;
      const relative=Math.atan2(dx,-dz)-Math.atan2(forward.x,-forward.z);
      arrow.style.transform=`rotate(${relative}rad)`;
      const text=underwater?'海水已淹入校园 · 后续巨浪继续推进':impact>.45?'浪头即将抵达 · 前往高处':water.wet?'巨浪正在横穿校园 · 急流持续翻涌':sample.phase==='crossing'?'海啸正在冲入校园 · 前往高处':'远处巨浪正在逼近 · 前往高处';
      if(text!==previousText){label.textContent=text;previousText=text;}
      notice.dataset.phase=sample.phase;
      notice.dataset.inundated=String(water.wet);notice.dataset.waterDepth=water.depth.toFixed(2);notice.dataset.waveFront=sample.firstFront.toFixed(1);
    },
    dispose(){if(disposed)return;disposed=true;restoreFog();notice.remove();wash.remove();}
  };
}
