const isLine=f=>['LineString','MultiLineString'].includes(f.geometry?.type);
const lines=f=>f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
const equal=(a,b)=>Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])<1e-9;
// Clip the extension at the original capture boundary. Keeping both overlapping
// source clips would double roads/markings and cause z-fighting at the seam.
function southOf(line,latitude){
  const result=[];let run=[];
  for(let i=1;i<line.length;i++){
    let a=line[i-1],b=line[i],insideA=a[1]<=latitude,insideB=b[1]<=latitude;
    if(!insideA&&!insideB){if(run.length>1)result.push(run);run=[];continue;}
    if(insideA!==insideB){const t=(latitude-a[1])/(b[1]-a[1]),cut=[a[0]+(b[0]-a[0])*t,latitude];if(insideA)b=cut;else a=cut;}
    if(equal(a,b))continue;
    if(run.length&&!equal(run.at(-1),a)){if(run.length>1)result.push(run);run=[];}
    if(!run.length)run.push(a);run.push(b);
    if(!insideB){result.push(run);run=[];}
  }
  if(run.length>1)result.push(run);return result;
}
function joinLines(input){
  const out=input.map(line=>line.map(p=>[...p]));
  let merged=true;
  while(merged){merged=false;outer:for(let a=0;a<out.length;a++)for(let b=a+1;b<out.length;b++){
    let left=out[a],right=out[b];
    if(equal(left.at(-1),right[0])){}
    else if(equal(left.at(-1),right.at(-1)))right=[...right].reverse();
    else if(equal(left[0],right.at(-1)))[left,right]=[right,left];
    else if(equal(left[0],right[0]))left=[...left].reverse();
    else continue;
    out[a]=left.concat(right.slice(1));out.splice(b,1);merged=true;break outer;
  }}return out;
}
export function mergeCampusExtension(base,extension,{seamLatitude=30.512}={}){
  if(base?.type!=='FeatureCollection'||extension?.type!=='FeatureCollection')throw new TypeError('Campus layers must be FeatureCollections');
  const features=[...base.features],index=new Map(features.map((f,i)=>[f.id,i]));
  for(const extra of extension.features){
    if(!index.has(extra.id)){index.set(extra.id,features.length);features.push(extra);continue;}
    const i=index.get(extra.id),original=features[i];
    if(!isLine(original)||!isLine(extra))continue; // Original polygon rings are complete.
    const appended=lines(extra).flatMap(line=>southOf(line,seamLatitude));
    if(!appended.length)continue;
    const joined=joinLines([...lines(original),...appended]);
    const points=joined.flat(),bbox=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
    features[i]={...original,bbox,properties:{...original.properties,coverage:'joined-public-captures',extensionSource:'opto-southeast.geojson'},geometry:joined.length===1?{type:'LineString',coordinates:joined[0]}:{type:'MultiLineString',coordinates:joined}};
  }
  const bbox=[Infinity,Infinity,-Infinity,-Infinity];
  const visit=coords=>{if(typeof coords[0]==='number'){bbox[0]=Math.min(bbox[0],coords[0]);bbox[1]=Math.min(bbox[1],coords[1]);bbox[2]=Math.max(bbox[2],coords[0]);bbox[3]=Math.max(bbox[3],coords[1]);}else coords.forEach(visit);};
  features.forEach(f=>visit(f.geometry.coordinates));
  const extents=[base.requestedBbox,extension.requestedBbox].filter(b=>b?.length===4);
  const viewBbox=extents.length?[Math.min(...extents.map(b=>b[0])),Math.min(...extents.map(b=>b[1])),Math.max(...extents.map(b=>b[2])),Math.max(...extents.map(b=>b[3]))]:bbox;
  return {...base,features,bbox,viewBbox,extensions:[...(base.extensions||[]),{id:'opto-southeast',source:'OpenStreetMap contributors',requestedBbox:extension.requestedBbox,originalSourceUnmodified:true,geometryJoin:'Only coincident clipped line endpoints; no inferred road connection'}]};
}
