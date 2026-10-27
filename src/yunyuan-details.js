import {createPhotoCanteen} from './yunyuan-canteen.js';
/** Building-specific reconstruction from the user's October 2026 street frames.
 * Source floor counts and footprints are retained. Projected dimensions, roof
 * pitch and the exact extent of the corner entrance remain visual estimates.
 */
const CANTEEN='way/103814566';
const DORM_FIVE='way/103815859';
const PHOTOS=['/references/local-campus/yunyuan-food-dorm-junction.webp','/references/local-campus/yunyuan-canteen-market.webp'];
export function getYunyuanBuildingProfile(feature){
  const id=String(feature?.id??feature?.properties?.osmId);
  if(id===DORM_FIVE)return {id:'yunyuan-five',name:'韵苑五栋',sourceId:id,
    sourceUrl:'https://hq.hust.edu.cn/info/1015/3979.htm',photos:['/references/local-campus/yunyuan-food-dorm-junction.webp','https://hq.hust.edu.cn/__local/3/7E/16/29629B73F08AD35E6422B928E9F_82971852_E11EA.png'],
    observed:'校方2025年照片定位5栋；用户街景与食堂东侧邻接关系支持南向弧阳台、灰色楼层带、深色空调格栅和顶部大圆拱。',
    uncertainty:'源地图为5层，街景可见层数与源标注有冲突；保留源层数，不把截图推定为测绘数据。阳台分组、圆拱位置和尺寸为配准估计，其余立面只作普通窗墙。',
    wallColor:'#d9bf90',roofColor:'#a7aaa1',windowColor:'#384644',roofForm:'dorm-arched-parapet',roofRise:1.25,
    facadeFeatures:{inferredEntrance:false,balconies:false,stairTower:false,airConditioners:false,windowFloorLimit:0,landmarkDetails:'yunyuan-five'}};
  if(id!==CANTEEN)return null;
  return {id:'yunyuan-canteen',name:'韵苑学生食堂',sourceId:CANTEEN,
    sourceUrl:'/references/local-campus/index.html',photos:[...PHOTOS],
    observed:'用户提供街景：两层暖米黄食堂，南翼局部弧廊、东翼连续浅弧、灰白厚檐口、大菱窗主塔与远端小塔，超市退在一层柱廊后。',
    uncertainty:'照片为截屏，拍摄时间未独立核验；曲线外皮、门塔配准、9.6米主体檐高、廊深及全部尺寸为照片估计；源地图轮廓独立保留。',
    floorHeight:4.8,wallColor:'#d8c8a4',roofColor:'#a6a69f',windowColor:'#394c4b',roofForm:'yunyuan-curved-gallery',roofRise:2.43,
    facadeFeatures:{inferredEntrance:false,balconies:false,stairTower:false,airConditioners:false,windowFloorLimit:0,landmarkDetails:'yunyuan-canteen'}};
}

function ringPoints(shape){const p=shape.getPoints().map(p=>p.clone());if(p.length>1&&p[0].distanceToSquared(p.at(-1))<1e-8)p.pop();return p;}
function area(points){return points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;}

/** Full replacement for the generic solid extrusion, not a facade stuck onto
 * an opaque box. Source GIS is retained separately; photo-informed slabs and gallery edges
 * share the refined boundary and openings remain physically open. The caller owns disposal with its campus traversal.
 */
export function createYunyuanDetails(THREE,record,profile){
  const evidence=getYunyuanBuildingProfile(record?.feature);
  if(!evidence||!record.shapes?.length)return null;
  if(record.id===DORM_FIVE)return createDormFiveDetails(THREE,record,profile,evidence);
  return createPhotoCanteen(THREE,record,profile,evidence);
}

function createDormFiveDetails(THREE,record,profile,evidence){
  const group=new THREE.Group();group.name='yunyuan-five-source-facades';
  group.userData={category:'building',feature:record.feature,featureId:record.id,component:'yunyuan-five',sourceFootprintPreserved:true,sourceLevels:profile.sourceLevels,
    sourceUrl:evidence.sourceUrl,photos:evidence.photos,observed:evidence.observed,uncertainty:evidence.uncertainty,dimensions:'photo-estimated',photoFacadeSides:['south']};
  const cream=new THREE.MeshStandardMaterial({color:profile.wallColor,roughness:.9,side:THREE.DoubleSide}),trim=new THREE.MeshStandardMaterial({color:'#cccfc6',roughness:.8,side:THREE.DoubleSide}),dark=new THREE.MeshStandardMaterial({color:'#2f3935',roughness:.85,side:THREE.DoubleSide}),glass=new THREE.MeshStandardMaterial({color:profile.windowColor,roughness:.3,metalness:.2,side:THREE.DoubleSide}),metal=new THREE.MeshStandardMaterial({color:'#b8bdb5',roughness:.56,metalness:.25,side:THREE.DoubleSide});
  const boxGeo=new THREE.BoxGeometry(1,1,1),batches=new Map(),decks=new Map(),dummy=new THREE.Object3D(),base=(profile.baseHeight??0)+.08,height=profile.height,levels=profile.levels,floor=height/levels;
  const meta=name=>({...group.userData,component:name});
  function box(name,material,x,y,z,sx,sy,sz,yaw=0){const key=`${name}/${material.uuid}`;if(!batches.has(key))batches.set(key,{name,material,items:[]});dummy.position.set(x,y,z);dummy.rotation.set(0,yaw,0);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();batches.get(key).items.push(dummy.matrix.clone());}
  function mesh(name,geometry,material){const o=new THREE.Mesh(geometry,material);o.name=name;o.castShadow=true;o.receiveShadow=true;o.renderOrder=205;o.userData=meta(name);group.add(o);return o;}
  const shell=mesh('five-source-footprint-shell',new THREE.ExtrudeGeometry(record.shapes,{depth:height,bevelEnabled:false,curveSegments:1}),cream);shell.rotation.x=-Math.PI/2;shell.position.y=base;
  for(const shape of record.shapes){const ring=ringPoints(shape),sign=area(ring)<0?-1:1;
    for(let index=0;index<ring.length;index++){
      const a=ring[index],b=ring[(index+1)%ring.length],dx=b.x-a.x,dz=-(b.y-a.y),length=Math.hypot(dx,dz);if(length<1)continue;
      const tx=dx/length,tz=dz/length,nx=-tz*sign,nz=tx*sign,yaw=-Math.atan2(tz,tx),south=nz>.8&&length>20;
      const put=(name,mat,u,y,out,w,h,d)=>box(name,mat,a.x+tx*u+nx*out,y,-a.y+tz*u+nz*out,w,h,d,yaw);
      put('five-base-plinth',trim,length/2,base+.27,.1,length,.5,.22);
      put('five-top-cornice',trim,length/2,base+height+.14,.16,length+.12,.25,.52);
      for(let f=1;f<levels;f++)put('five-grey-floor-bands',trim,length/2,base+f*floor,.15,length,.23,.3);
      const columns=Math.max(1,Math.floor(length/(south?4.8:3.6))),pitch=length/columns;
      for(let f=0;f<levels;f++)for(let c=0;c<columns;c++){
        const u=(c+.5)*pitch,y=base+f*floor,w=Math.min(south?3.75:2.05,pitch*.75);
        if(south){
          put('five-balcony-dark-recesses',dark,u,y+floor*.52,.08,w,floor*.82,.1);
          put('five-balcony-rear-glazing',glass,u,y+floor*.53,.15,w*.87,floor*.76,.055);
          // These shallow arcs project from the registered source wall. Their
          // segment count is a geometry choice, not a measured balcony count.
          const divisions=8,arc=[];for(let k=0;k<=divisions;k++){const x=(k/divisions-.5)*w,out=.46+.68*Math.sin(k/divisions*Math.PI);arc.push({u:u+x,out});}
          const deckKey=`${w}/${sign}`;
          if(!decks.has(deckKey)){
            const points=[new THREE.Vector2(-w/2,0),new THREE.Vector2(w/2,0),...arc.slice().reverse().map(p=>new THREE.Vector2(p.u-u,-p.out*sign))];
            const geometry=new THREE.ExtrudeGeometry(new THREE.Shape(points),{depth:.16,bevelEnabled:false,curveSegments:1});geometry.rotateX(-Math.PI/2);decks.set(deckKey,{geometry,items:[],width:w});
          }
          dummy.position.set(a.x+tx*u,y+.02,-a.y+tz*u);dummy.rotation.set(0,yaw,0);dummy.scale.set(1,1,1);dummy.updateMatrix();decks.get(deckKey).items.push(dummy.matrix.clone());
          for(let k=1;k<arc.length;k++){
            const p=arc[k-1],q=arc[k],du=q.u-p.u,doff=q.out-p.out,len=Math.hypot(du,doff),x=a.x+tx*(p.u+q.u)/2+nx*(p.out+q.out)/2,z=-a.y+tz*(p.u+q.u)/2+nz*(p.out+q.out)/2,angle=-Math.atan2(tz*du+nz*doff,tx*du+nx*doff);
            box('five-curved-balcony-slabs',trim,x,y+.12,z,len+.02,.2,.45,angle);
            box('five-curved-balcony-handrails',metal,x,y+1.08,z,len+.015,.055,.06,angle);
            if(f===levels-1)box('five-curved-top-parapets',trim,x,y+.48,z,len+.02,.56,.16,angle);
            else for(let v=0;v<2;v++)box('five-balcony-metal-balusters',metal,x+(v-.5)*du/2*tx,y+.66,z+(v-.5)*du/2*tz,.035,.82,.035);
          }
          for(const side of[-1,1])put('five-balcony-side-piers',trim,u+side*w/2,y+floor/2,.34,.19,floor-.2,.72);
          if(f===0)for(let k=0;k<8;k++)put('five-ground-security-bars',metal,u+(k-3.5)*w/8,y+floor*.51,.4,.03,floor*.87,.035);
          const ac=u+pitch*.43;
          put('five-ac-housings',trim,ac,y+floor*.64,.51,.64,.65,.35);
          for(const side of[-1,1])put('five-ac-cage-side-frames',dark,ac+side*.43,y+floor*.65,.65,.045,.93,.59);
          for(let l=0;l<6;l++)put('five-ac-cage-horizontal-slats',dark,ac,y+floor*.65+(l-2.5)*.15,.96,.88,.055,.055);
        }else{
          const width=Math.min(2.05,pitch*.66),cy=y+floor*.55;
          put('five-secondary-window-reveal',trim,u,cy,.1,width+.18,1.9,.15);
          put('five-secondary-window-glazing',glass,u,cy,.19,width,1.7,.055);
          put('five-secondary-window-mullions',metal,u,cy,.23,.055,1.7,.06);
          put('five-secondary-window-transoms',metal,u,cy+.42,.23,width,.055,.06);
          if(length>13&&(c+f)%2===0){put('five-secondary-ac-box',trim,u+width*.62,cy-.72,.45,.72,.5,.35);put('five-secondary-ac-grille',dark,u+width*.62,cy-.72,.64,.53,.34,.035);}
        }
      }
      if(south){
        const width=Math.min(6.2,pitch*1.35),half=width/2,spring=base+height-.98,top=base+height+1.25;
        // Actual arch opening through a parapet silhouette: the underside is
        // a semicircular cut-out, not a dark circle pasted onto a rectangle.
        const arch=new THREE.Shape();arch.moveTo(-half-.28,spring);arch.lineTo(-half-.28,top);arch.lineTo(half+.28,top);arch.lineTo(half+.28,spring);arch.lineTo(half,spring);
        for(let k=0;k<=24;k++){const angle=k/24*Math.PI;arch.lineTo(Math.cos(angle)*half,spring+Math.sin(angle)*1.85);}arch.lineTo(-half-.28,spring);
        const o=mesh('five-top-arched-parapet',new THREE.ExtrudeGeometry(arch,{depth:.27,bevelEnabled:false,curveSegments:24}),trim);o.position.set(a.x+tx*length/2+nx*.22,0,-a.y+tz*length/2+nz*.22);o.rotation.y=Math.atan2(nx,nz);
      }
    }
  }
  for(const{name,material,items}of batches.values()){const o=new THREE.InstancedMesh(boxGeo,material,items.length);o.name=name;items.forEach((m,i)=>o.setMatrixAt(i,m));o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();o.castShadow=true;o.receiveShadow=true;o.renderOrder=205;o.userData={...meta(name),instanceCount:items.length};group.add(o);}
  for(const{geometry,items,width}of decks.values()){const o=new THREE.InstancedMesh(geometry,trim,items.length);o.name='five-curved-balcony-decks';items.forEach((m,i)=>o.setMatrixAt(i,m));o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();o.castShadow=true;o.receiveShadow=true;o.renderOrder=205;o.userData={...meta(o.name),instanceCount:items.length,deckWidth:width,closedSolid:true};group.add(o);}
  return group;
}
