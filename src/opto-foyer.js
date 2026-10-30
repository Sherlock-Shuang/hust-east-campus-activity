import {addOptoSignAtlas, makeOptoTerrazzoTexture} from './opto-photo-details.js';

const rect=(x0,z0,x1,z1)=>[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
/** Topology confirmed by the user's C2 → C118 / left → C1 walk-through.
 * Lengths are photo estimates; the local floor datum matches the hall's rear landing. */
export function connectOptoFoyer(plan){
  const y=plan.rearLanding.surfaceY,back=plan.config.depth/2;
  const f={y,back,front:back+16,left:-13,right:13,end:-57,near:back+6,far:back+13,height:5.8};
  const doors=plan.aisles.filter(a=>a.id.endsWith('main')).map(a=>({id:`foyer-${a.id}`,x:(a.x0+a.x1)/2,z:back,y,width:2.6,height:2.85}));
  f.doors=doors;f.walls=[];f.furniture=[];
  const solid=(id,x0,z0,x1,z1,y0=y,y1=y+f.height+.7,collection=f.walls)=>{
    const item={id,sourceId:plan.id,label:'光电大楼',polygon:rect(x0,z0,x1,z1),minHeight:y0,height:y1};
    plan.colliders.push(item);collection.push(item);return item;
  };
  plan.colliders=plan.colliders.filter(c=>c.id!=='c118-rear-wall');
  let start=-plan.config.width/2-.18;
  for(const d of doors){
    solid(`${d.id}-pier`,start,back-.1,d.x-d.width/2,back+.18,plan.config.floorY,y+f.height+.7);
    solid(`${d.id}-sill`,d.x-d.width/2,back-.1,d.x+d.width/2,back+.18,plan.config.floorY,y);
    solid(`${d.id}-lintel`,d.x-d.width/2,back-.1,d.x+d.width/2,back+.18,y+d.height,y+f.height+.7);
    start=d.x+d.width/2;
  }
  solid('foyer-rear-end-pier',start,back-.1,plan.config.width/2+.18,back+.18,plan.config.floorY,y+f.height+.7);
  solid('foyer-right-wall',f.right,back,f.right+.2,f.front);
  solid('foyer-left-front-wall',f.left-.2,back,f.left,f.near);
  solid('foyer-left-back-wall',f.left-.2,f.far,f.left,f.front);
  solid('foyer-hall-front-corner',f.left,back-.1,-plan.config.width/2-.18,back+.18);
  solid('foyer-hall-right-corner',plan.config.width/2+.18,back-.1,f.right,back+.18);
  solid('foyer-corridor-near',f.end,f.near-.2,f.left,f.near);
  solid('foyer-corridor-far',f.end,f.far,f.left,f.far+.2);
  // Only the piers are solid at the two exterior doors. The centre is clear.
  solid('foyer-c2-left-glass',f.left,f.front-.1,-2.8,f.front+.1);
  solid('foyer-c2-right-glass',2.8,f.front-.1,f.right,f.front+.1);
  solid('foyer-c1-left-glass',f.end-.1,f.near,f.end+.1,f.near+1.3);
  solid('foyer-c1-right-glass',f.end-.1,f.far-1.3,f.end+.1,f.far);
  const surface=(id,p)=>plan.walkSurfaces.push({id,sourceId:plan.id,polygon:p,surfaceY:y,kind:'foyer'});
  surface('foyer-floor',rect(f.left,back-.2,f.right,f.front));
  surface('foyer-corridor-floor',rect(f.end,f.near,f.left+.1,f.far));
  surface('foyer-c2-threshold',rect(-2.8,f.front-.2,2.8,f.front+2));
  surface('foyer-c1-threshold',rect(f.end-2,f.near+1.3,f.end+.2,f.far-1.3));
  solid('foyer-brand-plinth',-3.9,back+.2,3.9,back+1.1,y,y+.4,f.furniture);
  for(const x of[-19,-30,-42,-50])for(const z of[f.near+.4,f.far-.4])solid(`foyer-pot-${x}-${z}`,x-.3,z-.3,x+.3,z+.3,y,y+.62,f.furniture);
  solid('foyer-registration-table',-46,f.near+.2,-43,f.near+1,y,y+.8,f.furniture);
  plan.foyer=f;
  plan.bounds={...plan.bounds,minX:f.end-2,maxX:Math.max(plan.bounds.maxX,f.right+.2),maxZ:f.front+2};
  plan.viewpoints.c2Lobby={x:0,y,z:f.front-1.5,yaw:0,pitch:0};
  plan.viewpoints.c1Lobby={x:f.end+1.5,y,z:(f.near+f.far)/2,yaw:-Math.PI/2,pitch:0};
  plan.viewpoints.foyer={x:0,y,z:back+9,yaw:0,pitch:0};
  return plan;
}

export function optoFoyerExit(plan,state){
  const f=plan.foyer;if(!f||!['x','y','z'].every(k=>Number.isFinite(state?.[k]))||Math.abs(state.y-f.y)>.25)return null;
  if(state.z>f.front+.3&&state.z<f.front+2&&Math.abs(state.x)<2.6)return 'opto-c2';
  if(state.x<f.end-.3&&state.x>f.end-2&&state.z>f.near+1.4&&state.z<f.far-1.4)return 'opto-c1';
  return null;
}
export function isInsideC118(plan,state){return !!state&&state.z<=plan.config.depth/2&&state.z>=-plan.config.depth/2&&Math.abs(state.x)<=plan.config.width/2+1.6;}

/** Batches repeated trim, furniture, glazing and lights; no extra render loop. */
export function createOptoFoyer(THREE,plan){
  const f=plan.foyer,group=new THREE.Group();group.name='opto-connected-foyer';
  const geos=new Set(),mats=new Set(),batches=new Map();
  const geo=g=>(geos.add(g),g),mat=(color,roughness=.8,extra={})=>{const m=new THREE.MeshStandardMaterial({color,roughness,...extra});mats.add(m);return m;};
  const white=mat('#eeefeb'),gray=mat('#bdc3c4'),dark=mat('#343b41'),blue=mat('#194d88'),silver=mat('#aebabc',.28,{metalness:.6}),green=mat('#42704c'),leaf=mat('#68854f');
  const floor=mat('#d5d8d5',.24,{metalness:.07}),glass=mat('#b1d8d7',.22,{transparent:true,opacity:.2,depthWrite:false}),sky=mat('#c8e0e9',1,{emissive:'#b3cddd',emissiveIntensity:.5});
  const light=mat('#fffdf0',.5,{emissive:'#fff5de',emissiveIntensity:1.2});
  floor.map=makeOptoTerrazzoTexture(THREE);if(floor.map)floor.map.repeat.set(24,12);
  const cube=geo(new THREE.BoxGeometry(1,1,1)),sphere=geo(new THREE.IcosahedronGeometry(1,1)),dummy=new THREE.Object3D();
  function box(m,x,y,z,w,h,d,ry=0,shape=cube,rz=0){
    if(Math.min(w,h,d)<=0)return;
    const key=m.uuid+shape.uuid;if(!batches.has(key))batches.set(key,{m,shape,items:[]});
    dummy.position.set(x,y,z);dummy.scale.set(w,h,d);dummy.rotation.set(0,ry,rz);dummy.updateMatrix();batches.get(key).items.push(dummy.matrix.clone());
  }
  function mesh(name,g,m){const o=new THREE.Mesh(g,m);o.name=name;group.add(o);return o;}
  const Y=f.y,T=Y+f.height;
  for(const w of f.walls){const[a,,b]=w.polygon;
    box(w.id.includes('glass')?glass:w.id.includes('pier')||w.id.includes('lintel')?gray:white,(a.x+b.x)/2,(w.minHeight+w.height)/2,(a.z+b.z)/2,b.x-a.x,w.height-w.minHeight,b.z-a.z);
    if(!w.id.includes('glass')&&w.minHeight===Y)box(dark,(a.x+b.x)/2,Y+.07,(a.z+b.z)/2,b.x-a.x,.14,b.z-a.z+.018);
  }
  box(floor,0,Y-.05,(f.back+f.front)/2,26,.1,16);
  box(floor,(f.end+f.left)/2,Y-.05,(f.near+f.far)/2,f.left-f.end,.1,7);
  box(floor,0,Y-.05,f.front+.8,5.6,.1,1.6);
  box(floor,f.end-.8,Y-.05,(f.near+f.far)/2,1.6,.1,4.4);
  // Atrium's daylight grid, with a shallow raised central skylight.
  box(sky,0,T+.7,f.back+8,25.8,.08,15.8);
  for(let x=-12;x<=12;x+=2)box(white,x,T+.65,f.back+8,.12,.22,16);
  for(let z=f.back;z<=f.front;z+=2)box(white,0,T+.65,z,26,.22,.12);
  for(const x of[-12.7,12.7])box(white,x,T+.3,f.back+8,.6,.8,16);
  for(const z of[f.back+.4,f.front-.4])box(white,0,T+.3,z,26,.8,.8);
  // Lower corridor ceiling, shallow coffers, continuous linear luminaires.
  const cy=Y+3.5;
  box(white,(f.end+f.left)/2,cy+.08,(f.near+f.far)/2,f.left-f.end,.16,7);
  for(let x=f.end+1;x<f.left;x+=.35)box(white,x,cy-.08,(f.near+f.far)/2,.08,.12,6.9);
  for(let x=f.end+3;x<f.left;x+=5){box(light,x,cy-.16,(f.near+f.far)/2,.07,.025,5.6);}
  // Large grey central identity wall flanked by two genuinely open rear doors.
  box(gray,0,Y+2.7,f.back+.22,8.6,5.4,.08);
  box(white,0,Y+.2,f.back+.65,7.8,.4,.9);
  const signs=[];
  const sign=(text,x,y,z,width,height,extra={})=>signs.push({text,x,y,z,width,height,nx:0,nz:1,color:'#163b84',...extra});
  sign('光谷实验室',0,Y+4.75,f.back+.28,4.2,.55,{subtext:'Optics Valley Laboratory'});
  sign('WNLO',0,Y+3.75,f.back+.28,1.75,.5);
  sign('武汉光电国家研究中心',0,Y+2.8,f.back+.28,7.5,.64,{subtext:'WUHAN NATIONAL LABORATORY FOR OPTOELECTRONICS'});
  sign('明德　厚学　求是　创新',0,Y+.24,f.back+1.11,6.5,.19,{color:'#b4944b'});
  for(const d of f.doors){
    for(const side of[-1,1]){
      box(white,d.x+side*(d.width/2+.05),Y+d.height/2,d.z+.06,.1,d.height,.18);
      // Leaves open into the foyer along the jamb; no slab masks the sightline.
      box(white,d.x+side*(d.width/2+.03),Y+1.38,d.z+.74,.08,2.76,1.3);
      box(silver,d.x+side*(d.width/2-.035),Y+1.45,d.z+1.22,.06,1.25,.05);
    }
    box(white,d.x,Y+d.height+.04,d.z+.06,d.width+.2,.1,.18);
    box(dark,d.x,Y+3.15,d.z+.23,1.1,.35,.06);
    sign('C118　报告厅',d.x,Y+3.15,d.z+.27,1.02,.25,{color:'#e8edeb'});
  }
  // Photo-visible flush control-room door, fire cabinet and understated signage.
  box(white,10.2,Y+1.35,f.back+.22,1.1,2.7,.08);box(dark,10.65,Y+1.25,f.back+.28,.04,.75,.035);
  sign('C118B 控制室',10.2,Y+2.96,f.back+.29,1.5,.2);
  box(silver,-9.8,Y+1.03,f.back+.23,.9,1.65,.08);sign('消火栓',-9.8,Y+1.3,f.back+.28,.55,.16,{color:'#9b3434'});
  // Corridor exhibition panels: concise headings and diagram geometry, no fake paragraphs.
  for(let x=-19,i=0;x>-52;x-=5,i++){
    for(const side of[-1,1]){
      const z=side<0?f.near+.12:f.far-.12;
      box(gray,x,Y+1.55,z,3.3,2.4,.08);box(white,x,Y+1.55,z-side*.05,3.18,2.28,.04);
      box(blue,x,Y+2.47,z-side*.08,3.08,.2,.025);
      for(let k=0;k<3;k++){box(k===1?blue:gray,x-.96+k*.96,Y+1.65,z-side*.08,.68,.55,.025);box(gray,x-.96+k*.96,Y+.99,z-side*.08,.68,.03,.025);}
      if(i%2===0)sign(side<0?'科研成果':'光电 · 创新',x,Y+2.47,z-side*.1,1.65,.14,{nz:side<0?1:-1,color:'#ffffff'});
      // Dark side-room frames sit flush; they are not fake traversable portals.
      box(dark,x+2.05,Y+1.35,z,.84,2.7,.1);box(white,x+2.05,Y+1.32,z-side*.07,.7,2.52,.04);
    }
  }
  // Black recessed display on the foyer's right wall.
  box(dark,f.right-.12,Y+2.1,f.back+7,.1,1.8,4.5);
  for(const item of f.furniture){const[a,,b]=item.polygon;
    if(item.id.includes('pot')){
      box(white,(a.x+b.x)/2,Y+.3,(a.z+b.z)/2,.52,.6,.52,0,sphere);
      for(let i=0;i<5;i++)box(i%2?green:leaf,(a.x+b.x)/2+(i-2)*.09,Y+.85+Math.sin(i)*.1,(a.z+b.z)/2,.1,.72,.24,i*.9,sphere,(i-2)*.22);
    }else if(item.id.includes('table')){box(blue,(a.x+b.x)/2,Y+.39,(a.z+b.z)/2,b.x-a.x,.78,b.z-a.z);}
  }
  // Dark overhead route board and green exit markers match the building's wayfinding.
  box(dark,-16,Y+2.9,(f.near+f.far)/2,.08,.48,3.8);
  signs.push({text:'C1 出口  →',x:-15.94,y:Y+2.9,z:(f.near+f.far)/2,width:3.3,height:.32,nx:1,nz:0,color:'#f1f3ed'});
  function glazedDoor(axis,at,center,width,label){
    const p=(u,h,v)=>axis==='z'?[center+u,Y+h,at+v]:[at+v,Y+h,center+u];
    const b=(m,u,h,v,w,ht,d)=>{const[x,y,z]=p(u,h,v);box(m,x,y,z,axis==='z'?w:d,ht,axis==='z'?d:w);};
    b(dark,0,3.3,0,width,.28,.18);b(glass,0,4,0,width,1.1,.1);
    for(const s of[-1,1]){b(dark,s*width/2,1.7,0,.12,3.4,.16);b(glass,s*(width/2-.08),1.6,-.7,.07,3.1,1.45);b(silver,s*(width/2-.17),1.55,-1.2,.055,1.2,.06);}
    const[x,y,z]=p(0,3.85,-.08);signs.push({text:label,x,y,z,width:1.1,height:.6,nx:axis==='x'?1:0,nz:axis==='z'?-1:0,color:'#d6ad24'});
  }
  glazedDoor('z',f.front,0,5.6,'C2');glazedDoor('x',f.end,(f.near+f.far)/2,4.4,'C1');
  // Glazed walls, outside trees and the opposite building can be seen before exiting.
  for(let x=-12;x<=12;x+=1.4){if(Math.abs(x)<3)continue;box(dark,x,Y+2.8,f.front,.055,5.6,.12);}
  for(const h of[3.4,5.5])box(dark,0,Y+h,f.front,26,.07,.14);
  for(let u=-8;u<=8;u+=4){box(green,u,Y+1.3,f.front+5,1.6,1,1.1,0,sphere);box(gray,u,Y+1.1,f.front+5,.15,2.2,.15);}
  box(sky,0,Y+4,f.front+11,35,10,.1);box(gray,0,Y-.1,f.front+6,30,.1,12);
  box(sky,f.end-11,Y+4,(f.near+f.far)/2,.1,10,25);box(gray,f.end-6,Y-.1,(f.near+f.far)/2,12,.1,20);
  for(let z=f.near-5;z<f.far+5;z+=1.3){box(silver,f.end-10,Y+3,z,.25,6,.12);box(green,f.end-5,Y+.6,z,.8,.8,1.2,0,sphere);}
  for(const b of batches.values()){const o=new THREE.InstancedMesh(b.shape,b.m,b.items.length);o.name=`foyer-${b.m===floor?'terrazzo':b.m===glass?'glazing':b.m===light?'lights':'details'}`;b.items.forEach((m,i)=>o.setMatrixAt(i,m));o.computeBoundingSphere();group.add(o);}
  addOptoSignAtlas(THREE,{signs,mesh,geometry:geo,mats});
  group.userData={photoEstimated:true,route:'C2 → C118; left corridor → C1 (west)',labelCount:signs.length};
  let disposed=false;
  return {group,dispose(){if(disposed)return;disposed=true;group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});geos.forEach(g=>g.dispose());mats.forEach(m=>{m.map?.dispose();m.dispose();});group.removeFromParent();group.clear();}};
}
