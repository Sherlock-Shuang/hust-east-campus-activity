/** Opaque architectural glazing: existing environment reflections plus a quiet
 * recessed interior cue. No screen-space pass, transmission target or texture
 * allocation. Source openings and the real transparent entry doors stay intact. */
export function createCampusGlazing(THREE,{color='#7b9295',roughness=.16,interiorStrength=.32,envMapIntensity=1.25,side=THREE.DoubleSide}={}){
  const material=new THREE.MeshPhysicalMaterial({color,roughness,metalness:0,ior:1.52,clearcoat:.65,clearcoatRoughness:.12,envMapIntensity,side});
  material.name='校园玻璃 · 环境反射与内层纵深';
  material.userData={architecturalGlazing:true,opaqueReflection:true,interiorStrength,extraRenderTargets:0};
  material.onBeforeCompile=shader=>{
    shader.uniforms.campusInteriorStrength={value:interiorStrength};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
varying vec2 vCampusPaneUv;
varying vec3 vCampusPaneEye;
varying vec2 vCampusPaneIdentity;
`).replace('#include <begin_vertex>',`#include <begin_vertex>
vCampusPaneUv=uv;
mat4 campusPaneTransform=modelViewMatrix;
vCampusPaneIdentity=vec2(0.0);
#ifdef USE_INSTANCING
 campusPaneTransform=modelViewMatrix*instanceMatrix;
 vCampusPaneIdentity=vec2(fract(sin(dot(instanceMatrix[3].xyz,vec3(12.9898,39.3468,78.233)))*43758.5453),1.0);
#endif
vec3 campusView=normalize(-(campusPaneTransform*vec4(position,1.0)).xyz);
vCampusPaneEye=vec3(dot(campusView,normalize(campusPaneTransform[0].xyz)),dot(campusView,normalize(campusPaneTransform[1].xyz)),dot(campusView,normalize(campusPaneTransform[2].xyz)));
`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
uniform float campusInteriorStrength;
varying vec2 vCampusPaneUv;
varying vec3 vCampusPaneEye;
varying vec2 vCampusPaneIdentity;
`).replace('#include <color_fragment>',`#include <color_fragment>
// A small view-dependent offset separates the room/curtain cue from the
// reflecting outer pane. Broad, non-instanced glazing remains uninterrupted.
vec2 campusRoomUv=clamp(vCampusPaneUv+vCampusPaneEye.xy/max(abs(vCampusPaneEye.z),.35)*.055,0.0,1.0);
float campusEdge=min(min(campusRoomUv.x,1.0-campusRoomUv.x),min(campusRoomUv.y,1.0-campusRoomUv.y));
float campusReveal=smoothstep(.015,.10,campusEdge);
float campusRoom=mix(.56,.94,smoothstep(.0,.72,campusRoomUv.y))*mix(.76,1.0,campusReveal);
float campusBlindHeight=.18+vCampusPaneIdentity.x*.44;
float campusBlind=step(.66,vCampusPaneIdentity.x)*smoothstep(campusBlindHeight-.018,campusBlindHeight+.018,campusRoomUv.y);
float campusPleat=.94+.06*cos(campusRoomUv.x*62.83185);
campusRoom=mix(campusRoom,campusPleat,campusBlind*.60);
diffuseColor.rgb*=mix(1.0,campusRoom,campusInteriorStrength*vCampusPaneIdentity.y);
`);
  };
  material.customProgramCacheKey=()=>`campus-glazing-v1/${interiorStrength}`;
  return material;
}
