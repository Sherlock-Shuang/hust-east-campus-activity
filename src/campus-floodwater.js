import {campusEffectBudget} from './campus-effect-budget.js';

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
const phaseVector=CAMPUS_FLOOD_WAVES.map(([,x,z,t,p])=>`p.x*${glslFloat(x)}+p.y*${glslFloat(z)}+uTime*${glslFloat(t)}+${glslFloat(p)}`).join(',');
const waveCoefficients=component=>CAMPUS_FLOOD_WAVES.map(wave=>glslFloat(component===0?wave[0]:wave[0]*wave[component])).join(',');
const WATER_QUALITY=Object.freeze({
  desktop:{segmentsX:180,segmentsZ:160,detail:2},
  mobile:{segmentsX:128,segmentsZ:112,detail:1},
  low:{segmentsX:88,segmentsZ:80,detail:0},
});

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

export function createCampusFloodwater({THREE,placement={},quality='desktop',level}){
  if(Number.isFinite(level))quality=campusEffectBudget({level}).quality;
  const config=configuration(placement),group=new THREE.Group();group.name='campus-floodwater';group.visible=false;
  let budget=Object.hasOwn(WATER_QUALITY,quality)?WATER_QUALITY[quality]:WATER_QUALITY.desktop;
  group.position.x=config.x;
  let geometry=null,material=null,mesh=null,disposed=false;
  let state={active:false,elapsed:0,front:Infinity,reducedMotion:false};
  const uniforms={uTime:{value:0},uFront:{value:4200},uCenterX:{value:config.x},uHalfWidth:{value:config.width/2},
    uArcDepth:{value:config.arcDepth},uLevel:{value:config.level},uFillDistance:{value:config.fillDistance},uRipple:{value:1},
    uHazeColor:{value:new THREE.Color('#cbd6d6')},uHazeNear:{value:480},uHazeFar:{value:2900},uHazeDensity:{value:0},uHazeMode:{value:1}};
  function surfaceGeometry(){
    const g=new THREE.PlaneGeometry(config.width,config.maxZ-config.minZ,budget.segmentsX,budget.segmentsZ);
    g.rotateX(-Math.PI/2);g.translate(0,0,(config.maxZ+config.minZ)/2);
    const swell=CAMPUS_FLOOD_WAVES.reduce((sum,wave)=>sum+Math.abs(wave[0]),0);
    g.boundingBox=new THREE.Box3(new THREE.Vector3(-config.width/2,Math.min(-1,config.level)-swell,config.minZ),new THREE.Vector3(config.width/2,Math.max(-1,config.level)+swell,config.maxZ));
    g.boundingSphere=g.boundingBox.getBoundingSphere(new THREE.Sphere());return g;
  }
  function build(){
    if(geometry)return;
    geometry=surfaceGeometry();
    material=new THREE.ShaderMaterial({uniforms,defines:{WATER_DETAIL:budget.detail},transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,fog:false,
      vertexShader:/* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        ${waterField}
        varying vec3 vWorld;
        varying float vViewDepth;
        void main(){
          vec3 p=position;vec2 worldXZ=vec2(p.x+uCenterX,p.z);p.y=waterHeight(worldXZ);
          vWorld=(modelMatrix*vec4(p,1.)).xyz;
          vec4 view=modelViewMatrix*vec4(p,1.);vViewDepth=-view.z;
          gl_Position=projectionMatrix*view;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader:/* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${waterField}
        varying vec3 vWorld;
        varying float vViewDepth;
        uniform vec3 uHazeColor;
        uniform float uHazeNear,uHazeFar,uHazeDensity,uHazeMode;
        // Hash arithmetic avoids another sine for every corner of every noise cell.
        float hash21(vec2 p){vec3 h=fract(vec3(p.xyx)*.1031);h+=dot(h,h.yzx+33.33);return fract((h.x+h.y)*h.z);}
        // Value and analytical derivatives share the same four lattice samples.
        vec3 noiseGradient(vec2 p){
          vec2 cell=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
          float a=hash21(cell),b=hash21(cell+vec2(1.,0.)),c=hash21(cell+vec2(0.,1.)),d=hash21(cell+1.);
          return vec3(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),du*vec2(mix(b-a,d-c,u.y),mix(c-a,d-b,u.x)));
        }
        vec2 waterGradient(vec2 p,float distance,float fill){
          vec3 phase=vec3(${phaseVector}),s=sin(phase),c=cos(phase);
          float swell=dot(vec3(${waveCoefficients(0)}),s);
          vec2 slope=vec2(dot(vec3(${waveCoefficients(1)}),c),dot(vec3(${waveCoefficients(2)}),c));
          float t=clamp(distance/uFillDistance,0.,1.),fillDerivative=6.*t*(1.-t)/uFillDistance;
          vec2 frontGradient=vec2(-2.*uArcDepth*(p.x-uCenterX)/(uHalfWidth*uHalfWidth),1.);
          return frontGradient*fillDerivative*(uLevel+1.+uRipple*swell)+fill*uRipple*slope;
        }
        void main(){
          #include <logdepthbuf_fragment>
          float distance=floodDistance(vWorld.xz);if(distance<=0.)discard;
          float fill=floodFill(vWorld.xz);
          vec2 p=vWorld.xz;
          vec2 slope=waterGradient(p,distance,fill);
          // Irregular patches advect north in world metres, never in mesh UV rows.
          mat2 rotation=mat2(.8,.6,-.6,.8);
          vec2 drift=vec2(uTime*.045,uTime*.55);
          vec3 broad=noiseGradient(rotation*(p*.012+drift*.27));
          vec2 flow=rotation*(p*vec2(.035,.053)+drift)+vec2(broad.x,-broad.x)*1.7;
          vec3 churn=noiseGradient(flow);
          float footprint=max(length(dFdx(flow)),length(dFdy(flow)));
          float detailFade=1.-smoothstep(.4,1.6,footprint);
          vec2 detailSlope=churn.yz*.045*detailFade;
          float flecks=churn.x;
          #if WATER_DETAIL > 0
            vec3 small=noiseGradient(rotation*flow*3.1+vec2(2.7,-uTime*.19));
            float smallFade=1.-smoothstep(.3,1.1,footprint*3.1);
            detailSlope+=small.yz*.026*smallFade;
            flecks=mix(flecks,small.x,.40*smallFade);
          #endif
          #if WATER_DETAIL > 1
            vec3 micro=noiseGradient(flow*7.3+vec2(-uTime*.21,4.3));
            float microFade=1.-smoothstep(.25,.9,footprint*7.3);
            detailSlope+=micro.yz*.012*microFade;
            flecks=mix(flecks,micro.x,.16*microFade);
          #endif
          slope+=vec2(.8*detailSlope.x+.6*detailSlope.y,-.6*detailSlope.x+.8*detailSlope.y)*uRipple*fill;
          vec3 normal=normalize(vec3(-slope.x,1.,-slope.y));
          if(!gl_FrontFacing)normal=-normal;
          vec3 eye=normalize(cameraPosition-vWorld);
          float facing=clamp(dot(eye,normal),0.,1.);
          float fresnel=.02+.98*pow(1.-facing,5.);
          // Approximate optical thickness from inundation, without a scene-depth pass.
          float thickness=max(.15,(uLevel+1.)*fill)/max(.28,facing);
          vec3 transmission=exp(-vec3(.26,.115,.075)*thickness);
          vec3 waterColor=vec3(.16,.23,.20)*transmission+vec3(.021,.103,.125)*(1.-transmission);
          vec3 reflected=reflect(-eye,normal);
          vec3 sky=mix(uHazeColor*.94,vec3(.19,.32,.43),pow(clamp(reflected.y,0.,1.),.65));
          vec3 color=mix(waterColor,sky,fresnel*(gl_FrontFacing?.86:.28));
          vec3 sun=normalize(vec3(650.,520.,420.));
          float shine=pow(max(0.,dot(normal,normalize(sun+eye))),96.);
          color+=vec3(1.,.89,.70)*shine*.32*detailFade;
          // Broken front patches decay into sparse, stretched eddies behind the bore.
          float head=(1.-smoothstep(75.,420.,distance))*smoothstep(0.,32.,distance);
          float wake=exp(-max(0.,distance-220.)/1500.);
          float broken=smoothstep(.48,.76,churn.x*.64+broad.x*.36);
          float lace=1.-smoothstep(.025,.14,abs(churn.x-.56));
          float foam=head*broken*.90+wake*lace*smoothstep(.48,.72,broad.x)*.34;
          foam*=mix(.65,1.14,flecks)*smoothstep(0.,.12,fill);
          foam=clamp(foam,0.,.91);
          vec3 foamColor=mix(vec3(.43,.55,.55),vec3(.87,.91,.86),.45+flecks*.45);
          color=mix(color,foamColor,foam*(gl_FrontFacing?1.:.45));
          float alpha=mix(gl_FrontFacing?.79:.48,gl_FrontFacing?.95:.76,fill*.75+foam*.25)*smoothstep(0.,.07,fill);
          float haze=uHazeMode<.5?0.:uHazeMode>1.5?1.-exp(-uHazeDensity*uHazeDensity*vViewDepth*vViewDepth):smoothstep(uHazeNear,uHazeFar,vViewDepth);
          color=mix(color,uHazeColor,clamp(haze,0.,1.));
          gl_FragColor=vec4(color,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    mesh=new THREE.Mesh(geometry,material);mesh.name='campus-advancing-floodwater';mesh.frustumCulled=true;mesh.renderOrder=8;group.add(mesh);
    // Use the scene's live fog range (including overview changes) while preserving
    // the independent water shader and its existing no-automatic-fog contract.
    mesh.onBeforeRender=(_renderer,scene)=>{
      const fog=scene.fog;uniforms.uHazeMode.value=fog?(fog.isFogExp2?2:1):0;
      if(!fog)return;
      uniforms.uHazeColor.value.copy(fog.color);
      if(fog.isFogExp2)uniforms.uHazeDensity.value=fog.density;
      else{uniforms.uHazeNear.value=fog.near;uniforms.uHazeFar.value=fog.far;}
    };
  }
  return {
    group,
    setPerformanceBudget(next){
      if(disposed)return false;const selected=WATER_QUALITY[campusEffectBudget(next).quality];
      if(selected===budget)return false;budget=selected;if(!geometry)return true;
      const old=geometry;geometry=surfaceGeometry();mesh.geometry=geometry;old.dispose();
      material.defines.WATER_DETAIL=budget.detail;material.needsUpdate=true;return true;
    },
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
