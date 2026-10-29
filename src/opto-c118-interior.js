/**
 * C118 report hall, reconstructed from a named, publicly documented C118 event.
 * Colours and stage silhouette are photo observations; dimensions/row count are
 * configurable visual estimates, not a survey or a fire-safety seating plan.
 * Local metres: +Y up, stage -Z, photo-visible left audience door -X/-Z.
 */
export const OPTO_C118_EVIDENCE = Object.freeze({
  id: 'opto-c118', name: '光电信息大楼 C118 报告厅',
  confidence: 'photo-informed-approximation',
  photo: 'https://yurenhao.sizhengwang.cn/upload/resources/image/2024/06/19/6882948.jpg',
  sources: [
    'https://wnlo.hust.edu.cn/info/1090/12515.htm',
    'https://news.hust.edu.cn/info/1004/49824.htm',
    'https://news.hust.edu.cn/info/1002/52408.htm',
    'https://wnlo.hust.edu.cn/info/1374/4231.htm',
  ],
  observed: [
    '浅金木饰面舞台框与弧形前缘、两侧短阶梯',
    '台后中央大屏、上部长条信息屏、左右悬吊白色阵列音箱',
    '浅灰侧墙、前部两侧双扇门、舞台后侧小门',
    '木质椅背与深红软垫、前排长桌、嵌入式顶灯',
  ],
  uncertain: [
    '房间尺寸、准确排数和座位数、后半厅轮廓及高差未取得测绘资料',
    'C区外门到C118的精确走廊路径尚未核实，室内使用独立按需加载空间',
  ],
});

const DEFAULTS = Object.freeze({ width: 22, depth: 34, height: 9.6, rows: 20,
  centreSeats: 18, sideSeats: 4, seatPitch: .57, rowPitch: 1.05,
  rowRise: .12, aisleWidth: 1.5, stageHeight: .72, floorY: .14 });
const rect = (x0,z0,x1,z1) => [{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
const finite = (v, min, max, name) => {
  if (!Number.isFinite(v) || v < min || v > max) throw new RangeError(`${name} must be ${min}…${max}`);
  return v;
};

/** Serializable metre-based navigation and furniture plan, independent of Three/DOM. */
export function planOptoC118Interior(options = {}) {
  const c = {...DEFAULTS,...options};
  for (const [name,min,max] of [['width',20,40],['depth',30,55],['height',8,15],['rows',10,26],
    ['centreSeats',12,22],['sideSeats',2,6],['seatPitch',.52,.66],['rowPitch',1,1.3],
    ['rowRise',0,.18],['aisleWidth',1.2,2.4],['stageHeight',.45,.9],['floorY',.14,2]]) finite(c[name],min,max,name);
  for (const name of ['rows','centreSeats','sideSeats']) if (!Number.isInteger(c[name])) throw new RangeError(`${name} must be an integer`);
  const halfW=c.width/2,halfD=c.depth/2, front=-halfD, back=halfD;
  const stageFront=front+7,stageBack=front+.5,stageHalfW=halfW-2.1;
  const firstRow=stageFront+3.1,lastRow=firstRow+(c.rows-1)*c.rowPitch;
  if(lastRow+1.7>back)throw new RangeError('Rows leave insufficient rear circulation space');
  const centreHalf=c.centreSeats*c.seatPitch/2;
  const sideInner=centreHalf+c.aisleWidth,sideOuter=sideInner+c.sideSeats*c.seatPitch;
  if(halfW-sideOuter<1.15)throw new RangeError('Seating leaves insufficient side circulation space');
  const blocks=[{id:'left',x0:-sideOuter,x1:-sideInner,count:c.sideSeats},
    {id:'centre',x0:-centreHalf,x1:centreHalf,count:c.centreSeats},
    {id:'right',x0:sideInner,x1:sideOuter,count:c.sideSeats}];
  const seats=[],seatRows=[],colliders=[],walkSurfaces=[];
  const floor=(id,polygon,surfaceY)=>walkSurfaces.push({id,polygon,surfaceY,sourceId:'opto-c118'});
  const solid=(id,polygon,minHeight,height)=>colliders.push({id,sourceId:'opto-c118',label:'C118报告厅',polygon,minHeight,height});
  floor('c118-base-floor',rect(-halfW,front,halfW,back),c.floorY);
  const stagePolygon=[{x:-stageHalfW,z:stageBack},{x:stageHalfW,z:stageBack},{x:stageHalfW,z:stageFront}];
  for(let i=1;i<=24;i++){const x=stageHalfW-2*stageHalfW*i/24;stagePolygon.push({x,z:stageFront+.62*(1-(x/stageHalfW)**2)});}
  floor('c118-stage',stagePolygon,c.floorY+c.stageHeight);
  // Short treads beside the stage exactly match the visible geometry. No invisible ramp.
  const stairCount=Math.ceil(c.stageHeight/.18),stairs=[];
  for(const sign of [-1,1]) for(let i=0;i<stairCount;i++){
    const z=stageFront+.8-i*.36, y=c.floorY+(i+1)*c.stageHeight/stairCount;
    const polygon=rect(sign<0?-halfW+.9:stageHalfW, z-.36,sign<0?-stageHalfW:halfW-.9,z);
    stairs.push({id:`c118-stage-stair-${sign}-${i}`,polygon,surfaceY:y});floor(stairs.at(-1).id,polygon,y);
  }
  for(let row=0;row<c.rows;row++){
    const z=firstRow+row*c.rowPitch,y=c.floorY+row*c.rowRise;
    const startZ=z-c.rowPitch*.5,endZ=row===c.rows-1?back:z+c.rowPitch*.5;
    floor(`c118-audience-tier-${row}`,rect(-halfW,startZ,halfW,endZ),y);
    seatRows.push({row,z,y,startZ,endZ});
    for(const block of blocks){
      solid(`c118-seats-${block.id}-${row}`,rect(block.x0,z-.33,block.x1,z+.35),y,y+1.05);
      for(let col=0;col<block.count;col++)seats.push({row,column:col,block:block.id,x:block.x0+(col+.5)*c.seatPitch,z,y});
    }
  }
  for(const block of blocks){
    const z=firstRow-.67;
    solid(`c118-front-table-${block.id}`,rect(block.x0,z-.21,block.x1,z+.21),c.floorY,c.floorY+.78);
  }
  // Both front audience doors are observed. Their clear openings are left empty.
  const doorZ=stageFront+1.5,doorHalf=1.1;
  solid('c118-front-wall',rect(-halfW-.18,front-.18,halfW+.18,front+.1),c.floorY,c.floorY+c.height);
  solid('c118-rear-wall',rect(-halfW-.18,back-.1,halfW+.18,back+.18),c.floorY,c.floorY+c.height);
  for(const sign of [-1,1]){
    const x=sign*halfW;
    solid(`c118-side-front-${sign}`,rect(x-.15,front,x+.15,doorZ-doorHalf),c.floorY,c.floorY+c.height);
    solid(`c118-side-rear-${sign}`,rect(x-.15,doorZ+doorHalf,x+.15,back),c.floorY,c.floorY+c.height);
    // External portal recess contains the player until the runtime handles return.
    floor(`c118-door-recess-${sign}`,rect(sign<0?-halfW-1.6:halfW,doorZ-doorHalf,sign<0?-halfW:halfW+1.6,doorZ+doorHalf),c.floorY);
  }
  // Stage fascia is solid except the side treads; stage itself remains walkable.
  const fascia=stagePolygon.slice(2).map(p=>({...p}));
  solid('c118-stage-front', [...fascia,...fascia.slice().reverse().map(p=>({x:p.x,z:p.z-.12}))],c.floorY,c.floorY+c.stageHeight);
  solid('c118-lectern',rect(-stageHalfW+2.8,stageFront-1.75,-stageHalfW+3.55,stageFront-1.1),c.floorY+c.stageHeight,c.floorY+c.stageHeight+1.12);
  const spawn={x:-halfW+1.05,y:c.floorY,z:doorZ,yaw:-1.1,pitch:.06};
  const exit={id:'c118-return',x:-halfW-.15,y:c.floorY,z:doorZ,radius:1.15,
    polygon:rect(-halfW-1.5,doorZ-1.1,-halfW+.15,doorZ+1.1)};
  return {id:'opto-c118',config:c,evidence:OPTO_C118_EVIDENCE,dimensions:'photo-estimate',
    bounds:{minX:-halfW-1.6,maxX:halfW+1.6,minZ:front,maxZ:back,minY:c.floorY,maxY:c.floorY+c.height},
    stage:{polygon:stagePolygon,front:stageFront,back:stageBack,halfWidth:stageHalfW,height:c.floorY+c.stageHeight},
    doors:[{x:-halfW,z:doorZ,width:2.2},{x:halfW,z:doorZ,width:2.2}],
    seats,seatRows,blocks,stairs,colliders,walkSurfaces,spawn,exit,
    viewpoints:{entry:{...spawn},front:{x:0,y:c.floorY,z:stageFront+1.55,yaw:0,pitch:.14},
      rear:{x:centreHalf+c.aisleWidth/2,y:c.floorY+(c.rows-1)*c.rowRise,z:lastRow+1,yaw:0,pitch:-.12}},
    seatCount:seats.length,layoutEstimated:true};
}

/** No document/canvas, fetch, timer, input bindings or source-map mutations. */
export function createOptoC118Interior(THREE,options={}) {
  const plan=planOptoC118Interior(options),c=plan.config;
  const group=new THREE.Group();group.name='opto-c118-photo-reconstruction';
  group.userData={landmarkId:plan.id,evidence:OPTO_C118_EVIDENCE,dimensions:plan.dimensions,
    estimatedSeatCount:plan.seatCount,photoTexturesUsed:false,walkSurfaces:plan.walkSurfaces,collisionBarriers:plan.colliders};
  const geometries=new Set(),materials=new Set(),textures=new Set(),batches=new Map();
  const ownGeo=g=>(geometries.add(g),g),ownMat=m=>(materials.add(m),m);
  const mat=(color,roughness=.8,more={})=>ownMat(new THREE.MeshStandardMaterial({color,roughness,...more}));
  const wood=mat('#c6a36d'),lightWood=mat('#d6b784'),darkWood=mat('#745439'),woodJoint=mat('#927447');
  const wall=mat('#a8adac'),wallPanel=mat('#bac1c0'),ceiling=mat('#c9cdca'),carpet=mat('#878a78');
  const red=mat('#6f2032'),seatRed=mat('#8d2a40'),metal=mat('#52545a',.65,{metalness:.3});
  const white=mat('#deded5'),black=mat('#171d21'),screen=mat('#172b41',.7,{emissive:'#10335b',emissiveIntensity:.8});
  const glow=mat('#fff2cf',.4,{emissive:'#fff1d6',emissiveIntensity:2});
  const green=mat('#a1f5bc',.6,{emissive:'#32c273',emissiveIntensity:1.2});
  // Tiny deterministic material maps: authored grain, never downloaded photo textures.
  // DataTexture works in node tests and requires no document or canvas.
  const grainTexture=(kind)=>{
    const size=128,data=new Uint8Array(size*size*4);let seed=kind==='wood'?851:kind==='fabric'?411:97;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=(y*size+x)*4,noise=rand();let v;
      if(kind==='wood'){
        const drift=1.7*Math.sin(y*.065)+.8*Math.sin(y*.21);
        const grain=Math.sin((x+drift)*.83)+.34*Math.sin((x+drift)*2.7);
        v=220+grain*11+(noise-.5)*9;
      }else if(kind==='fabric')v=219+(noise-.5)*20+((x+y)%2)*12;
      else v=229+(noise-.5)*19-((x%8===0&&y%8===0)?19:0);
      data[i]=data[i+1]=data[i+2]=Math.max(0,Math.min(255,v));data[i+3]=255;
    }
    const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;
    t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;
    t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;textures.add(t);return t;
  };
  const woodMap=grainTexture('wood'),wallMap=grainTexture('acoustic'),clothMap=grainTexture('fabric');
  woodMap.repeat.set(5,2);wallMap.repeat.set(10,8);clothMap.repeat.set(12,12);
  for(const material of [wood,lightWood,darkWood]){material.map=woodMap;material.bumpMap=woodMap;material.bumpScale=.003;}
  for(const material of [wall,wallPanel,ceiling]){material.map=wallMap;material.bumpMap=wallMap;material.bumpScale=.0015;}
  for(const material of [red,seatRed,carpet]){material.map=clothMap;material.bumpMap=clothMap;material.bumpScale=.002;}
  const boxGeometry=ownGeo(new THREE.BoxGeometry(1,1,1)),cylinder=ownGeo(new THREE.CylinderGeometry(1,1,1,8));
  const roundedShape=new THREE.Shape(),r=.12;
  roundedShape.moveTo(-.5+r,-.5);roundedShape.lineTo(.5-r,-.5);roundedShape.quadraticCurveTo(.5,-.5,.5,-.5+r);
  roundedShape.lineTo(.5,.5-r);roundedShape.quadraticCurveTo(.5,.5,.5-r,.5);
  roundedShape.lineTo(-.5+r,.5);roundedShape.quadraticCurveTo(-.5,.5,-.5,.5-r);
  roundedShape.lineTo(-.5,-.5+r);roundedShape.quadraticCurveTo(-.5,-.5,-.5+r,-.5);
  const roundedSeat=ownGeo(new THREE.ExtrudeGeometry(roundedShape,{depth:1,bevelEnabled:false,curveSegments:3}));roundedSeat.translate(0,0,-.5);
  const dummy=new THREE.Object3D();
  const batch=(name,geometry,material,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0)=>{
    const key=`${name}:${material.uuid}:${geometry.uuid}`;
    if(!batches.has(key))batches.set(key,{name,geometry,material,matrices:[]});
    dummy.position.set(x,y,z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(rx,ry,rz);dummy.updateMatrix();
    batches.get(key).matrices.push(dummy.matrix.clone());
  };
  const box=(name,m,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0)=>batch(name,boxGeometry,m,x,y,z,sx,sy,sz,rx,ry,rz);
  const pole=(name,m,x,y,z,r,h,rx=0,rz=0)=>batch(name,cylinder,m,x,y,z,r,h,r,rx,0,rz);
  const mesh=(name,geometry,material)=>{const o=new THREE.Mesh(ownGeo(geometry),material);o.name=name;o.receiveShadow=true;group.add(o);return o;};
  const shape=(polygon,depth)=>{
    const s=new THREE.Shape();polygon.forEach((p,i)=>i?s.lineTo(p.x,-p.z):s.moveTo(p.x,-p.z));s.closePath();
    const g=new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);return g;
  };
  const W=c.width/2,D=c.depth/2,top=c.floorY+c.height;
  const floor=mesh('c118-floor',new THREE.BoxGeometry(c.width,.16,c.depth),carpet);floor.position.y=c.floorY-.08;
  const stage=mesh('c118-curved-stage',shape(plan.stage.polygon,c.stageHeight),lightWood);stage.position.y=c.floorY;
  for(const s of plan.stairs){const [a,,b]=s.polygon;box('c118-stage-stairs',lightWood,(a.x+b.x)/2,(c.floorY+s.surfaceY)/2,(a.z+b.z)/2,b.x-a.x,s.surfaceY-c.floorY,b.z-a.z);
    box('c118-step-nosings',wood,(a.x+b.x)/2,s.surfaceY+.012,b.z-.025,b.x-a.x,.024,.05);}
  for(const r of plan.seatRows)if(r.row>0)box('c118-audience-terraces',carpet,0,(c.floorY+r.y)/2,(r.startZ+r.endZ)/2,c.width,r.y-c.floorY,r.endZ-r.startZ);
  // Front frame: its tall, continuous warm wood silhouette is the strongest photo cue.
  const stageWidth=plan.stage.halfWidth*2;
  box('c118-stage-back',wood,0,(c.floorY+top)/2,-D+.1,c.width,.01+c.height,.2);
  box('c118-proscenium-header',wood,0,top-.8,plan.stage.front-1.1,c.width-1.5,1.6,.7);
  for(const sign of [-1,1]){
    box('c118-stage-wings',wood,sign*(plan.stage.halfWidth+.38),c.floorY+c.height/2,(plan.stage.back+plan.stage.front-1.3)/2,.76,c.height,plan.stage.front-plan.stage.back-1.3);
    for(let j=0;j<7;j++)box('c118-stage-panel-joints',woodJoint,sign*(plan.stage.halfWidth-.015),c.floorY+c.height/2,plan.stage.back+j*.9,.014,c.height,.012);
  }
  // Large screen and restrained, original optics graphic; no event portrait/photo reuse.
  const screenZ=-D+.31,screenY=c.floorY+4.55,screenW=8.45,screenH=4.75;
  box('c118-screen-frame',black,0,screenY,screenZ,screenW+.16,screenH+.16,.12);
  box('c118-led-screen',screen,0,screenY,screenZ+.072,screenW,screenH,.025);
  // Thin concentric optical rings make the empty stage screen legible without baked text.
  const ringMat=ownMat(new THREE.MeshBasicMaterial({color:'#54768b'}));
  for(let i=0;i<3;i++){
    const o=mesh('c118-screen-optics-ring',new THREE.TorusGeometry(.52+i*.29,.014,4,64),ringMat);
    o.position.set(2.1,screenY,screenZ+.095);
  }
  for(let i=0;i<5;i++)box('c118-screen-graphic-lines',ringMat,-1.7,screenY+.65-i*.3,screenZ+.095,3.2-(i%2)*.6,.025,.018);
  box('c118-banner-black',black,0,top-1.8,plan.stage.front-.7,stageWidth-1.1,.62,.08);
  for(let i=0;i<13;i++)box('c118-banner-status',glow,-3.8+i*.64,top-1.8,plan.stage.front-.65,.3,.06,.016);
  // Photo-visible backstage doors: set into the side wings, not fabricated windows.
  for(const sign of [-1,1]){
    const doorX=sign*(plan.stage.halfWidth-.02),z=plan.stage.back+1.6;
    box('c118-backstage-door',darkWood,doorX,c.floorY+c.stageHeight+1.1,z,.055,2.2,.96);
    box('c118-backstage-reveal',black,doorX-sign*.035,c.floorY+c.stageHeight+1.07,z,.025,2.1,.86);
    box('c118-backstage-handle',metal,doorX-sign*.07,c.floorY+c.stageHeight+.99,z+.3,.07,.14,.03);
  }
  const doorZ=plan.doors[0].z;
  for(const sign of [-1,1]){
    const x=sign*W;
    for(const [z0,z1] of [[-D,doorZ-1.1],[doorZ+1.1,D]])box('c118-side-wall',wall,x,(c.floorY+top)/2,(z0+z1)/2,.18,c.height,z1-z0);
    box('c118-door-lintel',wall,x,(top+c.floorY+2.55)/2,doorZ,.18,top-c.floorY-2.55,2.2);
    box('c118-door-head-trim',white,x-sign*.12,c.floorY+2.6,doorZ,.08,.08,2.35);
    for(const side of [-1,1])box('c118-door-jamb',white,x-sign*.12,c.floorY+1.28,doorZ+side*1.14,.08,2.56,.08);
    // Open double leaves stay outside the collision doorway and communicate a real opening.
    for(const side of [-1,1])box('c118-open-door-leaves',metal,x+sign*.5,c.floorY+1.2,doorZ+side*1.04,1.02,2.4,.07);
    box('c118-exit-marker',black,x-sign*.12,c.floorY+2.95,doorZ,.06,.19,.48);
    box('c118-exit-marker-glow',green,x-sign*.158,c.floorY+2.95,doorZ,.018,.08,.31);
    for(let k=0;k<12;k++){
      const z=-D+1.3+k*2.75;
      if(Math.abs(z-doorZ)<1.6)continue;
      box('c118-side-acoustic-panels',wallPanel,x-sign*.12,c.floorY+4.5,z,.06,5.2,2.64);
      for(let n=0;n<13;n++)box('c118-acoustic-panel-slots',wall,x-sign*.157,c.floorY+2.2+n*.36,z,.012,.012,2.56);
    }
    box('c118-door-recess-floor',carpet,x+sign*.8,c.floorY-.04,doorZ,1.6,.08,2.2);
    box('c118-door-recess-back',black,x+sign*1.55,c.floorY+1.35,doorZ,.1,2.7,2.2);
    for(const side of [-1,1])box('c118-door-recess-walls',wall,x+sign*.8,c.floorY+1.35,doorZ+side*1.15,1.6,2.7,.1);
    // White suspended line arrays curve gently toward the seats.
    const sx=sign*(W-1.7),sz=plan.stage.front-.1;
    for(let j=0;j<4;j++)box('c118-hanging-speaker-array',white,sx,top-1.25-j*.32,sz+j*j*.035,.68,.3,.49,-j*.045);
    for(const dx of [-.22,.22])pole('c118-speaker-suspension',metal,sx+dx,top-.4,sz,.012,.8);
  }
  const rearY=c.floorY+(c.rows-1)*c.rowRise;
  box('c118-rear-wall',wall,0,(c.floorY+top)/2,D,.18+c.width,c.height,.18);
  for(let i=0;i<12;i++)box('c118-rear-acoustic-panels',wallPanel,-W+.95+i*(c.width-1.9)/11,(rearY+top)/2,D-.13,1.58,top-rearY-.5,.06);
  box('c118-ceiling',ceiling,0,top+.06,0,c.width,.12,c.depth);
  for(let iz=0;iz<8;iz++){
    const z=-D+2+iz*(c.depth-4)/7;
    box('c118-ceiling-reveal',wall,0,top-.018,z,c.width,.03,.05);
    for(let ix=0;ix<6;ix++){
      const x=-W+2+ix*(c.width-4)/5;
      pole('c118-downlight-rim',white,x,top-.055,z,.13,.035);
      pole('c118-recessed-downlights',glow,x,top-.077,z,.095,.014);
    }
  }
  for(let i=0;i<18;i++)box('c118-stage-wood-floor-joints',woodJoint,-stageWidth/2+i*(stageWidth/17),plan.stage.height+.005,(plan.stage.back+plan.stage.front)/2,.01,.008,plan.stage.front-plan.stage.back);
  // Seats share one geometry per component and one instanced draw per material.
  for(const s of plan.seats){
    const x=s.x,y=s.y,z=s.z;
    batch('c118-seat-wood-backs',roundedSeat,lightWood,x,y+.73,z+.22,.49,.7,.09,-.08);
    batch('c118-seat-back-cushions',roundedSeat,red,x,y+.76,z+.155,.435,.56,.065,-.08);
    box('c118-seat-cushions',seatRed,x,y+.46,z-.045,.46,.095,.4);
    box('c118-seat-underpan',darkWood,x,y+.4,z-.045,.47,.045,.4);
    for(const sign of [-1,1]){
      box('c118-seat-side-panels',wood,x+sign*.255,y+.38,z,.045,.61,.41);
      box('c118-seat-armrests',darkWood,x+sign*.255,y+.7,z-.01,.06,.045,.4);
      box('c118-seat-foot-brackets',metal,x+sign*.17,y+.13,z+.03,.05,.25,.05);
    }
    // Chair rear number plate is geometry only, preserving correct human scale.
    box('c118-seat-number-plates',metal,x,y+.99,z+.277,.07,.026,.012);
  }
  // The first-row conference tables visible in the source photo.
  for(const b of plan.blocks){
    const z=plan.seatRows[0].z-.67,width=b.x1-b.x0;
    box('c118-front-row-tables',darkWood,(b.x0+b.x1)/2,c.floorY+.74,z,width,.065,.42);
    for(let x=b.x0+.2;x<b.x1;x+=1.8)box('c118-table-legs',darkWood,x,c.floorY+.35,z,.055,.7,.055);
  }
  const lx=-plan.stage.halfWidth+3.175,lz=plan.stage.front-1.42,sy=plan.stage.height;
  box('c118-lectern-front',darkWood,lx,sy+.5,lz,.7,1,.6);
  box('c118-lectern-top',black,lx,sy+1.05,lz,.82,.09,.7);
  pole('c118-lectern-microphone',metal,lx+.18,sy+1.25,lz-.16,.012,.35,0,-.3);
  box('c118-lectern-mark',white,lx,sy+.7,lz+.306,.34,.18,.01);
  for(const x of [-5,-1.8,2.4,5.5])box('c118-stage-monitor-speakers',black,x,sy+.19,plan.stage.front-.3,.62,.38,.46,-.25);
  // Non-shadowed local lights avoid making hundreds of seats cast expensive shadows.
  const ambient=new THREE.HemisphereLight('#fff6e6','#777f82',1.65);ambient.name='c118-ambient-light';group.add(ambient);
  const key=new THREE.PointLight('#fff2dc',80,30,2);key.name='c118-stage-light';key.position.set(0,top-2,plan.stage.front+1);group.add(key);
  const fill=new THREE.PointLight('#e9f0f5',90,35,2);fill.name='c118-audience-light';fill.position.set(0,top-1,7);group.add(fill);
  for(const b of batches.values()){
    const o=new THREE.InstancedMesh(b.geometry,b.material,b.matrices.length);o.name=b.name;
    b.matrices.forEach((m,i)=>o.setMatrixAt(i,m));o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();
    o.receiveShadow=true;o.castShadow=false;o.userData.dimensions='photo-estimate';group.add(o);
  }
  group.updateMatrixWorld(true);
  let disposed=false;
  return {group,plan,colliders:plan.colliders,walkSurfaces:plan.walkSurfaces,
    infrastructure:{barriers:plan.colliders,walkSurfaces:plan.walkSurfaces},
    spawn:plan.spawn,exit:plan.exit,bounds:plan.bounds,viewpoints:plan.viewpoints,
    dispose(){if(disposed)return;disposed=true;geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear();}};
}
