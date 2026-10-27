/** Building-specific visual evidence. Exact OSM identities are intentional:
 * a photograph of one hall must never become a rule for all campus buildings.
 * Source outlines/levels remain in the GeoJSON; projected details are estimates.
 */
const GYM_SOURCE='https://www.sohu.com/a/421773661_673149';
const ACTIVITY_SOURCE='https://thirdpage.thepaper.cn/h5/jrtt/31181759';
export const CAMPUS_LANDMARK_EVIDENCE=Object.freeze({
  'way/103488139':Object.freeze({
    id:'yunyuan-gym',name:'韵苑体育馆',sourceId:'way/103488139',sourceUrl:GYM_SOURCE,
    photos:['https://p7.itc.cn/q_70/images03/20200930/642b00fa001e45c288738553b158e824.jpeg','https://p9.itc.cn/q_70/images03/20200930/d59be1f7c3cd45e0a030c0b800541de0.jpeg'],
    observed:'2020 校方研究生招生实拍：浅石色大实墙、下部横向窄窗、南端梯形玻璃门洞与长引桥。',
    uncertainty:'门洞尺寸、板缝、窗格及5.5 m引桥展示高程均为估计；不表示测绘现状。',
    wallColor:'#d5d0be',roofColor:'#a7a69b',windowColor:'#596965',facadeModuleWidth:3.2,
    facadeFeatures:{balconies:false,stairTower:false,inferredEntrance:false,windowFloorLimit:0,airConditioners:false,landmarkDetails:'yunyuan-gym'},
    entry:[114.4291484,30.5152109],approach:[114.4290932,30.5146381],approachSourceId:'way/103488148',
  }),
  'way/1484333086':Object.freeze({
    id:'yunyuan-gym-plinth',name:'韵苑体育馆下部与引桥源部件',sourceId:'way/1484333086',sourceUrl:GYM_SOURCE,
    observed:'源一层部件含南向长引桥轮廓，保持其与三层主体的源几何关系。',
    uncertainty:'下部用途、高程和立面未完整核验，不复制普通建筑入口或窗格。',
    wallColor:'#aaa99b',roofColor:'#aeb0a5',facadeFeatures:{balconies:false,stairTower:false,inferredEntrance:false,windowFloorLimit:0,airConditioners:false},
  }),
  'way/103932379':Object.freeze({
    id:'yunyuan-activity-centre',name:'韵苑学生活动中心',sourceId:'way/103932379',sourceUrl:ACTIVITY_SOURCE,
    photos:['https://imagepphcloud.thepaper.cn/pph/image/352/747/498.jpg'],
    observed:'2025 校方实拍：两层暖灰米色翼楼、深窗框、低坡斜屋顶和挑檐、翼楼内转角处圆弧玻璃门厅。',
    uncertainty:'用源 L 形轮廓配准翼楼；圆弧门厅的配准、半径、檐口与坡度是外观估计，非测量立面。',
    wallColor:'#c2b49a',roofColor:'#777d73',windowColor:'#334b4d',facadeModuleWidth:3.5,windowWidth:1.55,windowHeight:2.0,
    roofForm:'landmark-hipped',roofRise:1.1,
    facadeFeatures:{balconies:false,stairTower:false,inferredEntrance:false,airConditioners:false,landmarkDetails:'yunyuan-activity-centre'},
    entry:[114.428988,30.5173633],
  }),
  'way/103814566':Object.freeze({
    id:'yunyuan-canteen',name:'韵苑学生食堂',sourceId:'way/103814566',sourceUrl:'https://www.sohu.com/a/251421839_154724',
    observed:'2018 校学生会报道与既有实拍：两层白色外墙、退入柱廊与入口圆形构件；源楼层数2。',
    uncertainty:'历史照片不保证当前立面状态，柱距、门洞和圆形构件尺寸为估计。',
    wallColor:'#e4e1d5',roofColor:'#93998c',windowColor:'#4f7270',
    facadeFeatures:{balconies:false,stairTower:false,inferredEntrance:true,airConditioners:false},
  }),
  'way/110398529':Object.freeze({
    id:'yunyuan-27',name:'韵苑27栋',sourceId:'way/110398529',sourceUrl:'https://www.openstreetmap.org/way/110398529',
    observed:'源地图确认韵苑二十七栋轮廓与6层。已有校园照片不足以定位其全部正反立面。',
    uncertainty:'普通窗墙仅作尺度示意；不添加未经该楼照片证明的连续阳台、楼梯塔或特定入口。',
    facadeFeatures:{balconies:false,stairTower:false,inferredEntrance:false},
  }),
});

export function getCampusLandmarkProfile(feature){
  const p=feature?.properties??feature??{},id=String(feature?.id??p.osmId??p.id??'');
  const evidence=CAMPUS_LANDMARK_EVIDENCE[id];
  return evidence?{...evidence,photos:[...(evidence.photos??[])],facadeFeatures:{...evidence.facadeFeatures}}:null;
}

function ringArea(ring){let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a.x*b.y-b.x*a.y;}return area/2;}
function pointsFor(shape){const ring=shape.getPoints().map(p=>p.clone());if(ring.length>1&&ring[0].distanceToSquared(ring.at(-1))<1e-8)ring.pop();return ring;}
function distanceToSegment(p,a,b){const x=b.x-a.x,y=b.y-a.y,l=x*x+y*y,t=l?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/l)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}

/** Standalone details, added to the holder after the unchanged source extrusion.
 * `geoToLocal` is the same explicit projection used by the campus scene.
 * Resources are owned by the returned group and disposed by campus traversal.
 */
export function createCampusLandmarkDetails(THREE,record,profile,{frame,geoToLocal}={}){
  const evidence=getCampusLandmarkProfile(record?.feature),kind=evidence?.facadeFeatures?.landmarkDetails;
  if(!kind||!record.shapes?.length)return null;
  if(typeof geoToLocal!=='function')throw new TypeError('Landmark details require the source WGS84 projection.');
  const group=new THREE.Group();group.name=`landmark-${kind}`;
  group.userData={component:'campus-landmark-details',category:'building',feature:record.feature,featureId:record.id,sourceId:record.id,sourceUrl:evidence.sourceUrl,photos:evidence.photos,
    observed:evidence.observed,uncertainty:evidence.uncertainty,sourceFootprintPreserved:true,dimensions:'display-estimates'};
  const height=profile.height,base=(profile.baseHeight??0)+.08;
  const materials=new Map(),boxGeo=new THREE.BoxGeometry(1,1,1),batches=new Map(),dummy=new THREE.Object3D();
  const mat=(color,roughness=.8,metalness=0)=>{const key=`${color}/${roughness}/${metalness}`;if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness,metalness,side:THREE.DoubleSide}));return materials.get(key);};
  const wall=mat(profile.wallColor),stone=mat('#e0d9c7'),glass=mat(profile.windowColor,.28,.35),frameMat=mat('#a9b1aa',.5,.3),roof=mat(profile.roofColor),dark=mat('#48504a');
  function mesh(name,geometry,material,parent=group){const o=new THREE.Mesh(geometry,material);o.name=name;o.castShadow=true;o.receiveShadow=true;o.renderOrder=204;o.userData={...group.userData,component:name};parent.add(o);return o;}
  function box(name,material,x,y,z,sx,sy,sz,yaw=0){const key=`${name}/${material.uuid}`;if(!batches.has(key))batches.set(key,{name,material,items:[]});dummy.position.set(x,y,z);dummy.rotation.set(0,yaw,0);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();batches.get(key).items.push(dummy.matrix.clone());}
  function projected(c){const p=geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);return new THREE.Vector3(p.x,0,p.z);}
  const entry=projected(evidence.entry);
  const rings=record.shapes.map(pointsFor);
  if(kind==='yunyuan-gym'){
    // Broad blind upper walls are the most distinctive part of this hall.
    for(const ring of rings){const sign=ringArea(ring)<0?-1:1;for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=-(b.y-a.y),len=Math.hypot(dx,dz);if(len<9)continue;
      const tx=dx/len,tz=dz/len,nx=-tz*sign,nz=tx*sign,yaw=-Math.atan2(tz,tx);
      const put=(name,material,u,y,out,sx,sy,sz)=>box(name,material,a.x+tx*u+nx*out,y,-a.y+tz*u+nz*out,sx,sy,sz,yaw);
      for(const y of[3.3,6.7]){
        put('gym-continuous-lower-glazing',glass,len/2,y,.12,len-.9,2.0,.1);
        for(const dy of[-1,0,1])put('gym-window-horizontal-frames',frameMat,len/2,y+dy,.2,len-.8,.055,.06);
        const count=Math.ceil(len/1.15);for(let k=0;k<=count;k++)put('gym-window-vertical-frames',frameMat,.45+(len-.9)*k/count,y,.2,.055,2.05,.06);
      }
      for(let y=8.25;y<height;y+=2.15)put('gym-upper-panel-joints',dark,len/2,y,.095,len,.035,.025);
      put('gym-upper-eave',stone,len/2,height+.13,.18,len+.15,.26,.55);
    }}
    const outward=projected(evidence.approach).sub(entry).normalize(),yaw=Math.atan2(outward.x,outward.z),entryGroup=new THREE.Group();
    entryGroup.name='gym-source-south-entry';entryGroup.position.copy(entry);entryGroup.rotation.y=yaw;group.add(entryGroup);
    const entryBase=5.5,doorTop=9.1,trapTop=Math.min(height-.9,13.4),half=3.65,topHalf=1.75;
    const trapezoid=new THREE.Shape([new THREE.Vector2(-half,doorTop),new THREE.Vector2(half,doorTop),new THREE.Vector2(topHalf,trapTop),new THREE.Vector2(-topHalf,trapTop)]);
    const glazing=mesh('gym-trapezoid-glazing',new THREE.ShapeGeometry(trapezoid),glass,entryGroup);glazing.position.z=.24;
    function localBox(name,material,x,y,z,sx,sy,sz,angle=0){const o=mesh(name,boxGeo,material,entryGroup);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.rotation.z=angle;return o;}
    localBox('gym-entry-doors',glass,0,(entryBase+doorTop)/2,.2,half*2,doorTop-entryBase,.1);
    for(const x of[-half,0,half])localBox('gym-entry-door-jambs',stone,x,(entryBase+doorTop)/2,.42,.22,doorTop-entryBase,.45);
    for(let x=-half+.45;x<half;x+=.5)localBox('gym-entry-grille',frameMat,x,(entryBase+doorTop)/2,.36,.035,doorTop-entryBase-.12,.04);
    for(const side of[-1,1]){const dx=side*(topHalf-half),dy=trapTop-doorTop,length=Math.hypot(dx,dy);localBox('gym-sloping-reveal',stone,side*(half+topHalf)/2,(doorTop+trapTop)/2,.42,length,.32,.45,Math.atan2(dy,dx));}
    for(const y of[doorTop,trapTop])localBox('gym-trapezoid-horizontal-reveal',stone,0,y,.4,(y===doorTop?half:topHalf)*2,.24,.4);
    for(const x of[-1.6,0,1.6])localBox('gym-trapezoid-mullions',frameMat,x,(doorTop+trapTop)/2,.3,.075,trapTop-doorTop-.2,.08);
    localBox('gym-entry-landing',stone,0,entryBase-.1,1.15,8.2,.2,2.4);
    entryGroup.userData={...group.userData,entrySourceCoordinate:evidence.entry,approachSourceId:evidence.approachSourceId,displayEntryElevation:entryBase};
  } else if(kind==='yunyuan-activity-centre'){
    // Source L-shaped wings get a continuous low hipped roof. The slope is
    // estimated from the photograph, not promoted to a source height tag.
    for(const ring of rings){
      const vertices=[],rise=evidence.roofRise;
      const roofY=p=>height+.08+rise*Math.min(1,Math.min(...ring.map((a,i)=>distanceToSegment(p,a,ring[(i+1)%ring.length])))/4);
      function triangle(a,b,c,depth=0){if(depth<5&&Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))>2.6){const ab=a.clone().lerp(b,.5),bc=b.clone().lerp(c,.5),ca=c.clone().lerp(a,.5);triangle(a,ab,ca,depth+1);triangle(ab,b,bc,depth+1);triangle(ca,bc,c,depth+1);triangle(ab,bc,ca,depth+1);return;}vertices.push(a.x,roofY(a),-a.y,b.x,roofY(b),-b.y,c.x,roofY(c),-c.y);}
      for(const[a,b,c]of THREE.ShapeUtils.triangulateShape(ring,[]))triangle(ring[a],ring[b],ring[c]);
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();mesh('activity-low-hipped-roof',geo,roof);
      const sign=ringArea(ring)<0?-1:1;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=-(b.y-a.y),len=Math.hypot(dx,dz);if(len<.2)continue;const nx=-dz/len*sign,nz=dx/len*sign;
        box('activity-deep-eave',stone,(a.x+b.x)/2+nx*.3,height+.04,-(a.y+b.y)/2+nz*.3,len+.12,.18,.8,-Math.atan2(dz,dx));}
    }
    // A faceted quarter-drum occupies the observed inner corner. Its source
    // anchor is retained; radius and detailed alignment remain an estimate.
    const radius=3.7,h=height-.4,count=12,arc=[];
    for(let i=0;i<=count;i++){const a=Math.PI+i*Math.PI/2;arc.push(new THREE.Vector3(entry.x+Math.cos(a)*radius,0,entry.z-Math.sin(a)*radius));}
    for(let i=0;i<count;i++){const a=arc[i],b=arc[i+1],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),yaw=-Math.atan2(dz,dx),x=(a.x+b.x)/2,z=(a.z+b.z)/2;
      box('activity-curved-foyer-glazing',glass,x,base+h/2,z,len+.015,h,.1,yaw);
      for(const y of[base+.08,base+h*.46,base+h*.78,base+h])box('activity-foyer-horizontal-frame',frameMat,x,y,z,len+.03,.065,.14,yaw);
      box('activity-curved-sign-fascia',stone,x,height+.04,z,len+.04,.56,.34,yaw);
    }
    for(let i=0;i<=count;i++){const p=arc[i];box('activity-foyer-mullion',i%6===0?stone:frameMat,p.x,base+h/2,p.z,i%6===0?.28:.055,h,.12);}
    const signPanel=mesh('activity-curved-foyer-roof',new THREE.CylinderGeometry(radius,radius,.12,24,1,false,Math.PI*1.5,Math.PI/2),roof);signPanel.position.set(entry.x,height+.35,entry.z);
    group.userData.entrySourceCoordinate=evidence.entry;group.userData.foyerRadiusEstimate=radius;
  }
  for(const {name,material,items}of batches.values()){const o=new THREE.InstancedMesh(boxGeo,material,items.length);o.name=name;items.forEach((m,i)=>o.setMatrixAt(i,m));o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();o.castShadow=true;o.receiveShadow=true;o.renderOrder=204;o.userData={...group.userData,component:name,instanceCount:items.length};group.add(o);}
  return group;
}
