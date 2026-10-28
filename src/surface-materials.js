/** Original procedural surface textures, drawn at metre scale; no remote photo pixels.
 * Photo references guide material families only. Wear/aggregate/paver dimensions are estimates.
 */
export function applyWorldUV(geometry, scale = 1, plane = 'xz') {
  const p = geometry.getAttribute('position'), uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * scale; uv[i * 2 + 1] = (plane === 'xy' ? p.getY(i) : p.getZ(i)) * scale; }
  geometry.setAttribute('uv', new p.constructor(uv, 2));
  return geometry;
}
const fract = x => x - Math.floor(x);
const hash = (x, y, s=0) => fract(Math.sin(x*127.1+y*311.7+s*74.7)*43758.5453123);
function noise(x,y,period=16) {
  const ix=Math.floor(x),iy=Math.floor(y),fx=fract(x),fy=fract(y),u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  const h=(a,b)=>hash((a%period+period)%period,(b%period+period)%period);
  return (h(ix,iy)*(1-u)+h(ix+1,iy)*u)*(1-v)+(h(ix,iy+1)*(1-u)+h(ix+1,iy+1)*u)*v;
}
const clamp = x => Math.max(0,Math.min(255,Math.round(x)));
/** Resolve nearly coplanar road layers under both ordinary and shader-written
 * logarithmic depth. Keep actual geometry and normal depth occlusion intact. */
export function applySurfaceDepthBias(material,steps) {
  const bias=(steps/2**24).toFixed(24);
  material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=-1;
  material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <logdepthbuf_fragment>',`#include <logdepthbuf_fragment>
      #if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
        gl_FragDepth = max(0.0, gl_FragDepth - ${bias});
      #endif`);
  };
  material.customProgramCacheKey=()=>`road-surface-depth-v1-${steps}`;
  return material;
}

export function createSurfaceMaterials(THREE) {
  const textures=[],materials=[],size=256;
  function texture(data,metres,color=false){
    const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/metres,1/metres);
    t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=8;
    if(color)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;textures.push(t);return t;
  }
  function surface(name,metres,sample,{roughness=.94,bump=.035,metalness=0,roughnessVariation=.025,...rest}={}){
    const color=new Uint8Array(size*size*4),height=new Uint8Array(size*size*4),finish=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const p=(y*size+x)*4, [r,g,b,h]=sample(x/size,y/size,x,y);
      color.set([clamp(r),clamp(g),clamp(b),255],p);height.set([clamp(h),clamp(h),clamp(h),255],p);
      const matte=clamp(255*(1-roughnessVariation+roughnessVariation*hash(x,y,19)));
      finish.set([matte,matte,matte,255],p);
    }
    const m=new THREE.MeshStandardMaterial({name,color:'#ffffff',map:texture(color,metres,true),bumpMap:texture(height,metres),roughnessMap:texture(finish,metres),bumpScale:bump,roughness,metalness,...rest});
    m.userData={materialBasis:'procedural, photo-informed; dimensions and weathering estimated',textureTileMetres:metres};materials.push(m);return m;
  }
  const asphalt=surface('细骨料沥青 · 估计纹理',1.6,(u,v,x,y)=>{
    const grain=hash(x,y,1),cloud=noise(u*4,v*4,4),aggregate=grain>.96?4:grain<.07?-4:0;
    const n=(grain-.5)*7+(cloud-.5)*3+aggregate;
    return [104+n,105+n,103+n,124+(grain-.5)*36];
  },{bump:.007,roughness:.91});
  const paving=surface('灰色错缝铺装 · 估计砖尺度',1.6,(u,v,x,y)=>{
    const row=Math.floor(v*8),col=Math.floor(u*4+(row%2)*.5),fx=fract(u*4+(row%2)*.5),fy=fract(v*8);
    const edge=Math.min(fx/4,(1-fx)/4,fy/8,(1-fy)/8),seam=edge<.0026;
    const grain=(hash(x,y)-.5)*6,tile=(hash(col,row,4)-.5)*12,stain=(noise(u*4,v*4,4)-.5)*3;
    const n=seam?112+grain:157+tile+grain+stain;
    return[n+3,n+2,n,seam?110:158+grain];
  },{bump:.012,roughness:.88});
  // The supplied lake-curve frames show small rectangular pavers across the
  // carriageway. A periodic herringbone bond avoids replacing it with asphalt.
  const roadPavers=surface('东九湖边灰棕块砖车行面 · 砖尺度估计',3.2,(u,v,x,y)=>{
    const px=(u+v)*16,py=(v-u)*16,ix=Math.floor(px),iy=Math.floor(py);
    const phase=((ix-iy)%4+4)%4,horizontal=phase<2;
    const bx=ix-(phase===1?1:0),by=iy-(phase===2?1:0);
    const fx=px-bx,fy=py-by;
    const edge=horizontal?Math.min(fx,2-fx,fy,1-fy):Math.min(fx,1-fx,fy,2-fy);
    const grain=(hash(x,y,9)-.5)*6,brick=(hash((bx%32+32)%32,(by%32+32)%32,7)-.5)*13;
    const seam=edge<.024,n=seam?93+grain:131+brick+grain;
    return[n+3,n,n-3,seam?100:155+grain];
  },{bump:.012,roughness:.9});
  roadPavers.userData.photoEvidence='用户实景：截屏2026-10-06 20.20.36.png、20.21.05.png；拍摄日期未知';
  const concrete=surface('混凝土与石质路缘',2,(u,v,x,y)=>{const n=(hash(x,y)-.5)*7+(noise(u*8,v*8,8)-.5)*6;return[177+n,175+n,168+n,140+n];},{bump:.006,roughness:.9});
  const grass=surface('草地与细碎落叶',6,(u,v,x,y)=>{
    // Fine blade contrast, with very weak broad variation. Large bump/noise
    // patches made a trimmed lawn read like corrugated terrain from eye level.
    const blade=(hash(x,y)-.5)*13,n=(noise(u*16,v*16,16)-.5)*7+(noise(u*2,v*2,2)-.5)*4+blade,leaf=hash(x,y,5)>.997?11:0;
    return[100+n+leaf,122+n,69+n-leaf*.3,128+blade];
  },{bump:.005,roughness:.98,roughnessVariation:.01});
  const ground=surface('校园地面底色',10,(u,v,x,y)=>{const n=(noise(u*8,v*8,8)-.5)*3+(hash(x,y)-.5)*6;return[155+n,156+n,139+n,128+n];},{bump:.004});
  const bark=surface('树皮纵向裂纹',1,(u,v,x,y)=>{
    const ridge=noise(u*32,v*8,32),crack=ridge<.34?-26:0,n=(hash(x,y)-.5)*12+ridge*25+crack;
    return[102+n,97+n,77+n,95+ridge*85];
  },{bump:.08});
  const paint=surface('磨损道路标线',1,(u,v,x,y)=>{const n=hash(x,y),wear=n<.08?42:0;return[224-wear,224-wear,207-wear,145+n*35];},{bump:.006});
  const water=surface('校园水面细波',10,(u,v,x,y)=>{const n=noise(u*32,v*32,32);return[77+n*9,111+n*8,110+n*9,128+Math.sin(u*125.66+Math.sin(v*25.13))*14+n*20];},{bump:.09,roughness:.29,metalness:.12});
  return {asphalt,paving,roadPavers,concrete,grass,ground,bark,paint,water,dispose(){textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());}};
}

/** A soft daylight environment for glass and shaded facades; no baked shadows. */
export function createMorningEnvironment(THREE,renderer) {
  const width=512,height=256,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const v=y/(height-1),elevation=Math.sin((v-.5)*Math.PI),u=x/width;
    const cloud=noise(u*16,v*8,16)*.7+noise(u*32,v*16,32)*.3;
    const c=Math.max(0,(cloud-.47)*1.5)*Math.max(0,elevation),t=Math.pow(Math.max(0,elevation),.45);
    let rgb=elevation>=0?[208-92*t,219-66*t,220-36*t]:[112,118,99];
    rgb=rgb.map(n=>n+(246-n)*c);
    const p=(y*width+x)*4;data.set([...rgb.map(clamp),255],p);
  }
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);texture.mapping=THREE.EquirectangularReflectionMapping;texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearFilter;texture.needsUpdate=true;
  const generator=new THREE.PMREMGenerator(renderer),target=generator.fromEquirectangular(texture);generator.dispose();
  return {background:texture,environment:target.texture,dispose(){target.dispose();texture.dispose();}};
}
