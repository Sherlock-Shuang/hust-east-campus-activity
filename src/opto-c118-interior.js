/**
 * C118 report hall, revised against two participant-provided rear/side photographs.
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
  userPhotos: ['1b8b1c3442a8711b934a2e634b1be7f9.jpg','94265c4171b52d79ee3dccdb4556c114.jpg'],
  observed: [
    '实拍后部明显阶梯升高，前后席区之间有横向过道和浅木矮挡板',
    '中部高平台侧向双扇门，灰墙深竖框、蓝白竖向灯槽，低深灰横梁顶棚',
    '舞台左侧黑色三角钢琴、偏中左讲台、大方屏与红色细长信息条',
    '浅金木饰面舞台框与弧形前缘、两侧短阶梯',
    '台后中央大屏、上部长条信息屏、左右悬吊白色阵列音箱',
    '浅灰侧墙、前部两侧双扇门、舞台后侧小门',
    '木质椅背与深红软垫、前排长桌、嵌入式顶灯',
  ],
  uncertain: [
    '房间尺寸、准确排数和座位数、各排高差及中部门位仍按照片比例估算，未取得测绘资料',
    '用户已确认学院标识左门直行后左手入厅、东侧外门直接入厅；走廊长度、具体门位及内外坐标对应仍按可辨照片估计',
  ],
});

const DEFAULTS = Object.freeze({ width:23.4, depth:35.5, height:10.8, rows:20, frontRows:10,
  centreSeats:18, sideSeats:4, seatPitch:.57, rowPitch:1.08,
  rowRise:.28, rearRowRise:.34, aisleWidth:1.55, crossAisleWidth:1.8, stageHeight:.72, floorY:.14 });
const rect = (x0,z0,x1,z1) => [{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
const finite = (v, min, max, name) => {
  if (!Number.isFinite(v) || v < min || v > max) throw new RangeError(`${name} must be ${min}…${max}`);
  return v;
};

/** Serializable metre-based navigation and furniture plan, independent of Three/DOM. */
export function planOptoC118Interior(options = {}) {
  const c={...DEFAULTS,...options};
  for(const [name,min,max]of[['width',20,40],['depth',32,55],['height',9.5,15],['rows',12,26],['frontRows',3,16],
    ['centreSeats',12,22],['sideSeats',2,6],['seatPitch',.52,.66],['rowPitch',1.02,1.4],
    ['rowRise',.18,.36],['rearRowRise',.2,.38],['aisleWidth',1.2,2.4],['crossAisleWidth',1.4,2.6],['stageHeight',.45,.9],['floorY',.14,2]])finite(c[name],min,max,name);
  for(const name of['rows','frontRows','centreSeats','sideSeats'])if(!Number.isInteger(c[name]))throw new RangeError(`${name} must be an integer`);
  if(c.frontRows>c.rows-3)throw new RangeError('frontRows must leave at least three rear rows');
  const halfW=c.width/2,halfD=c.depth/2,front=-halfD,back=halfD,stageFront=front+7,stageBack=front+.5,stageHalfW=halfW-2.1;
  const firstRow=stageFront+3.1,lastRow=firstRow+(c.rows-1)*c.rowPitch+c.crossAisleWidth;
  if(lastRow+1.7>back)throw new RangeError('Rows leave insufficient rear circulation space');
  const centreHalf=c.centreSeats*c.seatPitch/2,sideInner=centreHalf+c.aisleWidth,sideOuter=sideInner+c.sideSeats*c.seatPitch;
  if(halfW-sideOuter<1.15)throw new RangeError('Seating leaves insufficient side circulation space');
  const rearY=c.floorY+(c.frontRows-1)*c.rowRise+(c.rows-c.frontRows)*c.rearRowRise;
  if(c.floorY+c.height-rearY<3.5)throw new RangeError('Rear seating leaves insufficient ceiling clearance');
  const blocks=[{id:'left',x0:-sideOuter,x1:-sideInner,count:c.sideSeats},{id:'centre',x0:-centreHalf,x1:centreHalf,count:c.centreSeats},{id:'right',x0:sideInner,x1:sideOuter,count:c.sideSeats}];
  const aisles=[{id:'left-side',x0:-halfW,x1:-sideOuter},{id:'left-main',x0:-sideInner,x1:-centreHalf},{id:'right-main',x0:centreHalf,x1:sideInner},{id:'right-side',x0:sideOuter,x1:halfW}];
  const seats=[],seatRows=[],colliders=[],walkSurfaces=[],terraces=[],audienceSteps=[];
  const floor=(id,polygon,surfaceY,kind='floor')=>walkSurfaces.push({id,polygon,surfaceY,kind,sourceId:'opto-c118'});
  const solid=(id,polygon,minHeight,height,label='C118报告厅')=>colliders.push({id,sourceId:'opto-c118',label,polygon,minHeight,height});
  floor('c118-base-floor',rect(-halfW,front,halfW,back),c.floorY);
  const stagePolygon=[{x:-stageHalfW,z:stageBack},{x:stageHalfW,z:stageBack},{x:stageHalfW,z:stageFront}];
  for(let i=1;i<=24;i++){const x=stageHalfW-2*stageHalfW*i/24;stagePolygon.push({x,z:stageFront+.62*(1-(x/stageHalfW)**2)});}
  floor('c118-stage',stagePolygon,c.floorY+c.stageHeight);
  const stairCount=Math.ceil(c.stageHeight/.18),stairs=[];
  for(const sign of[-1,1])for(let i=0;i<stairCount;i++){
    const z=stageFront+.8-i*.36,y=c.floorY+(i+1)*c.stageHeight/stairCount,polygon=rect(sign<0?-halfW+.9:stageHalfW,z-.36,sign<0?-stageHalfW:halfW-.9,z);
    stairs.push({id:`c118-stage-stair-${sign}-${i}`,polygon,surfaceY:y});floor(stairs.at(-1).id,polygon,y,'stage-stair');
  }
  for(let row=0;row<c.rows;row++){
    const rear=row>=c.frontRows,z=firstRow+row*c.rowPitch+(rear?c.crossAisleWidth:0),previousY=row?seatRows.at(-1).y:c.floorY;
    const rise=row?(rear?c.rearRowRise:c.rowRise):0,y=previousY+rise,startZ=z-c.rowPitch*.5,endZ=z+c.rowPitch*.5;
    seatRows.push({row,z,y,startZ,endZ,section:rear?'rear':'front',rise});
    for(const block of blocks){
      const platform={id:`c118-seat-platform-${block.id}-${row}`,polygon:rect(block.x0,startZ,block.x1,endZ),surfaceY:y,row};terraces.push(platform);floor(platform.id,platform.polygon,y,'seat-platform');
      solid(`c118-seats-${block.id}-${row}`,rect(block.x0,z-.33,block.x1,z+.35),y,y+1.08,'报告厅座椅');
      for(let col=0;col<block.count;col++)seats.push({row,column:col,block:block.id,x:block.x0+(col+.5)*c.seatPitch,z,y});
    }
    // Each chair row sits on one flat terrace. The clear longitudinal aisles
    // split that rise into two physical treads, so .28/.34 m seat terraces never
    // become an unwalkable single vertical step in the player collision model.
    for(const aisle of aisles)for(let j=0;j<2;j++){
      const step={id:`c118-aisle-${aisle.id}-${row}-${j}`,row,aisle:aisle.id,polygon:rect(aisle.x0,startZ+j*c.rowPitch/2,aisle.x1,startZ+(j+1)*c.rowPitch/2),surfaceY:previousY+rise*(j+1)/2,riser:rise/2};
      audienceSteps.push(step);floor(step.id,step.polygon,step.surfaceY,'audience-stair');
    }
  }
  const lastFront=seatRows[c.frontRows-1],firstRear=seatRows[c.frontRows],crossAisle={id:'c118-middle-cross-aisle',startZ:lastFront.endZ,endZ:firstRear.startZ,z:(lastFront.endZ+firstRear.startZ)/2,y:lastFront.y,polygon:rect(-halfW,lastFront.endZ,halfW,firstRear.startZ)};
  floor(crossAisle.id,crossAisle.polygon,crossAisle.y,'cross-aisle');
  const rearLanding={id:'c118-rear-circulation',polygon:rect(-halfW,seatRows.at(-1).endZ,halfW,back),surfaceY:rearY};floor(rearLanding.id,rearLanding.polygon,rearY,'rear-circulation');
  const guards=blocks.map(block=>({id:`c118-cross-aisle-guard-${block.id}`,x0:block.x0,x1:block.x1,z:crossAisle.startZ-.03,y:crossAisle.y,height:.87}));
  for(const g of guards)solid(g.id,rect(g.x0,g.z-.07,g.x1,g.z+.07),g.y,g.y+g.height,'横向过道木护板');
  for(const block of blocks){const z=firstRow-.67;solid(`c118-front-table-${block.id}`,rect(block.x0,z-.21,block.x1,z+.21),c.floorY,c.floorY+.78,'前排桌');}
  const doors=[];
  for(const side of[-1,1])for(const [tier,z,y]of[['front',stageFront+1.5,c.floorY],['middle',crossAisle.z,crossAisle.y]])doors.push({id:`c118-${tier}-${side<0?'left':'right'}-door`,side,x:side*halfW,z,y,width:2.2,height:2.55,tier,estimated:true});
  solid('c118-front-wall',rect(-halfW-.18,front-.18,halfW+.18,front+.1),c.floorY,c.floorY+c.height);
  solid('c118-rear-wall',rect(-halfW-.18,back-.1,halfW+.18,back+.18),c.floorY,c.floorY+c.height);
  const wallSegments=[];
  for(const side of[-1,1]){
    let from=front;const x=side*halfW;
    for(const door of doors.filter(d=>d.side===side).sort((a,b)=>a.z-b.z)){
      wallSegments.push({side,z0:from,z1:door.z-door.width/2,y0:c.floorY,y1:c.floorY+c.height});
      solid(`c118-wall-before-${door.id}`,rect(x-.15,from,x+.15,door.z-door.width/2),c.floorY,c.floorY+c.height);
      if(door.y>c.floorY){wallSegments.push({side,z0:door.z-door.width/2,z1:door.z+door.width/2,y0:c.floorY,y1:door.y});solid(`c118-wall-below-${door.id}`,rect(x-.15,door.z-door.width/2,x+.15,door.z+door.width/2),c.floorY,door.y);}
      from=door.z+door.width/2;
      floor(`${door.id}-recess`,rect(side<0?-halfW-1.6:halfW,door.z-door.width/2,side<0?-halfW:halfW+1.6,door.z+door.width/2),door.y,'door-recess');
    }
    wallSegments.push({side,z0:from,z1:back,y0:c.floorY,y1:c.floorY+c.height});solid(`c118-side-rear-${side}`,rect(x-.15,from,x+.15,back),c.floorY,c.floorY+c.height);
  }
  const fascia=stagePolygon.slice(2).map(p=>({...p}));solid('c118-stage-front',[...fascia,...fascia.slice().reverse().map(p=>({x:p.x,z:p.z-.12}))],c.floorY,c.floorY+c.stageHeight);
  const lectern={x:-1.4,z:stageFront-1.65},piano={x:-4.8,z:stageFront-3.1};
  solid('c118-lectern',rect(lectern.x-.38,lectern.z-.33,lectern.x+.38,lectern.z+.33),c.floorY+c.stageHeight,c.floorY+c.stageHeight+1.12);
  solid('c118-grand-piano',rect(piano.x-1.05,piano.z-1.2,piano.x+1.05,piano.z+.62),c.floorY+c.stageHeight,c.floorY+c.stageHeight+1.3,'三角钢琴');
  solid('c118-piano-bench',rect(piano.x-.44,piano.z+.9,piano.x+.44,piano.z+1.36),c.floorY+c.stageHeight,c.floorY+c.stageHeight+.6,'琴凳');
  solid('c118-stage-stool',rect(1.35,stageFront-2.25,2.05,stageFront-1.75),c.floorY+c.stageHeight,c.floorY+c.stageHeight+.4,'舞台低凳');
  const entryDoor=doors.find(d=>d.tier==='middle'&&d.side===-1),legacyDoor=doors.find(d=>d.tier==='front'&&d.side===-1);
  const spawn={x:-halfW+1.05,y:entryDoor.y,z:entryDoor.z,yaw:-.5,pitch:-.18};
  const exits=doors.map(d=>({id:`${d.id}-return`,doorId:d.id,x:d.x+d.side*.15,y:d.y,z:d.z,radius:1.15,polygon:rect(d.side<0?-halfW-1.5:halfW-.15,d.z-1.1,d.side<0?-halfW+.15:halfW+1.5,d.z+1.1)}));
  const exit={...exits.find(e=>e.doorId===legacyDoor.id),id:'c118-return'};
  return{id:'opto-c118',config:c,evidence:OPTO_C118_EVIDENCE,dimensions:'photo-estimate',bounds:{minX:-halfW-1.6,maxX:halfW+1.6,minZ:front,maxZ:back,minY:c.floorY,maxY:c.floorY+c.height},
    stage:{polygon:stagePolygon,front:stageFront,back:stageBack,halfWidth:stageHalfW,height:c.floorY+c.stageHeight},
    doors,seats,seatRows,blocks,aisles,stairs,audienceSteps,terraces,crossAisle,rearLanding,guards,wallSegments,lectern,piano,colliders,walkSurfaces,spawn,exit,exits,
    viewpoints:{entry:{...spawn},westEntry:{...spawn},eastEntry:{x:halfW-1.05,y:c.floorY,z:legacyDoor.z,yaw:.5,pitch:.06},middle:{x:(centreHalf+sideInner)/2,y:crossAisle.y,z:crossAisle.z,yaw:0,pitch:-.19},
      front:{x:0,y:c.floorY,z:stageFront+1.55,yaw:0,pitch:.14},frontDoor:{x:-halfW+1.05,y:c.floorY,z:legacyDoor.z,yaw:-1.1,pitch:.06},
      rear:{x:(centreHalf+sideInner)/2,y:rearY,z:lastRow+1,yaw:0,pitch:-.25}},seatCount:seats.length,layoutEstimated:true};
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
  const wood=mat('#c6a36d'),lightWood=mat('#d6b784'),darkWood=mat('#745439'),woodJoint=mat('#b69a6d');
  const wall=mat('#a8adac'),wallPanel=mat('#bac1c0'),ceiling=mat('#777b75'),carpet=mat('#878a78');
  const red=mat('#6f2032'),seatRed=mat('#8d2a40'),metal=mat('#52545a',.65,{metalness:.3});
  const white=mat('#deded5'),black=mat('#171d21'),screen=mat('#343c43',.8,{emissive:'#222a30',emissiveIntensity:.12});
  const glow=mat('#fff2cf',.4,{emissive:'#fff1d6',emissiveIntensity:2});
  const stripGlow=mat('#bddce3',.45,{emissive:'#a2cfdf',emissiveIntensity:.65}),redLED=mat('#ad1625',.6,{emissive:'#e31322',emissiveIntensity:1.1});
  const green=mat('#a1f5bc',.6,{emissive:'#32c273',emissiveIntensity:1.2});
  // Tiny deterministic material maps: authored grain, never downloaded photo textures.
  // DataTexture works in node tests and requires no document or canvas.
  const grainTexture=(kind)=>{
    const size=128,data=new Uint8Array(size*size*4);let seed=kind==='wood'?851:kind==='fabric'?411:97;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const woodColumns=Array.from({length:size},()=>rand()-.5);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=(y*size+x)*4,noise=rand();let v;
      if(kind==='wood'){
        // Low-contrast, non-periodic grain avoids long high-frequency stripes
        // turning into waves when viewed from the rear of the auditorium.
        const grain=(woodColumns[(x+size-1)%size]+2*woodColumns[x]+woodColumns[(x+1)%size])/4;
        v=243+grain*5+(noise-.5)*2;
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
    const fine=/seat-number-plates|seat-foot-brackets/.test(name),zone=fine?Math.floor((z+c.depth/2)/(c.depth/3)):'';
    const key=`${name}:${material.uuid}:${geometry.uuid}:${zone}`;
    if(!batches.has(key))batches.set(key,{name,geometry,material,matrices:[],fine,zone,zValues:[]});
    dummy.position.set(x,y,z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(rx,ry,rz);dummy.updateMatrix();
    batches.get(key).matrices.push(dummy.matrix.clone());batches.get(key).zValues.push(z);
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
  for(const platform of [...plan.terraces,...plan.audienceSteps,plan.rearLanding,{polygon:plan.crossAisle.polygon,surfaceY:plan.crossAisle.y}]){
    if(platform.surfaceY<=c.floorY+.001)continue;const [a,,b]=platform.polygon;
    box(platform.riser!==undefined?'c118-aisle-treads':'c118-seat-platforms',carpet,(a.x+b.x)/2,(c.floorY+platform.surfaceY)/2,(a.z+b.z)/2,b.x-a.x,platform.surfaceY-c.floorY,b.z-a.z);
    if(platform.riser>0)box('c118-audience-step-nosings',wall,(a.x+b.x)/2,platform.surfaceY+.007,a.z+.018,b.x-a.x,.014,.035);
  }
  for(const g of plan.guards){
    box('c118-middle-aisle-wood-guard',wood,(g.x0+g.x1)/2,g.y+g.height/2,g.z,g.x1-g.x0,g.height,.14);
    box('c118-middle-aisle-guard-top',darkWood,(g.x0+g.x1)/2,g.y+g.height,g.z,g.x1-g.x0+.08,.07,.2);
    for(let x=g.x0+.18;x<g.x1;x+=1.15)box('c118-middle-aisle-guard-panels',lightWood,x,g.y+.44,g.z+.081,.075,.72,.03);
  }
  // Front frame: its tall, continuous warm wood silhouette is the strongest photo cue.
  const stageWidth=plan.stage.halfWidth*2;
  box('c118-stage-back',wood,0,(c.floorY+top)/2,-D+.1,c.width,.01+c.height,.2);
  box('c118-proscenium-header',wood,0,top-.8,plan.stage.front-1.1,c.width-1.5,1.6,.7);
  for(const sign of [-1,1]){
    box('c118-stage-wings',wood,sign*(plan.stage.halfWidth+.38),c.floorY+c.height/2,(plan.stage.back+plan.stage.front-1.3)/2,.76,c.height,plan.stage.front-plan.stage.back-1.3);
    for(let j=0;j<7;j++)box('c118-stage-panel-joints',woodJoint,sign*(plan.stage.halfWidth-.015),c.floorY+c.height/2,plan.stage.back+j*.9,.014,c.height,.012);
  }
  // Large screen; no event portrait, slogan or photo reuse.
  const screenZ=-D+.31,screenW=9.8,screenH=6,screenY=plan.stage.height+.75+screenH/2;
  box('c118-screen-frame',black,0,screenY,screenZ,screenW+.16,screenH+.16,.12);
  box('c118-led-screen',screen,0,screenY,screenZ+.072,screenW,screenH,.025);
  // The viewer owns media; building this surface performs no network requests.
  const videoScreen=mesh('c118-video-screen',new THREE.PlaneGeometry(screenW,screenH),
    ownMat(new THREE.MeshBasicMaterial({color:'#ffffff',toneMapped:false})));
  videoScreen.position.set(0,screenY,screenZ+.12);videoScreen.visible=false;
  const bannerY=screenY+screenH/2+.66;
  box('c118-banner-black',black,0,bannerY,screenZ+.14,screenW+3,.48,.12);
  // The reference's event text is private/transient. Only an understated red
  // dot-matrix ribbon is authored here; the runtime still owns announcements.
  for(let i=0;i<72;i++)for(let j=0;j<2;j++)box('c118-banner-status',redLED,-5.5+i*.155,bannerY+(j-.5)*.06,screenZ+.207,.06,.018,.012);
  // Photo-visible backstage doors: set into the side wings, not fabricated windows.
  for(const sign of [-1,1]){
    const doorX=sign*(plan.stage.halfWidth-.02),z=plan.stage.back+1.6;
    box('c118-backstage-door',darkWood,doorX,c.floorY+c.stageHeight+1.1,z,.055,2.2,.96);
    box('c118-backstage-reveal',black,doorX-sign*.035,c.floorY+c.stageHeight+1.07,z,.025,2.1,.86);
    box('c118-backstage-handle',metal,doorX-sign*.07,c.floorY+c.stageHeight+.99,z+.3,.07,.14,.03);
  }
  for(const wallSegment of plan.wallSegments){const q=wallSegment;box('c118-side-wall',wall,q.side*W,(q.y0+q.y1)/2,(q.z0+q.z1)/2,.18,q.y1-q.y0,q.z1-q.z0);}
  for(const door of plan.doors){
    const sign=door.side,x=door.x,doorZ=door.z,y=door.y;
    box('c118-door-lintel',wall,x,(top+y+door.height)/2,doorZ,.18,top-y-door.height,door.width);
    box('c118-door-head-trim',white,x-sign*.12,y+door.height+.04,doorZ,.08,.08,door.width+.15);
    for(const side of[-1,1])box('c118-door-jamb',white,x-sign*.12,y+door.height/2,doorZ+side*(door.width/2+.04),.08,door.height,.08);
    for(const side of[-1,1])box('c118-open-door-leaves',metal,x+sign*.5,y+1.2,doorZ+side*1.04,1.02,2.4,.07);
    box('c118-exit-marker',black,x-sign*.12,y+2.95,doorZ,.06,.19,.48);
    box('c118-exit-marker-glow',green,x-sign*.158,y+2.95,doorZ,.018,.08,.31);
    box('c118-door-recess-floor',carpet,x+sign*.8,y-.04,doorZ,1.6,.08,2.2);
    box('c118-door-recess-back',black,x+sign*1.55,y+1.35,doorZ,.1,2.7,2.2);
    for(const side of[-1,1])box('c118-door-recess-walls',wall,x+sign*.8,y+1.35,doorZ+side*1.15,1.6,2.7,.1);
  }
  for(const sign of[-1,1]){
    const x=sign*W;
    for(let k=0;k<10;k++){
      const z=-D+1.6+k*(c.depth-3.2)/9;
      // Test panel extents, not just centres: wide panels must never veil the
      // raised middle door while navigation sees an otherwise open doorway.
      if(plan.doors.some(d=>d.side===sign&&Math.abs(z-d.z)<d.width/2+1.5))continue;
      box('c118-side-acoustic-panels',wallPanel,x-sign*.12,(c.floorY+top)/2,z,.06,c.height-.24,2.9);
      box('c118-side-deep-ribs',metal,x-sign*.26,(c.floorY+top)/2,z-1.48,.36,c.height,.19);
      if(k>2&&k%2===0){box('c118-side-light-slot',black,x-sign*.31,(c.floorY+top)/2,z-1.37,.08,c.height-.2,.18);box('c118-side-light-strip',stripGlow,x-sign*.36,(c.floorY+top)/2,z-1.35,.025,c.height-.25,.09);}
    }
    const sx=sign*(W-1.7),sz=plan.stage.front-.1;
    for(let j=0;j<4;j++)box('c118-hanging-speaker-array',white,sx,top-1.25-j*.32,sz+j*j*.035,.68,.3,.49,-j*.045);
    for(const dx of[-.22,.22])pole('c118-speaker-suspension',metal,sx+dx,top-.4,sz,.012,.8);
    const rackZ=plan.stage.front+.1;
    box('c118-side-light-rack',black,x-sign*.33,top-3.5,rackZ,.08,3.8,.08);
    for(let j=0;j<4;j++){box('c118-side-light-arms',black,x-sign*.52,top-2.2-j*.85,rackZ,.5,.06,.06);box('c118-side-stage-spots',black,x-sign*.72,top-2.2-j*.85,rackZ,.22,.18,.32,0,sign*.35);}
  }
  const rearY=plan.seatRows.at(-1).y;
  box('c118-rear-wall',wall,0,(c.floorY+top)/2,D,.18+c.width,c.height,.18);
  for(let i=0;i<12;i++)box('c118-rear-acoustic-panels',wallPanel,-W+.95+i*(c.width-1.9)/11,(rearY+top)/2,D-.13,1.58,top-rearY-.5,.06);
  box('c118-ceiling',ceiling,0,top+.06,0,c.width,.12,c.depth);
  for(let iz=0;iz<8;iz++){
    const z=-D+2+iz*(c.depth-4)/7;
    box('c118-ceiling-low-beams',ceiling,0,top-.28,z,c.width,.52,.66);
    box('c118-ceiling-warm-trim',darkWood,0,top-.56,z+.27,c.width,.055,.09);
    for(let ix=0;ix<6;ix++){
      const x=-W+2+ix*(c.width-4)/5;
      pole('c118-downlight-rim',white,x,top-.56,z,.13,.035);
      pole('c118-recessed-downlights',glow,x,top-.582,z,.095,.014);
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
      box('c118-seat-armrests',lightWood,x+sign*.255,y+.7,z-.01,.06,.045,.4);
      box('c118-seat-foot-brackets',metal,x+sign*.17,y+.13,z+.03,.05,.25,.05);
    }
    // Chair rear number plate is geometry only, preserving correct human scale.
    batch('c118-seat-headrests',roundedSeat,(s.column+s.row)%5===0?red:seatRed,x,y+1.065,z+.223,.46,.11,.1,-.08);
    box('c118-seat-number-plates',metal,x,y+.99,z+.277,.07,.026,.012);
  }
  // The first-row conference tables visible in the source photo.
  for(const b of plan.blocks){
    const z=plan.seatRows[0].z-.67,width=b.x1-b.x0;
    box('c118-front-row-tables',darkWood,(b.x0+b.x1)/2,c.floorY+.74,z,width,.065,.42);
    for(let x=b.x0+.2;x<b.x1;x+=1.8)box('c118-table-legs',darkWood,x,c.floorY+.35,z,.055,.7,.055);
  }
  const lx=plan.lectern.x,lz=plan.lectern.z,sy=plan.stage.height;
  box('c118-lectern-front',darkWood,lx,sy+.5,lz,.7,1,.6);
  box('c118-lectern-top',black,lx,sy+1.05,lz,.82,.09,.7);
  pole('c118-lectern-microphone',metal,lx+.18,sy+1.25,lz-.16,.012,.35,0,-.3);
  box('c118-lectern-mark',white,lx,sy+.7,lz+.306,.34,.18,.01);
  const px=plan.piano.x,pz=plan.piano.z;
  const pianoOutline=[{x:px-.9,z:pz+.58},{x:px+.9,z:pz+.58},{x:px+.9,z:pz-.25},{x:px+.65,z:pz-.83},{x:px+.05,z:pz-1.08},{x:px-.6,z:pz-.95},{x:px-.9,z:pz-.48}];
  const pianoBody=mesh('c118-grand-piano-case',shape(pianoOutline,.23),black);pianoBody.position.y=sy+.76;
  const pianoLid=mesh('c118-grand-piano-lid',shape(pianoOutline,.055),black);pianoLid.position.y=sy+1.02;
  for(const [dx,dz]of[[-.72,.38],[.72,.38],[.02,-.83]])pole('c118-piano-legs',black,px+dx,sy+.39,pz+dz,.055,.78);
  box('c118-piano-keyboard',white,px,sy+.82,pz+.66,1.65,.055,.28);
  for(let i=0;i<23;i++)box('c118-piano-black-keys',black,px-.77+i*.07,sy+.87,pz+.59,.035,.04,.17);
  box('c118-piano-bench',black,px,sy+.49,pz+1.13,.8,.12,.4);
  for(const dx of[-.3,.3])for(const dz of[-.14,.14])box('c118-piano-bench-legs',black,px+dx,sy+.22,pz+1.13+dz,.045,.44,.045);
  box('c118-stage-low-stool',black,1.7,sy+.32,plan.stage.front-2,.65,.09,.45);
  for(const dx of[-.24,.24])for(const dz of[-.15,.15])box('c118-stage-stool-legs',black,1.7+dx,sy+.15,plan.stage.front-2+dz,.035,.3,.035);
  // Non-shadowed local lights avoid making hundreds of seats cast expensive shadows.
  const ambient=new THREE.HemisphereLight('#fff6e6','#777f82',1.4);ambient.name='c118-ambient-light';group.add(ambient);
  const key=new THREE.PointLight('#fff2dc',80,30,2);key.name='c118-stage-light';key.position.set(0,top-2,plan.stage.front+1);group.add(key);
  const fill=new THREE.PointLight('#e9f0f5',90,35,2);fill.name='c118-audience-light';fill.position.set(0,top-1,7);group.add(fill);
  const detailMeshes=[];
  for(const b of batches.values()){
    const o=new THREE.InstancedMesh(b.geometry,b.material,b.matrices.length);o.name=b.name;
    b.matrices.forEach((m,i)=>o.setMatrixAt(i,m));o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();
    o.receiveShadow=true;o.castShadow=false;o.userData.dimensions='photo-estimate';if(b.fine){o.userData.detailCenterZ=b.zValues.reduce((a,v)=>a+v,0)/b.zValues.length;detailMeshes.push(o);}group.add(o);
  }
  group.updateMatrixWorld(true);
  let disposed=false;
  const update=camera=>{const p=camera?.position||camera;for(const mesh of detailMeshes)mesh.visible=!p||Math.abs(p.z-mesh.userData.detailCenterZ)<13;};
  return {group,plan,videoScreen,colliders:plan.colliders,walkSurfaces:plan.walkSurfaces,
    infrastructure:{barriers:plan.colliders,walkSurfaces:plan.walkSurfaces},
    spawn:plan.spawn,exit:plan.exit,exits:plan.exits,bounds:plan.bounds,viewpoints:plan.viewpoints,update,
    dispose(){if(disposed)return;disposed=true;geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear();}};
}
