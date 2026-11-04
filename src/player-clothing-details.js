import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Small authored details for the local walking character only. Shared commuter
// geometry/materials remain untouched; every added shape follows an existing
// torso or shoe matrix and is batched by anchor/material.
export function createPlayerClothingDetails(THREE,{palette,ownGeometry,ownMaterial,ownTexture}){
  const size=64,pixels=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const weave=(x%4<2?1:-1)*(y%4<2?1:-1),grain=((x*37+y*71+x*y*13)%17)/16-.5;
    const value=Math.round(128+weave*9+grain*7),i=(y*size+x)*4;pixels.set([value,value,value,255],i);
  }
  const weave=ownTexture(new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat));
  weave.name='player-fabric-weave';weave.needsUpdate=true;weave.wrapS=weave.wrapT=THREE.RepeatWrapping;weave.minFilter=THREE.LinearMipmapLinearFilter;weave.magFilter=THREE.LinearFilter;weave.generateMipmaps=true;
  weave.repeat.set(12,16);
  const materials={};
  for(const [name,roughness,bumpScale] of [['coat',.89,.0011],['pants',.94,.0007],['bag',.82,.0009]]){
    const material=ownMaterial(palette[name].clone());material.name=`player-walking-${name}-fabric`;material.roughness=roughness;material.bumpMap=weave;material.bumpScale=bumpScale;materials[name]=material;
  }
  const trim=ownMaterial(new THREE.MeshStandardMaterial({name:'player-jacket-seams',color:'#264d4c',roughness:.93}));
  const hardware=ownMaterial(new THREE.MeshStandardMaterial({name:'player-small-hardware',color:'#8d9d97',roughness:.45,metalness:.55}));
  const stitching=ownMaterial(new THREE.MeshStandardMaterial({name:'player-bag-stitching',color:'#99714d',roughness:.96}));
  const laces=ownMaterial(new THREE.MeshStandardMaterial({name:'player-shoe-laces',color:'#c4c9bd',roughness:.97}));
  const buckets=new Map();
  function add(anchor,material,geometry){const key=`${anchor}/${material.name}`;if(!buckets.has(key))buckets.set(key,{anchor,material,list:[]});const g=geometry.index?geometry.toNonIndexed():geometry;if(g!==geometry)geometry.dispose();buckets.get(key).list.push(g);}
  function line(anchor,material,points,radius=.002,project){
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
    const path=project?new THREE.Curve():curve;
    if(project)path.getPoint=(t,target=new THREE.Vector3())=>{const p=curve.getPoint(t);return target.fromArray(project(p.x,p.y));};
    add(anchor,material,new THREE.TubeGeometry(path,Math.max(3,points.length*(project?4:3)),radius,5,false));
  }
  function box(anchor,material,size,position){const g=new THREE.BoxGeometry(...size);g.translate(...position);add(anchor,material,g);}
  // Follow the actual faceted loft, not the largest ellipse thickness. A seam
  // placed at that maximum would visibly float in front of a backpack's sides.
  function surface(sections,sides,x,y,back=false){
    let hi=sections.findIndex(p=>p[0]>=y);if(hi<0)hi=sections.length-1;else if(hi<1)hi=1;
    const a=sections[hi-1],b=sections[hi],t=Math.max(0,Math.min(1,(y-a[0])/(b[0]-a[0]))),rx=a[1]+(b[1]-a[1])*t,rz=a[2]+(b[2]-a[2])*t,cz=a[3]+(b[3]-a[3])*t;
    let z=back?-Infinity:Infinity;
    for(let i=0;i<sides;i++){
      const q=i/sides*Math.PI*2,r=(i+1)/sides*Math.PI*2,x0=rx*Math.cos(q),x1=rx*Math.cos(r);
      if(x<Math.min(x0,x1)-1e-8||x>Math.max(x0,x1)+1e-8||Math.abs(x1-x0)<1e-9)continue;
      const f=(x-x0)/(x1-x0),value=cz+rz*(Math.sin(q)+(Math.sin(r)-Math.sin(q))*f);z=back?Math.max(z,value):Math.min(z,value);
    }
    return[x,y,z+(back?.001:-.001)];
  }
  const jacket=[[.875,.141,.10,.20],[.94,.148,.108,.175],[1.08,.158,.12,.133],[1.23,.177,.125,.09],[1.30,.186,.113,.072],[1.345,.158,.087,.062],[1.368,.104,.063,.058],[1.385,.058,.052,.052]];
  const bag=[[.98,.105,.05,.30],[1.04,.143,.067,.30],[1.24,.134,.063,.265],[1.30,.09,.04,.24]];
  const jacketPoint=(x,y)=>surface(jacket,14,x,y),bagPoint=(x,y)=>surface(bag,12,x,y,true);
  const zipper=[.94,1.08,1.23,1.30,1.345].map(y=>jacketPoint(0,y));
  line('torso',trim,zipper,.0022,jacketPoint);
  for(let i=0;i<22;i++){
    const t=i/21*(zipper.length-1),j=Math.min(zipper.length-2,Math.floor(t)),a=zipper[j],b=zipper[j+1],f=t-j;
    box('torso',hardware,[.005,.002,.0015],[0,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f-.001]);
  }
  box('torso',hardware,[.008,.019,.002],jacketPoint(.004,1.315));
  for(const side of [-1,1]){
    line('torso',trim,[[side*.058,1.365],[side*.066,1.337],[side*.025,1.315]].map(([x,y])=>jacketPoint(x,y)),.0016,jacketPoint);
    line('torso',trim,[[side*.07,.985],[side*.11,1.045],[side*.125,1.08]].map(([x,y])=>jacketPoint(x,y)),.0018,jacketPoint);
    line('torso',stitching,[[side*.105,1.045],[side*.112,1.13],[side*.105,1.24],[side*.069,1.278]].map(([x,y])=>bagPoint(x,y)),.0009,bagPoint);
  }
  line('torso',stitching,[[-.067,1.278],[0,1.292],[.067,1.278]].map(([x,y])=>bagPoint(x,y)),.0009,bagPoint);
  line('torso',stitching,[[-.065,1.113,.384],[.065,1.113,.384]],.0009);
  box('torso',hardware,[.009,.016,.002],[.060,1.107,.384]);
  for(const side of ['L','R']){
    const anchor=`ankle${side}`;
    // Shoe geometry is authored around its ankle anchor. Low-profile laces
    // and toe stitching retain the existing outsole/ground contact exactly.
    for(let i=0;i<3;i++){
      const z=-.04-i*.019,y=.0408,width=.025-i*.003;
      line(anchor,laces,[[-width,y,z],[width,y,z-.006]],.0009);
      line(anchor,laces,[[width,y,z],[-width,y,z-.006]],.0009);
    }
    line(anchor,laces,[1.2,1.35,1.5,1.65,1.8].map(t=>[Math.cos(t*Math.PI)*.047*.93,.0407,-.02+Math.sin(t*Math.PI)*.096*.93]),.00065);
  }
  const parts=[];
  for(const {anchor,material,list} of buckets.values()){
    const geometry=ownGeometry(mergeGeometries(list,false));for(const g of list)g.dispose();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=`player-detail-${anchor}-${material.name}`;mesh.matrixAutoUpdate=false;mesh.castShadow=false;mesh.receiveShadow=true;
    parts.push({anchor,mesh});
  }
  return{materials,parts};
}
