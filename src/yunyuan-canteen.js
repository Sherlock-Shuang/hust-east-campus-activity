/** The map supplies location and two storeys; street photos supply the curved
 * silhouette. This derived boundary is deliberately separate from source GIS.
 */
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
const shift=(p,v,s)=>({x:p.x+v.x*s,z:p.z+v.z*s});
const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
function edge(a,b){const length=distance(a,b),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;return{a,b,length,tx,tz,nx:-tz,nz:tx};}
function path(points){let length=0;const distances=[0];for(let i=1;i<points.length;i++){length+=distance(points[i-1],points[i]);distances.push(length);}return{points,distances,length};}
function at(p,s){s=Math.max(0,Math.min(p.length,s));let i=1;while(i<p.points.length-1&&p.distances[i]<s)i++;const e=edge(p.points[i-1],p.points[i]),q=mix(e.a,e.b,(s-p.distances[i-1])/e.length);return{...q,...e};}
function curve(a,b,bow,start=0,segments=64){const e=edge(a,b),points=[];for(let i=0;i<=segments;i++){const t=i/segments,u=Math.max(0,(t-start)/(1-start)),offset=bow*Math.sin(Math.PI*u)**2;points.push(shift(mix(a,b,t),{x:e.nx,z:e.nz},offset));}return path(points);}
function slice(p,from,to){const a=at(p,from),b=at(p,to);return path([{x:a.x,z:a.z},...p.points.filter((_,i)=>p.distances[i]>from&&p.distances[i]<to),{x:b.x,z:b.z}]);}

export function planCanteenBoundary(record){
  let ring=record.shapes[0].getPoints().map(p=>({x:p.x,z:-p.y}));if(distance(ring[0],ring.at(-1))<1e-6)ring.pop();
  const signed=ring.reduce((s,a,i)=>{const b=ring[(i+1)%ring.length];return s+a.x*b.z-b.x*a.z;},0);if(signed>0)ring.reverse();
  const edges=ring.map((a,i)=>({...edge(a,ring[(i+1)%ring.length]),index:i}));
  const south=edges.filter(e=>e.nz>.7&&e.length>20).sort((a,b)=>b.length-a.length)[0],east=edges.filter(e=>e.nx>.7&&e.length>25).sort((a,b)=>b.length-a.length)[0];
  if(!south||!east)return null;
  const west=edges.filter(e=>e.nx<-.7).sort((a,b)=>b.length-a.length)[0];
  const north=edges.filter(e=>e.nz<-.7).sort((a,b)=>b.length-a.length)[0];
  const mainSouth=shift(south.b,{x:south.tx,z:south.tz},-.35),mainEast=shift(east.a,{x:east.tx,z:east.tz},1.5);
  const southEnd=shift(mainSouth,{x:south.tx,z:south.tz},-6.6);
  const eastEnd=shift(north.a,{x:east.tx,z:east.tz},-5.1);
  const southGallery=curve(west.b,southEnd,2.1,.32),eastGallery=curve(mainEast,eastEnd,2.35);
  const adjacent=path([southEnd,mainSouth]),main=path([mainSouth,mainEast]),secondary=path([eastEnd,north.a]);
  const boundary=[west.a,...southGallery.points,...adjacent.points.slice(1),...main.points.slice(1),...eastGallery.points.slice(1),...secondary.points.slice(1)];
  return{ring,boundary,southGallery,eastGallery,adjacent,main,secondary,rear:[path([north.a,north.b]),path([west.a,west.b])],maxBow:2.35};
}

/** Photographed paved approaches contain no regular row of tall trees. */
export function inCanteenOpenForecourt(plan,point){
  if(!plan)return false;
  return [plan.southGallery,plan.eastGallery,plan.main,plan.adjacent].some(p=>{
    const e=edge(p.points[0],p.points.at(-1)),dx=point.x-e.a.x,dz=point.z-e.a.z;
    const along=dx*e.tx+dz*e.tz,out=dx*e.nx+dz*e.nz;
    return along>(p===plan.eastGallery?-22:-9)&&along<e.length+9&&out>-.4&&out<(p===plan.eastGallery?26:19);
  });
}

export function createPhotoCanteen(THREE,record,profile,evidence){
  const plan=planCanteenBoundary(record);if(!plan)return null;
  const group=new THREE.Group();group.name='yunyuan-canteen-street-reconstruction';
  group.userData={category:'building',feature:record.feature,featureId:record.id,component:'yunyuan-canteen',sourceFootprintPreserved:true,
    renderBoundary:'photo-refined-estimate',reconstructionMode:'curved-gallery-chamfered-entry',photos:evidence.photos,sourceUrl:evidence.sourceUrl,
    observed:evidence.observed,uncertainty:evidence.uncertainty,dimensions:'photo-estimated',sourceLevels:profile.sourceLevels,
    photoFacadeSides:['south','east'],galleryDepthEstimate:3.05,maximumFacadeBowEstimate:plan.maxBow,
    photoRefinedBoundary:plan.boundary,sourceBoundary:plan.ring,entranceType:'recessed side doors, low continuous threshold'};
  const base=(profile.baseHeight??0)+.08,h=profile.height,f=h/2;
  const unit=new THREE.BoxGeometry(1,1,1),batches=new Map(),materials=new Map(),dummy=new THREE.Object3D();
  function mat(color,roughness=.86,metalness=0){const key=`${color}/${roughness}/${metalness}`;if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness,metalness,side:THREE.DoubleSide}));return materials.get(key);}
  const cream=mat('#d2c1a0'),trim=mat('#d9d9cf'),grey=mat('#8c928c'),dark=mat('#44483e'),glass=mat('#334643',.27,.28),frame=mat('#a1aca3',.48,.35),navy=mat('#173743'),mint=mat('#468c79'),black=mat('#202a28'),stone=mat('#a8aaa0'),gold=mat('#ac935a',.56,.2);
  // Fine plaster grain, not an invented brick/tile facade photograph.
  const grainBytes=new Uint8Array(128*128*4);let seed=917;
  for(let i=0;i<128*128;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const value=242+(seed%13);grainBytes.set([value,value,value,255],i*4);}
  const plaster=new THREE.DataTexture(grainBytes,128,128,THREE.RGBAFormat);plaster.wrapS=plaster.wrapT=THREE.RepeatWrapping;plaster.minFilter=THREE.LinearMipmapLinearFilter;plaster.generateMipmaps=true;plaster.colorSpace=THREE.SRGBColorSpace;plaster.needsUpdate=true;
  cream.map=plaster;cream.bumpMap=plaster;cream.bumpScale=.004;cream.addEventListener('dispose',()=>plaster.dispose());
  function mesh(name,geometry,material){const o=new THREE.Mesh(geometry,material);o.name=name;o.castShadow=true;o.receiveShadow=true;o.renderOrder=205;o.userData={...group.userData,component:name};group.add(o);return o;}
  function box(name,material,x,y,z,sx,sy,sz,yaw=0){const key=`${name}/${material.uuid}`;if(!batches.has(key))batches.set(key,{name,material,items:[]});dummy.position.set(x,y,z);dummy.rotation.set(0,yaw,0);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();batches.get(key).items.push(dummy.matrix.clone());}
  function put(p,s,name,material,y,out,w,height,depth){const q=at(p,s);box(name,material,q.x+q.nx*out,y,q.z+q.nz*out,w,height,depth,-Math.atan2(q.tz,q.tx));}
  function shape(points){return new THREE.Shape(points.map(p=>new THREE.Vector2(p.x,-p.z)));}
  function solid(name,points,y,height,material){const g=new THREE.ExtrudeGeometry(shape(points),{depth:height,bevelEnabled:false,curveSegments:1,steps:1});g.rotateX(-Math.PI/2);g.translate(0,y,0);return mesh(name,g,material);}
  function band(name,p,y,height,front,back,material){const offsets=amount=>p.points.map((q,i)=>{const a=p.points[Math.max(0,i-1)],b=p.points[Math.min(p.points.length-1,i+1)],e=edge(a,b);return{x:q.x+e.nx*amount,z:q.z+e.nz*amount};});return solid(name,[...offsets(front),...offsets(back).reverse()],y,height,material);}
  // Every horizontal silhouette follows the same curved boundary. The raw map
  // shape remains unchanged and available for source/collision inspection.
  solid('canteen-source-ground-slab',plan.ring,base,.13,stone);
  solid('canteen-photo-upper-slab',plan.boundary,base+f-.24,.24,trim);
  solid('canteen-photo-roof-slab',plan.boundary,base+h-.28,.28,grey);
  solid('canteen-photo-roof-surface',plan.boundary,base+h,.055,stone);
  const fronts=[plan.southGallery,plan.eastGallery];
  for(const [side,p]of fronts.entries()){
    band('canteen-gallery-walking-platform',p,base+.02,.15,.7,-3.2,stone);
    band('canteen-recessed-shopfront',p,base+.35,f-1.32,-1.04,-1.15,glass);
    band('canteen-shopfront-fascia',p,base+f-1.05,.63,-.86,-1.18,navy);
    band('education-market-fascia-green-edge',p,base+f-1.06,.065,-.80,-.91,mint);
    band('canteen-upper-gallery-back-wall',p,base+f+.14,f-.5,-3.05,-3.24,dark);
    band('canteen-upper-solid-parapet',p,base+f+.12,.87,.12,-.14,cream);
    for(const [y,height,front,back,m]of[
      [base+f-.20,.33,.30,-.30,trim],[base+f+.01,.07,.36,-.31,grey],
      [base+f+.96,.11,.22,-.23,trim],[base+h-.59,.20,.27,-.20,trim],
      [base+h-.39,.22,.43,-.28,grey],[base+h-.16,.16,.57,-.25,trim],
      [base+h+.02,.08,.61,-.25,trim]])band('canteen-curved-cornice',p,y,height,front,back,m);
    const bays=Math.round(p.length/5.8),pitch=p.length/bays;
    for(let i=0;i<=bays;i++){
      const s=Math.min(p.length-.15,Math.max(.15,i*pitch));
      put(p,s,'canteen-open-gallery-columns',trim,base+h/2,0,.49,h-.28,.60);
      put(p,s,'canteen-column-footings',stone,base+.32,.02,.60,.44,.71);
      put(p,s,'canteen-column-capitals',trim,base+h-.66,.03,.67,.17,.76);
    }
    for(let i=0;i<bays;i++){
      const s=(i+.5)*pitch;
      put(p,s,'canteen-upper-interior-door-reveals',grey,base+f+1.71,-2.94,1.99,2.92,.13);
      put(p,s,'canteen-upper-interior-doorways',black,base+f+1.70,-2.85,1.78,2.72,.065);
      put(p,s,'canteen-gallery-ceiling-panels',trim,base+h-.38,-1.62,1.50,.045,.25);
    }
    // Fine glazing is confined to the curved bay next to the large tower.
    const glazed=side===0?slice(p,p.length-pitch-1.0,p.length-.15):slice(p,.15,pitch+.15);
    band('canteen-recessed-upper-glazing',glazed,base+f+1.04,f-1.66,-.63,-.71,glass);
    for(let s=.05;s<glazed.length;s+=.88)put(glazed,s,'canteen-curved-bay-mullions',frame,base+f+(f+.4)/2,-.56,.055,f-1.65,.065);
    for(const y of[base+f+1.04,base+f+2.1,base+f+3.16])band('canteen-curved-bay-transoms',glazed,y,.05,-.55,-.63,frame);
    for(let s=.6;s<p.length;s+=1.23){
      put(p,s,'canteen-ground-door-mullions',frame,base+(f-.77)/2,-.97,.052,f-1.26,.07);
    }
    band('canteen-ground-window-transom',p,base+2.87,.065,-.96,-1.02,frame);
    // Real entrances sit behind the columns, with a low sill rather than
    // invented stairs/handrails repeated on every photographed elevation.
    const entry=p.length*.40;
    put(p,entry,'education-market-door-reveal',black,base+1.6,-.94,4.9,2.85,.16);
    for(const d of[-1.22,1.22]){
      put(p,entry+d,'education-market-glass-doors',glass,base+1.58,-.81,2.35,2.76,.07);
      for(const v of[-1.14,1.14])put(p,entry+d+v,'education-market-door-jambs',frame,base+1.58,-.75,.055,2.8,.07);
      for(const v of[-.10,.10])put(p,entry+d+v,'education-market-door-handles',frame,base+1.38,-.64,.032,.65,.035);
    }
    put(p,entry,'education-market-low-threshold',stone,base+.20,-.48,5.3,.18,1.48);
    textOnPath(p,entry,'喻园教育超市','education-market-readable-sign',base+f-.73,-.68,8.5,.55,'#d9e4df','#153743');
    roofLetters(p,p.length*.44,base+h+.91);
    for(const s of[p.length*.13,p.length*.69]){
      put(p,s,'canteen-roof-ventilators',cream,base+h+.66,-1.3,.97,1.25,1.08);
      for(let i=0;i<4;i++)put(p,s,'canteen-ventilator-louvres',dark,base+h+.47+i*.13,-.74,.75,.055,.045);
      put(p,s,'canteen-ventilator-caps',trim,base+h+1.32,-1.3,1.10,.12,1.21);
    }
  }
  for(const p of plan.rear){
    band('canteen-secondary-wall',p,base+.12,h-.25,0,-.26,cream);
    band('canteen-secondary-cornice',p,base+h-.34,.36,.35,-.26,trim);
    for(let s=2.5;s<p.length-1;s+=5.2)for(const y of[base+f*.55,base+f*1.55]){
      put(p,s,'canteen-secondary-window-reveals',trim,y,.07,1.65,1.95,.12);
      put(p,s,'canteen-secondary-window-glazing',glass,y,.15,1.43,1.72,.06);
      put(p,s,'canteen-secondary-window-mullions',frame,y,.2,.05,1.72,.05);
    }
  }
  // The three slender windows belong to the solid bay on one side of the
  // primary tower. They are not mirrored onto the other gallery.
  band('canteen-entry-adjacent-solid-panel',plan.adjacent,base+.15,h+.33,.13,-2.8,cream);
  for(const [y,height,out,m]of[[h-.22,.10,.29,trim],[h-.10,.08,.34,grey],[h,.16,.40,trim],[h+.16,.48,.50,grey],[h+.64,.14,.57,trim]])band('canteen-adjacent-cornice',plan.adjacent,base+y,height,out,-3,m);
  band('canteen-adjacent-floor-band',plan.adjacent,base+f-.22,.29,.26,-.1,trim);
  for(const s of[1.3,3.3,5.3]){
    put(plan.adjacent,s,'canteen-entry-narrow-window-reveals',trim,base+f+2.15,.22,.78,2.18,.13);
    put(plan.adjacent,s,'canteen-entry-narrow-window-glazing',glass,base+f+2.15,.30,.59,1.98,.05);
    put(plan.adjacent,s,'canteen-entry-narrow-window-transoms',frame,base+f+2.48,.35,.59,.05,.05);
  }
  for(const s of[1.0,3.0,5.0]){
    put(plan.adjacent,s,'canteen-high-roof-stacks',cream,base+h+1.43,-1.55,.66,1.46,.78);
    put(plan.adjacent,s,'canteen-high-stack-caps',trim,base+h+2.20,-1.55,.79,.12,.90);
    for(let i=0;i<3;i++)put(plan.adjacent,s,'canteen-high-stack-slits',dark,base+h+1.05+i*.23,-1.13,.42,.10,.035);
  }
  put(plan.adjacent,2.4,'canteen-side-entrance-glazing',glass,base+1.76,.23,3.7,3.15,.10);
  for(const s of[.58,2.4,4.22])put(plan.adjacent,s,'canteen-side-entrance-frames',frame,base+1.76,.30,.06,3.15,.07);
  put(plan.adjacent,2.4,'canteen-side-entrance-threshold',stone,base+.19,.53,4.3,.17,1.18);
  put(plan.adjacent,5.5,'canteen-entry-equipment-housing',grey,base+2.03,.36,1.7,1.14,.25);
  for(let i=0;i<8;i++)put(plan.adjacent,5.5,'canteen-entry-equipment-grille-slats',dark,base+1.56+i*.135,.51,1.56,.043,.045);
  tower(plan.main,true);tower(plan.secondary,false);
  function tower(p,main){
    const top=main?h+1.25:h+.65,w=p.length;
    band(main?'canteen-main-entry-tower':'canteen-secondary-entry-tower',p,base+.14,top,.23,-2.8,cream);
    band('canteen-tower-plinth',p,base+.12,.46,.34,-.2,stone);
    const q=at(p,w/2),diamondWidth=main?.94:.70,diamondHeight=main?1.35:1.10,cy=base+(main?h-1.35:h-1.20);
    const diamond=new THREE.Shape([new THREE.Vector2(0,diamondHeight),new THREE.Vector2(diamondWidth,0),new THREE.Vector2(0,-diamondHeight),new THREE.Vector2(-diamondWidth,0)]);
    const pane=mesh(main?'canteen-main-diamond-window':'canteen-secondary-diamond-window',new THREE.ShapeGeometry(diamond),glass);
    pane.position.set(q.x+q.nx*.29,cy,q.z+q.nz*.29);pane.rotation.y=Math.atan2(q.nx,q.nz);
    const surround=mesh('canteen-diamond-window-surround',new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0,diamondHeight,0),new THREE.Vector3(diamondWidth,0,0),new THREE.Vector3(0,-diamondHeight,0),new THREE.Vector3(-diamondWidth,0,0),new THREE.Vector3(0,diamondHeight,0)],false,'catmullrom',0),4,.065,6,false),trim);
    surround.position.copy(pane.position);surround.position.add(new THREE.Vector3(q.nx*.04,0,q.nz*.04));surround.rotation.y=pane.rotation.y;
    if(main){
      put(p,w/2,'canteen-entry-dark-display-frame',grey,base+3.92,.35,3.70,3.55,.15);
      put(p,w/2,'canteen-entry-dark-display',black,base+3.92,.45,3.48,3.33,.07);
      put(p,w/2,'canteen-main-service-grille',grey,base+1.18,.39,w-.65,1.65,.20);
      for(let i=0;i<11;i++)put(p,w/2,'canteen-main-service-louvres',dark,base+.47+i*.14,.51,w-.85,.055,.045);
      for(const side of[-1,1]){
        const s=w/2+side*2.37;
        put(p,s,'canteen-main-equipment-casings',trim,base+3.46,.4,.70,1.32,.29);
        for(let row=0;row<7;row++)put(p,s,'canteen-main-equipment-vents',grey,base+3.05+row*.13,.56,.49,.047,.035);
      }
      put(p,w/2+.28,'canteen-roof-antenna',grey,base+h+2.55,-.5,.045,3.05,.045);
      for(const s of[w/2-1.08,w/2+1.08])put(p,s,'canteen-entry-tower-uprights',grey,base+h+.68,.41,.08,2.8,.12);
      for(let i=0;i<5;i++)put(p,w/2,'canteen-entry-tower-cross-bars',frame,base+h-.16+i*.44,.48,2.75,.065,.20);
      canopy(p,base+top+.06,7.4,3.6,true);
    }else canopy(p,base+top+.04,w+1.05,2.9,false);
  }
  function canopy(p,y,width,depth,main){
    const q=at(p,p.length/2),vertices=[],indices=[],n=40;
    // A continuous thin concrete shell, outer tips raised on the main tower.
    // The far tower has a much quieter convex cap, as seen at the end of the wing.
    for(let side=0;side<2;side++)for(let i=0;i<=n;i++)for(const d of[-depth/2,depth/2]){
      const x=(i/n-.5)*width,r=x/(width/2),rise=main?1.04*Math.pow(Math.abs(r),1.45):.45*(1-r*r);
      vertices.push(q.x+q.tx*x+q.nx*(d-.6),y+rise-side*.13,q.z+q.tz*x+q.nz*(d-.6));
    }
    const layer=(n+1)*2;
    for(let i=0;i<n;i++){const a=i*2,b=a+2;indices.push(a,a+1,b,b,a+1,b+1,layer+a,layer+b,layer+a+1,layer+b,layer+b+1,layer+a+1);for(const k of[0,1])indices.push(a+k,b+k,layer+a+k,b+k,layer+b+k,layer+a+k);}
    indices.push(0,layer,1,1,layer,layer+1,n*2,n*2+1,layer+n*2,n*2+1,layer+n*2+1,layer+n*2);
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();
    const o=mesh(main?'canteen-butterfly-shell-canopy':'canteen-secondary-arched-canopy',geo,main?grey:cream);o.userData.shellThicknessEstimate=.13;o.userData.centralHeight=y;o.userData.span=width;
  }
  function textOnPath(p,s,text,name,y,out,width,height,color,background){
    if(typeof document==='undefined')return;
    const canvas=document.createElement('canvas');canvas.width=text.length===1?128:1024;canvas.height=128;const ctx=canvas.getContext('2d');if(!ctx)return;
    if(background){ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,128);}ctx.font='600 84px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,canvas.width/2,65);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const m=new THREE.MeshStandardMaterial({map:texture,roughness:.72,transparent:!background,alphaTest:.15,side:THREE.DoubleSide});m.addEventListener('dispose',()=>texture.dispose());
    const q=at(p,s),o=mesh(name,new THREE.PlaneGeometry(width,height),m);o.position.set(q.x+q.nx*out,y,q.z+q.nz*out);o.rotation.y=Math.atan2(q.nx,q.nz);
  }
  function roofLetters(p,s,y){
    const letters=[...'韵苑学生食堂'],pitch=2.35;
    for(let i=0;i<letters.length;i++){
      const u=s+(i-2.5)*pitch;
      textOnPath(p,u,letters[i],'canteen-roof-name',y,.01,1.54,1.38,'#ac945b');
      put(p,u,'canteen-roof-letter-supports',grey,y-.64,-.13,.035,.53,.045);
    }
  }
  for(const{name,material,items}of batches.values()){
    const o=new THREE.InstancedMesh(unit,material,items.length);o.name=name;items.forEach((m,i)=>o.setMatrixAt(i,m));o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();o.castShadow=true;o.receiveShadow=true;o.renderOrder=205;o.userData={...group.userData,component:name,instanceCount:items.length};group.add(o);
  }
  return group;
}
