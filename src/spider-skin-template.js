// Original authored anatomy, shared by the optional worker and fallback path.
// Runtime rigs only read the cached arrays and copy their own BufferAttributes.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const templateCache=new WeakMap();
const TAU=Math.PI*2;
let precomputedGeometry=null;
export function usePrecomputedSpiderGeometry(geometry){precomputedGeometry=geometry;}

export function buildSkinTemplate(THREE){
  if(templateCache.has(THREE))return templateCache.get(THREE);
  const defs=[],fields=[],V=(x,y,z)=>new THREE.Vector3(x,y,z);
  const bone=(name,a,b)=>{defs.push({name,a:V(...a),b:V(...b)});return defs.length-1;};
  const pelvis=bone('pelvis',[0,.91,.014],[0,1.105,0]);
  const chest=bone('chest',[0,1.105,0],[0,1.445,0]);
  const neck=bone('neck',[0,1.445,0],[0,1.535,0]);
  const head=bone('head',[0,1.535,0],[0,1.752,0]);
  function ellipsoid(owner,c,r,axis=null){
    let q=new THREE.Quaternion();if(axis)q.setFromUnitVectors(V(0,1,0),axis.clone().normalize());q.invert();
    const m=new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    fields.push({owner,c,r,m});
  }
  function tapered(owner,a,b,r0,r1,bulge=.004){const av=V(...a),bv=V(...b),axis=bv.clone().sub(av),length=axis.length();axis.divideScalar(length);fields.push({owner,type:'tapered',a:av,axis,length,r0,r1,bulge});}
  function segment(owner,a,b,rx,rz,overlap=.015){const av=V(...a),bv=V(...b);ellipsoid(owner,av.clone().add(bv).multiplyScalar(.5).toArray(),[rx,av.distanceTo(bv)*.5+overlap,rz],bv.sub(av));}
  ellipsoid(pelvis,[0,.928,.023],[.167,.133,.112]);
  ellipsoid(pelvis,[0,1.065,.012],[.139,.185,.096]);
  ellipsoid(chest,[0,1.270,.007],[.193,.196,.112]);
  ellipsoid(chest,[0,1.365,.007],[.215,.092,.099]);
  // Small pectoral and scapular masses, rather than an inflated barrel torso.
  for(const side of[-1,1]){ellipsoid(chest,[side*.090,1.312,-.047],[.107,.100,.080]);ellipsoid(chest,[side*.085,1.315,.057],[.096,.112,.058]);}
  ellipsoid(neck,[0,1.465,.006],[.052,.073,.052]);
  for(const side of[-1,1])segment(chest,[side*.052,1.454,.016],[side*.184,1.389,.012],.049,.060,.025);
  ellipsoid(head,[0,1.636,.006],[.091,.116,.083]);
  ellipsoid(head,[0,1.548,-.004],[.068,.066,.065]);
  ellipsoid(head,[0,1.612,-.062],[.025,.039,.021]);
  for(const side of[-1,1]){
    const k=side<0?'L':'R',a=[side*.194,1.386,0],b=[side*.375,1.102,0],c=[side*.485,.844,-.005],h=[side*.524,.746,-.008];
    const ua=bone(`upperArm${k}`,a,b),fa=bone(`forearm${k}`,b,c),ha=bone(`hand${k}`,c,h);
    ellipsoid(ua,[side*.198,1.365,0],[.062,.065,.066]);
    tapered(ua,a,b,.053,.040,.005);
    tapered(fa,b,c,.041,.027,.008);
    ellipsoid(fa,[side*.479,.860,-.005],[.029,.038,.028]);
    const palmEnd=V(...c).lerp(V(...h),.64).toArray();segment(ha,c,palmEnd,.031,.020,.012);
    const hip=[side*.099,.925,.013],knee=[side*.108,.501,-.010],ankle=[side*.108,.090,.014],toe=[side*.108,.080,-.12];
    const th=bone(`thigh${k}`,hip,knee),sh=bone(`shin${k}`,knee,ankle),fo=bone(`foot${k}`,ankle,toe);
    tapered(th,hip,knee,.079,.051,.007);ellipsoid(th,[side*.104,.779,-.005],[.080,.170,.083]);
    ellipsoid(th,[side*.108,.506,-.013],[.052,.058,.055]);
    tapered(sh,knee,ankle,.049,.033,.007);ellipsoid(sh,[side*.108,.358,.018],[.052,.123,.058]);
    ellipsoid(sh,[side*.108,.121,.014],[.038,.066,.041]);
    ellipsoid(fo,[side*.108,.064,-.050],[.052,.064,.126]);
    ellipsoid(fo,[side*.108,.083,.027],[.045,.075,.052]);
  }
  function fieldValue(f,x,y,z){
    if(f.type==='tapered'){const x0=x-f.a.x,y0=y-f.a.y,z0=z-f.a.z,t=clamp((x0*f.axis.x+y0*f.axis.y+z0*f.axis.z)/f.length,0,1),r=f.r0+(f.r1-f.r0)*t+Math.sin(t*Math.PI)*f.bulge;return Math.hypot(x0-f.axis.x*t*f.length,y0-f.axis.y*t*f.length,z0-f.axis.z*t*f.length)-r;}
    const dx=x-f.c[0],dy=y-f.c[1],dz=z-f.c[2],m=f.m;
    const a=(m[0]*dx+m[4]*dy+m[8]*dz)/f.r[0],b=(m[1]*dx+m[5]*dy+m[9]*dz)/f.r[1],c=(m[2]*dx+m[6]*dy+m[10]*dz)/f.r[2];
    const k0=Math.sqrt(a*a+b*b+c*c),k1=Math.sqrt((a/f.r[0])**2+(b/f.r[1])**2+(c/f.r[2])**2);
    return k0<1e-8?-Math.min(...f.r):k0*(k0-1)/k1;
  }
  function distance(x,y,z){let d=2;for(const f of fields){const q=fieldValue(f,x,y,z),k=.019,h=Math.max(k-Math.abs(d-q),0)/k;d=Math.min(d,q)-h*h*k*.25;}return d;}
  if(precomputedGeometry){const result={defs,...precomputedGeometry,fieldValue,fields};templateCache.set(THREE,result);return result;}
  const step=.012,nx=111,ny=151,nz=37,origin=[-.66,-.018,-.216],stride=nx*ny,values=new Float32Array(nx*ny*nz);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)values[x+y*nx+z*stride]=distance(origin[0]+x*step,origin[1]+y*step,origin[2]+z*step);
  const positions=[],normals=[],indices=[],edgeMap=new Map(),tmpA=V(0,0,0),tmpB=V(0,0,0),tmpC=V(0,0,0);
  const gridPoint=id=>{const z=Math.floor(id/stride),r=id-z*stride,y=Math.floor(r/nx),x=r-y*nx;return[origin[0]+x*step,origin[1]+y*step,origin[2]+z*step];};
  const grad=(id)=>[(values[id+1]-values[id-1]),(values[id+nx]-values[id-nx]),(values[id+stride]-values[id-stride])];
  function crossing(a,b){
    if(a>b)[a,b]=[b,a];const key=a*values.length+b;if(edgeMap.has(key))return edgeMap.get(key);
    const t=values[a]/(values[a]-values[b]),pa=gridPoint(a),pb=gridPoint(b),ga=grad(a),gb=grad(b),index=positions.length/3;
    for(let j=0;j<3;j++){positions.push(pa[j]+(pb[j]-pa[j])*t);tmpA.setComponent(j,ga[j]+(gb[j]-ga[j])*t);}tmpA.normalize();normals.push(...tmpA.toArray());edgeMap.set(key,index);return index;
  }
  function triangle(a,b,c){
    tmpA.fromArray(positions,b*3).sub(tmpB.fromArray(positions,a*3));tmpC.fromArray(positions,c*3).sub(tmpB);tmpA.cross(tmpC);tmpB.fromArray(normals,a*3);
    if(tmpA.dot(tmpB)<0)indices.push(a,c,b);else indices.push(a,b,c);
  }
  const tets=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  for(let z=1;z<nz-2;z++)for(let y=1;y<ny-2;y++)for(let x=1;x<nx-2;x++){
    const a=x+y*nx+z*stride,cube=[a,a+1,a+1+nx,a+nx,a+stride,a+stride+1,a+stride+1+nx,a+stride+nx];
    let mask=0;for(let i=0;i<8;i++)if(values[cube[i]]<0)mask|=1<<i;if(mask===0||mask===255)continue;
    for(const t of tets){const inside=[],outside=[];for(const i of t)(values[cube[i]]<0?inside:outside).push(cube[i]);
      if(inside.length===1)triangle(...outside.map(o=>crossing(inside[0],o)));
      else if(inside.length===3)triangle(...inside.map(i=>crossing(i,outside[0])));
      else if(inside.length===2){const a0=crossing(inside[0],outside[0]),a1=crossing(inside[0],outside[1]),b0=crossing(inside[1],outside[0]),b1=crossing(inside[1],outside[1]);triangle(a0,a1,b0);triangle(a1,b1,b0);}
    }
  }
  const skinIndices=[],skinWeights=[],colors=[],suitCoords=[],owners=[],red=new THREE.Color('#b8293b'),blue=new THREE.Color('#174779'),black=new THREE.Color('#171e2c'),color=new THREE.Color();
  for(let i=0;i<positions.length;i+=3){
    const x=positions[i],y=positions[i+1],z=positions[i+2],ds=new Array(defs.length).fill(Infinity);
    for(const f of fields)ds[f.owner]=Math.min(ds[f.owner],fieldValue(f,x,y,z));
    // Restrict each influence to its local anatomy. Surface proximity alone
    // would incorrectly tie a relaxed hand to the hip when they pass nearby.
    const ranked=ds.map((d,j)=>({j,d})).sort((a,b)=>a.d-b.d),min=ranked[0].d,top=ranked.slice(0,4),weights=top.map(o=>Math.exp(-Math.max(0,o.d-min)*82)),sum=weights.reduce((a,b)=>a+b,0);
    top.forEach((o,j)=>{skinIndices.push(o.j);skinWeights.push(weights[j]/sum);});
    const owner=ranked[0].j,name=defs[owner].name;owners.push(owner);
    let redAmount=0,u=Math.atan2(x,-z)/TAU,v=y;
    if(y>1.43){redAmount=1;v=(y-1.505)*1.15;u=Math.atan2(x,-(z-.003))/TAU;}
    else if(name.startsWith('forearm')||name.startsWith('hand'))redAmount=1;
    else if(name.startsWith('upperArm'))redAmount=clamp((y-1.27)/.065,0,1);
    else if(name.startsWith('shin')||name.startsWith('foot'))redAmount=clamp((.49-y)/.075,0,1);
    else if(name==='pelvis'||name==='chest'){
      const panelWidth=y>1.21?.167:.102+(y-1.03)*.22;
      const front=Math.abs(z)>.062&&Math.abs(x)<panelWidth;
      redAmount=front?clamp((y-1.025)/.040,0,1):0;
      if(y>1.37)redAmount=1;
    }
    if(name.includes('Arm')||name.startsWith('forearm')||name.startsWith('hand')){
      const d=defs[owner],axis=d.b.clone().sub(d.a).normalize(),p=V(x,y,z).sub(d.a),t=p.dot(axis),radial=p.clone().addScaledVector(axis,-t);u=Math.atan2(radial.x,-radial.z)/TAU;v=t;
    }else if(name.startsWith('shin')||name.startsWith('foot')){u=Math.atan2(x-Math.sign(x)*.108,-z)/TAU;v=y;}
    color.copy(blue).lerp(red,redAmount);
    if(y<.018)color.lerp(black,.62);
    colors.push(color.r,color.g,color.b);suitCoords.push(u,v,redAmount);
  }
  const result={defs,positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices),skinIndices:new Uint16Array(skinIndices),skinWeights:new Float32Array(skinWeights),colors:new Float32Array(colors),suitCoords:new Float32Array(suitCoords),owners:new Uint8Array(owners),fieldValue,fields};
  templateCache.set(THREE,result);return result;
}

