import {getC118FloodElapsed} from './c118-flood-state.js';
import {createCampusFloodwater} from './campus-floodwater.js';

// Fixed LOCAL_ENU coordinates (x east, z south). Each crest travels from the
// southern horizon through the whole playable campus, including z = -3942 m.
// Camera motion never moves the wave; only the shared event clock does.
export const CAMPUS_TSUNAMI_PLACEMENT=Object.freeze({x:1400,z:0,width:9000,farFront:4200,shoreFront:1100,speed:260,arcDepth:600,period:40,interval:20});
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
const waveFront=age=>age<0?CAMPUS_TSUNAMI_PLACEMENT.farFront+(CAMPUS_TSUNAMI_PLACEMENT.shoreFront-CAMPUS_TSUNAMI_PLACEMENT.farFront)*smooth((age+3)/3):CAMPUS_TSUNAMI_PLACEMENT.shoreFront-CAMPUS_TSUNAMI_PLACEMENT.speed*age;

export function sampleCampusTsunami(event,now){
  const elapsed=getC118FloodElapsed(event,now);
  if(elapsed===null)return null;
  const firstFront=waveFront(elapsed),waves=[];
  // Two reusable crests cross the entire world. They recycle only after moving
  // well beyond its northern boundary; the inundated region never moves back.
  for(let slot=0;slot<2;slot++){
    const clock=elapsed+3-slot*CAMPUS_TSUNAMI_PLACEMENT.interval,cycle=Math.floor(Math.max(0,clock)/CAMPUS_TSUNAMI_PLACEMENT.period),age=((Math.max(0,clock)%CAMPUS_TSUNAMI_PLACEMENT.period)-3);
    const front=waveFront(age),height=260+((cycle===0&&slot===0?670:380)-260)*smooth((age+3)/3);
    const opacity=clock<0?0:smooth((age+3)/1.2)*(1-smooth((-front-6000)/2200));
    waves.push({slot,age,front,height,opacity,reveal:.3+.7*smooth((age+3)/3),visible:opacity>.001});
  }
  const primary=[...waves].filter(w=>w.visible).sort((a,b)=>Math.abs(a.front+1200)-Math.abs(b.front+1200))[0]||waves[0];
  return {elapsed,firstFront,waves,front:primary.front,height:primary.height,reveal:primary.reveal,
    arrival:smooth((elapsed+3)/3),phase:elapsed<0?'approaching':firstFront>882?'arrival':firstFront>-4600?'crossing':'surging'};
}

const waveMath=`
  uniform float uTime;
  uniform float uFront;
  uniform float uHeight;
  uniform float uReveal;
  uniform float uOpacity;
  float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+vec2(1.)),f.x),f.y);}
  vec3 wavePoint(float u,float v){
    float ridge=1.0+.045*sin(u*38.0+uTime*1.9)+.025*sin(u*81.0-uTime*2.4);
    float h=uHeight*ridge;
    float y,z;
    if(v<.78){float q=v/.78;y=-28.0+(h+28.0)*pow(sin(q*1.5707963),1.8);z=720.0*pow(1.0-q,1.75)-h*.12*sin(q*3.14159265);}
    else {float curl=(v-.78)/.22*2.28;y=h-h*.24*(1.0-cos(curl));z=-h*.24*sin(curl);}
    float ripples=sin(u*105.0+v*42.0-uTime*4.0)*4.2+sin(u*57.0-v*36.0+uTime*2.8)*5.0;
    y+=ripples*sin(v*3.14159265);
    z+=u*u*${CAMPUS_TSUNAMI_PLACEMENT.arcDepth.toFixed(1)}+sin(u*16.0+uTime*.65)*28.0;
    return vec3(u*${(CAMPUS_TSUNAMI_PLACEMENT.width/2).toFixed(1)},y,uFront+z);
  }
`;
const waveVertex=`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  ${waveMath}
  uniform float uFoam;
  varying vec2 vWave;
  varying vec3 vWorld;
  void main(){
    float u=uv.x*2.0-1.0,v=mix(uv.y,.69+uv.y*.31,uFoam);
    vec3 p=wavePoint(u,v);p.y+=uFoam*2.5;p.z-=uFoam*2.5;
    vWave=vec2(u,v);vWorld=(modelMatrix*vec4(p,1.0)).xyz;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
    #include <logdepthbuf_vertex>
  }
`;
const waveFragment=`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${waveMath}
  uniform float uFoam;
  varying vec2 vWave;
  varying vec3 vWorld;
  void main(){
    #include <logdepthbuf_fragment>
    float u=vWave.x,v=vWave.y;
    float flow=noise21(vec2(u*120.0,v*22.0+uTime*1.4));
    float fine=noise21(vec2(u*480.0+sin(v*55.0)*1.4,v*70.0+uTime*3.5));
    float streak=pow(.5+.5*sin(u*700.0+v*18.0+flow*9.0),9.0);
    vec3 normal=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
    float rim=pow(1.0-abs(dot(normal,normalize(cameraPosition-vWorld))),2.0);
    vec3 color=mix(vec3(.018,.095,.15),vec3(.045,.36,.40),smoothstep(.08,.85,v));
    color+=vec3(.08,.15,.15)*(flow*.5+fine*.25+rim*.4);
    color+=vec3(.19,.27,.25)*streak*smoothstep(.32,.82,v)*.42;
    float foam=smoothstep(.69,.84,v)*(flow*.58+fine*.5);
    color=mix(color,vec3(.70,.86,.85),foam*.65);
    float edge=1.0-smoothstep(.88,1.0,abs(u));
    float alpha=1.0;
    if(uFoam>.5){
      float lip=smoothstep(.69,.79,v)*(1.0-smoothstep(.91,1.01,v));
      alpha=lip*smoothstep(.18,.64,flow*.65+fine*.6)*edge*.92;
      if(alpha<.045)discard;
      color=mix(vec3(.47,.72,.73),vec3(.94,.98,.94),fine*.65+.35);
    }
    color=mix(vec3(.51,.65,.68),color,uReveal);
    alpha*=uOpacity*edge;if(alpha<.01)discard;
    gl_FragColor=vec4(color,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCampusTsunami({THREE,scene}){
  const group=new THREE.Group();group.name='campus-tsunami';group.visible=false;
  group.position.set(CAMPUS_TSUNAMI_PLACEMENT.x,0,CAMPUS_TSUNAMI_PLACEMENT.z);scene.add(group);
  let built=false,disposed=false,lastSample=null,lastTime=null,lastId=null,water;
  const geometries=[],materials=[],surges=[];
  function build(){
    if(built)return;built=true;
    const bodyGeometry=new THREE.PlaneGeometry(1,1,180,30),foamGeometry=new THREE.PlaneGeometry(1,1,180,12);
    geometries.push(bodyGeometry,foamGeometry);
    // One batch of airborne droplets traces the breaking lip; seeds are fixed
    // so every participant sees the same wave phase without network particles.
    const count=1500,positions=new Float32Array(count*3);
    for(let i=0;i<count;i++){positions[i*3]=((i*.61803398875)%1)*2-1;positions[i*3+1]=(i*.754877666)%1;positions[i*3+2]=(i*.56984029)%1;}
    const sprayGeometry=new THREE.BufferGeometry();sprayGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometries.push(sprayGeometry);
    for(let slot=0;slot<2;slot++){
      const surge=new THREE.Group();surge.name=`campus-tsunami-surge-${slot}`;group.add(surge);
      const uniforms={uTime:{value:0},uFront:{value:4200},uHeight:{value:260},uReveal:{value:0},uOpacity:{value:0}};
      for(const [geometry,foam] of [[bodyGeometry,0],[foamGeometry,1]]){
        const material=new THREE.ShaderMaterial({uniforms:{...uniforms,uFoam:{value:foam}},vertexShader:waveVertex,fragmentShader:waveFragment,
          side:THREE.DoubleSide,transparent:true,depthWrite:foam===0,fog:false});
        const mesh=new THREE.Mesh(geometry,material);mesh.name=foam?'campus-tsunami-crest':'campus-tsunami-wall';
        mesh.frustumCulled=false;surge.add(mesh);materials.push(material);
      }
      const sprayMaterial=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,fog:false,
      vertexShader:`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        ${waveMath}
        varying float vLife;
        void main(){
          float life=fract(position.y+uTime*.31);vLife=sin(life*3.14159265);
          vec3 p=wavePoint(position.x,.78);
          p.y+=sin(life*3.14159265)*(22.0+position.z*65.0)-life*38.0;
          p.z-=life*(90.0+position.z*95.0);p.x+=sin(life*5.0+position.z*30.0)*22.0;
          vec4 view=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*view;
          gl_PointSize=clamp((14.0+position.z*14.0)*1200.0/max(1.0,-view.z),1.0,36.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader:`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying float vLife;
        uniform float uOpacity;
        void main(){
          #include <logdepthbuf_fragment>
          float radius=length(gl_PointCoord-vec2(.5));if(radius>.5)discard;
          gl_FragColor=vec4(.8,.94,.94,(1.0-smoothstep(.12,.5,radius))*vLife*.64*uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
      const spray=new THREE.Points(sprayGeometry,sprayMaterial);spray.name='campus-tsunami-spray';spray.frustumCulled=false;surge.add(spray);materials.push(sprayMaterial);
      surges.push({group:surge,uniforms});
    }
    water=createCampusFloodwater({THREE});water.group.position.x=0;group.add(water.group);
  }
  return {
    group,
    get sample(){return lastSample;},
    get active(){return group.visible;},
    sampleAt(position){return group.visible&&water?water.sampleAt(position):{wet:false,depth:0,waterY:-1,fill:0};},
    update({event,now,visible=true,paused=false,reducedMotion=false}){
      if(disposed)return false;
      const wasVisible=group.visible;group.visible=!!event&&visible;
      if(!event){lastSample=null;lastId=null;lastTime=null;water?.update({active:false,elapsed:0,front:4200});return wasVisible;}
      if(!group.visible)return wasVisible;
      build();
      let sample=sampleCampusTsunami(event,now);
      // The server's pausedAt is authoritative. This guard also freezes a frame
      // while a locally paused host is waiting for its reconciled event state.
      if(paused&&event.pausedAt==null&&lastId===event.id&&lastSample)sample=lastSample;
      const time=reducedMotion?0:sample.elapsed;
      const changed=!wasVisible||lastId!==event.id||lastTime!==time||lastSample?.front!==sample.front||lastSample?.height!==sample.height;
      for(const wave of sample.waves){
        const {group:surge,uniforms}=surges[wave.slot];surge.visible=wave.visible;
        uniforms.uTime.value=time;uniforms.uFront.value=wave.front;uniforms.uHeight.value=wave.height;uniforms.uReveal.value=wave.reveal;uniforms.uOpacity.value=wave.opacity;
      }
      water.update({active:true,elapsed:sample.elapsed,front:sample.firstFront,reducedMotion});
      lastId=event.id;lastTime=time;lastSample=sample;return changed;
    },
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();water?.dispose();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();group.clear();lastSample=null;}
  };
}

export function mountCampusTsunamiNotice({THREE,root,camera,effect}){
  const wash=document.createElement('div');wash.className='campus-tsunami-wash';wash.hidden=true;wash.setAttribute('aria-hidden','true');root.append(wash);
  const notice=document.createElement('div');notice.className='campus-tsunami-notice';notice.hidden=true;
  notice.innerHTML='<span class="campus-tsunami-arrow" aria-hidden="true">↑</span><div><small>剧情演出 · 校园南侧</small><strong role="status" aria-live="polite">远处巨浪正在逼近 · 前往高处</strong></div>';
  root.append(notice);const arrow=notice.querySelector('.campus-tsunami-arrow'),label=notice.querySelector('strong');
  const forward=new THREE.Vector3();let previousText='';
  return {
    update({paused=false}={}){
      notice.hidden=!effect.active||paused;
      const water=effect.sampleAt(camera.position),underwater=effect.active&&water.wet&&water.depth>.08;
      wash.hidden=!underwater;wash.style.opacity=String(Math.min(.32,.12+Math.max(0,water.depth)*.025));
      if(notice.hidden)return;
      camera.getWorldDirection(forward);
      const next=[...effect.sample.waves].filter(w=>w.visible).sort((a,b)=>Math.abs(a.front-camera.position.z)-Math.abs(b.front-camera.position.z))[0];
      const dx=CAMPUS_TSUNAMI_PLACEMENT.x-camera.position.x,dz=(next?.front??effect.sample.front)-camera.position.z;
      const relative=Math.atan2(dx,-dz)-Math.atan2(forward.x,-forward.z);
      arrow.style.transform=`rotate(${relative}rad)`;
      const text=underwater?'海水已淹入校园 · 后续巨浪继续推进':water.wet?'巨浪正在横穿校园 · 急流持续翻涌':effect.sample.phase==='crossing'?'海啸正在冲入校园 · 前往高处':'远处巨浪正在逼近 · 前往高处';
      if(text!==previousText){label.textContent=text;previousText=text;}
      notice.dataset.phase=effect.sample.phase;
      notice.dataset.inundated=String(water.wet);notice.dataset.waterDepth=water.depth.toFixed(2);notice.dataset.waveFront=effect.sample.firstFront.toFixed(1);
    },
    dispose(){notice.remove();wash.remove();}
  };
}
