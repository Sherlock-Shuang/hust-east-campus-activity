// Original authored superhero: a single continuous remeshed skin, an articulated
// skeleton and painted suit details. No extracted models, textures or animation.
// Metres; local forward -Z; supporting plane y=0. World transform belongs to caller.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const num=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const templateCache=new WeakMap();
const TAU=Math.PI*2;

// Rest anatomy is sampled only at construction. Smooth unions remove the
// interior shells and the ball/cylinder seams of the former segmented model.
function buildSkinTemplate(THREE){
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

function addSuitShader(material){
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 suitCoordinates; varying vec3 vSuitCoordinates; varying vec3 vSuitRest;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvSuitCoordinates=suitCoordinates; vSuitRest=position;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vSuitCoordinates; varying vec3 vSuitRest;
      float suitSegment(vec2 p, vec2 a, vec2 b){vec2 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.,1.));}
      float spiderEmblem(vec2 p){
        float d=min(length(p/vec2(.016,.033))-1.,length((p-vec2(0.,.039))/vec2(.011,.011))-1.);
        float ink=1.-smoothstep(-.08,.08,d);
        for(int i=0;i<4;i++){
          float f=float(i);vec2 a=vec2(.010,.023-f*.015),b=vec2(.034+f*.003,.054-f*.032),c=vec2(.067-f*.003,.086-f*.056);
          vec2 q=vec2(abs(p.x),p.y);float edge=min(suitSegment(q,a,b),suitSegment(q,b,c));ink=max(ink,1.-smoothstep(.0020,.0036,edge));
        }return ink;
      }`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float u=vSuitCoordinates.x*12.;float v=vSuitCoordinates.y/.057+.12*cos(u*6.2831853);
      float du=abs(fract(u+.5)-.5),dv=abs(fract(v+.5)-.5);
      float au=max(fwidth(u),.005),av=max(fwidth(v),.005);
      float web=max(1.-smoothstep(.015-au*.55,.015+au*.55,du),1.-smoothstep(.014-av*.55,.014+av*.55,dv));
      // Fwidth fades subpixel weave and keeps black web ink stable at distance.
      float weaveScale=max(fwidth(vSuitRest.y*1000.),fwidth(vSuitRest.x*1000.));
      float weave=sin(vSuitRest.y*6000.)*sin(vSuitRest.x*6000.)*.022*(1.-smoothstep(.3,1.2,weaveScale));
      diffuseColor.rgb*=1.+weave;
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.17,web*vSuitCoordinates.z*.72);
      if(abs(vSuitRest.z)>.078&&vSuitRest.y>1.16&&vSuitRest.y<1.43&&abs(vSuitRest.x)<.082){
        float insignia=spiderEmblem(vec2(vSuitRest.x,vSuitRest.y-1.296));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.009,.013,.020),insignia);
      }`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      float textileFilter=1.-smoothstep(.25,1.0,max(fwidth(vSuitRest.x*1000.),fwidth(vSuitRest.y*1000.)));
      float textileHeight=sin(vSuitRest.x*6000.)*sin(vSuitRest.y*6000.)*.000012*textileFilter;
      vec3 clothDx=dFdx(-vViewPosition),clothDy=dFdy(-vViewPosition),clothR1=cross(clothDy,normal),clothR2=cross(normal,clothDx);
      float clothDet=dot(clothDx,clothR1);
      normal=normalize(max(abs(clothDet),1.e-9)*normal-sign(clothDet)*(dFdx(textileHeight)*clothR1+dFdy(textileHeight)*clothR2));`);
  };
  material.customProgramCacheKey=()=> 'spider-continuous-suit-v2';
}

export function createSpiderModel(THREE){
  const group=new THREE.Group();group.name='spider-player';
  const character=new THREE.Group();character.name='spider-character';group.add(character);
  const resources={geometries:new Set(),materials:new Set()};
  const ownG=g=>(resources.geometries.add(g),g),ownM=m=>(resources.materials.add(m),m);
  const material=(color,roughness=.7,metalness=.02,extra={})=>ownM(new THREE.MeshStandardMaterial({color,roughness,metalness,...extra}));
  const black=material('#171b25',.72,.02,{side:THREE.DoubleSide}),white=material('#e8eee8',.30,.05,{side:THREE.DoubleSide});
  const webMaterial=material('#e9eee7',.69,.05,{emissive:'#768179',emissiveIntensity:.12});
  const fibreMaterial=ownM(new THREE.LineBasicMaterial({color:'#d5e2db',transparent:true,opacity:.56}));
  function mesh(parent,geometry,mat,name,pos=[0,0,0],rot=[0,0,0]){const m=new THREE.Mesh(ownG(geometry),mat);m.name=name;m.position.set(...pos);m.rotation.set(...rot);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  const template=buildSkinTemplate(THREE),skinGeometry=ownG(new THREE.BufferGeometry());
  for(const [name,data,size]of[['position',template.positions,3],['normal',template.normals,3],['skinIndex',template.skinIndices,4],['skinWeight',template.skinWeights,4],['color',template.colors,3],['suitCoordinates',template.suitCoords,3]])skinGeometry.setAttribute(name,new THREE.BufferAttribute(data.slice(),size));
  skinGeometry.setIndex(new THREE.BufferAttribute(template.indices.slice(),1));
  const suit=ownM(new THREE.MeshPhysicalMaterial({color:'#ffffff',vertexColors:true,roughness:.72,metalness:0,sheen:.28,sheenRoughness:.84,sheenColor:'#66718b'}));addSuitShader(suit);
  const skin=new THREE.SkinnedMesh(skinGeometry,suit);skin.name='spider-continuous-skin';skin.castShadow=true;skin.receiveShadow=true;skin.frustumCulled=false;character.add(skin);
  const restUp=new THREE.Vector3(0,1,0),bones=[],boneByName={},dir=new THREE.Vector3(),tempQ=new THREE.Quaternion();
  const rig=new THREE.Group();rig.name='spider-anatomical-rig';character.add(rig);
  for(const def of template.defs){const b=new THREE.Bone();b.name=`spider-bone-${def.name}`;b.position.copy(def.a);b.quaternion.setFromUnitVectors(restUp,dir.copy(def.b).sub(def.a).normalize());rig.add(b);bones.push(b);boneByName[def.name]=b;}
  group.updateMatrixWorld(true);const skeleton=new THREE.Skeleton(bones);skin.bind(skeleton);
  const headBone=boneByName.head,headBase=template.defs.find(d=>d.name==='head').a;
  function faceZ(x,y){let lo=-.14,hi=.015;for(let i=0;i<20;i++){const z=(lo+hi)*.5;let d=2;for(const f of template.fields)if(f.owner===3){const q=template.fieldValue(f,x,y,z),h=Math.max(.019-Math.abs(d-q),0)/.019;d=Math.min(d,q)-h*h*.019*.25;}if(d>0)lo=z;else hi=z;}return(lo+hi)*.5;}
  function eye(side,scale,mat,name,offset){
    const control=[[.012,1.653],[.039,1.675],[.069,1.682],[.071,1.660],[.058,1.640],[.032,1.635]],cx=.041,cy=1.655;
    const curve=new THREE.CatmullRomCurve3(control.map(([x,y])=>new THREE.Vector3(side*(cx+(x-cx)*scale),cy+(y-cy)*scale,0)),true,'centripetal');
    const n=48,rings=5,positions=[],indices=[];
    for(let r=0;r<=rings;r++)for(let i=0;i<=n;i++){const t=r/rings,p=curve.getPoint(i/n),x=side*cx+(p.x-side*cx)*t,y=cy+(p.y-cy)*t;positions.push(x-headBase.x,y-headBase.y,faceZ(x,y)-offset-headBase.z);}
    for(let r=0;r<rings;r++)for(let i=0;i<n;i++){const a=r*(n+1)+i,b=a+n+1;indices.push(a,b,a+1,a+1,b,b+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return mesh(headBone,g,mat,name);
  }
  for(const side of[-1,1]){eye(side,1.12,black,`spider-eye-outline-${side}`,.0013);eye(side,1,white,`spider-white-eye-${side}`,.0026);}
  // The palm and wrist are part of the continuous skin. Slender finger
  // surfaces start inside the palm and bend continuously, with no ball joints.
  // Their small silhouette needs a finer sampling than the full-body remesh.
  const fingerMaterial=material('#b8293b',.75,0),fingerSets={},fingerAxis=new THREE.Vector3(),fingerSide=new THREE.Vector3(),fingerNormal=new THREE.Vector3();
  const fingerRings=15,fingerSides=10;
  for(const side of[-1,1]){
    const key=side<0?'L':'R',medial=-side,defs=[];
    for(let i=0;i<4;i++)defs.push({x:medial*(.022-i*.015),y:.060,z:-.001,length:[.057,.065,.061,.046][i],radius:[.008,.0085,.008,.0067][i],thumb:false,index:i});
    defs.push({x:medial*.025,y:.021,z:-.002,length:.047,radius:.010,thumb:true,index:4});
    const positions=new Float32Array(defs.length*(fingerRings+1)*(fingerSides+1)*3),normals=new Float32Array(positions.length),indices=[];
    for(let f=0;f<defs.length;f++)for(let r=0;r<fingerRings;r++)for(let j=0;j<fingerSides;j++){const a=f*(fingerRings+1)*(fingerSides+1)+r*(fingerSides+1)+j,b=a+fingerSides+1;indices.push(a,a+1,b,a+1,b+1,b);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3).setUsage(THREE.DynamicDrawUsage));geometry.setIndex(indices);
    const fingers=mesh(boneByName[`hand${key}`],geometry,fingerMaterial,`spider-articulated-fingers-${key}`);fingers.frustumCulled=false;
    fingerSets[key]={defs,positions,normals,geometry,medial,curls:[.35,.40,.44,.48,.30],spread:.1};
  }
  function updateFingers(key,casting,airborne,blend){
    const set=fingerSets[key],spread=casting?.18:airborne?.35:.06;set.spread+=(spread-set.spread)*blend;
    for(let f=0;f<set.defs.length;f++){
      const d=set.defs[f],target=casting?[.08,1.85,1.78,.10,.48][f]:airborne?[.20,.24,.28,.32,.25][f]:[.30,.40,.48,.53,.34][f];set.curls[f]+=(target-set.curls[f])*blend;
      let x=d.x,y=d.y,z=d.z;
      for(let r=0;r<=fingerRings;r++){
        const t=r/fingerRings,bend=set.curls[f]*(.12+.88*t),splay=d.thumb?set.medial*.72:(f-1.5)*set.spread*.22*set.medial;
        fingerAxis.set(splay,Math.cos(bend)*(d.thumb?.75:1),-Math.sin(bend)).normalize();
        if(r){const ds=d.length/fingerRings;x+=fingerAxis.x*ds;y+=fingerAxis.y*ds;z+=fingerAxis.z*ds;}
        fingerSide.set(1,0,0).addScaledVector(fingerAxis,-fingerAxis.x).normalize();fingerNormal.crossVectors(fingerAxis,fingerSide).normalize();
        const radius=d.radius*(1-.28*t)*Math.sqrt(Math.max(0,1-Math.max(0,(t-.84)/.16)**2));
        for(let j=0;j<=fingerSides;j++){
          const angle=j/fingerSides*TAU,cos=Math.cos(angle),sin=Math.sin(angle),nx=fingerSide.x*cos+fingerNormal.x*sin,ny=fingerSide.y*cos+fingerNormal.y*sin,nz=fingerSide.z*cos+fingerNormal.z*sin,i=(f*(fingerRings+1)*(fingerSides+1)+r*(fingerSides+1)+j)*3;
          set.positions[i]=x+nx*radius;set.positions[i+1]=y+ny*radius;set.positions[i+2]=z+nz*radius;set.normals[i]=nx;set.normals[i+1]=ny;set.normals[i+2]=nz;
        }
      }
    }
    set.geometry.attributes.position.needsUpdate=true;set.geometry.attributes.normal.needsUpdate=true;
  }
  // One dynamic tube and two fine filaments are reused throughout a swing.
  const webSegments=28,webSides=6,webPositions=new Float32Array((webSegments+1)*webSides*3),webNormals=new Float32Array(webPositions.length),webIndices=[];
  for(let i=0;i<webSegments;i++)for(let j=0;j<webSides;j++){const a=i*webSides+j,b=i*webSides+(j+1)%webSides;webIndices.push(a,b,a+webSides,b,b+webSides,a+webSides);}
  const webGeometry=ownG(new THREE.BufferGeometry());webGeometry.setAttribute('position',new THREE.BufferAttribute(webPositions,3).setUsage(THREE.DynamicDrawUsage));webGeometry.setAttribute('normal',new THREE.BufferAttribute(webNormals,3).setUsage(THREE.DynamicDrawUsage));webGeometry.setIndex(webIndices);webGeometry.boundingSphere=new THREE.Sphere();
  const webMesh=new THREE.Mesh(webGeometry,webMaterial);webMesh.name='spider-web-main';webMesh.castShadow=false;group.add(webMesh);
  const fibres=[];
  for(let i=0;i<2;i++){const g=ownG(new THREE.BufferGeometry());g.setAttribute('position',new THREE.BufferAttribute(new Float32Array((webSegments+1)*3),3).setUsage(THREE.DynamicDrawUsage));g.boundingSphere=new THREE.Sphere();const line=new THREE.Line(g,fibreMaterial);line.name=`spider-web-fibre-${i}`;group.add(line);fibres.push(line);}
  const zipWebs=[];
  for(let i=0;i<2;i++){
    const geometry=ownG(new THREE.BufferGeometry());geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(webPositions.length),3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(webNormals.length),3).setUsage(THREE.DynamicDrawUsage));geometry.setIndex(webIndices);geometry.boundingSphere=new THREE.Sphere();
    const strand=new THREE.Mesh(geometry,webMaterial);strand.name=`spider-zip-web-${i}`;strand.visible=false;strand.castShadow=false;group.add(strand);zipWebs.push(strand);
  }
  const pointWebs=[];
  for(let i=0;i<2;i++){
    const geometry=ownG(new THREE.BufferGeometry());geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(webPositions.length),3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(webNormals.length),3).setUsage(THREE.DynamicDrawUsage));geometry.setIndex(webIndices);geometry.boundingSphere=new THREE.Sphere();
    const strand=new THREE.Mesh(geometry,webMaterial);strand.name=`spider-point-web-${i}`;strand.visible=false;strand.castShadow=false;group.add(strand);pointWebs.push(strand);
  }
  const marker=new THREE.Group();marker.name='spider-anchor-marker';group.add(marker);
  const markerMaterial=ownM(new THREE.MeshBasicMaterial({color:'#95d5d5',transparent:true,opacity:.85,toneMapped:false}));
  for(const [i,rot]of [[0,[0,0,0]],[1,[Math.PI/2,0,0]],[2,[0,Math.PI/2,0]]])mesh(marker,new THREE.TorusGeometry(.115,.006,6,32),markerMaterial,`spider-anchor-ring-${i}`,[0,0,0],rot);
  const inverseWorld=new THREE.Matrix4(),anchorLocal=new THREE.Vector3(),gravity=new THREE.Vector3(),start=new THREE.Vector3(),end=new THREE.Vector3(),delta=new THREE.Vector3(),tangent=new THREE.Vector3(),normal=new THREE.Vector3(),binormal=new THREE.Vector3(),v=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),axis=new THREE.Vector3();
  const points={},targets={},markers={},torsoQ=new THREE.Quaternion(),pelvisQ=new THREE.Quaternion(),torsoEuler=new THREE.Euler(),pelvisEuler=new THREE.Euler(),axialQ=new THREE.Quaternion(),bodyBase=new THREE.Vector3(),hipOrigin=new THREE.Vector3(),ikDir=new THREE.Vector3(),ikPole=new THREE.Vector3(),velLocal=new THREE.Vector3(),footEnd=new THREE.Vector3(),handEnd=new THREE.Vector3();
  const armLengths={},legLengths={},zipLocal=[new THREE.Vector3(),new THREE.Vector3()],zipPose=[new THREE.Vector3(),new THREE.Vector3()];
  const inverseCharacter=new THREE.Matrix4(),poseAnchor=new THREE.Vector3(),pointLocal=new THREE.Vector3(),pointPose=new THREE.Vector3(),webWrist=new THREE.Vector3(),trickPivot=new THREE.Vector3(),rotatedPivot=new THREE.Vector3(),trickQ=new THREE.Quaternion(),trickEuler=new THREE.Euler();
  for(const key of['L','R']){
    for(const name of[`shoulder${key}`,`elbow${key}`,`wrist${key}`,`hip${key}`,`knee${key}`,`ankle${key}`]){points[name]=new THREE.Vector3();targets[name]=new THREE.Vector3();}
    for(const kind of['shoulder','web-wrist']){const m=new THREE.Object3D();m.name=`spider-${kind}-${key}`;character.add(m);markers[`${kind}${key}`]=m;}
    armLengths[key]=['upperArm','forearm'].map(s=>{const d=template.defs.find(d=>d.name===s+key);return d.a.distanceTo(d.b);});
    legLengths[key]=['thigh','shin'].map(s=>{const d=template.defs.find(d=>d.name===s+key);return d.a.distanceTo(d.b);});
  }
  for(const key of['pelvisBase','spine','chestTop','neckTop','headTop']){points[key]=new THREE.Vector3();targets[key]=new THREE.Vector3();}
  let elapsed=0,wasGrounded=true,lastVerticalSpeed=0,impact=0,disposed=false,initialized=false,lastAttached=false,releaseAge=10,kickAge=10,chestTwist=0,pelvisTwist=0,lastPointPhase='idle',pointLaunchAge=0;
  function assign(name,x,y,z){return targets[name].set(x,y,z);}
  function bodyPoint(name,x,y,z){
    if(y>.180){bodyBase.set(0,.180,0).applyQuaternion(pelvisQ).add(hipOrigin);return assign(name,x,y-.180,z).applyQuaternion(torsoQ).add(bodyBase);}
    return assign(name,x,y,z).applyQuaternion(pelvisQ).add(hipOrigin);
  }
  function solveJoint(a,b,result,upper,lower,px,py,pz){
    ikDir.copy(b).sub(a);const distance=clamp(ikDir.length(),Math.abs(upper-lower)+.025,upper+lower-.004);ikDir.normalize();b.copy(a).addScaledVector(ikDir,distance);
    ikPole.set(px,py,pz).addScaledVector(ikDir,-ikPole.dot(ikDir));if(ikPole.lengthSq()<.001)ikPole.set(0,0,1);ikPole.normalize();
    const along=(upper*upper-lower*lower+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,upper*upper-along*along));
    result.copy(a).addScaledVector(ikDir,along).addScaledVector(ikPole,height);
  }
  function poseBone(name,a,b,twist=0){const bone=boneByName[name],def=template.defs.find(d=>d.name===name);bone.position.copy(a);dir.copy(b).sub(a);const length=dir.length();bone.quaternion.setFromUnitVectors(restUp,dir.divideScalar(Math.max(length,.001)));if(twist)bone.quaternion.multiply(axialQ.setFromAxisAngle(restUp,twist));bone.scale.set(1,length/def.a.distanceTo(def.b),1);}
  function updateCharacterPivot(){
    trickPivot.copy(points.pelvisBase);rotatedPivot.copy(trickPivot).applyQuaternion(character.quaternion);character.position.copy(trickPivot).sub(rotatedPivot);
    character.updateMatrix();inverseCharacter.copy(character.matrix).invert();
  }
  function wristInRoot(key){return webWrist.copy(points[`wrist${key}`]).applyMatrix4(character.matrix);}
  function writeWebSurface(strand,from,to,sag,filaments=[]){
    start.copy(from);end.copy(to);delta.copy(end).sub(start);const span=delta.length();
    if(span<.015){strand.visible=false;filaments.forEach(f=>{f.visible=false;});return;}
    const geometry=strand.geometry,positions=geometry.attributes.position.array,normals=geometry.attributes.normal.array;
    gravity.set(0,-1,0).transformDirection(inverseWorld);
    for(let i=0;i<=webSegments;i++){
      const t=i/webSegments;v.copy(start).addScaledVector(delta,t).addScaledVector(gravity,4*t*(1-t)*sag);
      tangent.copy(delta).addScaledVector(gravity,4*(1-2*t)*sag).normalize();axis.set(Math.abs(tangent.y)>.9?1:0,Math.abs(tangent.y)>.9?0:1,0);normal.crossVectors(tangent,axis).normalize();binormal.crossVectors(tangent,normal).normalize();
      for(let j=0;j<webSides;j++){const angle=j/webSides*TAU,c=Math.cos(angle),s=Math.sin(angle),nx=normal.x*c+binormal.x*s,ny=normal.y*c+binormal.y*s,nz=normal.z*c+binormal.z*s,k=(i*webSides+j)*3;positions[k]=v.x+nx*.0045;positions[k+1]=v.y+ny*.0045;positions[k+2]=v.z+nz*.0045;normals[k]=nx;normals[k+1]=ny;normals[k+2]=nz;}
      filaments.forEach((line,f)=>{const side=f?1:-1,offset=Math.sin(t*Math.PI)*.006*side,p=line.geometry.attributes.position.array,k=i*3;p[k]=v.x+normal.x*offset;p[k+1]=v.y+normal.y*offset;p[k+2]=v.z+normal.z*offset;});
    }
    geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;geometry.boundingSphere.center.copy(start).add(end).multiplyScalar(.5);geometry.boundingSphere.radius=span*.5+sag+.02;
    for(const line of filaments){line.geometry.attributes.position.needsUpdate=true;line.geometry.boundingSphere.copy(geometry.boundingSphere);}
  }
  function updateWeb(state,key,zipCount,pointApproach){
    const active=!state.inspection&&!!state.anchor&&!zipCount&&!pointApproach;webMesh.visible=active;fibres.forEach(f=>{f.visible=active;});
    if(active){
      const span=wristInRoot(key).distanceTo(anchorLocal),tension=clamp(num(state.webTension,1),0,1);
      // The assisted pendulum pivot differs from the visible building anchor.
      // Its absolute length cannot be used as visible excess rope: that used
      // to draw metre-deep loops even while the web was carrying the player.
      const slack=Math.max(0,num(state.webSlack,0));
      const sag=clamp(slack*.35*(1-tension),0,Math.min(.18,span*.008));
      writeWebSurface(webMesh,wristInRoot(key),anchorLocal,sag,fibres);
    }
    for(let i=0;i<2;i++){
      zipWebs[i].visible=i<zipCount;
      if(i<zipCount){const hand=zipCount===1?key:i===0?'L':'R';writeWebSurface(zipWebs[i],wristInRoot(hand),zipLocal[i],0);}
    }
    for(let i=0;i<2;i++){pointWebs[i].visible=pointApproach;if(pointApproach)writeWebSurface(pointWebs[i],wristInRoot(i===0?'L':'R'),pointLocal,0);}
  }
  function update(state={},dt=0){
    if(disposed)return;
    const step=clamp(num(dt),0,.1);elapsed+=step;
    const preview=state.inspection===true;
    const grounded=preview||state.grounded!==false,attached=!preview&&!!state.anchor,speed=preview?0:Math.hypot(num(state.vx),num(state.vz))||Math.abs(num(state.speed)),run=clamp(speed/4.8,0,1),vertical=num(state.verticalSpeed);
    const zipCount=!grounded&&state.zipActive&&Array.isArray(state.zipAnchors)?Math.min(2,state.zipAnchors.length):0;
    const diving=!grounded&&(state.diving||state.traversalPhase==='dive'),dive=diving?clamp(num(state.diveBlend,1),0,1):0;
    const pointPhase=!preview&&['approach','perch','launch'].includes(state.pointPhase)?state.pointPhase:'idle',pointApproach=pointPhase==='approach'&&!!state.pointTarget,pointPerch=pointPhase==='perch',pointLaunch=pointPhase==='launch';
    if(pointPhase!==lastPointPhase)pointLaunchAge=0;else if(pointLaunch)pointLaunchAge+=step;lastPointPhase=pointPhase;
    const pointProgress=clamp(num(state.pointProgress),0,1),launchTime=num(state.pointLaunchTime,pointLaunchAge),launchExtend=clamp(launchTime/.16,0,1),launchQuality=clamp(num(state.pointLaunchQuality,.5),0,1);
    const trickAllowed=!grounded&&!attached&&!zipCount&&!diving&&pointPhase==='idle',trickPerform=trickAllowed&&!!state.trickActive&&(state.trickPhase??'perform')==='perform';
    const trickProgress=clamp(num(state.trickProgress),0,1),trickType=state.trickType||'frontflip',trickWeight=trickAllowed?clamp(num(state.trickBlend,trickPerform?1:0),0,1):0;
    const trickTuck=trickWeight*Math.sin(clamp(trickProgress,.02,.98)*Math.PI),sideTrick=trickType==='leftroll'||trickType==='rightroll',trickSide=trickType==='leftroll'?-1:1;
    let rx=0,ry=0,rz=0;
    if(trickAllowed&&(trickPerform||state.trickPhase==='recover')){
      if(state.trickRotation){rx=num(state.trickRotation.x);ry=num(state.trickRotation.y);rz=num(state.trickRotation.z);}
      else if(trickPerform){if(sideTrick)rz=(trickType==='leftroll'?1:-1)*TAU*trickProgress;else rx=(trickType==='frontflip'?-1:1)*TAU*trickProgress;}
    }
    trickEuler.set(rx,ry,rz,'XYZ');trickQ.setFromEuler(trickEuler);
    if(grounded||step===0)character.quaternion.copy(trickQ);
    else if(trickPerform)character.quaternion.copy(trickQ);
    else character.quaternion.slerp(trickQ,1-Math.exp(-step*32));
    updateCharacterPivot();
    const phaseName=preview?'ground':state.traversalPhase||(grounded?'ground':zipCount?'zip':diving?'dive':attached?'swing':vertical>1?'launch':'fall');
    if(preview)impact=0;
    else if(Number.isFinite(state.landingImpact))impact=clamp(state.landingImpact/11,0,1);
    else{if(grounded&&!wasGrounded)impact=clamp(Math.abs(lastVerticalSpeed)/10,.1,1);impact*=Math.exp(-step*8);}
    if(!attached&&lastAttached)releaseAge=0;else releaseAge+=step;
    if(attached&&lastVerticalSpeed<-.5&&vertical>=-.5)kickAge=0;else kickAge+=step;
    lastVerticalSpeed=vertical;wasGrounded=grounded;lastAttached=attached;
    const releaseTime=phaseName==='release'?num(state.releaseTime,releaseAge):releaseAge;
    const release=grounded?0:Math.exp(-releaseTime*5),releaseOpen=grounded?0:Math.sin(clamp(releaseTime/.55,0,1)*Math.PI);
    const zipPull=zipCount?clamp(num(state.zipStrength,Math.sin(clamp(num(state.zipProgress,.5),0,1)*Math.PI)),0,1):0;
    const kick=attached?clamp(num(state.bottomKick,Math.exp(-kickAge*9)),0,1):0;
    const swingPhase=state.swingPhase||(vertical<-1?'downswing':vertical>1?'upswing':'bottom');
    const entry=attached?Math.exp(-num(state.attachAge,2)*5):0;
    const clock=num(state.elapsed,elapsed),phase=clock*(8.7+run*2.2),breath=Math.sin(clock*2.2)*.0018;
    group.updateWorldMatrix(true,false);inverseWorld.copy(group.matrixWorld).invert();
    if(attached){anchorLocal.set(state.anchor.x,state.anchor.y,state.anchor.z).applyMatrix4(inverseWorld);poseAnchor.copy(anchorLocal).applyMatrix4(inverseCharacter);}
    for(let i=0;i<zipCount;i++){zipLocal[i].set(state.zipAnchors[i].x,state.zipAnchors[i].y,state.zipAnchors[i].z).applyMatrix4(inverseWorld);zipPose[i].copy(zipLocal[i]).applyMatrix4(inverseCharacter);}
    if(pointApproach){pointLocal.set(state.pointTarget.x,state.pointTarget.y,state.pointTarget.z).applyMatrix4(inverseWorld);pointPose.copy(pointLocal).applyMatrix4(inverseCharacter);}
    velLocal.set(num(state.vx),0,num(state.vz));if(velLocal.lengthSq()>.01)velLocal.transformDirection(inverseWorld);
    const running=grounded?run:0,crouch=grounded?impact:0,drive=clamp(speed/16,0,1),tension=clamp(num(state.webTension,1),0,1);
    const down=attached&&swingPhase==='downswing'?1:0,rise=attached&&swingPhase==='upswing'?1:0;
    const ropeForward=attached?clamp(-anchorLocal.z/Math.max(1,anchorLocal.length()),-.7,.7):0;
    let tilt=grounded?-.035-running*.09-crouch*.28:attached?-.10-down*(.18+drive*.12)-ropeForward*.15+rise*.24-kick*.18:phaseName==='launch'?-.18:phaseName==='wallrun'?-.15:-.15-release*.10-releaseOpen*.26;
    if(zipCount)tilt=-.30-zipPull*.22;
    if(diving)tilt=-.20-dive*.56;
    if(pointApproach)tilt=-.43+pointProgress*.20;
    if(pointPerch)tilt=-.72;
    if(pointLaunch)tilt=-.60*(1-launchExtend)-.10;
    if(trickWeight)tilt=sideTrick?-.12-trickTuck*.16:trickType==='backflip'?.03-trickTuck*.31:-.16-trickTuck*.32;
    const handSide=num(state.swingHand,1)<0?-1:1;
    const twist=attached?handSide*(.08+kick*.19-rise*.04):(zipCount||pointPhase!=='idle')?0:trickWeight?trickSide*trickTuck*.21:diving?0:Math.sin(phase)*running*.045+handSide*(release*.12+releaseOpen*.30);
    torsoEuler.set(clamp(tilt,-.80,.32),twist,attached?clamp(num(state.lean)*-.30,-.10,.10):sideTrick&&trickWeight?trickSide*trickTuck*.12:0);torsoQ.setFromEuler(torsoEuler);
    // Counter-rotate the pelvis rather than making the entire torso one rigid
    // rod. Axial twist is also applied to the skin bones below, not only to
    // the positions of their shoulder endpoints.
    pelvisEuler.set(tilt*(diving?.55:.32),-twist*.30,torsoEuler.z*.35);pelvisQ.setFromEuler(pelvisEuler);
    hipOrigin.set(0,(pointPerch?.43:pointLaunch?.43+.52*(launchExtend*launchExtend*(3-2*launchExtend)):grounded?.915-running*.056-crouch*.18+Math.sin(phase*2)*running*.010:.925)+breath,attached?.023:0);
    bodyPoint('pelvisBase',0,-.015,.012);bodyPoint('spine',0,.180,-.002);bodyPoint('chestTop',0,.520,-.002);bodyPoint('neckTop',0,.610,-.002);bodyPoint('headTop',0,.827,-.002);
    const handKey=num(state.swingHand,1)<0?'L':'R';
    for(const side of[-1,1]){
      const key=side<0?'L':'R',stride=Math.sin(phase+(side<0?Math.PI:0))*running;
      bodyPoint(`shoulder${key}`,side*.194,.461,-.002);bodyPoint(`hip${key}`,side*.099,0,.010);
      if(pointApproach){
        const gather=clamp((pointProgress-.45)/.55,0,1);
        assign(`ankle${key}`,side*(.14+.03*gather),.20+gather*(side===handSide?.35:.25),.22+gather*.12);
        dir.copy(pointPose).sub(targets[`shoulder${key}`]).normalize();targets[`wrist${key}`].copy(targets[`shoulder${key}`]).addScaledVector(dir,armLengths[key][0]+armLengths[key][1]-.012-gather*.035);
      }else if(pointPerch){
        assign(`ankle${key}`,side*.17,.090,side*.035+.014);
        assign(`wrist${key}`,side*.24,.155,-.32);
      }else if(pointLaunch){
        assign(`ankle${key}`,side*(.17-.04*launchExtend),.09+.035*launchExtend+(side===handSide?.09:0)*launchExtend,.014+.16*launchExtend);
        assign(`wrist${key}`,side*(.24+(.13+launchQuality*.04)*launchExtend),.20+(.80+launchQuality*.08)*launchExtend,.02+launchExtend*.17);
      }else if(trickWeight>.001){
        if(sideTrick){
          const tucked=side===trickSide;
          assign(`ankle${key}`,side*(.17+.09*trickTuck),.15+trickTuck*(tucked?.43:.17),.12+trickTuck*(tucked?.24:-.05));
          assign(`wrist${key}`,side*(.43-.12*trickTuck),1.17+trickTuck*(tucked?.26:-.15),-.04+trickTuck*(tucked?-.18:.20));
        }else{
          assign(`ankle${key}`,side*.14,.14+trickTuck*(side===handSide?.43:.37),.12+trickTuck*.15);
          assign(`wrist${key}`,side*(.40-.15*trickTuck),1.17-trickTuck*.23,-.06-trickTuck*.26);
        }
      }else if(grounded){
        const lift=Math.max(0,Math.cos(phase+(side<0?Math.PI:0)))*.105*running;
        assign(`ankle${key}`,side*.108,.090+lift,-stride*.265+.014);
        assign(`wrist${key}`,side*(.278+crouch*.08),hipOrigin.y-.055+crouch*.14,stride*.25-.020-crouch*.19);
      }else if(zipCount){
        const zipHand=zipCount===2||(key===handKey),i=zipCount===2?(key==='L'?0:1):0;
        assign(`ankle${key}`,side*.135,.23+(side===handSide?.18:.05)+zipPull*.14,.24+(side===handSide?.13:0));
        assign(`wrist${key}`,side*.30,1.24,-.34);
        if(zipHand){dir.copy(zipPose[i]).sub(targets[`shoulder${key}`]).normalize();targets[`wrist${key}`].copy(targets[`shoulder${key}`]).addScaledVector(dir,armLengths[key][0]+armLengths[key][1]-.015);}
      }else if(diving){
        // Streamline the silhouette without rotating the feet origin or the
        // physical/camera root. Hands trail the hips; knees remain unequal.
        assign(`ankle${key}`,side*(.12+.025*(1-dive)),.20+(side===handSide?.05:.16)*dive,.18+dive*(side===handSide?.40:.31));
        assign(`wrist${key}`,side*(.25-.025*dive),.98+.02*dive,.08+.20*dive);
      }else if(attached){
        const active=key===handKey,trail=active?.08:0;
        let ankleY=.20+entry*.23+rise*(active?.30:.20)-down*(active?0:.04),ankleZ=.24+down*(active?.08:.10)-rise*(active?.24:.10);
        ankleY+=active?.12:-.025;
        // The short kick pulse drives this accent independently of arc speed.
        ankleY+=kick*(active?-.03:.19);ankleZ-=kick*(active?.86:.05);
        assign(`ankle${key}`,side*(.14+kick*.045+rise*.025),ankleY,ankleZ+trail);
        assign(`wrist${key}`,side*(.44-entry*.07),hipOrigin.y+.06+kick*.20-rise*.05,.19+down*.12-kick*.14);
        if(active){dir.copy(poseAnchor).sub(targets[`shoulder${key}`]).normalize();const length=armLengths[key][0]+armLengths[key][1]-.008-entry*.050-(1-tension)*.035;targets[`wrist${key}`].copy(targets[`shoulder${key}`]).addScaledVector(dir,length);}
      }else if(phaseName==='wallrun'){
        assign(`ankle${key}`,side*.14,.17+Math.max(0,Math.cos(phase+side))* .23,-Math.sin(phase+side)*.20);
        assign(`wrist${key}`,side*.27,1.41+Math.cos(phase+side)*.15,-.28);
      }else{
        const launch=phaseName==='launch'?1:0;
        assign(`ankle${key}`,side*(.16+.05*(1-launch)),.12+(side===handSide?.10:.22)*(1-launch)+release*(side===handSide?.30:-.04)-releaseOpen*(side===handSide?.13:.09),.06+side*.11+release*(side===handSide?.24:-.13)+releaseOpen*(side===handSide?.18:.28));
        assign(`wrist${key}`,side*(.47-.13*launch+releaseOpen*.09),1.16+launch*.27+release*.17+releaseOpen*.09,-.025-launch*.16-release*.07+releaseOpen*.13);
      }
    }
    // Transition targets, not transforms independently: IK then restores the
    // bone lengths. A release retains momentum for several frames; it does not
    // snap an overhead hand directly to the falling pose.
    const blend=!initialized||step===0||preview?1:1-Math.exp(-step*(grounded?20:13));
    for(const name of Object.keys(points))if(!name.startsWith('elbow')&&!name.startsWith('knee')){
      const zipWrist=name.startsWith('wrist')&&(pointApproach||(zipCount&&(zipCount===2||name===`wrist${handKey}`)));
      if(!zipWrist)points[name].lerp(targets[name],blend);
    }
    updateCharacterPivot();
    if(attached)poseAnchor.copy(anchorLocal).applyMatrix4(inverseCharacter);
    for(let i=0;i<zipCount;i++)zipPose[i].copy(zipLocal[i]).applyMatrix4(inverseCharacter);
    if(pointApproach)pointPose.copy(pointLocal).applyMatrix4(inverseCharacter);
    initialized=true;chestTwist+=(torsoEuler.y-chestTwist)*blend;pelvisTwist+=(pelvisEuler.y-pelvisTwist)*blend;
    for(const side of[-1,1]){
      const key=side<0?'L':'R',zipHand=!!zipCount&&(zipCount===2||key===handKey);
      const zipArmBlend=step===0?1:1-Math.exp(-step*65);
      if(zipHand||pointApproach){
        // A zip lasts only .28s. Reach from the already-smoothed shoulder, not
        // from its future torso target: otherwise the short arm-to-shoulder
        // span keeps the elbow in a boxing pose for most of the action.
        const i=zipCount===2?(key==='L'?0:1):0,pullT=clamp((num(state.zipProgress,.5)-.55)/.40,0,1),pull=pullT*pullT*(3-2*pullT);
        dir.copy(pointApproach?pointPose:zipPose[i]).sub(points[`shoulder${key}`]).normalize();
        targets[`wrist${key}`].copy(points[`shoulder${key}`]).addScaledVector(dir,armLengths[key][0]+armLengths[key][1]-.010-(pointApproach?pointProgress*.035:pull*.090));
        points[`wrist${key}`].lerp(targets[`wrist${key}`],zipArmBlend);
      }
      if(grounded||pointPerch)points[`ankle${key}`].y=Math.max(.090,points[`ankle${key}`].y);
      solveJoint(points[`hip${key}`],points[`ankle${key}`],points[`knee${key}`],...legLengths[key],side*(pointPerch?.60:.14+rise*.15),-.10,-1);
      solveJoint(points[`shoulder${key}`],points[`wrist${key}`],points[`elbow${key}`],...armLengths[key],side*((zipHand||pointApproach)?.25:grounded?.18:.72),(zipHand||pointApproach)?-.65:-.12,(zipHand||pointApproach)?.40:attached&&key===handKey?-.45:.80);
      poseBone(`upperArm${key}`,points[`shoulder${key}`],points[`elbow${key}`]);poseBone(`forearm${key}`,points[`elbow${key}`],points[`wrist${key}`]);
      handEnd.copy(points[`wrist${key}`]).add(dir.copy(points[`wrist${key}`]).sub(points[`elbow${key}`]).normalize().multiplyScalar(template.defs.find(d=>d.name===`hand${key}`).a.distanceTo(template.defs.find(d=>d.name===`hand${key}`).b)));
      poseBone(`hand${key}`,points[`wrist${key}`],handEnd);
      poseBone(`thigh${key}`,points[`hip${key}`],points[`knee${key}`]);poseBone(`shin${key}`,points[`knee${key}`],points[`ankle${key}`]);
      footEnd.copy(points[`ankle${key}`]);footEnd.y+=pointLaunch?-.010-.025*launchExtend:(grounded||pointPerch)?-.010:-.035;footEnd.z-=.134;poseBone(`foot${key}`,points[`ankle${key}`],footEnd);
      updateFingers(key,(attached&&key===handKey)||zipHand||pointApproach,!grounded&&!pointPerch,(zipHand||pointApproach)?zipArmBlend:blend);
      markers[`shoulder${key}`].position.copy(points[`shoulder${key}`]);markers[`web-wrist${key}`].position.copy(points[`wrist${key}`]);
    }
    poseBone('pelvis',points.pelvisBase,points.spine,pelvisTwist);poseBone('chest',points.spine,points.chestTop,chestTwist);poseBone('neck',points.chestTop,points.neckTop,chestTwist);poseBone('head',points.neckTop,points.headTop,chestTwist);
    character.visible=state.view!=='first';
    const candidate=preview?null:pointApproach?state.pointTarget:zipCount?state.zipAnchors[0]:state.anchor||state.candidateAnchor;marker.visible=!!candidate;
    if(candidate){marker.position.set(candidate.x,candidate.y,candidate.z).applyMatrix4(inverseWorld);marker.scale.setScalar(attached?.72:1);markerMaterial.opacity=attached?.65:.82;}
    updateWeb(state,handKey,zipCount,pointApproach);group.updateMatrixWorld(true);skeleton.update();
  }
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();skeleton.dispose();for(const g of resources.geometries)g.dispose();for(const m of resources.materials)m.dispose();group.clear();resources.geometries.clear();resources.materials.clear();}
  group.userData={units:'metres',forward:'-Z',height:1.75,eyeHeight:1.64,originalProceduralAsset:true,continuousSkin:true,suitMarkings:['painted-web','chest-spider','back-spider'],webSegments,webSides};
  update({grounded:true},0);skin.computeBoundingBox();return{group,update,dispose};
}
