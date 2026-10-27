/** Data-driven campus layers. Geometry comes only from the supplied GeoJSON.
 * Coordinates: WGS84 -> explicit local ENU frame; Three x=east,y=up,z=south.
 * The displayed datum plane is flat because no surveyed terrain is supplied.
 * OSM source tags are observations, not a claim of survey-grade accuracy.
 */
export function createGeoScene(THREE, scene, featureCollection, frame, projectionFn) {
  if(featureCollection?.type!=='FeatureCollection'||!Array.isArray(featureCollection.features))throw new TypeError('Expected a GeoJSON FeatureCollection.');
  if(frame?.sourceDatum!=='EPSG:4326'||frame?.units!=='metres')throw new TypeError('An explicit WGS84 local frame in metres is required.');
  if(typeof projectionFn!=='function')throw new TypeError('A WGS84-to-local projection function is required.');
  const statedCRS=featureCollection.coordinateSystem??featureCollection.metadata?.coordinateSystem??featureCollection.properties?.coordinateSystem;
  if(statedCRS&&!['EPSG:4326','WGS84','WGS-84'].includes(statedCRS))throw new RangeError(`Unsupported GeoJSON datum ${statedCRS}; transform explicitly first.`);
  const group=new THREE.Group();group.name='东校区 · 真实坐标数据底座';scene.add(group);
  group.userData={coordinateSystem:'LOCAL_ENU',units:'metres',sourceDatum:'EPSG:4326',terrain:'Flat display datum; terrain elevations unavailable'};
  const featureMeshes=new Map(),buildings=[],roads=[],water=[],records=[],warnings=[];
  const bounds={minX:Infinity,maxX:-Infinity,minY:0,maxY:0,minZ:Infinity,maxZ:-Infinity};
  const counts={building:0,road:0,water:0,green:0,sports:0,boundary:0,poi:0,other:0,knownHeight:0,unknownHeight:0,buildingParts:0,levelsTagged:0,levelsAvailable:0,knownRoadWidth:0,unknownRoadWidth:0,skipped:0};
  const layers=new Map();let symbolicHeights=false;
  const materials={
    building:new THREE.MeshStandardMaterial({color:'#d9dedb',roughness:.92,metalness:0,side:THREE.DoubleSide}),
    sourced:new THREE.MeshStandardMaterial({color:'#b8c9cd',roughness:.85,metalness:0,side:THREE.DoubleSide}),
    symbolic:new THREE.MeshStandardMaterial({color:'#c6a263',roughness:.9,metalness:0,side:THREE.DoubleSide}),
    road:new THREE.MeshBasicMaterial({color:'#87918e',side:THREE.DoubleSide}),
    water:new THREE.MeshStandardMaterial({color:'#90b4ba',roughness:.72,metalness:0,side:THREE.DoubleSide}),
    green:new THREE.MeshBasicMaterial({color:'#c2d0b6',side:THREE.DoubleSide}),
    sports:new THREE.MeshBasicMaterial({color:'#bdc4b3',side:THREE.DoubleSide}),
    other:new THREE.MeshBasicMaterial({color:'#d4d9d0',side:THREE.DoubleSide}),
    line:new THREE.LineBasicMaterial({color:'#89928d',transparent:true,opacity:.9}),
    roadLine:new THREE.LineBasicMaterial({color:'#65736e',transparent:true,opacity:.92}),
    buildingLine:new THREE.LineBasicMaterial({color:'#727e78',depthTest:false,depthWrite:false}),
    volumeLine:new THREE.LineBasicMaterial({color:'#727e78',depthWrite:false}),
    symbolicLine:new THREE.LineBasicMaterial({color:'#a38149',depthWrite:false}),
    poi:new THREE.PointsMaterial({color:'#557d83',size:4,sizeAttenuation:false}),
    boundary:new THREE.LineDashedMaterial({color:'#6b8a72',dashSize:8,gapSize:5,transparent:true,opacity:.9}),
  };
  // Flat layers are cartographic overlays on a single datum, not terrain surfaces.
  // Their explicit painter order avoids far-camera coplanar depth aliasing.
  for(const name of['building','road','water','green','sports','other','poi','line','roadLine','boundary']){materials[name].depthTest=false;materials[name].depthWrite=false;}
  for(const name of['line','roadLine','boundary']){materials[name].transparent=false;materials[name].opacity=1;}
  const layerOrder={other:10,green:20,boundary:25,water:30,sports:40,road:50,poi:55,building:70};
  function metricTag(value){
    if(typeof value==='number')return Number.isFinite(value)&&value>0?value:null;
    if(typeof value!=='string')return null;
    const m=value.trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|'|cm)?$/i);
    if(!m)return null;let v=Number(m[1]);const unit=(m[2]||'m').toLowerCase();if(['ft','feet',"'"].includes(unit))v*=.3048;else if(unit==='cm')v/=100;return v>0&&Number.isFinite(v)?v:null;
  }
  function getLayer(name){if(!layers.has(name)){const l=new THREE.Group();l.name=name;l.userData.layer=name;group.add(l);layers.set(name,l);}return layers.get(name);}
  function getCategory(f){const p=f.properties||{},t=p.tags||p;let c=p.category||p.kind;
    if(c)return({buildings:'building',roads:'road',waters:'water',greens:'green',sport:'sports',landuse:'green',campus:'boundary'})[c]||c;
    if(t.building&&t.building!=='no')return'building';if(t.highway)return'road';if(t.natural==='water'||t.water||t.waterway)return'water';if(t.sport||['pitch','track','stadium'].includes(t.leisure))return'sports';if(t.boundary)return'boundary';if(t.landuse||['wood','grassland','scrub'].includes(t.natural)||['park','garden'].includes(t.leisure))return'green';return'other';
  }
  function projected(coord){
    if(!Array.isArray(coord)||coord.length<2||!Number.isFinite(coord[0])||!Number.isFinite(coord[1]))throw new TypeError('Invalid geographic coordinate.');
    const p=projectionFn({longitude:coord[0],latitude:coord[1],height:0,coordinateSystem:'EPSG:4326'},frame);
    if(!p||![p.x,p.z].every(Number.isFinite))throw new RangeError('Projection did not return finite x/z metres.');
    bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.minZ=Math.min(bounds.minZ,p.z);bounds.maxZ=Math.max(bounds.maxZ,p.z);
    return new THREE.Vector2(p.x,-p.z);
  }
  function ringPoints(coords){
    const pts=coords.map(projected);if(pts.length>1&&pts[0].distanceToSquared(pts.at(-1))<1e-12)pts.pop();
    return pts.filter((p,i)=>i===0||p.distanceToSquared(pts[i-1])>1e-12);
  }
  function polygonShape(rings){
    if(!rings?.length)return null;const outer=ringPoints(rings[0]);if(outer.length<3)return null;
    const s=new THREE.Shape(outer);
    for(const ring of rings.slice(1)){const pts=ringPoints(ring);if(pts.length>=3)s.holes.push(new THREE.Path(pts));}
    return s;
  }
  function geometryFor(shapes,height){return height>0?new THREE.ExtrudeGeometry(shapes,{depth:height,bevelEnabled:false,steps:1,curveSegments:1}):new THREE.ShapeGeometry(shapes,1);}
  function metadata(feature,id,category,extra={}){return{feature,featureId:id,category,coordinateSystem:'LOCAL_ENU',units:'metres',source:feature.properties?.source||'OpenStreetMap',...extra};}
  function edgesFor(mesh,mat){const edges=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,20),mat);edges.rotation.copy(mesh.rotation);edges.position.copy(mesh.position);edges.position.y+=.012;return edges;}
  function addPolygon(feature,id,category,rings){
    const shapes=rings.map(polygonShape).filter(Boolean);if(!shapes.length)throw new Error('No valid polygon exterior.');
    const holder=new THREE.Group();holder.name=feature.properties?.name||id;holder.userData=metadata(feature,id,category);getLayer(category).add(holder);
    const tags=feature.properties?.tags||feature.properties||{};
    const isPart=category==='building'&&(feature.properties?.isBuildingPart===true||(tags['building:part']&&tags['building:part']!=='no'));
    const sourceHeight=category==='building'?metricTag(tags.height):null;
    const rawLevels=tags['building:levels'];const levels=/^\d+(?:\.\d+)?$/.test(String(rawLevels??''))?Number(rawLevels):null;
    const symbolicHeight=category==='building'&&!sourceHeight&&!isPart&&levels>0?levels*3.2:null;
    const y=category==='building'?.065:category==='water'?.022:category==='sports'?.035:category==='road'?.055:.015;
    const mat=category==='building'?(sourceHeight?materials.sourced:materials.building):(materials[category]||materials.other);
    const mesh=new THREE.Mesh(geometryFor(shapes,sourceHeight||0),mat);mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.castShadow=!!sourceHeight;mesh.receiveShadow=true;
    mesh.userData=metadata(feature,id,category,{heightMeters:sourceHeight,heightMode:sourceHeight?'source-tag':'unknown-flat',sourceHeightTag:tags.height??null,levels,symbolicHeight,isPart,partDisplay:isPart?'source outline only; no invented volume':null});holder.add(mesh);if(isPart&&!sourceHeight){mesh.visible=false;mesh.raycast=()=>{};}
    const outline=edgesFor(mesh,category==='building'?(sourceHeight?materials.volumeLine:materials.buildingLine):materials.line);outline.userData=mesh.userData;holder.add(outline);
    const record={id,feature,group:holder,mesh,outline,shapes,category,sourceHeight,symbolicHeight,levels,isPart,widthMode:category==='road'?'source-area-footprint':undefined,flatArea:shapes.reduce((sum,s)=>sum+Math.abs(THREE.ShapeUtils.area(s.getPoints()))-s.holes.reduce((a,h)=>a+Math.abs(THREE.ShapeUtils.area(h.getPoints())),0),0),heightMode:isPart?'part-outline':mesh.userData.heightMode};records.push(record);featureMeshes.set(id,holder);
    if(category==='building'){buildings.push(record);counts[sourceHeight?'knownHeight':'unknownHeight']++;if(levels>0)counts.levelsTagged++;if(isPart)counts.buildingParts++;if(symbolicHeight)counts.levelsAvailable++;}
    if(category==='road')roads.push(record);if(category==='water')water.push(record);bounds.maxY=Math.max(bounds.maxY,sourceHeight||0);
    return holder;
  }
  function addLine(feature,id,category,lines){
    const holder=new THREE.Group();holder.name=feature.properties?.name||id;holder.userData=metadata(feature,id,category);getLayer(category).add(holder);
    const tags=feature.properties?.tags||feature.properties||{},width=category==='road'?metricTag(tags.width):null;
    for(const lineCoords of lines){
      const pts=lineCoords.map(projected);if(pts.length<2)continue;
      const points=pts.map(p=>new THREE.Vector3(p.x,.09,-p.y));
      const lineGeo=new THREE.BufferGeometry().setFromPoints(points),line=new THREE.Line(lineGeo,category==='road'?materials.roadLine:category==='boundary'?materials.boundary:materials.line);
      line.userData=metadata(feature,id,category,{widthMeters:width,widthMode:width?'source-tag':'screen-pixel-centerline'});if(category==='boundary')line.computeLineDistances();line.renderOrder=(layerOrder[category]||10)+1;holder.add(line);
      // A ribbon is only constructed when the source explicitly provides width.
      if(width){const pos=[],indices=[];for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<1e-5)continue;const nx=-dz/len*width/2,nz=dx/len*width/2,o=pos.length/3;
        pos.push(a.x+nx,.05,a.z+nz,a.x-nx,.05,a.z-nz,b.x+nx,.05,b.z+nz,b.x-nx,.05,b.z-nz);indices.push(o,o+1,o+2,o+1,o+3,o+2);
      }const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(indices);g.computeVertexNormals();const roadMesh=new THREE.Mesh(g,materials.road);roadMesh.userData=line.userData;roadMesh.renderOrder=layerOrder.road;holder.add(roadMesh);}
    }
    const record={id,feature,group:holder,category,widthMeters:width,widthMode:width?'source-tag':'screen-pixel-centerline'};records.push(record);featureMeshes.set(id,holder);if(category==='road'){roads.push(record);counts[width?'knownRoadWidth':'unknownRoadWidth']++;}if(category==='water')water.push(record);return holder;
  }
  function addPoints(feature,id,category,coordinates){
    const points=coordinates.map(projected).map(p=>new THREE.Vector3(p.x,.12,-p.y));const geometry=new THREE.BufferGeometry().setFromPoints(points),mesh=new THREE.Points(geometry,materials.poi);mesh.name=feature.properties?.name||id;mesh.renderOrder=110;mesh.userData=metadata(feature,id,category,{symbol:'4-pixel source point; no physical geometry implied'});getLayer(category).add(mesh);featureMeshes.set(id,mesh);records.push({id,feature,mesh,group:mesh,category});
  }
  for(const [i,feature]of featureCollection.features.entries()){
    const id=String(feature.id??feature.properties?.osmId??feature.properties?.id??`feature-${i}`),category=getCategory(feature),g=feature.geometry;
    if(!g){counts.skipped++;continue;}
    try{
      if(category==='boundary'&&g.type==='Polygon')addLine(feature,id,category,g.coordinates);
      else if(category==='boundary'&&g.type==='MultiPolygon')addLine(feature,id,category,g.coordinates.flat());
      else if(g.type==='Polygon')addPolygon(feature,id,category,[g.coordinates]);
      else if(g.type==='MultiPolygon')addPolygon(feature,id,category,g.coordinates);
      else if(g.type==='LineString')addLine(feature,id,category,[g.coordinates]);
      else if(g.type==='MultiLineString')addLine(feature,id,category,g.coordinates);
      else if(g.type==='Point')addPoints(feature,id,category,[g.coordinates]);
      else if(g.type==='MultiPoint')addPoints(feature,id,category,g.coordinates);
      else{counts.skipped++;warnings.push(`${id}: unsupported geometry ${g.type}`);continue;}
      counts[category in counts?category:'other']++;
    }catch(error){counts.skipped++;warnings.push(`${id}: ${error.message}`);}
  }
  // Large enclosing polygons render first; smaller exact source polygons remain legible.
  const polygonRecords=records.filter(r=>r.mesh?.isMesh);
  for(const category of new Set(polygonRecords.map(r=>r.category))){
    const sorted=polygonRecords.filter(r=>r.category===category).sort((a,b)=>b.flatArea-a.flatArea);
    sorted.forEach((r,i)=>{r.flatRenderOrder=(layerOrder[category]||10)+i/Math.max(1,sorted.length);r.flatOutlineOrder=100+(layerOrder[category]||10)*.01+i/Math.max(1,sorted.length)*.01;r.mesh.renderOrder=r.sourceHeight?200:r.flatRenderOrder;r.outline.renderOrder=r.sourceHeight?210:r.flatOutlineOrder;});
  }
  if(!Number.isFinite(bounds.minX))Object.assign(bounds,{minX:-1,maxX:1,minZ:-1,maxZ:1});
  const sourceBounds={...bounds};
  function setSymbolicHeights(enabled){
    symbolicHeights=!!enabled;bounds.maxY=sourceBounds.maxY;
    for(const b of buildings){if(b.sourceHeight||b.isPart||!b.symbolicHeight)continue;
      const height=symbolicHeights?b.symbolicHeight:0;b.mesh.geometry.dispose();b.mesh.geometry=geometryFor(b.shapes,height);b.mesh.material=symbolicHeights?materials.symbolic:materials.building;b.mesh.castShadow=symbolicHeights;b.mesh.renderOrder=symbolicHeights?200:b.flatRenderOrder;b.outline.renderOrder=symbolicHeights?210:b.flatOutlineOrder;
      b.outline.geometry.dispose();b.outline.geometry=new THREE.EdgesGeometry(b.mesh.geometry,20);b.outline.material=symbolicHeights?materials.symbolicLine:materials.buildingLine;
      b.heightMode=symbolicHeights?'symbolic-levels-times-3.2':'unknown-flat';b.mesh.userData.heightMode=b.heightMode;b.mesh.userData.displayHeightMeters=height;b.mesh.userData.heightIsMeasured=false;
      bounds.maxY=Math.max(bounds.maxY,height);
    }
    for(const b of buildings.filter(b=>b.isPart&&!b.sourceHeight))b.outline.material=symbolicHeights?materials.volumeLine:materials.buildingLine;
    return{enabled:symbolicHeights,affected:buildings.filter(b=>!b.sourceHeight&&b.symbolicHeight).length,method:'OSM building:levels × 3.2 m, symbolic only; not measured height'};
  }
  function setLayerVisible(name,visible){const normalized=({buildings:'building',roads:'road',waters:'water',greens:'green'})[name]||name;const layer=layers.get(normalized);if(layer)layer.visible=!!visible;return!!layer;}
  function dispose(){const geometries=new Set(),mats=new Set();group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])mats.add(m);});for(const g of geometries)g.dispose();for(const m of mats)m.dispose();for(const m of Object.values(materials))if(!mats.has(m))m.dispose();scene.remove(group);}
  return{group,featureMeshes,buildings,roads,water,layers,records,bounds,counts,warnings,setSymbolicHeights,setLayerVisible,dispose,get symbolicHeights(){return symbolicHeights;}};
}
