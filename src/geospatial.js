/**
 * Metric geospatial foundation. Geographic inputs MUST declare their datum.
 * WGS84 geographic coordinates -> ECEF -> a local east/north/up tangent frame.
 * Three.js mapping: x = east, y = up, z = south. All local values are metres.
 * True units do not imply that an input footprint, height or datum conversion
 * is surveyed accurately: preserve the independent feature provenance below.
 */
export const WGS84 = Object.freeze({
  semiMajorAxis: 6378137,
  inverseFlattening: 298.257223563,
  flattening: 1 / 298.257223563,
  eccentricitySquared: (1 / 298.257223563) * (2 - 1 / 298.257223563),
});
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

export function normalizeCoordinateSystem(value) {
  if (typeof value !== 'string') throw new TypeError('coordinateSystem is required; never infer a datum from numeric coordinates.');
  const key=value.toUpperCase().replace(/\s/g,'');
  if(['EPSG:4326','WGS84','WGS-84'].includes(key))return 'EPSG:4326';
  if(['GCJ02','GCJ-02'].includes(key))return 'GCJ-02';
  if(key==='LOCAL_ENU')return 'LOCAL_ENU';
  throw new RangeError(`Unsupported coordinate system: ${value}. Supply an explicit supported datum or transform it first.`);
}
export function validateGeographicCoordinate(point, expectedCoordinateSystem) {
  if(!point||typeof point!=='object')throw new TypeError('A geographic coordinate object is required.');
  const coordinateSystem=normalizeCoordinateSystem(point.coordinateSystem);
  if(coordinateSystem==='LOCAL_ENU')throw new RangeError('LOCAL_ENU is not a geographic datum.');
  if(!finite(point.longitude)||point.longitude < -180 || point.longitude > 180)throw new RangeError('longitude must be a finite number in [-180, 180].');
  if(!finite(point.latitude)||point.latitude < -90 || point.latitude > 90)throw new RangeError('latitude must be a finite number in [-90, 90].');
  if(point.height!==undefined&&!finite(point.height))throw new RangeError('height must be a finite ellipsoidal height in metres.');
  if(expectedCoordinateSystem&&coordinateSystem!==normalizeCoordinateSystem(expectedCoordinateSystem))throw new RangeError(`Datum mismatch: ${coordinateSystem} cannot be used as ${normalizeCoordinateSystem(expectedCoordinateSystem)}. Convert explicitly first.`);
  return {...point,height:point.height??0,coordinateSystem};
}
function toECEF(point) {
  const p=validateGeographicCoordinate(point,'EPSG:4326'),lat=p.latitude*RAD,lon=p.longitude*RAD;
  const sinLat=Math.sin(lat),cosLat=Math.cos(lat),n=WGS84.semiMajorAxis/Math.sqrt(1-WGS84.eccentricitySquared*sinLat*sinLat);
  return {x:(n+p.height)*cosLat*Math.cos(lon),y:(n+p.height)*cosLat*Math.sin(lon),z:(n*(1-WGS84.eccentricitySquared)+p.height)*sinLat};
}
function fromECEF(ecef) {
  const {x,y,z}=ecef,p=Math.hypot(x,y),a=WGS84.semiMajorAxis,e2=WGS84.eccentricitySquared;
  if(Math.hypot(p,z)<1)throw new RangeError('ECEF point is at the Earth centre; geographic coordinates are undefined.');
  const longitude=Math.atan2(y,x)*DEG;
  if(p<1e-8)return {longitude,latitude:z>=0?90:-90,height:Math.abs(z)-a*(1-WGS84.flattening),coordinateSystem:'EPSG:4326'};
  let latitude=Math.atan2(z,p*(1-e2));
  for(let i=0;i<20;i++){const sin=Math.sin(latitude),n=a/Math.sqrt(1-e2*sin*sin);const next=Math.atan2(z+e2*n*sin,p);if(Math.abs(next-latitude)<1e-15){latitude=next;break;}latitude=next;}
  const sin=Math.sin(latitude),n=a/Math.sqrt(1-e2*sin*sin);
  return {longitude,latitude:latitude*DEG,height:p/Math.cos(latitude)-n,coordinateSystem:'EPSG:4326'};
}
export function createLocalFrame(origin) {
  const geographicOrigin=validateGeographicCoordinate(origin,'EPSG:4326');
  const latitude=geographicOrigin.latitude*RAD,longitude=geographicOrigin.longitude*RAD;
  return Object.freeze({type:'LocalENUFrame',coordinateSystem:'LOCAL_ENU',sourceDatum:'EPSG:4326',units:'metres',
    axes:Object.freeze({x:'east',y:'up',z:'south'}),origin:Object.freeze(geographicOrigin),
    ecefOrigin:Object.freeze(toECEF(geographicOrigin)),sinLatitude:Math.sin(latitude),cosLatitude:Math.cos(latitude),
    sinLongitude:Math.sin(longitude),cosLongitude:Math.cos(longitude)});
}
function resolveFrame(frameOrOrigin) {
  if(frameOrOrigin?.type==='LocalENUFrame') {
    if(frameOrOrigin.sourceDatum!=='EPSG:4326'||frameOrOrigin.units!=='metres')throw new RangeError('Invalid local frame: WGS84 metre units are required.');
    return frameOrOrigin;
  }
  return createLocalFrame(frameOrOrigin);
}
export function geoToLocal(point, frameOrOrigin) {
  const frame=resolveFrame(frameOrOrigin),ecef=toECEF(point);
  const dx=ecef.x-frame.ecefOrigin.x,dy=ecef.y-frame.ecefOrigin.y,dz=ecef.z-frame.ecefOrigin.z;
  const east=-frame.sinLongitude*dx+frame.cosLongitude*dy;
  const north=-frame.sinLatitude*frame.cosLongitude*dx-frame.sinLatitude*frame.sinLongitude*dy+frame.cosLatitude*dz;
  const up=frame.cosLatitude*frame.cosLongitude*dx+frame.cosLatitude*frame.sinLongitude*dy+frame.sinLatitude*dz;
  return {x:east,y:up,z:-north,east,north,up,coordinateSystem:'LOCAL_ENU',units:'metres'};
}
export function localToGeo(local, frameOrOrigin) {
  const frame=resolveFrame(frameOrOrigin);
  if(!local||![local.x,local.y??0,local.z].every(finite))throw new TypeError('Local x, y and z must be finite metre values.');
  if(local.coordinateSystem!==undefined&&normalizeCoordinateSystem(local.coordinateSystem)!=='LOCAL_ENU')throw new RangeError('Expected LOCAL_ENU coordinates, not a geographic point.');
  if(local.units!==undefined&&local.units!=='metres')throw new RangeError('Local coordinates must use metres.');
  const east=local.x,up=local.y??0,north=-local.z;
  const dx=-frame.sinLongitude*east-frame.sinLatitude*frame.cosLongitude*north+frame.cosLatitude*frame.cosLongitude*up;
  const dy=frame.cosLongitude*east-frame.sinLatitude*frame.sinLongitude*north+frame.cosLatitude*frame.sinLongitude*up;
  const dz=frame.cosLatitude*north+frame.sinLatitude*up;
  return fromECEF({x:frame.ecefOrigin.x+dx,y:frame.ecefOrigin.y+dy,z:frame.ecefOrigin.z+dz});
}
/** WGS84 ellipsoidal surface distance using Vincenty's inverse solution.
 * Heights are deliberately ignored. Nonconvergence is reported, never silently
 * replaced by a spherical approximation (near-antipodal global routes need a
 * robust geodesic library; campus distances converge rapidly).
 */
export function geodesicDistance(from,to,{maxIterations=200,tolerance=1e-12}={}) {
  const a=validateGeographicCoordinate(from,'EPSG:4326'),b=validateGeographicCoordinate(to,'EPSG:4326');
  if(a.latitude===b.latitude&&(a.longitude===b.longitude||Math.abs(a.latitude)===90))return 0;
  const f=WGS84.flattening,major=WGS84.semiMajorAxis,minor=major*(1-f);
  const phi1=a.latitude*RAD,phi2=b.latitude*RAD,L=Math.atan2(Math.sin((b.longitude-a.longitude)*RAD),Math.cos((b.longitude-a.longitude)*RAD));
  const u1=Math.atan((1-f)*Math.tan(phi1)),u2=Math.atan((1-f)*Math.tan(phi2));
  const sinU1=Math.sin(u1),cosU1=Math.cos(u1),sinU2=Math.sin(u2),cosU2=Math.cos(u2);
  let lambda=L,sinSigma=0,cosSigma=0,sigma=0,sinAlpha=0,cosSqAlpha=0,cos2SigmaM=0,converged=false;
  for(let i=0;i<maxIterations;i++){
    const sinLambda=Math.sin(lambda),cosLambda=Math.cos(lambda);
    sinSigma=Math.hypot(cosU2*sinLambda,cosU1*sinU2-sinU1*cosU2*cosLambda);
    if(sinSigma<1e-16)return 0;
    cosSigma=sinU1*sinU2+cosU1*cosU2*cosLambda;sigma=Math.atan2(sinSigma,cosSigma);
    sinAlpha=cosU1*cosU2*sinLambda/sinSigma;cosSqAlpha=Math.max(0,1-sinAlpha*sinAlpha);
    cos2SigmaM=cosSqAlpha>1e-16?cosSigma-2*sinU1*sinU2/cosSqAlpha:0;
    const C=f/16*cosSqAlpha*(4+f*(4-3*cosSqAlpha)),old=lambda;
    lambda=L+(1-C)*f*sinAlpha*(sigma+C*sinSigma*(cos2SigmaM+C*cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)));
    if(Math.abs(lambda-old)<=tolerance){converged=true;break;}
  }
  if(!converged)throw new RangeError('WGS84 inverse geodesic did not converge; use an antipodal-safe geodesic implementation for this pair.');
  const uSq=cosSqAlpha*(major*major-minor*minor)/(minor*minor);
  const A=1+uSq/16384*(4096+uSq*(-768+uSq*(320-175*uSq)));
  const B=uSq/1024*(256+uSq*(-128+uSq*(74-47*uSq)));
  const delta=B*sinSigma*(cos2SigmaM+B/4*(cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)-B/6*cos2SigmaM*(-3+4*sinSigma*sinSigma)*(-3+4*cos2SigmaM*cos2SigmaM)));
  return minor*A*(sigma-delta);
}

// The commonly used public GCJ offset approximation is NOT an official datum
// transformation. It is opt-in and preserves an explicit uncertainty warning.
function gcjOffset(longitude,latitude) {
  const x=longitude-105,y=latitude-35;
  let lat=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  lat+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;
  lat+=(20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3;
  lat+=(160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;
  let lon=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  lon+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;
  lon+=(20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3;
  lon+=(150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;
  const radians=latitude*RAD,sin=Math.sin(radians),magic=1-.00669342162296594323*sin*sin,sqrt=Math.sqrt(magic);
  return {latitude:lat*DEG/(6378245*(1-.00669342162296594323)/(magic*sqrt)),longitude:lon*DEG/(6378245/sqrt*Math.cos(radians))};
}
function inGCJApproximationDomain(p){return p.longitude>=72.004&&p.longitude<=137.8347&&p.latitude>=.8293&&p.latitude<=55.8271;}
export function convertDatum(point,targetCoordinateSystem,{allowApproximate=false}={}) {
  const p=validateGeographicCoordinate(point),target=normalizeCoordinateSystem(targetCoordinateSystem);
  if(target==='LOCAL_ENU')throw new RangeError('Use geoToLocal for a local frame.');
  if(p.coordinateSystem===target)return {...p};
  if(!allowApproximate)throw new RangeError('GCJ-02 conversion is approximate and requires {allowApproximate:true}; it is not a surveyed alignment.');
  if(!inGCJApproximationDomain(p))throw new RangeError('Coordinate is outside the documented domain of this GCJ approximation; do not silently relabel the datum.');
  let longitude=p.longitude,latitude=p.latitude;
  if(p.coordinateSystem==='EPSG:4326'&&target==='GCJ-02'){
    const offset=gcjOffset(longitude,latitude);longitude+=offset.longitude;latitude+=offset.latitude;
  }else if(p.coordinateSystem==='GCJ-02'&&target==='EPSG:4326'){
    for(let i=0;i<12;i++){const offset=gcjOffset(longitude,latitude),dx=longitude+offset.longitude-p.longitude,dy=latitude+offset.latitude-p.latitude;longitude-=dx;latitude-=dy;if(Math.max(Math.abs(dx),Math.abs(dy))<1e-11)break;}
  }else throw new RangeError(`Unsupported datum transform ${p.coordinateSystem} -> ${target}.`);
  return {...p,longitude,latitude,coordinateSystem:target,datumTransform:{sourceCoordinateSystem:p.coordinateSystem,targetCoordinateSystem:target,
    method:'public GCJ-02 offset approximation',quality:'approximate',official:false,accuracyMeters:null,
    warning:'Numerical roundtrip precision is not absolute geospatial accuracy. Verify alignment against independent control points.'}};
}

const equalPoint=(a,b)=>Math.abs(a[0]-b[0])<1e-12&&Math.abs(a[1]-b[1])<1e-12;
function signedArea(ring){let area=0;for(let i=1;i<ring.length;i++)area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];return area/2;}
function orientation(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function onSegment(a,b,p){const epsilon=1e-12;return Math.abs(orientation(a,b,p))<=epsilon&&p[0]>=Math.min(a[0],b[0])-epsilon&&p[0]<=Math.max(a[0],b[0])+epsilon&&p[1]>=Math.min(a[1],b[1])-epsilon&&p[1]<=Math.max(a[1],b[1])+epsilon;}
function segmentsIntersect(a,b,c,d){const ab1=orientation(a,b,c),ab2=orientation(a,b,d),cd1=orientation(c,d,a),cd2=orientation(c,d,b);return (ab1*ab2<0&&cd1*cd2<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);}
function pointInside(point,ring){let inside=false;for(let i=0,j=ring.length-2;i<ring.length-1;j=i++){const a=ring[i],b=ring[j];if(onSegment(a,b,point))return false;if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function ringsIntersect(a,b){for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++)if(segmentsIntersect(a[i-1],a[i],b[j-1],b[j]))return true;return false;}
/** GeoJSON Polygon/MultiPolygon validation before extrusion. Geometry arrays
 * use [longitude, latitude] (geographic) or [x, z] (LOCAL_ENU), never lat/lon.
 * Bounds must be in that same declared coordinate system.
 */
export function validatePolygonGeometry(geometry,{coordinateSystem,bounds}={}) {
  const errors=[],warnings=[];let system;
  try{system=normalizeCoordinateSystem(coordinateSystem??geometry?.coordinateSystem);}catch(error){return {valid:false,errors:[error.message],warnings,bounds:null};}
  if(bounds?.coordinateSystem){try{if(normalizeCoordinateSystem(bounds.coordinateSystem)!==system)errors.push('Bounds coordinate system differs from geometry.');}catch(error){errors.push(error.message);}}
  if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type))return {valid:false,errors:[...errors,'Expected GeoJSON Polygon or MultiPolygon.'],warnings,bounds:null};
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  if(!Array.isArray(polygons)||polygons.length===0)return {valid:false,errors:[...errors,'Polygon coordinates are empty.'],warnings,bounds:null};
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const validPolygons=[];
  for(let pi=0;pi<polygons.length;pi++){
    const polygon=polygons[pi];if(!Array.isArray(polygon)||!polygon.length){errors.push(`Polygon ${pi} has no exterior ring.`);continue;}
    const validRings=[];
    for(let ri=0;ri<polygon.length;ri++){
      const ring=polygon[ri],label=`Polygon ${pi}, ring ${ri}`;
      if(!Array.isArray(ring)||ring.length<4){errors.push(`${label} needs at least four coordinates including closure.`);continue;}
      if(!ring.every(p=>Array.isArray(p)&&p.length>=2&&p.every(finite))){errors.push(`${label} contains a non-finite coordinate.`);continue;}
      if(!equalPoint(ring[0],ring.at(-1)))errors.push(`${label} is not closed.`);
      if(system!=='LOCAL_ENU'&&ring.some(p=>Math.abs(p[0])>180||Math.abs(p[1])>90))errors.push(`${label} is outside longitude/latitude ranges.`);
      for(const p of ring){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
      for(let i=1;i<ring.length;i++)if(equalPoint(ring[i-1],ring[i]))errors.push(`${label} contains a zero-length edge.`);
      const area=signedArea(ring);if(Math.abs(area)<(system==='LOCAL_ENU'?1e-9:1e-15))errors.push(`${label} has zero signed area.`);
      else if((ri===0&&area<0)||(ri>0&&area>0))warnings.push(`${label} winding differs from GeoJSON right-hand convention.`);
      for(let i=0;i<ring.length-1;i++)for(let j=i+1;j<ring.length-1;j++){
        if(j===i+1||(i===0&&j===ring.length-2))continue;
        if(segmentsIntersect(ring[i],ring[i+1],ring[j],ring[j+1]))errors.push(`${label} self-intersects at edges ${i}/${j}.`);
      }
      validRings[ri]=ring;
    }
    if(validRings[0])for(let ri=1;ri<validRings.length;ri++)if(validRings[ri]){
      if(!pointInside(validRings[ri][0],validRings[0])||ringsIntersect(validRings[ri],validRings[0]))errors.push(`Polygon ${pi}, hole ${ri} is not strictly inside its exterior.`);
      for(let j=1;j<ri;j++)if(validRings[j]&&(ringsIntersect(validRings[ri],validRings[j])||pointInside(validRings[ri][0],validRings[j])||pointInside(validRings[j][0],validRings[ri])))errors.push(`Polygon ${pi}, holes ${j}/${ri} overlap or nest.`);
    }
    validPolygons.push(validRings);
  }
  if(system!=='LOCAL_ENU'&&maxX-minX>180)errors.push('Antimeridian-spanning geometry must be explicitly unwrapped before local processing.');
  const resultBounds=finite(minX)?(system==='LOCAL_ENU'?{minX,maxX,minZ:minY,maxZ:maxY,coordinateSystem:system}:{west:minX,east:maxX,south:minY,north:maxY,coordinateSystem:system}):null;
  if(bounds&&resultBounds){const b=system==='LOCAL_ENU'?[bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ]:[bounds.west,bounds.east,bounds.south,bounds.north];
    if(!b.every(finite)||b[0]>b[1]||b[2]>b[3])errors.push('Invalid validation bounds.');else if(minX<b[0]||maxX>b[1]||minY<b[2]||maxY>b[3])errors.push('Geometry lies outside the specified bounds.');}
  return {valid:errors.length===0,errors,warnings,bounds:resultBounds,coordinateSystem:system,polygonCount:polygons.length};
}
/** Keep footprint and height claims separate. Accepts either a provenance
 * object or a GeoJSON feature with properties.provenance and heightMeters.
 * status: 'measured' | 'source' | 'inferred' | 'unknown'.
 */
export function validateFeatureProvenance(input,{heightMeters,coordinateSystem}={}) {
  const metadata=input?.properties?.provenance??input?.provenance??input;
  heightMeters=input?.properties?.heightMeters??heightMeters;
  const errors=[],warnings=[],allowed=new Set(['measured','source','inferred','unknown']);
  const output={footprintStatus:metadata?.footprint?.status??'unknown',heightStatus:metadata?.height?.status??'unknown'};
  for(const field of ['footprint','height']){
    const item=metadata?.[field];if(!item){errors.push(`Missing independent ${field} provenance.`);continue;}
    if(!allowed.has(item.status)){errors.push(`Invalid ${field} provenance status.`);continue;}
    if(['source','measured'].includes(item.status)&&!(typeof item.source==='string'&&item.source.trim()))errors.push(`${field} ${item.status} status needs an identifiable source.`);
    if(['measured','inferred'].includes(item.status)&&!(typeof item.method==='string'&&item.method.trim()))errors.push(`${field} ${item.status} status needs a method.`);
    if(item.accuracyMeters!==undefined&&item.accuracyMeters!==null&&(!finite(item.accuracyMeters)||item.accuracyMeters<0))errors.push(`${field} accuracyMeters must be nonnegative or null (unknown).`);
    if(item.status==='inferred')warnings.push(`${field} is inferred and must not be presented as measured.`);
  }
  if(metadata?.footprint?.coordinateSystem){try{const sourceSystem=normalizeCoordinateSystem(metadata.footprint.coordinateSystem);if(coordinateSystem&&sourceSystem!==normalizeCoordinateSystem(coordinateSystem))errors.push('Footprint provenance datum differs from current geometry; record an explicit transform.');}catch(error){errors.push(error.message);}}
  else errors.push('Footprint provenance must declare its current coordinateSystem.');
  if(output.heightStatus!=='unknown'&&(!finite(heightMeters)||heightMeters<0))errors.push('A sourced, measured or inferred height needs a nonnegative heightMeters value.');
  if(output.heightStatus==='unknown'&&finite(heightMeters))warnings.push('Displayed height is a placeholder because height provenance is unknown.');
  return {valid:errors.length===0,errors,warnings,...output,canClaimMeasuredFootprint:output.footprintStatus==='measured'&&errors.length===0,
    canClaimMeasuredHeight:output.heightStatus==='measured'&&errors.length===0};
}

/** Inspect authored dimensions without deriving height from floors or road
 * width from a classification. Missing dimensions remain explicitly unknown.
 * Renderer defaults may be used for display, but never become source values.
 */
export function validateFeatureDimensions(feature) {
  const properties=feature?.properties??feature??{},errors=[],warnings=[],result={};
  for(const dimension of ['height','width']){
    const value=properties[`${dimension}Meters`];
    const provenance=properties.provenance?.[dimension];
    const status=properties[`${dimension}Status`]??provenance?.status??'unknown';
    const hasValue=value!==undefined&&value!==null;
    if(!['source','measured','inferred','unknown'].includes(status))errors.push(`Invalid ${dimension}Status.`);
    if(hasValue&&(!finite(value)||value<=0))errors.push(`${dimension}Meters must be a positive finite metre value when present.`);
    if(status!=='unknown'&&!hasValue)errors.push(`${dimension} status is ${status} but no ${dimension}Meters value is supplied.`);
    if(status==='inferred'&&!provenance?.method)errors.push(`Inferred ${dimension} requires an explicit inference method.`);
    if(status==='unknown'&&hasValue)warnings.push(`${dimension} value is a display placeholder and is not a known source dimension.`);
    if(status==='inferred')warnings.push(`${dimension} is estimated, not a source measurement.`);
    result[dimension]={meters:hasValue?value:null,status,
      sourceKnown:hasValue&&finite(value)&&value>0&&['source','measured'].includes(status),
      displayOnly:hasValue&&!['source','measured'].includes(status)};
  }
  return {valid:errors.length===0,errors,warnings,...result};
}
