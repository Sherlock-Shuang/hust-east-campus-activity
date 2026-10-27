import {createArchitecturalMaterials,applyBuildingUV} from './architectural-materials.js';
import {getBuildingProfile} from './building-profiles.js';
import {resolveEastNineArcadeScale} from './east-nine-scale.js';
/** East Nine / Shaw teaching building: source-footprint architectural detail.
 * Source geometry: OSM way/1023544717 and raised part way/1528957937.
 * Sources identify five levels and building:min_level=3; photographs recorded
 * in docs/research.md identify four wings, the glazed east arcade, round columns,
 * pale tiled walls and window grids. Heights, bay spacing and materials below
 * are architectural estimates. No old WORLD coordinate or rectangular proxy is
 * used. Horizontal roof/wing/bridge boundaries are the supplied source shapes.
 */
export function createEastNineDetails(THREE, record, profile = {}) {
  if(record?.id!=='way/1023544717'||!record.shapes?.length)throw new TypeError('East Nine details require the source way/1023544717 record and projected shapes.');
  const bridgeRecord=(profile.parts||[]).find(p=>p.id==='way/1528957937');
  if(!bridgeRecord?.shapes?.length)throw new TypeError('Source raised part way/1528957937 is required; refusing to fill the arcade with an invented solid shell.');
  const sourceLevels=Number(record.feature?.properties?.tags?.['building:levels']);
  const levels=sourceLevels>0?sourceLevels:5;
  const sourceProfile=getBuildingProfile(record.feature),bridgeProfile=getBuildingProfile(bridgeRecord.feature);
  const measuredHeight=sourceProfile.heightEvidence==='source-height';
  const height=measuredHeight?sourceProfile.height:Number(profile.height)>0?Number(profile.height):sourceProfile.height;
  const floorHeight=height/levels;
  const minLevel=Number(bridgeRecord.feature?.properties?.tags?.['building:min_level']);
  if(!(minLevel>0&&minLevel<levels))throw new RangeError('Raised source part requires a valid building:min_level below the roof.');
  const arcadeScale=resolveEastNineArcadeScale(height,{explicitMinHeight:bridgeProfile.baseHeightEvidence==='source-min-height'?bridgeProfile.baseHeight:null,sourceMinLevel:minLevel,floorHeight});
  const clearHeight=arcadeScale.clearHeight,baseY=Number.isFinite(profile.baseHeight)?profile.baseHeight:(record.mesh?.position?.y??.065);
  if(!(clearHeight>=0&&clearHeight<height))throw new RangeError('Raised source part minimum height must be below its roof.');
  const group=new THREE.Group();group.name='东九 · 四翼与架空弧廊';
  const provenance={footprint:'Unmodified projected OSM source rings; bridge strip subtracted along shared source vertices.',
    levels:{value:levels,status:'source',source:record.feature?.properties?.sourceUrl||'https://www.openstreetmap.org/way/1023544717'},
    minLevel:{value:minLevel,status:'source',source:bridgeRecord.feature?.properties?.sourceUrl||'https://www.openstreetmap.org/way/1528957937'},
    height:{value:height,status:measuredHeight?'source':'inferred',method:measuredHeight?'Explicit source height in metres':`${levels} source levels × ${floorHeight.toFixed(3)} m estimated storey height`},
    arcadeScale,
    details:{status:'inferred',method:'Photo-informed pale tiled walls, three continuous silver glazing ribbons with split panes, slender circular arcade columns, and the A east stairwell with broad entrance stairs; exact bay spacing, dimensions and elevations estimated',photos:[...arcadeScale.photos,'https://www.hust.edu.cn/images/22/09/29/1z26t6x3br/11.jpg','https://www.hust.edu.cn/images/22/09/29/1z26t6x3br/12.jpg']},
    caveat:arcadeScale.explanation+' Building height, facade dimensions and terrain are not measured unless explicit metre tags are present.'};
  const stats={wingCount:0,windowCount:0,glazingPaneCount:0,openGlazingPaneCount:0,columnCount:0,parapetSegments:0,mainArea:0,wingArea:0,bridgeArea:0,height,clearHeight,levels,minLevel};
  group.userData={feature:record.feature,featureId:record.id,category:'building',detailModel:'east-nine-source-footprint',
    heightMode:measuredHeight?'source-height-photo-details':'estimated-photo-details',heightIsMeasured:measuredHeight,displayHeightMeters:height,provenance,stats,units:'metres'};
  const ownedTextures=new Set();
  const finishes=createArchitecturalMaterials(THREE,{squareTiles:true,weathering:.10});
  group.disposeArchitecturalTextures=()=>{finishes.dispose();ownedTextures.forEach(texture=>texture.dispose());};
  const mats={
    wall:finishes.wall('#e0e2df'),
    trim:new THREE.MeshStandardMaterial({color:'#deded4',roughness:.83,side:THREE.DoubleSide}),
    roof:new THREE.MeshStandardMaterial({color:'#b6ab9b',roughness:.95,side:THREE.DoubleSide}),
    // The local photographs show pale silver reflections, not a continuous
    // green opaque strip. Pane variants share one geometry and few draw calls.
    bandSilver:new THREE.MeshStandardMaterial({color:'#c5cdd0',roughness:.25,metalness:.18,envMapIntensity:.85,side:THREE.DoubleSide}),
    bandCool:new THREE.MeshStandardMaterial({color:'#b8c3c9',roughness:.27,metalness:.16,envMapIntensity:.8,side:THREE.DoubleSide}),
    bandPale:new THREE.MeshStandardMaterial({color:'#d4d8d7',roughness:.29,metalness:.14,envMapIntensity:.8,side:THREE.DoubleSide}),
    bandShade:new THREE.MeshStandardMaterial({color:'#aab8bd',roughness:.29,metalness:.18,envMapIntensity:.85,side:THREE.DoubleSide}),
    bandOpen:new THREE.MeshStandardMaterial({color:'#80afc6',roughness:.22,metalness:.22,envMapIntensity:.95,side:THREE.DoubleSide}),
    windowRecess:new THREE.MeshStandardMaterial({color:'#3a4245',roughness:.7,side:THREE.DoubleSide}),
    soffit:new THREE.MeshStandardMaterial({color:'#bfc3c0',roughness:.92,side:THREE.DoubleSide}),
    glass:new THREE.MeshStandardMaterial({color:'#9ba9a7',roughness:.32,metalness:.48,side:THREE.DoubleSide}),
    glassDark:new THREE.MeshStandardMaterial({color:'#667b7c',roughness:.36,metalness:.34,side:THREE.DoubleSide}),
    frame:new THREE.MeshStandardMaterial({color:'#454d50',roughness:.45,metalness:.25,side:THREE.DoubleSide}),
    vent:new THREE.MeshStandardMaterial({color:'#a9afa5',roughness:.85,side:THREE.DoubleSide}),
    gold:new THREE.MeshStandardMaterial({color:'#bf9e54',roughness:.45,metalness:.35,side:THREE.DoubleSide}),
  };
  const boxGeometry=new THREE.BoxGeometry(1,1,1),columnGeometry=new THREE.CylinderGeometry(1,1,1,24);
  const batches=new Map(),dummy=new THREE.Object3D();
  function metadata(component,source=record,extra={}){return {...group.userData,feature:source.feature,featureId:source.id,component,...extra};}
  function batch(key,geometry,material,x,y,z,sx,sy,sz,yaw=0,component='facade-detail',source=record,pitch=0){
    if(!batches.has(key))batches.set(key,{geometry,material,component,source,items:[]});
    batches.get(key).items.push({x,y,z,sx,sy,sz,yaw,pitch});
  }
  function box(material,x,y,z,sx,sy,sz,yaw=0,component='facade-detail',source=record,pitch=0){batch(`${component}/${Object.keys(mats).find(k=>mats[k]===material)}/${source.id}`,boxGeometry,material,x,y,z,sx,sy,sz,yaw,component,source,pitch);}
  function strip(a,b,y,tall,depth,material,offset=0,component='floor-band',source=record){
    const dx=b.x-a.x,dz=-(b.y-a.y),length=Math.hypot(dx,dz);if(length<.02)return;
    const nx=-dz/length,nz=dx/length;
    box(material,(a.x+b.x)/2+nx*offset,y,-(a.y+b.y)/2+nz*offset,length,tall,depth,Math.atan2(-dz,dx),component,source);
  }
  function points(path){const p=path.getPoints(1).map(v=>v.clone());if(p.length>1&&p[0].distanceTo(p.at(-1))<1e-7)p.pop();return p;}
  const same=(a,b)=>a.distanceToSquared(b)<1e-10;
  function area(shape){return Math.abs(THREE.ShapeUtils.area(points(shape)))-shape.holes.reduce((sum,h)=>sum+Math.abs(THREE.ShapeUtils.area(points(h))),0);}
  function inside(point,ring){let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }return result;}
  function centre(ring){const sum=ring.reduce((s,p)=>s.add(p),new THREE.Vector2());return sum.multiplyScalar(1/ring.length);}
  function cloneShape(shape){return shape.clone();}
  // In the actual data every raised-part vertex lies on the main source ring.
  // The four perimeter chains skipped by the raised-part ring are exactly the
  // four teaching wings, so the subtraction needs no arbitrary clipping box.
  const mainShape=record.shapes[0],bridgeShape=cloneShape(bridgeRecord.shapes[0]);
  const outer=points(mainShape),bridge=points(bridgeShape);
  // This source vertex is shared by the mapped A-north entrance footway
  // way/655063746. Leave the ground-floor facade clear for the separately
  // reconstructed entrance; door dimensions themselves are not source data.
  const entryIndex=record.feature.geometry.coordinates[0].findIndex(c=>Math.abs(c[0]-114.4215014)<1e-7&&Math.abs(c[1]-30.5164424)<1e-7);
  const entryPoint=entryIndex>=0?outer[entryIndex]:null;
  // The photographed A tower faces east. It is distinct from the mapped north
  // footway door above; never move that source junction to match a photograph.
  const aEndIndices=[[114.4221113,30.5161631],[114.4221485,30.5163435]].map(c=>record.feature.geometry.coordinates[0].findIndex(v=>Math.abs(v[0]-c[0])<1e-7&&Math.abs(v[1]-c[1])<1e-7));
  const aEnd=aEndIndices.every(i=>i>=0)?aEndIndices.map(i=>outer[i]):null;
  if(entryPoint){const a=outer[(entryIndex-1+outer.length)%outer.length],b=outer[(entryIndex+1)%outer.length],dx=b.x-a.x,dz=-(b.y-a.y),length=Math.hypot(dx,dz);let nx=-dz/length,nz=dx/length;
    if(inside(new THREE.Vector2(entryPoint.x+nx*.5,entryPoint.y-nz*.5),outer)){nx=-nx;nz=-nz;}
    const entry=createEastNineEntrance(THREE,{x:entryPoint.x,y:baseY+.075,z:-entryPoint.y,yaw:Math.atan2(nx,nz),sourceBuildingId:record.id,sourceFootwayId:'way/655063746',locationEvidence:'source footway endpoint shares this source exterior vertex',detailEvidence:'inferred double glass doors, framing and canopy; dimensions not surveyed'});
    entry.traverse(object=>{object.userData={...metadata(object.userData.component||'estimated-building-entry'),...object.userData};});group.add(entry);
  }
  const indices=bridge.map(p=>outer.findIndex(q=>same(p,q)));
  if(indices.some(i=>i<0))throw new RangeError('Raised-part ring no longer shares source vertices with the main footprint; source topology must be reviewed.');
  const forward=Math.sign(THREE.ShapeUtils.area(outer))===Math.sign(THREE.ShapeUtils.area(bridge))?1:-1;
  const wings=[];
  for(let i=0;i<indices.length;i++){
    const start=indices[i],end=indices[(i+1)%indices.length],chain=[outer[start].clone()];let cursor=start;
    for(let guard=0;guard<outer.length;guard++){cursor=(cursor+forward+outer.length)%outer.length;chain.push(outer[cursor].clone());if(cursor===end)break;}
    if(chain.length>2&&Math.abs(THREE.ShapeUtils.area(chain))>1){const shape=new THREE.Shape(chain);wings.push({shape,chain,centroid:centre(chain)});}
  }
  if(wings.length!==4)throw new RangeError(`Source topology yielded ${wings.length} wings; expected the four observed wings without inventing geometry.`);
  for(const hole of mainShape.holes){
    const ring=points(hole),targets=[...wings.map(w=>w.shape),bridgeShape].filter(s=>ring.every(p=>inside(p,points(s))));
    if(targets.length!==1)throw new RangeError('A source hole crosses the bridge partition; refusing to fill or alter it.');
    targets[0].holes.push(hole.clone());
  }
  stats.mainArea=area(mainShape);stats.wingArea=wings.reduce((sum,w)=>sum+area(w.shape),0);stats.bridgeArea=area(bridgeShape);
  if(Math.abs(stats.mainArea-stats.wingArea-stats.bridgeArea)>Math.max(.001,stats.mainArea*1e-7))throw new RangeError('Wing/bridge partition does not preserve the source footprint area.');
  wings.sort((a,b)=>b.centroid.y-a.centroid.y);stats.wingCount=wings.length;
  function extrude(shapes,bottom,depth,material,component,source=record,extra={}){
    const geometry=new THREE.ExtrudeGeometry(shapes,{depth,bevelEnabled:false,steps:1,curveSegments:1});
    applyBuildingUV(geometry);
    const mesh=new THREE.Mesh(geometry,material);mesh.rotation.x=-Math.PI/2;mesh.position.y=baseY+bottom;
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.renderOrder=200;mesh.userData=metadata(component,source,extra);group.add(mesh);return mesh;
  }
  for(const [index,wing]of wings.entries())extrude(wing.shape,0,height,mats.wall,'teaching-wing',record,{wingLabel:'ABCD'[index]});
  const raised=extrude(bridgeShape,clearHeight,height-clearHeight,mats.wall,'raised-bridge',bridgeRecord,{sourceMinLevel:minLevel,clearHeight});
  // One complete roof uses the original source shapes, including original holes.
  extrude(record.shapes,height-.02,.24,mats.roof,'source-outline-roof');
  function facadeWindows(ring,floors,low,storey,pitch,component,source=record,skipLast=false){
    const normalSign=THREE.ShapeUtils.area(ring)>=0?1:-1;
    const edgeCount=skipLast?ring.length-1:ring.length;
    for(let i=0;i<edgeCount;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=-(b.y-a.y),length=Math.hypot(dx,dz);
      if(length<2.25||(aEnd&&((same(a,aEnd[0])&&same(b,aEnd[1]))||(same(b,aEnd[0])&&same(a,aEnd[1])))))continue;
      const ux=dx/length,uz=dz/length,nx=-uz*normalSign,nz=ux*normalSign,yaw=Math.atan2(-dz,dx);
      const bays=Math.max(1,Math.floor((length-.6)/pitch)),spacing=(length-.6)/bays,glassWidth=Math.min(spacing-.3,pitch*.82),glassHeight=Math.max(.7,Math.min(storey*.60,2.35));
      for(let floor=0;floor<floors;floor++){
        const y=baseY+low+floor*storey+storey*.54;
        for(let bay=0;bay<bays;bay++){
          const t=.3+(bay+.5)*spacing,x=a.x+ux*t+nx*.075,z=-a.y+uz*t+nz*.075;
          if(floor===0&&entryPoint&&Math.hypot(x-entryPoint.x,z+entryPoint.y)<1.7+glassWidth/2)continue;
          box((bay+floor)%7===0?mats.glassDark:mats.glass,x,y,z,glassWidth,glassHeight,.09,yaw,component,source);stats.windowCount++;
          for(const along of[-glassWidth/2,-glassWidth/4,0,glassWidth/4,glassWidth/2])box(mats.frame,x+ux*along+nx*.06,y,z+uz*along+nz*.06,.045,glassHeight+.08,.065,yaw,'window-mullion',source);
          for(const vertical of[-glassHeight/2,0,glassHeight/2])box(mats.frame,x+nx*.07,y+vertical,z+nz*.07,glassWidth+.08,.045,.065,yaw,'window-mullion',source);
          for(const side of[-1,1])box(mats.trim,x+ux*side*(glassWidth/2+.075)+nx*.03,y,z+uz*side*(glassWidth/2+.075)+nz*.03,.13,glassHeight+.25,.20,yaw,'wing-window-jamb',source);
          box(mats.trim,x+nx*.13,y-glassHeight/2-.08,z+nz*.13,glassWidth+.28,.13,.34,yaw,'wing-window-sill',source);
          if((bay+floor)%2===0){const ax=x+ux*(glassWidth*.42)+nx*.43,az=z+uz*(glassWidth*.42)+nz*.43,ay=y-glassHeight*.37;
            box(mats.trim,ax,ay,az,.73,.52,.36,yaw,'wing-air-conditioner',source);
            for(let slat=0;slat<5;slat++)box(mats.vent,ax+nx*.19,ay+(slat-2)*.075,az+nz*.19,.56,.022,.025,yaw,'wing-air-conditioner-grille',source);
          }
        }
        strip(a,b,baseY+low+floor*storey+.18,.18,.16,mats.trim,normalSign*.05,'floor-band',source);
      }
    }
  }
  for(const wing of wings)facadeWindows(wing.chain,levels,0,floorHeight,3.55,'wing-window',record,true);

  if(aEnd){
    const [a,b]=aEnd,mid=a.clone().lerp(b,.5),length=a.distanceTo(b);
    let nx=(b.y-a.y)/length,nz=(b.x-a.x)/length;
    if(inside(new THREE.Vector2(mid.x+nx*.5,mid.y-nz*.5),outer)){nx=-nx;nz=-nz;}
    const tx=nz,tz=-nx,yaw=Math.atan2(nx,nz),stairX=Math.min(4.0,length*.20),groundDatum=Math.max(baseY,.14),landingY=groundDatum+.98;
    const entryDetail=new THREE.Group();entryDetail.name='A 东端 · 楼梯玻璃带与宽台阶';entryDetail.userData=metadata('photo-east-entry',record,{locationEvidence:'east-end source edge, independently distinguished from mapped north footway entrance',detailEvidence:'local east-nine-approach photograph; pane layout, steps and dimensions estimated',walkSurfaces:[]});group.add(entryDetail);
    const worldPoint=(x,z)=>({x:mid.x+tx*x+nx*z,z:-mid.y+tz*x+nz*z});
    function towerBox(material,x,y,z,sx,sy,sz,component){const p=worldPoint(x,z);box(material,p.x,y,p.z,sx,sy,sz,yaw,component,record);}
    // The approach photograph shows large cladding-panel joints on the end
    // wall. Keep these shallow and behind the recessed glazing and balcony.
    for(let floor=1;floor<levels;floor++)for(const offset of[-.20,.04])towerBox(mats.stain,0,baseY+floor*floorHeight+offset,.025,length,.022,.012,'a-end-panel-joint');
    for(let x=-length/2+2.6;x<length/2;x+=2.6)if(Math.abs(x-stairX)>2.75)towerBox(mats.stain,x,baseY+height/2,.025,.022,height-.14,.012,'a-end-panel-joint');
    function walkSurface(id,x,z,width,depth,surfaceY){entryDetail.userData.walkSurfaces.push({id,kind:'entry-step',polygon:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([dx,dz])=>worldPoint(x+dx*width/2,z+dz*depth/2)),holes:[],surfaceY,evidence:'photo-estimated A east entrance stairs; not a surveyed elevation'});}
    towerBox(mats.trim,stairX,(groundDatum+landingY)/2,.90,7.0,.98,1.8,'a-entry-landing');
    walkSurface('east-nine-a-east-landing',stairX,.90,7,1.8,landingY);
    for(let step=0;step<7;step++){
      const h=(step+1)*.14,z=1.8+(6-step+.5)*.40;
      towerBox(mats.trim,stairX,groundDatum+h/2,z,7,h,.40,'a-entry-stair');
      towerBox(mats.soffit,stairX,groundDatum+h-.025,z+.19,7,.045,.035,'a-entry-stair-nosing');
      walkSurface(`east-nine-a-east-step-${step+1}`,stairX,z,7,.4,groundDatum+h);
    }
    // The broad blank wall remains the unmodified source shell. A single
    // vertical glazing slot and projecting balconies occupy its right side.
    for(const side of[-1,1])towerBox(mats.trim,stairX+side*2.72,baseY+height/2,.19,.24,height-.30,.42,'a-stairwell-jamb');
    for(let floor=1;floor<levels;floor++){
      const bottom=baseY+floor*floorHeight+.30,windowHeight=Math.min(2.85,floorHeight-.65),y=bottom+windowHeight/2;
      towerBox(mats.windowRecess,stairX,y,.035,5.12,windowHeight+.20,.045,'a-stairwell-recess');
      for(let pane=0;pane<5;pane++)towerBox(pane%3===0?mats.glassDark:mats.glass,stairX+(pane-2)*.98,y,.075,.93,windowHeight,.05,'a-stairwell-glazing');
      for(let division=0;division<=5;division++)towerBox(mats.frame,stairX+(division-2.5)*.98,y,.12,.045,windowHeight+.10,.06,'a-stairwell-frame');
      for(const level of[-.5,0,.5])towerBox(mats.frame,stairX,y+level*windowHeight,.12,4.95,.045,.06,'a-stairwell-frame');
      towerBox(mats.trim,stairX,bottom-.10,.42,5.65,.20,1.05,'a-stairwell-balcony-slab');
      towerBox(mats.trim,stairX,bottom+.22,.89,5.55,.58,.16,'a-stairwell-balcony-parapet');
      for(const level of[.63,.82,1.01])towerBox(mats.vent,stairX,bottom+level,.91,5.40,.028,.028,'a-stairwell-balcony-rail');
      for(const along of[-2.68,0,2.68])towerBox(mats.vent,stairX+along,bottom+.78,.91,.032,.58,.032,'a-stairwell-balcony-rail');
    }
    const doorHeight=Math.min(2.72,floorHeight-.95);
    towerBox(mats.windowRecess,stairX,landingY+doorHeight/2,.035,5.1,doorHeight+.12,.04,'a-east-door-recess');
    for(let pane=0;pane<4;pane++){
      const x=stairX+(pane-1.5)*1.20;
      towerBox(mats.glassDark,x,landingY+doorHeight/2,.10,1.14,doorHeight,.06,'a-east-glass-door');
      for(const side of[-1,1])towerBox(mats.vent,x+side*.58,landingY+doorHeight/2,.16,.045,doorHeight+.08,.06,'a-east-door-frame');
      if(pane===1||pane===2)towerBox(mats.vent,x+(pane===1?.42:-.42),landingY+1.12,.24,.025,.65,.045,'a-east-door-handle');
    }
    for(const level of[landingY,landingY+doorHeight])towerBox(mats.vent,stairX,level,.16,4.85,.065,.065,'a-east-door-frame');
    // Canvas supplies Chinese glyph outlines only, never a billboard panel.
    // Its pale-gold embossed appearance follows the photographed vertical title.
    if(typeof document!=='undefined'){
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=1536;const context=canvas.getContext('2d');
      if(context){context.clearRect(0,0,256,1536);context.textAlign='center';context.textBaseline='middle';context.font='bold 204px "Songti SC", "Noto Serif CJK SC", serif';context.lineWidth=7;context.strokeStyle='#78603b';context.fillStyle='#e3c17a';
        [...'逸夫教学楼'].forEach((glyph,i)=>{context.strokeText(glyph,128,145+i*286);context.fillText(glyph,128,141+i*286);});
        const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;ownedTextures.add(texture);
        const material=new THREE.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.12,roughness:.55,metalness:.12,side:THREE.DoubleSide});
        const title=new THREE.Mesh(new THREE.PlaneGeometry(1.65,9.9),material),p=worldPoint(-2.15,.14);title.position.set(p.x,baseY+height-5.8,p.z);title.rotation.y=yaw;title.renderOrder=201;title.userData=metadata('a-vertical-building-title',record,{text:'逸夫教学楼',evidence:'visible local approach photograph; size estimated'});group.add(title);
      }
    }
    entryDetail.userData.dimensions={landingHeight:.98,steps:7,riser:.14,tread:.40,width:7,glazingWidth:4.9,status:'photo-estimated'};
  }

  // Three continuous glazed ribbons follow every source edge all the way to its
  // endpoints. Those endpoints are survey vertices, not white structural piers.
  // The source shell is the tiled spandrel/backing; panes sit 5 cm outside it,
  // fine dark mullions another 4 cm out, giving a real recess at walking height.
  const upperStorey=(height-clearHeight-.16)/3,glazingHeight=upperStorey*arcadeScale.glazingFractionOfUpperStorey;
  const bandPalette=[mats.bandSilver,mats.bandCool,mats.bandPale,mats.bandShade];
  const bandNormalSign=THREE.ShapeUtils.area(bridge)>=0?1:-1;
  const curtainwallEdges=[];
  for(let edge=0;edge<bridge.length;edge++){
    const a=bridge[edge],b=bridge[(edge+1)%bridge.length],dx=b.x-a.x,dz=-(b.y-a.y),length=Math.hypot(dx,dz);
    if(length<.08)continue;
    const ux=dx/length,uz=dz/length,nx=-uz*bandNormalSign,nz=ux*bandNormalSign,yaw=Math.atan2(-dz,dx);
    const bays=Math.max(1,Math.round(length/1.05)),spacing=length/bays,paneWidth=spacing-.045;
    curtainwallEdges.push({edge,length,bays,endInset:0,mullionWidth:.045});
    for(let floor=0;floor<3;floor++){
      const y=baseY+clearHeight+.16+upperStorey*(floor+.47),halfHeight=glazingHeight/2-.025;
      strip(a,b,y,glazingHeight+.04,.025,mats.windowRecess,bandNormalSign*.024,'arcade-window-recess',bridgeRecord);
      for(let bay=0;bay<bays;bay++){
        const t=(bay+.5)*spacing,x=a.x+ux*t,z=-a.y+uz*t;
        for(let pane=0;pane<2;pane++){
          const hash=(edge*29+bay*11+floor*19+pane*7),open=pane===0&&hash%71===0;
          const angle=open?.18:0,paneY=y+(pane===0?-1:1)*glazingHeight/4+halfHeight/2*(1-Math.cos(angle));
          const outward=.056+halfHeight/2*Math.sin(angle),material=open?mats.bandOpen:bandPalette[hash%11<7?0:1+hash%3];
          box(material,x+nx*outward,paneY,z+nz*outward,paneWidth,halfHeight,.035,yaw,'arcade-glazing',bridgeRecord,-angle*bandNormalSign);
          stats.windowCount++;stats.glazingPaneCount++;if(open)stats.openGlazingPaneCount++;
          if(open){
            // A sparse bottom awning leaf opens around its top rail. Its own
            // frame tilts with the glass; the fixed curtain-wall grid stays put.
            for(const lx of[-paneWidth/2,paneWidth/2])box(mats.frame,x+ux*lx+nx*(outward+.025),paneY,z+uz*lx+nz*(outward+.025),.035,halfHeight+.03,.05,yaw,'arcade-open-leaf-frame',bridgeRecord,-angle*bandNormalSign);
            for(const ly of[-halfHeight/2,halfHeight/2])box(mats.frame,x+nx*(outward+.025-ly*Math.sin(angle)),paneY+ly*Math.cos(angle),z+nz*(outward+.025-ly*Math.sin(angle)),paneWidth+.035,.035,.05,yaw,'arcade-open-leaf-frame',bridgeRecord,-angle*bandNormalSign);
          }
        }
      }
      for(let bay=0;bay<=bays;bay++){
        const t=bay*spacing;box(mats.frame,a.x+ux*t+nx*.095,y,-a.y+uz*t+nz*.095,.045,glazingHeight+.08,.065,yaw,'window-mullion',bridgeRecord);
      }
      for(const vertical of[-glazingHeight/2,0,glazingHeight/2])strip(a,b,y+vertical,.045,.065,mats.frame,bandNormalSign*.095,'window-mullion',bridgeRecord);
      strip(a,b,y-glazingHeight/2-.065,.085,.15,mats.trim,bandNormalSign*.075,'arcade-window-drip-sill',bridgeRecord);
    }
  }
  group.userData.facadePhotoCalibration={status:'estimated-photo-details',glazingRows:3,panesPerVerticalBay:2,
    glazingFractionOfUpperStorey:arcadeScale.glazingFractionOfUpperStorey,glazingHeight,upperStorey,
    glass:'pale silver/cool grey individual panes with sparse blue outward-opening lower leaves',
    mullionWidth:.045,curtainwallEdges,columnDiameter:.88,columnSpacing:8.2,
    referencePhotos:arcadeScale.photos,unmeasured:['exact bay positions','pane colours','opening locations','column diameters','letter locations']};
  function parapets(shape,source=record){for(const ring of[points(shape),...shape.holes.map(points)]){
    const sign=THREE.ShapeUtils.area(ring)>=0?1:-1;
    for(let i=0;i<ring.length;i++){strip(ring[i],ring[(i+1)%ring.length],baseY+height+.36,.45,.25,mats.trim,-sign*.15,'roof-parapet',source);stats.parapetSegments++;}
  }}
  for(const shape of record.shapes)parapets(shape);
  // Sample true bridge cross-sections; column rows follow the source arc rather
  // than a fitted parabola. Circle radius and longitudinal spacing are estimates.
  const axis=bridge[5].clone().sub(bridge[0]).normalize(),normal=new THREE.Vector2(-axis.y,axis.x),anchor=bridge[0];
  const along=bridge.map(p=>p.clone().sub(anchor).dot(axis)),min=Math.min(...along),max=Math.max(...along);
  const columnPositions=[];
  function section(s){const cuts=[];for(let i=0;i<bridge.length;i++){
    const a=bridge[i],b=bridge[(i+1)%bridge.length],sa=a.clone().sub(anchor).dot(axis),sb=b.clone().sub(anchor).dot(axis);
    if((sa<=s&&sb>s)||(sb<=s&&sa>s)){const t=(s-sa)/(sb-sa),p=a.clone().lerp(b,t);cuts.push(p.clone().sub(anchor).dot(normal));}
  }return cuts.sort((a,b)=>a-b);}
  for(let s=min+4;s<max-3;s+=8.2){const cuts=section(s);if(cuts.length<2)continue;const left=cuts[0],right=cuts.at(-1);
    for(const fraction of[.22,.78]){const across=left+(right-left)*fraction,p=anchor.clone().addScaledVector(axis,s).addScaledVector(normal,across);
      if(!inside(p,bridge)||bridgeShape.holes.some(h=>inside(p,points(h))))continue;
      const radius=.44;batch('arcade-round-column',columnGeometry,mats.wall,p.x,baseY+clearHeight/2,-p.y,radius,clearHeight,radius,0,'arcade-round-column',bridgeRecord);
      batch('arcade-column-base',columnGeometry,mats.soffit,p.x,baseY+.055,-p.y,.455,.11,.455,0,'arcade-column-base',bridgeRecord);
      columnPositions.push({x:p.x,z:-p.y,radius});stats.columnCount++;
    }
  }
  // Raised slab fascia makes the open space readable from both sides.
  for(let i=0;i<bridge.length;i++)strip(bridge[i],bridge[(i+1)%bridge.length],baseY+clearHeight+.10,.20,.16,mats.trim,0,'arcade-deck-fascia',bridgeRecord);
  // Solid shallow glyphs with counters replace oversized stick-letter beams.
  // Their 0.78 m height is an appearance estimate from the local B identifier.
  function letterShape(letter){
    const shape=new THREE.Shape(),hole=points=>{const path=new THREE.Path();path.moveTo(...points[0]);points.slice(1).forEach(p=>path.lineTo(...p));path.closePath();shape.holes.push(path);};
    if(letter==='A'){
      [[0,0],[.30,1],[.49,1],[.82,0],[.62,0],[.55,.24],[.22,.24],[.15,0]].forEach((p,i)=>shape[i?'lineTo':'moveTo'](...p));shape.closePath();hole([[.28,.42],[.49,.42],[.38,.79]]);
    }else if(letter==='B'){
      shape.moveTo(0,0);shape.lineTo(0,1);shape.lineTo(.39,1);shape.bezierCurveTo(.80,1,.83,.58,.55,.52);shape.bezierCurveTo(.91,.46,.83,0,.40,0);shape.closePath();
      for(const [bottom,top]of[[.16,.43],[.60,.84]]){const h=new THREE.Path();h.moveTo(.18,bottom);h.lineTo(.18,top);h.lineTo(.37,top);h.bezierCurveTo(.61,top,.61,bottom,.37,bottom);h.closePath();shape.holes.push(h);}
    }else if(letter==='C'){
      shape.moveTo(.78,.88);shape.bezierCurveTo(.56,1.12,0,1.04,0,.50);shape.bezierCurveTo(0,-.04,.56,-.12,.78,.12);shape.lineTo(.65,.26);shape.bezierCurveTo(.48,.10,.19,.15,.19,.50);shape.bezierCurveTo(.19,.85,.48,.90,.65,.74);shape.closePath();
    }else{
      shape.moveTo(0,0);shape.lineTo(0,1);shape.lineTo(.31,1);shape.bezierCurveTo(.96,1,.96,0,.31,0);shape.closePath();const h=new THREE.Path();h.moveTo(.19,.17);h.lineTo(.19,.83);h.lineTo(.32,.83);h.bezierCurveTo(.69,.83,.69,.17,.32,.17);h.closePath();shape.holes.push(h);
    }
    return shape;
  }
  for(const [i,wing]of wings.entries()){
    const s=wing.centroid.clone().sub(anchor).dot(axis),cuts=section(Math.max(min+.5,Math.min(max-.5,s)));if(cuts.length<2)continue;
    const p1=anchor.clone().addScaledVector(axis,s).addScaledVector(normal,cuts[0]),p2=anchor.clone().addScaledVector(axis,s).addScaledVector(normal,cuts.at(-1));
    const p=p1.x>p2.x?p1:p2,nx=normal.x*(p===p2?1:-1),nz=-normal.y*(p===p2?1:-1);
    const geometry=new THREE.ExtrudeGeometry(letterShape('ABCD'[i]),{depth:.075,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:1,curveSegments:8});
    geometry.scale(.78,.78,1);geometry.translate(-.30,-.39,0);
    const letter=new THREE.Mesh(geometry,mats.gold);letter.rotation.y=Math.atan2(nx,nz);
    letter.position.set(p.x+nx*.14,baseY+clearHeight+.44,-p.y+nz*.14);letter.castShadow=true;letter.renderOrder=201;
    letter.userData=metadata('wing-letter',record,{wingLabel:'ABCD'[i],estimatedHeight:.78,letterForm:'filled bevelled outline with open counters'});group.add(letter);
  }
  for(const {geometry,material,component,source,items}of batches.values()){
    const mesh=new THREE.InstancedMesh(geometry,material,items.length);mesh.name=component;mesh.renderOrder=200;mesh.castShadow=true;mesh.receiveShadow=true;
    for(let i=0;i<items.length;i++){const item=items[i];dummy.position.set(item.x,item.y,item.z);dummy.rotation.set(0,item.yaw,0);if(item.pitch)dummy.rotateX(item.pitch);dummy.scale.set(item.sx,item.sy,item.sz);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);}
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.userData=metadata(component,source,{instanceCount:items.length});group.add(mesh);
  }
  const collisionRings=shape=>[points(shape),...shape.holes.map(points)].map(ring=>ring.map(p=>({x:p.x,z:-p.y})));
  group.userData.collisionBuildings=[...wings.map((wing,index)=>({id:`${record.id}/wing-${'ABCD'[index]}`,sourceId:record.id,rings:collisionRings(wing.shape),minHeight:baseY,height:baseY+height})),
    {id:bridgeRecord.id,sourceId:bridgeRecord.id,rings:collisionRings(bridgeShape),minHeight:baseY+clearHeight,height:baseY+height}];
  group.userData.columnPositions=columnPositions;
  group.userData.bridgeClearHeight=clearHeight;
  group.userData.roofHeight=height;
  group.userData.sourceFootprintPreserved=true;
  group.userData.raisedBridgeSourceId=bridgeRecord.id;
  // Exporter extras must remain JSON-safe; keep scene-object references outside userData.
  group.userData.raisedBridgeMeshUuid=raised.uuid;
  group.raisedBridgeMesh=raised;
  return group;
}

/** Estimated facade entrance at the source A-north footway / exterior junction.
 * The doors are opaque architectural surfaces, not a simulated indoor space. */
export function createEastNineEntrance(THREE,entry){
  const mat=(color,roughness=.7,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const box=(x,y,z)=>new THREE.BoxGeometry(x,y,z),housing=mat('#263135',.6);
  function mesh(geometry,material,parent){const object=new THREE.Mesh(geometry,material);object.castShadow=true;object.receiveShadow=true;object.renderOrder=205;parent.add(object);return object;}
    const holder=new THREE.Group();holder.name='东九 A 座入口 · 门扇细节推定';holder.position.set(entry.x,entry.y,entry.z);holder.rotation.y=entry.yaw;holder.userData={component:'estimated-building-entry',sourceId:entry.sourceBuildingId,sourceFootwayId:entry.sourceFootwayId,locationEvidence:entry.locationEvidence,detailEvidence:entry.detailEvidence};
    const stone=mat('#dddccf',.88),doorGlass=mat('#385c67',.24,.48),doorFrame=mat('#bac5bf',.38,.6);
    function part(name,geometry,material,x,y,z){const o=mesh(geometry,material,holder);o.position.set(x,y,z);o.userData={...holder.userData,component:name};return o;}
    part('entry-threshold',box(3.8,.12,2.3),stone,0,-.01,1.04);
    // Opaque glazing sits just outside the preserved source wall shell. The
    // trip ends on the threshold; this facade is not a navigable interior.
    part('door-recess',box(2.96,2.88,.14),housing,0,1.44,.13);
    for(const side of[-1,1]){part('door-jamb',box(.22,3.14,.4),stone,side*1.56,1.57,.22);part('double-glass-door',box(1.28,2.48,.10),doorGlass,side*.67,1.35,.23);for(const x of[side*.05,side*1.29])part('door-metal-frame',box(.055,2.52,.08),doorFrame,x,1.35,.3);for(const y of[.1,2.59])part('door-metal-frame',box(1.29,.06,.08),doorFrame,side*.67,y,.3);part('door-pull-handle',new THREE.CylinderGeometry(.017,.017,.58,8),doorFrame,side*.2,1.23,.39);}
    part('door-lintel',box(3.34,.3,.48),stone,0,3.05,.22);part('entry-canopy',box(3.85,.18,2.08),stone,0,3.32,.87);part('entry-canopy-trim',box(3.9,.075,.13),doorFrame,0,3.24,1.91);
    part('entry-letter-panel',box(.7,.62,.06),housing,0,2.98,.49);
    const gold=mat('#c3a463',.45,.35);for(const[a,b]of[[[-.18,2.76],[0,3.18]],[[0,3.18],[.18,2.76]],[[-.11,2.91],[.11,2.91]]]){const dx=b[0]-a[0],dy=b[1]-a[1],bar=part('entry-wing-letter-A',box(Math.hypot(dx,dy),.045,.035),gold,(a[0]+b[0])/2,(a[1]+b[1])/2,.53);bar.rotation.z=Math.atan2(dy,dx);}
  return holder;
}
