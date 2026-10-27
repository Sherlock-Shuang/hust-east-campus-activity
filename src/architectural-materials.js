/** Locally generated surface detail; these are not copied photo textures.
 * Tile dimensions/colour variation are appearance estimates. */
export function createArchitecturalMaterials(THREE,{squareTiles=false,weathering=.035}={}) {
  let seed=91023;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  const size=256,data=new Uint8Array(size*size*4),bump=new Uint8Array(size*size*4),roughness=new Uint8Array(size*size*4);
  const tileShade=Array.from({length:squareTiles?16:32},()=>random()*3);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const k=(y*size+x)*4,rowHeight=squareTiles?64:32,px=x%64,py=y%rowHeight;
    const joint=px<1||py<1,bevel=px===1||py===1,grain=(random()-.5)*2;
    const tile=tileShade[Math.floor(y/rowHeight)*4+Math.floor(x/64)];
    // Narrow grout and restrained vertical rain traces give the pale tiled
    // facades scale without turning each wall into a high-contrast checkerboard.
    const weather=Math.sin(x*.11)*Math.sin(y*.025)*.6;
    const streak=Math.max(0,Math.sin(x*.71)+Math.cos(x*.183)-1.05)*weathering*75*(.55+.45*Math.cos(y/size*Math.PI*2));
    const value=Math.max(0,Math.min(255,(joint?216:bevel?242:247)+grain+weather-streak-tile));
    data[k]=data[k+1]=data[k+2]=value;data[k+3]=255;
    bump[k]=bump[k+1]=bump[k+2]=joint?110:bevel?155:174+grain;bump[k+3]=255;
    roughness[k]=roughness[k+1]=roughness[k+2]=joint?255:237+tile;roughness[k+3]=255;
  }
  function tex(bytes){const t=new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.anisotropy=8;t.needsUpdate=true;t.repeat.set(squareTiles?5/6:1.25,squareTiles?5/6:1.25);return t;}
  const tiled=tex(data);tiled.colorSpace=THREE.SRGBColorSpace;const relief=tex(bump),finish=tex(roughness);
  const cache=new Map();
  function wall(color){if(!cache.has(color)){const m=new THREE.MeshStandardMaterial({color,map:tiled,bumpMap:relief,roughnessMap:finish,bumpScale:.0018,roughness:.87,side:THREE.DoubleSide,shadowSide:THREE.FrontSide});m.userData={materialBasis:'photo-informed pale ceramic cladding; joints, weathering and tile dimensions estimated',tileWidthMetres:squareTiles?.3:.2,tileHeightMetres:squareTiles?.3:.1};cache.set(color,m);}return cache.get(color);}
  return {wall,dispose(){cache.forEach(m=>m.dispose());tiled.dispose();relief.dispose();finish.dispose();}};
}

/** Extrusion UVs put wall metres on x/y and roof metres on x/z. */
export function applyBuildingUV(geometry){
  const p=geometry.attributes.position,n=geometry.attributes.normal,uv=[];
  for(let i=0;i<p.count;i++){
    if(Math.abs(n.getZ(i))>.8)uv.push(p.getX(i),p.getY(i));
    else uv.push(Math.abs(n.getX(i))>.7?p.getY(i):p.getX(i),p.getZ(i));
  }geometry.setAttribute('uv',new p.constructor(new Float32Array(uv),2));return geometry;
}
