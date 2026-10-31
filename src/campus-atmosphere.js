// Three display looks for exploring the same campus. This is a local visual
// preference, independent of the host's shared activity stage or pause state.
export const ATMOSPHERE_STORAGE_KEY='campus-time-of-day-v1';
export const ATMOSPHERE_PRESETS=Object.freeze({
  day:Object.freeze({key:'day',label:'林间日光',zenith:'#5689bc',middle:'#a8cadb',horizon:'#e0e8e3',ground:'#a9b7ba',cloud:'#f6f4e7',cloudShade:'#98b2bd',cloudAmount:.31,disc:'#fff7d9',discRadius:.009,halo:.14,night:0,stars:0,sun:'#fff0d4',sunIntensity:2.55,hemisphere:'#d5e8f7',hemisphereGround:'#7a8469',hemisphereIntensity:.96,exposure:1.01,environmentIntensity:.50,fog:'#c6d5d7',fogNear:430,fogFar:2900,offset:Object.freeze([650,620,420])}),
  sunset:Object.freeze({key:'sunset',label:'夕阳晚霞',zenith:'#344778',middle:'#b493b5',horizon:'#ffbd88',ground:'#b3a1a6',cloud:'#ffd0a3',cloudShade:'#8a7899',cloudAmount:.66,disc:'#fff0be',discRadius:.013,halo:.38,night:0,stars:0,sun:'#ffd096',sunIntensity:2.3,hemisphere:'#e9bed0',hemisphereGround:'#6e606d',hemisphereIntensity:.88,exposure:1.03,environmentIntensity:.29,fog:'#ccb1b3',fogNear:330,fogFar:2600,offset:Object.freeze([-820,145,260])}),
  night:Object.freeze({key:'night',label:'月下校园',zenith:'#071229',middle:'#1a3152',horizon:'#506479',ground:'#17283c',cloud:'#627587',cloudShade:'#172841',cloudAmount:.19,disc:'#dbe6eb',discRadius:.0068,halo:.06,night:1,stars:.53,sun:'#bdcedf',sunIntensity:.63,hemisphere:'#93aeca',hemisphereGround:'#394a62',hemisphereIntensity:.52,exposure:.96,environmentIntensity:.13,fog:'#253d55',fogNear:260,fogFar:2250,offset:Object.freeze([420,610,-480])}),
});
const hasMode=mode=>Object.hasOwn(ATMOSPHERE_PRESETS,mode);
function defaultStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function readAtmospherePreference(storage=defaultStorage()){
  try{const value=storage?.getItem(ATMOSPHERE_STORAGE_KEY);return hasMode(value)?value:'day';}catch{return'day';}
}
const vertexShader=`
varying vec3 vDirection;
void main(){
 vDirection=position;
 vec4 clip=projectionMatrix*modelViewMatrix*vec4(position,1.0);
 gl_Position=clip.xyww;
}`;
const fragmentShader=`
uniform vec3 uZenith,uMiddle,uHorizon,uGround,uCloud,uCloudShade,uDisc,uDirection;
uniform float uCloudAmount,uDiscRadius,uHalo,uNight,uStars;
varying vec3 vDirection;
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1)),f.x),f.y);}
float cloudNoise(vec2 p){return noise21(p)*.58+noise21(p*2.13+vec2(5.4,1.3))*.28+noise21(p*4.27+vec2(1.5,8.3))*.14;}
void main(){
 vec3 d=normalize(vDirection);float elevation=max(0.0,d.y);
 // Horizon afterglow remains visible even when looking away from the sun.
 vec3 color=mix(uHorizon,uMiddle,smoothstep(0.0,.27,elevation));
 color=mix(color,uZenith,pow(smoothstep(.17,1.0,elevation),.65));
 color=mix(color,uGround,1.0-smoothstep(-.20,0.0,d.y));
 float angle=acos(clamp(dot(d,uDirection),-1.0,1.0));
 float glow=exp(-angle*angle/(.05+uHalo*.22))*uHalo;
 color=mix(color,uDisc,glow);
 // Static, seamless direction-space clouds. No texture fetches, no full-screen
 // postprocessing, and no time animation that would keep an idle view drawing.
 vec2 p=vec2(d.x*4.0+d.z*2.7,d.y*15.0+d.z*.8);
 float density=cloudNoise(p),wisps=noise21(p*vec2(2.0,.57)+vec2(6.0,2.0));
 float cloud=smoothstep(.48,.79,density*.80+wisps*.20)*uCloudAmount;
 cloud*=smoothstep(.025,.13,d.y)*(1.0-smoothstep(.72,.94,d.y));
 vec3 cloudColor=mix(uCloudShade,uCloud,smoothstep(.47,.77,density));
 color=mix(color,cloudColor,cloud);
 float disc=1.0-smoothstep(uDiscRadius*.88,uDiscRadius*1.12,angle);
 // A quiet, cratered moon; star cells use a sparse deterministic hash.
 if(uNight>.5){
  float craters=noise21(d.xz*330.0+vec2(3.7,9.0))*.16;
  color=mix(color,uDisc*(1.0-craters),disc);
  vec2 stars=vec2(atan(d.z,d.x),asin(clamp(d.y,-1.0,1.0)))*vec2(78.0,92.0);
  vec2 cell=floor(stars),f=fract(stars)-.5;
  float selected=step(.986,hash21(cell)),radius=.035+.042*hash21(cell+vec2(4,8));
  float star=(1.0-smoothstep(radius,radius+.05,length(f)))*selected;
  color+=vec3(.77,.84,1.0)*star*uStars*smoothstep(.08,.42,d.y)*(1.0-cloud);
 }else{color=mix(color,uDisc,disc*(1.0-cloud*.45));}
 gl_FragColor=vec4(color,1.0);
 #include <colorspace_fragment>
}`;

/** Owns one background mesh and its material. The existing PMREM, hemisphere,
 * directional light and shadow map are borrowed, never cloned or regenerated. */
export function createCampusAtmosphere({THREE,scene,renderer,hemisphere,sun,sunOffset,daylight,storage=defaultStorage(),onChange=()=>{},invalidate=()=>{}}={}){
  if(!THREE||!scene||!renderer||!hemisphere||!sun||!sunOffset)throw new TypeError('Campus atmosphere needs the existing scene and lighting.');
  const original={background:scene.background,exposure:renderer.toneMappingExposure,environmentIntensity:scene.environmentIntensity,sunColor:sun.color.clone(),sunIntensity:sun.intensity,sunPosition:sun.position.clone(),offset:sunOffset.clone(),hemiColor:hemisphere.color.clone(),hemiGround:hemisphere.groundColor.clone(),hemiIntensity:hemisphere.intensity,fog:scene.fog,fogColor:scene.fog?.color?.clone(),fogNear:scene.fog?.near,fogFar:scene.fog?.far};
  const uniforms={};for(const key of ['Zenith','Middle','Horizon','Ground','Cloud','CloudShade','Disc'])uniforms['u'+key]={value:new THREE.Color()};
  uniforms.uDirection={value:new THREE.Vector3()};for(const key of ['CloudAmount','DiscRadius','Halo','Night','Stars'])uniforms['u'+key]={value:0};
  const geometry=new THREE.SphereGeometry(5000,32,16),material=new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,toneMapped:false});
  const sky=new THREE.Mesh(geometry,material);sky.name='campus-time-sky';sky.frustumCulled=false;sky.renderOrder=-1000;sky.userData={component:'campus-atmosphere',excludeFromCampusExport:true,drawCalls:1,extraLights:0};scene.add(sky);scene.background=null;
  const listeners=new Set();let mode=readAtmospherePreference(storage),disposed=false,lastFog=null;
  function apply(){
    const p=ATMOSPHERE_PRESETS[mode];
    for(const key of ['Zenith','Middle','Horizon','Ground','Cloud','CloudShade','Disc'])uniforms['u'+key].value.set(p[key[0].toLowerCase()+key.slice(1)]);
    for(const key of ['CloudAmount','DiscRadius','Halo','Night','Stars'])uniforms['u'+key].value=p[key[0].toLowerCase()+key.slice(1)];
    sunOffset.fromArray(p.offset);sun.position.copy(sun.target.position).add(sunOffset);uniforms.uDirection.value.copy(sunOffset).normalize();
    sun.color.set(p.sun);sun.intensity=p.sunIntensity;hemisphere.color.set(p.hemisphere);hemisphere.groundColor.set(p.hemisphereGround);hemisphere.intensity=p.hemisphereIntensity;
    renderer.toneMappingExposure=p.exposure;scene.environmentIntensity=p.environmentIntensity;
    // WEBGL context recovery continues to own daylight.environment. Never
    // overwrite it here with an old render target saved before recovery.
    if(renderer.shadowMap)renderer.shadowMap.needsUpdate=true;
    lastFog=null;update();
  }
  function update(camera,{overviewLift=Math.max(0,(camera?.position?.y??0)-120)}={}){
    if(disposed)return false;
    if(camera?.position)sky.position.copy(camera.position);
    const immersion=scene.fog?.name==='campus-tsunami-immersion';sky.visible=!immersion;
    if(immersion){lastFog=null;return false;}
    const p=ATMOSPHERE_PRESETS[mode],fog=scene.fog;
    if(fog?.isFog){if(lastFog!==fog){fog.color.set(p.fog);lastFog=fog;}fog.near=p.fogNear+overviewLift*.9;fog.far=p.fogFar+overviewLift*1.3;}
    return false;
  }
  function setMode(next,{persist=true}={}){
    if(disposed||!hasMode(next)||next===mode)return false;
    mode=next;apply();if(persist)try{storage?.setItem(ATMOSPHERE_STORAGE_KEY,mode);}catch{}
    onChange(mode,ATMOSPHERE_PRESETS[mode]);for(const listener of listeners)listener(mode);invalidate();return true;
  }
  apply();
  return{sky,setMode,update,get mode(){return mode;},get preset(){return ATMOSPHERE_PRESETS[mode];},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    getDiagnostics(){return{mode,drawCalls:1,triangles:geometry.index.count/3,extraLights:0,disposed};},
    dispose(){if(disposed)return;disposed=true;listeners.clear();sky.removeFromParent();geometry.dispose();material.dispose();scene.background=original.background;renderer.toneMappingExposure=original.exposure;scene.environmentIntensity=original.environmentIntensity;sunOffset.copy(original.offset);sun.position.copy(original.sunPosition);sun.color.copy(original.sunColor);sun.intensity=original.sunIntensity;hemisphere.color.copy(original.hemiColor);hemisphere.groundColor.copy(original.hemiGround);hemisphere.intensity=original.hemiIntensity;if(original.fog?.isFog){original.fog.color.copy(original.fogColor);original.fog.near=original.fogNear;original.fog.far=original.fogFar;}}
  };
}

/** Compact local preference beside the quality control; it never joins or
 * changes an activity stage. Keyboard/pointer events stay out of game controls. */
export function mountAtmosphereUI({document,host,atmosphere,onChange=()=>{}}={}){
  host??=document?.getElementById('player-hud');
  if(!document||!host||!atmosphere)return{update(){},dispose(){}};
  const label=document.createElement('label');label.className='campus-atmosphere-choice';
  const select=document.createElement('select');select.id='campus-time-of-day';select.setAttribute('aria-label','校园光照时段');
  for(const [value,p]of Object.entries(ATMOSPHERE_PRESETS)){const option=document.createElement('option');option.value=value;option.textContent=p.label;select.append(option);}
  label.append(select);host.append(label);select.value=atmosphere.mode;
  const update=()=>{select.value=atmosphere.mode;select.title='只改变你看到的光照，不影响活动阶段';};
  const change=()=>{atmosphere.setMode(select.value);update();select.blur();onChange(atmosphere.mode);};
  const stop=event=>event.stopPropagation();select.addEventListener('change',change);for(const name of ['keydown','keyup','pointerdown','pointerup','wheel'])select.addEventListener(name,stop);
  const unsubscribe=atmosphere.subscribe?.(update);update();
  return{select,update,dispose(){unsubscribe?.();select.removeEventListener('change',change);for(const name of ['keydown','keyup','pointerdown','pointerup','wheel'])select.removeEventListener(name,stop);label.remove();}};
}
