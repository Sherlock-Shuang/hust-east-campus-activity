// Small, independently disposable shop-front details. The caller owns the
// source footprint, collision solids and all evidence/tenant placement.
// This layer stays in a shallow skin outside that wall; it does not advertise
// a playable interior behind an opaque building shell.

const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const finite=(x,fallback)=>Number.isFinite(x)?x:fallback;
const nextPow2=n=>2**Math.ceil(Math.log2(Math.max(1,n)));

export function createCommercialFrontages(THREE,{frontages=[],fixtures=[]}={}){
  const group=new THREE.Group();group.name='沿街门面 · 店招、橱窗与街具';
  group.userData={component:'commercial-frontages',estimated:true,interiors:'shallow window dressing; not playable shop interiors'};
  const geometries=new Set(),materials=new Set(),textures=new Set(),batches=new Map(),meshes=[],signs=[];
  const matrix=new THREE.Object3D(),white=new THREE.Color('#ffffff');let disposed=false;
  const geometry=(g)=>{geometries.add(g);return g;};
  const boxGeo=geometry(new THREE.BoxGeometry(1,1,1));
  const cylinderGeo=geometry(new THREE.CylinderGeometry(.5,.5,1,10));
  const umbrellaGeo=geometry(new THREE.ConeGeometry(.5,1,8));
  const makeMat=(name,roughness=.8,metalness=0)=>{
    const m=new THREE.MeshStandardMaterial({color:'#ffffff',roughness,metalness});
    m.name=`commercial-${name}`;materials.add(m);return m;
  };
  const matte=makeMat('paint'),metal=makeMat('metal',.52,.35),glass=makeMat('glass',.27,.22),inside=makeMat('window-dressing',.82),leaf=makeMat('planting',1),fabric=makeMat('fabric',.95);
  const tint=new THREE.Color();
  function instance(geo,material,color,x,y,z,w,h,d,yaw=0,detail=false,sourceId='',component=''){
    if(![x,y,z,w,h,d,yaw].every(Number.isFinite)||Math.min(w,h,d)<=0)return;
    // Keep distant street blocks independently cullable, while sharing a few
    // materials/primitive geometries rather than creating a draw per mullion.
    const tile=`${Math.floor(x/72)}/${Math.floor(z/72)}`;
    const key=`${geo.uuid}/${material.uuid}/${detail}/${tile}`;
    if(!batches.has(key))batches.set(key,{geo,material,detail,items:[],sources:new Set(),components:new Set()});
    const b=batches.get(key);matrix.position.set(x,y,z);matrix.rotation.set(0,yaw,0);matrix.scale.set(w,h,d);matrix.updateMatrix();
    tint.set(color||'#ffffff');b.items.push({matrix:matrix.matrix.clone(),color:tint.clone()});
    if(sourceId)b.sources.add(sourceId);if(component)b.components.add(component);
  }
  function frontBox(f,material,color,u,y,out,w,h,d,detail,component){
    const projection=f.maxProjection,scale=projection/.36;
    instance(boxGeo,material,color,f.x+f.tx*u+f.nx*out*scale,f.baseY+y,f.z+f.tz*u+f.nz*out*scale,w,h,d*scale,f.yaw,detail,f.sourceId,component);
  }
  for(const input of frontages){
    const n=Math.hypot(input.nx,input.nz),width=finite(input.width,0),height=finite(input.height,3.2);
    if(!n||!Number.isFinite(input.x)||!Number.isFinite(input.z)||width<1||height<1)continue;
    const nx=input.nx/n,nz=input.nz/n;
    const f={...input,nx,nz,tx:nz,tz:-nx,yaw:Math.atan2(nx,nz),width,height,baseY:finite(input.baseY,.14),maxProjection:clamp(finite(input.maxProjection,.30),.035,.36)};
    const brand=String(f.brand||'neutral').toLowerCase(),burger=/burger|汉堡|\bbk\b/.test(brand);
    const frame=f.frameColor||'#373c36',fascia=f.fasciaColor||(burger?'#453c33':'#6e746c'),wall=f.wallColor||(burger?'#996642':'#c8c4b1');
    const cap=clamp(height*.19,.38,.72),top=height-cap,glassTop=top-.16,glassBottom=.17,glassH=glassTop-glassBottom;
    const jamb=clamp(width*.025,.13,.28),insideW=width-jamb*2;
    frontBox(f,matte,wall,0,height/2,.11,width,height,.18,false,'shopfront-reveal');
    frontBox(f,inside,'#2e3934',0,glassBottom+glassH/2,.212,insideW,glassH,.022,false,'shopfront-dark-recess');
    frontBox(f,matte,fascia,0,top+cap/2,.22,width+.04,cap,.22,false,'shopfront-fascia');
    frontBox(f,metal,'#6d6253',0,height-.018,.25,width+.10,.055,.20,true,'shopfront-drip-edge');
    for(const side of[-1,1])frontBox(f,matte,wall,side*(width-jamb)/2,top/2,.235,jamb,top,.24,false,'shopfront-side-pier');
    frontBox(f,matte,'#8e9389',0,.07,.22,width,.14,.26,false,'shopfront-stone-sill');
    if(f.shutter){
      frontBox(f,matte,f.shutterColor||'#818980',0,glassBottom+glassH/2,.24,insideW,glassH,.035,false,'shopfront-roller-shutter');
      for(let y=.27;y<glassTop;y+=.14)frontBox(f,metal,'#68746c',0,y,.268,insideW,.017,.018,true,'shopfront-shutter-joints');
      frontBox(f,metal,'#525e55',0,.32,.296,.34,.045,.055,true,'shopfront-shutter-grip');
    }else{
      // Door sits between modest shop windows, with true narrow frame volumes.
      // Glazing remains opaque: slight reflection strips and shallow silhouettes
      // provide depth without overlapping transparent render passes.
      const doorW=clamp(width*.27,1.05,1.9),doorU=finite(f.doorOffset,insideW*.18);
      const left=-insideW/2,right=insideW/2,doorLeft=clamp(doorU-doorW/2,left+.28,right-doorW-.28),doorRight=doorLeft+doorW;
      const panels=[];
      for(const [a,b,isDoor]of[[left,doorLeft,false],[doorLeft,doorRight,true],[doorRight,right,false]]){
        if(b-a<.1)continue;
        const count=isDoor?2:Math.max(1,Math.ceil((b-a)/1.45));
        for(let i=0;i<count;i++)panels.push({u:a+(i+.5)*(b-a)/count,w:(b-a)/count,isDoor});
      }
      for(let i=0;i<panels.length;i++){
        const p=panels[i],darkGlass=i%3===0?'#41524b':i%3===1?'#35473f':'#4b5c52';
        frontBox(f,glass,darkGlass,p.u,glassBottom+glassH/2,.242,p.w-.035,glassH,.022,false,'shopfront-window-glass');
        // Reflections are subdued and below signage. They use physical offsets,
        // avoiding coplanar canvases and log-depth fighting near the camera.
        frontBox(f,glass,'#64766c',p.u,glassTop-.34,.263,p.w-.05,.10,.013,true,'shopfront-window-reflection');
        if(!p.isDoor){
          const warm=burger?'#b6a27b':'#a89977';
          frontBox(f,inside,warm,p.u,.62,.264,p.w-.13,.25,.015,true,'shopfront-window-counter');
          frontBox(f,inside,'#485448',p.u,.80,.267,p.w-.15,.035,.018,true,'shopfront-window-counter-top');
          for(const du of[-.18,.19]){
            frontBox(f,inside,'#747b65',p.u+du,1.00,.265,.075,.33,.014,true,'shopfront-window-silhouette');
            frontBox(f,inside,'#9d9c7b',p.u+du,1.17,.268,.11,.04,.016,true,'shopfront-window-silhouette');
          }
        }
        frontBox(f,metal,frame,p.u-p.w/2,glassBottom+glassH/2,.285,.045,glassH+.07,.12,false,'shopfront-mullion');
      }
      frontBox(f,metal,frame,right,glassBottom+glassH/2,.285,.045,glassH+.07,.12,false,'shopfront-mullion');
      for(const y of[glassBottom,glassTop])frontBox(f,metal,frame,0,y,.285,insideW,.055,.12,false,'shopfront-transom');
      frontBox(f,metal,frame,0,glassTop-.52,.285,insideW,.045,.10,true,'shopfront-transom');
      const middle=(doorLeft+doorRight)/2;
      for(const du of[-.10,.10]){
        frontBox(f,metal,'#b4b5a5',middle+du,1.14,.33,.024,.56,.045,true,'shopfront-door-handle');
        for(const y of[.89,1.39])frontBox(f,metal,'#b4b5a5',middle+du,y,.312,.024,.028,.07,true,'shopfront-handle-bracket');
      }
      frontBox(f,matte,'#5f6860',middle,.014,.22,doorW+.1,.018,.27,true,'shopfront-door-mat');
      // Small menus are just color/line blocks, not invented prices or notices.
      if(width>3.5){
        const menuU=left+Math.min(.72,(doorLeft-left)*.5);
        frontBox(f,inside,'#c3bda7',menuU,1.46,.274,.30,.46,.015,true,'shopfront-window-menu');
        for(let i=0;i<4;i++)frontBox(f,inside,'#6d6a53',menuU,1.60-i*.075,.286,.20,.012,.008,true,'shopfront-menu-lines');
      }
    }
    if(f.title)signs.push({...f,burger,cap,top,fascia});
  }

  for(const f of fixtures){
    if(!Number.isFinite(f.x)||!Number.isFinite(f.z))continue;
    const yaw=finite(f.yaw,0),base=finite(f.baseY,finite(f.y,.14)),sourceId=f.sourceId||'',c=Math.cos(yaw),s=Math.sin(yaw);
    const box=(geo,mat,color,u,y,v,w,h,d,detail=true)=>instance(geo,mat,color,f.x+c*u+s*v,base+y,f.z-s*u+c*v,w,h,d,yaw,detail,sourceId,`street-${f.type}`);
    if(f.type==='planter'){
      const w=finite(f.width,2.8),d=finite(f.depth,.62),h=finite(f.height,.57);
      box(boxGeo,matte,'#625044',0,h/2,0,w,h,d,false);box(boxGeo,matte,'#7a6655',0,h+.015,0,w+.06,.045,d+.05);
      box(boxGeo,inside,'#443e30',0,h+.04,0,w-.13,.035,d-.13);
      for(let i=0;i<Math.max(3,Math.floor(w/.32));i++){
        const n=Math.max(3,Math.floor(w/.32)),u=(i+.5)*w/n-w/2;
        box(cylinderGeo,leaf,i%2?'#69725a':'#53654e',u,h+.13,Math.sin(i*2.7)*d*.17,.27,.23,.27);
        if(i%3===0)box(cylinderGeo,leaf,'#8f8174',u,h+.27,0,.10,.07,.1);
      }
      for(const u of[-w/2+.1,w/2-.1])box(boxGeo,metal,'#4c453d',u,h/2,0,.065,h+.04,d+.025);
    }else if(f.type==='table'){
      box(cylinderGeo,metal,'#5d6659',0,.74,0,.72,.035,.72);box(cylinderGeo,metal,'#424c43',0,.38,0,.055,.72,.055);
      box(boxGeo,metal,'#424c43',0,.045,0,.58,.05,.05);box(boxGeo,metal,'#424c43',0,.045,0,.05,.05,.58);
      for(const dir of[-1,1]){
        box(cylinderGeo,metal,'#727566',dir*.70,.44,0,.37,.035,.37);
        for(const du of[-.12,.12])for(const dv of[-.12,.12])box(boxGeo,metal,'#4c574c',dir*.70+du,.23,dv,.022,.43,.022);
        box(boxGeo,metal,'#68705f',dir*.70,.68,-.16,.34,.30,.027);
      }
    }else if(f.type==='closed-umbrella'){
      box(boxGeo,matte,'#5b6258',0,.045,0,.55,.09,.55);box(cylinderGeo,metal,'#5e5c4d',0,1.3,0,.05,2.6,.05);
      box(umbrellaGeo,fabric,f.color||'#283a47',0,2.03,0,.42,1.48,.42);
      box(cylinderGeo,metal,'#726954',0,2.83,0,.055,.10,.055);
      box(cylinderGeo,matte,'#5b6254',0,1.78,0,.29,.035,.29);
    }
  }

  for(const b of batches.values()){
    const mesh=new THREE.InstancedMesh(b.geo,b.material,b.items.length);
    mesh.name=b.detail?'commercial-near-details':'commercial-frontage-structure';
    b.items.forEach((item,i)=>{mesh.setMatrixAt(i,item.matrix);mesh.setColorAt(i,item.color||white);});
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    mesh.computeBoundingSphere();mesh.receiveShadow=true;mesh.castShadow=!b.detail&&b.material!==glass;mesh.renderOrder=205;
    mesh.userData={component:'commercial-frontage-batch',detail:b.detail,sourceIds:[...b.sources],components:[...b.components],estimated:true};
    group.add(mesh);meshes.push({mesh,detail:b.detail});
  }

  // One shared canvas/texture and one merged quad mesh for all shop names.
  // Exact supplied text is drawn only once; no inferred tenant names are added.
  if(signs.length&&typeof document!=='undefined'){
    const canvas=document.createElement('canvas'),gutter=8;
    canvas.width=2048;
    // Each row uses the same pixels/metre horizontally and vertically. A
    // fixed-height 2048×192 tile stretched across a long fascia would turn
    // three Chinese characters into an oversized, wide billboard.
    let atlasY=0;
    const rows=signs.map(f=>{
      const worldWidth=f.width*.9,worldHeight=f.cap*.8,pixelsPerMetre=canvas.width/worldWidth;
      const pixelHeight=worldHeight*pixelsPerMetre,py=atlasY+gutter;
      atlasY+=Math.ceil(pixelHeight)+gutter*2;
      return{f,worldWidth,worldHeight,pixelsPerMetre,pixelHeight,py};
    });
    canvas.height=nextPow2(atlasY);
    const ctx=canvas.getContext('2d');
    if(ctx){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const positions=[],uvs=[],indices=[];
      const font='"Arial", "PingFang SC", "Microsoft YaHei", sans-serif';
      rows.forEach(({f,worldWidth,worldHeight,pixelsPerMetre:ppm,pixelHeight,py})=>{
        const centerY=py+pixelHeight/2;
        ctx.fillStyle=f.textColor||'#eeeadd';ctx.textAlign='center';ctx.textBaseline='middle';
        if(f.burger){
          // Photographed fascia: the roundel and English name share one line,
          // followed by a smaller Chinese name, rather than a translated stack.
          const english=String(f.subtitle||'BURGER KING'),chinese=String(f.title);
          let englishSize=Math.min(.48,f.cap*.70)*ppm,chineseSize=englishSize*.73;
          ctx.font=`800 ${englishSize}px ${font}`;let enWidth=ctx.measureText(english).width;
          ctx.font=`600 ${chineseSize}px ${font}`;let cnWidth=ctx.measureText(chinese).width;
          let diameter=Math.min(.49,f.cap*.69)*ppm,gap=.18*ppm;
          const fit=Math.min(1,(canvas.width-.50*ppm)/(diameter+enWidth+cnWidth+gap*2));
          englishSize*=fit;chineseSize*=fit;enWidth*=fit;cnWidth*=fit;diameter*=fit;gap*=fit;
          const start=(canvas.width-(diameter+enWidth+cnWidth+gap*2))/2;
          ctx.font=`800 ${englishSize}px ${font}`;ctx.fillText(english,start+diameter+gap+enWidth/2,centerY);
          ctx.font=`600 ${chineseSize}px ${font}`;ctx.fillText(chinese,start+diameter+gap*2+enWidth+cnWidth/2,centerY);
          const x=start+diameter/2,y=centerY,r=diameter/2;
          ctx.fillStyle='#c3b38c';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#ab4031';ctx.font=`800 ${diameter*.22}px ${font}`;ctx.fillText('BURGER',x,y-r*.22);ctx.fillText('KING',x,y+r*.25);
          ctx.fillStyle='#c58e45';ctx.fillRect(x-r*.62,y-r*.68,r*1.24,r*.11);ctx.fillRect(x-r*.56,y+r*.58,r*1.12,r*.11);
        }else{
          const label=String(f.title),withSub=!!f.subtitle;
          let size=Math.min(withSub?.34:.46,f.cap*(withSub?.48:.72))*ppm;
          ctx.font=`600 ${size}px ${font}`;size*=Math.min(1,(canvas.width-.6*ppm)/Math.max(1,ctx.measureText(label).width));
          ctx.font=`600 ${size}px ${font}`;ctx.fillText(label,canvas.width/2,centerY-(withSub?.10*ppm:0));
          if(withSub){ctx.font=`500 ${Math.min(.16,f.cap*.25)*ppm}px ${font}`;ctx.fillText(String(f.subtitle),canvas.width/2,centerY+.17*ppm);}
        }
        const halfW=worldWidth/2,halfH=worldHeight/2,out=f.maxProjection*.994,y=f.baseY+f.top+f.cap*.5;
        const start=positions.length/3;
        for(const[u,v]of[[-halfW,-halfH],[halfW,-halfH],[halfW,halfH],[-halfW,halfH]])positions.push(f.x+f.tx*u+f.nx*out,y+v,f.z+f.tz*u+f.nz*out);
        const v0=1-(py+pixelHeight)/canvas.height,v1=1-py/canvas.height;uvs.push(0,v0,1,v0,1,v1,0,v1);indices.push(start,start+1,start+2,start,start+2,start+3);
      });
      const atlas=new THREE.CanvasTexture(canvas);atlas.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=4;textures.add(atlas);
      const m=new THREE.MeshStandardMaterial({map:atlas,color:'#ffffff',roughness:.78,transparent:true,alphaTest:.10,depthWrite:false});materials.add(m);
      const g=geometry(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();
      const mesh=new THREE.Mesh(g,m);mesh.name='commercial-evidenced-shop-lettering';mesh.renderOrder=207;mesh.userData={component:'commercial-sign-atlas',glyphAspect:'isotropic-pixels-per-metre',labels:signs.map(s=>({id:s.id,title:s.title,subtitle:s.subtitle||'',sourceId:s.sourceId})),estimated:true};group.add(mesh);meshes.push({mesh,detail:false,lettering:true});
    }
  }
  const p=new THREE.Vector3();
  function update(camera,{detailDistanceScale=1}={}){
    const at=camera?.position||camera,scale=clamp(finite(detailDistanceScale,1),.35,1.5);
    for(const {mesh,detail,lettering}of meshes){
      if(!at){mesh.visible=true;continue;}
      const sphere=mesh.boundingSphere||mesh.geometry.boundingSphere;
      if(!sphere){mesh.visible=true;continue;}
      p.copy(sphere.center);mesh.localToWorld(p);
      const range=(detail?110:lettering?170:330)*scale+sphere.radius;
      mesh.visible=(p.x-at.x)**2+(p.z-at.z)**2<range*range;
    }
  }
  function dispose(){if(disposed)return;disposed=true;geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.removeFromParent();group.clear();}
  return{group,update,dispose,counts:{frontages:frontages.length,fixtures:fixtures.length,batches:meshes.length,signs:signs.length,textures:textures.size}};
}
