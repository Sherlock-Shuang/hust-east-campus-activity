/** Water left behind the first campus wave. The advancing front is supplied by
 * the shared event timeline; subsequent crests never uncover flooded ground. */
export const CAMPUS_FLOOD_WATER=Object.freeze({
  x:1400,width:9000,minZ:-4000,maxZ:6000,arcDepth:600,level:8.2,fillDistance:450,
});

// Long surface swells fit the fixed campus mesh. Smaller racing ripples and
// whitewater are shaded per fragment, so nearby streets retain water detail.
// [amplitude, x frequency, z frequency, temporal frequency, phase]
export const CAMPUS_FLOOD_WAVES=Object.freeze([
  [.56,.013,.019,-1.7,0], [.32,-.024,.011,2.3,.8], [.18,.037,-.028,-3.1,1.9],
].map(wave=>Object.freeze(wave)));
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};
const glslFloat=value=>Number.isInteger(value)?`${value}.`:String(value);
const spectrum=CAMPUS_FLOOD_WAVES.map(([a,x,z,t,p])=>`${glslFloat(a)}*sin(p.x*${glslFloat(x)}+p.y*${glslFloat(z)}+uTime*${glslFloat(t)}+${glslFloat(p)})`).join('+');

function configuration(placement={}){
  const config={...CAMPUS_FLOOD_WATER,...placement};
  if(!['x','width','minZ','maxZ','arcDepth','level','fillDistance'].every(key=>Number.isFinite(config[key]))||
    config.width<=0||config.maxZ<=config.minZ||config.fillDistance<=0)throw new Error('Invalid campus floodwater placement');
  return config;
}

function sample(config,position,{active=true,elapsed=0,front=Infinity,reducedMotion=false}={}){
  const x=Number.isFinite(position?.x)?position.x:0,z=Number.isFinite(position?.z)?position.z:0,y=Number.isFinite(position?.y)?position.y:0;
  const inside=x>=config.x-config.width/2&&x<=config.x+config.width/2&&z>=config.minZ&&z<=config.maxZ;
  const u=(x-config.x)/(config.width/2),distance=z-front-u*u*config.arcDepth;
  const fill=active&&inside&&Number.isFinite(front)&&Number.isFinite(elapsed)?smooth(distance/config.fillDistance):0;
  const time=reducedMotion?0:elapsed,ripple=reducedMotion?.25:1;
  const swell=fill>0?CAMPUS_FLOOD_WAVES.reduce((value,[a,kx,kz,w,phase])=>value+a*Math.sin(x*kx+z*kz+time*w+phase),0):0;
  const waterY=-1+(config.level+1)*fill+swell*fill*ripple;
  const wet=fill>0;
  return {waterY,wet,fill,depth:wet?waterY-y:0};
}

export function sampleCampusFloodwater(position,options={}){
  return sample(configuration(options.placement),position,options);
}

const waterField=/* glsl */`
  uniform float uTime;
  uniform float uFront;
  uniform float uCenterX;
  uniform float uHalfWidth;
  uniform float uArcDepth;
  uniform float uLevel;
  uniform float uFillDistance;
  uniform float uRipple;
  float floodDistance(vec2 p){float x=(p.x-uCenterX)/uHalfWidth;return p.y-uFront-x*x*uArcDepth;}
  float floodFill(vec2 p){return smoothstep(0.,uFillDistance,floodDistance(p));}
  float waterHeight(vec2 p){float fill=floodFill(p);return -1.+(uLevel+1.)*fill+fill*uRipple*(${spectrum});}
`;

export function createCampusFloodwater({THREE,placement={}}){
  const config=configuration(placement),group=new THREE.Group();group.name='campus-floodwater';group.visible=false;
  group.position.x=config.x;
  let geometry=null,material=null,disposed=false;
  let state={active:false,elapsed:0,front:Infinity,reducedMotion:false};
  const uniforms={uTime:{value:0},uFront:{value:4200},uCenterX:{value:config.x},uHalfWidth:{value:config.width/2},
    uArcDepth:{value:config.arcDepth},uLevel:{value:config.level},uFillDistance:{value:config.fillDistance},uRipple:{value:1}};
  function build(){
    if(geometry)return;
    geometry=new THREE.PlaneGeometry(config.width,config.maxZ-config.minZ,180,160);
    geometry.rotateX(-Math.PI/2);geometry.translate(0,0,(config.maxZ+config.minZ)/2);
    material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:false,
      vertexShader:/* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        ${waterField}
        varying vec3 vWorld;
        void main(){
          vec3 p=position;vec2 worldXZ=vec2(p.x+uCenterX,p.z);p.y=waterHeight(worldXZ);
          vWorld=(modelMatrix*vec4(p,1.)).xyz;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader:/* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${waterField}
        varying vec3 vWorld;
        float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);}
        void main(){
          #include <logdepthbuf_fragment>
          float distance=floodDistance(vWorld.xz);if(distance<=0.)discard;
          float fill=floodFill(vWorld.xz);
          vec2 p=vWorld.xz;
          float e=1.,dx=waterHeight(p+vec2(e,0.))-waterHeight(p-vec2(e,0.));
          float dz=waterHeight(p+vec2(0.,e))-waterHeight(p-vec2(0.,e));
          vec2 flow=p*vec2(.13,.22)+vec2(uTime*.19,uTime*.95);
          float noise=noise21(flow),fine=noise21(flow*3.7+vec2(uTime*.4,0.));
          vec3 normal=normalize(vec3(-dx+sin(p.x*.31+p.y*.18+uTime*2.4)*.16*uRipple,2.,-dz+sin(p.y*.43-uTime*3.)*.21*uRipple));
          if(!gl_FrontFacing)normal=-normal;
          vec3 eye=normalize(cameraPosition-vWorld);
          float fresnel=pow(1.-max(0.,dot(eye,normal)),3.);
          float streak=pow(.5+.5*sin(p.y*.72+p.x*.18+noise*6.+uTime*4.1),10.);
          float frontFoam=(1.-smoothstep(15.,240.,distance))*smoothstep(.23,.7,noise);
          float foam=frontFoam*.88+streak*smoothstep(.33,.72,fine)*.58+smoothstep(.79,.98,noise)*.30;
          float shine=pow(max(0.,dot(reflect(-normalize(vec3(-.3,.85,.15)),normal),eye)),52.);
          vec3 color=mix(vec3(.02,.17,.21),vec3(.11,.38,.41),fresnel*.60+noise*.18);
          color+=vec3(.32,.48,.46)*shine*.55;
          color=mix(color,vec3(.80,.94,.91),clamp(foam,0.,.95));
          float alpha=(gl_FrontFacing?.84:.42)*smoothstep(0.,.07,fill);
          gl_FragColor=vec4(color,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh=new THREE.Mesh(geometry,material);mesh.name='campus-advancing-floodwater';mesh.frustumCulled=false;mesh.renderOrder=8;group.add(mesh);
  }
  return {
    group,
    update({active=false,elapsed=0,front=Infinity,reducedMotion=false}={}){
      if(disposed)return false;
      const valid=!!active&&Number.isFinite(elapsed)&&Number.isFinite(front);
      const next={active:valid,elapsed:valid?elapsed:0,front:valid?front:Infinity,reducedMotion:!!reducedMotion};
      const changed=next.active!==state.active||valid&&(next.front!==state.front||next.reducedMotion!==state.reducedMotion||!next.reducedMotion&&next.elapsed!==state.elapsed);
      state=next;group.visible=valid;if(!valid)return changed;
      build();uniforms.uTime.value=reducedMotion?0:elapsed;uniforms.uFront.value=front;uniforms.uRipple.value=reducedMotion?.25:1;
      return changed;
    },
    sampleAt(position){return sample(config,position,state);},
    dispose(){if(disposed)return;disposed=true;state={...state,active:false};group.visible=false;group.removeFromParent();geometry?.dispose();material?.dispose();group.clear();},
  };
}
