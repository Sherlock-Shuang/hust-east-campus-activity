import {getRoadProfile} from './building-profiles.js';
import {createYunyuanPhotoParking} from './yunyuan-parking.js';
import {createEastNineParking,EAST_NINE_PARKING_IDS} from './east-nine-parking.js';

const DORM='way/110398529', DORM_23='way/110398543', EAST_NINE='way/1023544717';
const A_NORTH=[114.4216304,30.5169494];
export const COMMUTE_DORMS=Object.freeze([
  {id:DORM,name:'韵苑27栋'},
  {id:DORM_23,name:'韵苑23栋'},
  {id:'way/103815859',name:'韵苑5栋'},
  {id:'way/110398525',name:'韵苑14栋'},
  {id:'way/1023544715',name:'韵苑1栋'},
].map(Object.freeze));
const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
const key=c=>`${Number(c[0]).toFixed(7)},${Number(c[1]).toFixed(7)}`;

/** Routes exclusively on the captured OSM road vertices / centreline segments.
 * No connector is invented across open land. Start is a projection onto a source
 * service road next to the dormitory, rather than an unverified entrance.
 */
export function createCommuteRoute(fc,{frame,geoToLocal,dormId=DORM,startAccess='north',travelMode='ride',destination='bc-plaza'}={}) {
  if(fc?.type!=='FeatureCollection'||!frame||typeof geoToLocal!=='function')throw new TypeError('GeoJSON and explicit WGS84 projection are required.');
  if(!['north','south'].includes(startAccess)||!['ride','walk'].includes(travelMode))throw new TypeError('Choose north/south source-road access and ride/walk travel mode.');
  if(!['a-north','bc-plaza'].includes(destination))throw new TypeError('Choose a-north or bc-plaza as the mapped destination.');
  const features=new Map(fc.features.map(f=>[String(f.id),f])),warnings=[],nodes=new Map(),edges=[];
  const project=c=>{const p=geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);return{x:p.x,z:p.z,longitude:c[0],latitude:c[1]};};
  function node(c){const id=key(c);if(!nodes.has(id))nodes.set(id,{...project(c),id,coordinate:c,links:[]});return nodes.get(id);}
  const roads=fc.features.filter(f=>f.properties?.category==='road'&&['LineString','MultiLineString'].includes(f.geometry?.type));
  for(const f of roads){const tags=f.properties.tags||{},highway=tags.highway;
    if(!highway||/^(motorway|trunk|secondary|primary)/.test(highway)||tags.motorroad==='yes')continue;
    if(tags.bridge==='viaduct'||(Number(tags.layer)>1))continue;
    const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates,profile=getRoadProfile(f);
    const restricted=['private','no'].includes(tags.access),allowed=value=>['yes','designated','permissive'].includes(value);
    const walkAllowed=!['private','no'].includes(tags.foot)&&(!restricted||allowed(tags.foot));
    const rideAllowed=!['private','no','dismount'].includes(tags.bicycle)&&(!restricted||allowed(tags.bicycle))&&(!['steps','footway','path','pedestrian'].includes(highway)||allowed(tags.bicycle))&&highway!=='steps';
    if(!walkAllowed&&!rideAllowed)continue;
    for(const line of lines)for(let i=1;i<line.length;i++){const a=node(line[i-1]),b=node(line[i]),length=distance(a,b);if(length<.01)continue;
      const edge={a:a.id,b:b.id,length,sourceId:f.id,feature:f,highway,width:profile.width,reserveMotorCenter:profile.reserveMotorCenter,cycleBandWidth:profile.cycleBandWidth,elevation:profile.elevation,surfaceOffset:profile.campusBridge?.role==='sidewalk'?profile.campusBridge.sidewalkRise:0,bridge:profile.bridge,mode:rideAllowed?'ride':'walk',walkAllowed,rideAllowed,oneway:tags['oneway:bicycle']==='no'?'no':tags['oneway:bicycle']??tags.oneway};edges.push(edge);
      a.links.push({...edge,to:b.id});b.links.push({...edge,to:a.id,reverse:true});
    }
  }
  const dorm=features.get(dormId),east=features.get(EAST_NINE),dormName=COMMUTE_DORMS.find(d=>d.id===dormId)?.name??dorm?.properties?.name;
  if(!dorm||dorm.geometry?.type!=='Polygon'||!/^韵苑.*[栋幢]$/.test(dormName||'')||!east)throw new Error('This commute requires a source 韵苑 dormitory and 东九 building footprint.');
  const coords=dorm.geometry.coordinates[0].slice(0,-1),center=project([coords.reduce((s,c)=>s+c[0],0)/coords.length,coords.reduce((s,c)=>s+c[1],0)/coords.length]);
  function nearestOnEdge(p,edge){const a=nodes.get(edge.a),b=nodes.get(edge.b),dx=b.x-a.x,dz=b.z-a.z,len=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/len));return{x:a.x+dx*t,z:a.z+dz*t,t,longitude:a.longitude+(b.longitude-a.longitude)*t,latitude:a.latitude+(b.latitude-a.latitude)*t};}
  let startChoice;
  const dormRoad=dormId===DORM_23?(startAccess==='north'?'way/102754434':'way/102754446'):null;
  for(const edge of edges.filter(e=>(travelMode==='ride'?e.rideAllowed:e.walkAllowed)&&['service','residential','unclassified','living_street'].includes(e.highway)&&(!dormRoad||e.sourceId===dormRoad))){const p=nearestOnEdge(center,edge),d=distance(center,p);if(!dormRoad&&(startAccess==='north'?p.z>center.z:p.z<center.z))continue;if(!startChoice||d<startChoice.distance)startChoice={edge,point:p,distance:d};}
  if(!startChoice||startChoice.distance>75)throw new Error(`No source public road close enough to ${dormName} ${startAccess} side; no off-road connection was fabricated.`);
  const startNode=node([startChoice.point.longitude,startChoice.point.latitude]);
  for(const endpoint of[startChoice.edge.a,startChoice.edge.b]){const n=nodes.get(endpoint);if(n.id===startNode.id)continue;const e={...startChoice.edge,a:startNode.id,b:n.id,length:distance(startNode,n),sourceInterpolation:true};startNode.links.push({...e,to:n.id});n.links.push({...e,to:startNode.id});}
  function required(c,label){const n=nodes.get(key(c));if(!n)throw new Error(`Missing source road vertex for ${label}; route cannot be reconstructed from this dataset.`);return n;}
  const aNorth=required(A_NORTH,'A区北侧主干');
  const finalFootway=destination==='a-north'?features.get('way/655063746'):null;if(destination==='a-north'&&!finalFootway)throw new Error('Source A-north entrance footway is missing.');
  const finalCoords=finalFootway?.geometry.coordinates;
  // This is a vertex of the mapped lakeside carriageway beside the B/C bicycle
  // parking POI, not a guessed building door or an invented parking connector.
  const endNode=destination==='a-north'?required(finalCoords.at(-1),'A北入口步道'):required([114.4218461,30.5156001],'东九湖畔 B/C 前场道路');
  function search(start,end,walking=false){
    const cost=new Map([[start.id,0]]),previous=new Map(),open=new Set([start.id]);
    while(open.size){let current=null,best=Infinity;for(const id of open){const score=cost.get(id)+distance(nodes.get(id),end);if(score<best){best=score;current=id;}}open.delete(current);if(current===end.id)break;
      for(const e of nodes.get(current).links){if(walking?!e.walkAllowed:!e.rideAllowed)continue;if(!walking&&((e.oneway==='yes'&&e.reverse)||(e.oneway==='-1'&&!e.reverse)))continue;
        const next=e.to,nc=cost.get(current)+e.length*(walking?(e.highway==='steps'?1.08:1):1);if(nc<(cost.get(next)??Infinity)){cost.set(next,nc);previous.set(next,{from:current,edge:e});open.add(next);}}
    }
    if(!previous.has(end.id)&&start.id!==end.id)throw new Error(`Source road graph disconnected near ${start.id} → ${end.id}; no invented link added.`);
    const path=[];for(let id=end.id;id!==start.id;){const prev=previous.get(id);path.push({from:prev.from,to:id,edge:prev.edge});id=prev.from;}return path.reverse();
  }
  // No canteen/junction waypoint is forced: those points constrained an assumed
  // student itinerary rather than a verified entrance or road restriction.
  const legs=destination==='a-north'?[search(startNode,aNorth,travelMode==='walk'),search(aNorth,endNode,true)]:[search(startNode,endNode,travelMode==='walk')],dismountProgress=travelMode==='walk'?0:legs[0].reduce((s,e)=>s+e.edge.length,0);
  const path=legs.flat();let points=[{...nodes.get(path[0].from),y:.16}];const segments=[];let length=0;
  for(const step of path){const a=nodes.get(step.from),b=nodes.get(step.to),s0=length;length+=step.edge.length;const mode=s0>=dismountProgress-.1?'walk':'ride';
    segments.push({startProgress:s0,endProgress:length,s0,s1:length,length:step.edge.length,sourceId:step.edge.sourceId,width:step.edge.width,reserveMotorCenter:step.edge.reserveMotorCenter,cycleBandWidth:step.edge.cycleBandWidth,mode,highway:step.edge.highway,bridge:step.edge.bridge,elevation:step.edge.elevation,surfaceOffset:step.edge.surfaceOffset,from:{x:a.x,z:a.z},to:{x:b.x,z:b.z},sourceInterpolation:!!step.edge.sourceInterpolation});
    points.push({x:b.x,z:b.z,y:Math.max(.28,(step.edge.elevation||0)+.28),longitude:b.longitude,latitude:b.latitude,progress:length,sourceId:step.edge.sourceId,mode});
  }
  // The south-side mapped footway cuts the acute motor-road corner before
  // continuing beside the avenue and bridge. A constant 11.5 m offset of that
  // short motor segment folds back on itself; walkers need the actual source
  // path, not a smaller offset that would place them in the carriageway.
  const pedestrianPaths=[];
  if(travelMode==='ride'){
    const departureStep=path.find(s=>s.edge.sourceId==='way/97057001'&&nodes.get(s.to).links.some(e=>e.sourceId==='way/1483567159'));
    if(departureStep){
      const departure=nodes.get(departureStep.to),mainEdges=new Set(path.map(s=>`${s.edge.sourceId}:${[s.from,s.to].sort().join('/')}`));
      const walking=destination==='a-north'?[...search(departure,aNorth,true),...search(aNorth,endNode,true)]:search(departure,endNode,true);
      const rejoin=walking.findIndex(s=>mainEdges.has(`${s.edge.sourceId}:${[s.from,s.to].sort().join('/')}`));
      const branch=rejoin>0?walking.slice(0,rejoin):[];
      // At the A-north alternative the final source connector crosses back to
      // the road centre, although the traffic display continues on the same
      // south-side pavement. Finish at its actual parallel footway endpoint
      // instead of walking across the road and immediately blending back.
      const parallelEnd=destination==='a-north'&&branch.at(-1)?.edge.sourceId==='way/103488198';
      if(parallelEnd)branch.pop();
      if(branch[0]?.edge.sourceId==='way/1483567159'){
        const first=locate(departure),last=locate(nodes.get(branch.at(-1).to)),pathLength=branch.reduce((sum,s)=>sum+s.edge.length,0);
        if(first.distance<.05&&(last.distance<.05||parallelEnd&&last.distance<15)&&last.progress>first.progress+1){
          let walked=0;const sourcePoints=[{x:departure.x,y:(branch[0].edge.elevation||0)+(branch[0].edge.surfaceOffset||0)+.16,z:departure.z,longitude:departure.longitude,latitude:departure.latitude,sourceCoordinates:departure.coordinate,sourceId:branch[0].edge.sourceId,pathDistance:0,progress:first.progress}];
          for(const step of branch){walked+=step.edge.length;sourcePoints.at(-1).y=Math.max(sourcePoints.at(-1).y,(step.edge.elevation||0)+(step.edge.surfaceOffset||0)+.16);const n=nodes.get(step.to);sourcePoints.push({x:n.x,y:(step.edge.elevation||0)+(step.edge.surfaceOffset||0)+.16,z:n.z,longitude:n.longitude,latitude:n.latitude,sourceCoordinates:n.coordinate,sourceId:step.edge.sourceId,pathDistance:walked,progress:first.progress+walked/pathLength*(last.progress-first.progress)});}
          pedestrianPaths.push({id:'mapped-south-avenue-footway',direction:1,startProgress:first.progress,endProgress:last.progress,length:pathLength,width:Math.min(...branch.map(s=>s.edge.width)),points:sourcePoints,sourceIds:[...new Set(branch.map(s=>s.edge.sourceId))],endConnection:parallelEnd?'parallel-source-footway':'shared-source-vertex',geometryEvidence:'connected original pedestrian way vertices; south-side avenue/bridge footway',progressEvidence:'strictly increasing linear correspondence by pedestrian path distance; endpoints projected to the main route clock',transitionEvidence:'any blending to the surrounding traffic offset is a display transition, not a surveyed footway'});
        }
      }
    }
  }
  // Share the actual rendered ribbon footprints with the motion controller.
  // Source ways that connect at a route vertex are included, so turns can use
  // the intersection surface without treating all surrounding land as a road.
  const surfaceIds=new Set(path.map(s=>s.edge.sourceId));
  for(const branch of pedestrianPaths)for(const id of branch.sourceIds)surfaceIds.add(id);
  for(const step of path)for(const id of[step.from,step.to])for(const edge of nodes.get(id).links)surfaceIds.add(edge.sourceId);
  // Free player movement needs every mapped bridge deck as ground support,
  // even when it is not part of the selected commute or legal riding graph.
  for(const f of roads)if(getRoadProfile(f).bridge)surfaceIds.add(f.id);
  const surfaceNodes=new Map(),surfaceJoints=new Map();
  for(const f of roads){const profile=getRoadProfile(f);if(!profile.motor||profile.elevation!==0)continue;const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
    for(const line of lines)for(let i=0;i<line.length;i++){const id=key(line[i]);if(!surfaceNodes.has(id))surfaceNodes.set(id,{point:project(line[i]),neighbors:new Set(),width:0});const n=surfaceNodes.get(id);n.width=Math.max(n.width,profile.width);if(i)n.neighbors.add(key(line[i-1]));if(i<line.length-1)n.neighbors.add(key(line[i+1]));}
  }
  for(const n of surfaceNodes.values()){if(n.neighbors.size!==2)continue;const[a,b]=[...n.neighbors].map(id=>surfaceNodes.get(id)?.point);if(a&&b)surfaceJoints.set(`${n.point.x.toFixed(4)}/${n.point.z.toFixed(4)}`,{dx:b.x-a.x,dz:b.z-a.z,width:n.width});}
  const roadSurfaces=[];
  for(const f of roads){if(!surfaceIds.has(f.id))continue;const profile=getRoadProfile(f),permission=edges.find(e=>e.sourceId===f.id)||{mode:profile.motor?'ride':'walk',walkAllowed:false,rideAllowed:false};
    const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
    for(const line of lines){const ps=line.map(project).filter((p,i,all)=>!i||distance(p,all[i-1])>.01);
      const sides=ps.map((p,i)=>{const a=ps[Math.max(0,i-1)],b=ps[Math.min(ps.length-1,i+1)];let dx=b.x-a.x,dz=b.z-a.z;const joint=surfaceJoints.get(`${p.x.toFixed(4)}/${p.z.toFixed(4)}`);if((i===0||i===ps.length-1)&&joint&&Math.abs(joint.width-profile.width)<.01){const sign=joint.dx*dx+joint.dz*dz<0?-1:1;dx=joint.dx*sign;dz=joint.dz*sign;}const len=Math.hypot(dx,dz)||1,nx=-dz/len*profile.width/2,nz=dx/len*profile.width/2;return[{x:p.x+nx,z:p.z+nz},{x:p.x-nx,z:p.z-nz}];});
      for(let i=1;i<ps.length;i++){const polygon=[sides[i-1][0],sides[i][0],sides[i][1],sides[i-1][1]],xs=polygon.map(p=>p.x),zs=polygon.map(p=>p.z);
        const surfaceOffset=profile.campusBridge?.role==='sidewalk'?profile.campusBridge.sidewalkRise:0;
        roadSurfaces.push({sourceId:f.id,polygon,elevation:profile.elevation,surfaceY:profile.elevation+.14+surfaceOffset,surfaceOffset,bridge:profile.bridge,width:profile.width,mode:permission.mode,walkAllowed:permission.walkAllowed,rideAllowed:permission.rideAllowed,bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)},geometryEvidence:'source centreline rendered ribbon; width and elevation follow shared display profile'});
      }
    }
  }
  points[0]={x:startNode.x,z:startNode.z,y:.16,longitude:startNode.longitude,latitude:startNode.latitude,progress:0,sourceId:startChoice.edge.sourceId,mode:travelMode};
  const sourceRouteLength=length,sourceEndpoint={...points.at(-1)},approach=points.at(-2),wallRing=east.geometry.coordinates[0].map(project);
  let entryAnchor=null;
  if(destination==='a-north')for(let i=1;i<wallRing.length;i++){const a=wallRing[i-1],b=wallRing[i],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(l<.01)continue;const t=Math.max(0,Math.min(1,((sourceEndpoint.x-a.x)*dx+(sourceEndpoint.z-a.z)*dz)/(l*l))),x=a.x+dx*t,z=a.z+dz*t,d=Math.hypot(x-sourceEndpoint.x,z-sourceEndpoint.z);if(!entryAnchor||d<entryAnchor.distance){let nx=-dz/l,nz=dx/l;if((approach.x-x)*nx+(approach.z-z)*nz<0){nx=-nx;nz=-nz;}entryAnchor={x,y:.14,z,nx,nz,yaw:Math.atan2(nx,nz),distance:d,width:3.2,height:2.9,sourceBuildingId:EAST_NINE,sourceFootwayId:finalFootway.id,sourceCoordinates:finalCoords.at(-1),locationEvidence:'source footway endpoint projected onto source building exterior',detailEvidence:'inferred double glass doors, framing and canopy; dimensions not surveyed'};}}
  // Complete the trip on the exterior threshold; a human body has thickness.
  // The original mapped endpoint remains available as the entrance anchor.
  if(entryAnchor?.distance<2){const last=points.at(-1),seg=segments.at(-1),trim=Math.min(.8,seg.length*.25),ratio=(seg.length-trim)/seg.length;
    Object.assign(last,{x:approach.x+(last.x-approach.x)*ratio,z:approach.z+(last.z-approach.z)*ratio,longitude:approach.longitude+(last.longitude-approach.longitude)*ratio,latitude:approach.latitude+(last.latitude-approach.latitude)*ratio,progress:length-trim});
    length-=trim;seg.to={x:last.x,z:last.z};seg.length-=trim;seg.endProgress=seg.s1=length;seg.sourceInterpolation=true;entryAnchor.arrivalClearance=trim;
  }
  // The base campus puts source bridges on an estimated elevated deck. Approach
  // ramps share the source centreline rather than teleporting riders vertically.
  // Their grade is a display estimate; the source has no surveyed elevations.
  const bridgeRuns=[];
  for(const seg of segments.filter(s=>s.bridge&&s.elevation>0)){
    const previous=bridgeRuns.at(-1);
    if(previous&&Math.abs(previous.endProgress-seg.startProgress)<.05&&previous.elevation===seg.elevation)previous.endProgress=seg.endProgress;
    else bridgeRuns.push({startProgress:seg.startProgress,endProgress:seg.endProgress,elevation:seg.elevation,sourceId:seg.sourceId});
  }
  const ramps=bridgeRuns.flatMap(bridge=>[
    {startProgress:Math.max(0,bridge.startProgress-65),endProgress:bridge.startProgress,fromElevation:0,toElevation:bridge.elevation,sourceId:bridge.sourceId},
    {startProgress:bridge.endProgress,endProgress:Math.min(length,bridge.endProgress+65),fromElevation:bridge.elevation,toElevation:0,sourceId:bridge.sourceId},
  ]);
  function surfaceElevation(s){
    const bridgeSurface=segments.find(g=>g.bridge&&s>=g.startProgress-.001&&s<=g.endProgress+.001);if(bridgeSurface)return(bridgeSurface.elevation||0)+(bridgeSurface.surfaceOffset||0);
    const bridge=bridgeRuns.find(b=>s>=b.startProgress&&s<=b.endProgress);if(bridge)return bridge.elevation;
    const ramp=ramps.find(r=>s>=r.startProgress&&s<=r.endProgress);if(ramp){const t=(s-ramp.startProgress)/(ramp.endProgress-ramp.startProgress);return ramp.fromElevation+(ramp.toElevation-ramp.fromElevation)*t;}
    return 0;
  }
  const sourcePoints=points;
  function sourcePose(s){let i=1;while(i<sourcePoints.length-1&&sourcePoints[i].progress<s)i++;const a=sourcePoints[i-1],b=sourcePoints[i],t=(s-a.progress)/(b.progress-a.progress);return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,longitude:a.longitude+(b.longitude-a.longitude)*t,latitude:a.latitude+(b.latitude-a.latitude)*t,sourceId:b.sourceId,mode:b.mode,progress:s};}
  const samples=[...new Set([...sourcePoints.map(p=>p.progress),...ramps.flatMap(r=>[r.startProgress,r.endProgress])])].sort((a,b)=>a-b);
  points=samples.map(s=>({...sourcePose(s),y:surfaceElevation(s)+.16}));
  for(const ramp of ramps){ramp.points=points.filter(p=>p.progress>=ramp.startProgress-.001&&p.progress<=ramp.endProgress+.001);ramp.width=segments.find(s=>ramp.startProgress>=s.startProgress&&ramp.startProgress<=s.endProgress)?.width||6;ramp.evidence='inferred bridge approach, source centreline; not surveyed';}
  function locate(p){let best={distance:Infinity};for(const seg of segments){const dx=seg.to.x-seg.from.x,dz=seg.to.z-seg.from.z,l2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((p.x-seg.from.x)*dx+(p.z-seg.from.z)*dz)/l2)),x=seg.from.x+dx*t,z=seg.from.z+dz*t,d=Math.hypot(p.x-x,p.z-z);if(d<best.distance)best={distance:d,x,z,progress:seg.startProgress+t*seg.length,yaw:Math.atan2(-dx,-dz),width:seg.width,sourceId:seg.sourceId};}return best;}
  // Actual shared vertices with an off-route branch can supply a scenario flow.
  // Way IDs changing along a straight road are not independent feeder roads.
  const usedLinks=new Set(path.flatMap(s=>[`${s.from}|${s.to}`,`${s.to}|${s.from}`]));
  const trafficOrigins=[{id:'selected-dorm-road',progress:0,weight:1,sourceId:startChoice.edge.sourceId,sourceCoordinates:startNode.coordinate,geometryEvidence:'projection onto selected source road',weightEvidence:'equal scenario weight; not observed student origin share'}];
  for(const n of nodes.values()){
    const near=locate(n);if(near.distance>.05||near.progress<20||near.progress>Math.min(length,dismountProgress||length)-15)continue;
    const available=n.links.filter(e=>e.rideAllowed),unique=new Map(available.map(e=>[e.to,e]));if(unique.size<3)continue;
    const branches=[...unique.values()].filter(e=>!usedLinks.has(`${n.id}|${e.to}`)&&locate(nodes.get(e.to)).distance>2);
    if(!branches.length)continue;
    const sources=[...new Set(branches.map(e=>e.sourceId))];
    trafficOrigins.push({id:`source-junction:${n.id}`,progress:near.progress,weight:1,sourceId:sources[0],sourceIds:sources,sourceCoordinates:n.coordinate,x:n.x,z:n.z,geometryEvidence:'shared source road vertex with a connected off-route rideable branch',weightEvidence:'equal scenario weight; not observed student origin share'});
  }
  trafficOrigins.sort((a,b)=>a.progress-b.progress);
  const trafficSignals=[],crossings=[];
  const userConfirmedSignal={id:'user-confirmed/dongjiu-lakeside-turn',geometry:{type:'Point',coordinates:[114.424042,30.5166394]},properties:{userConfirmed:true,sourceUrl:'https://www.openstreetmap.org/way/97080595',tags:{highway:'traffic_signals',name:'东九湖畔入口路口'}}};
  // The user explicitly identified this signal: cross Yu-Dai bridge, then
  // turn left into the lakeside road. Coordinates are the existing shared
  // source-road vertex, not a new point inferred from a photograph.
  for(const f of [...fc.features,userConfirmedSignal]){if(f.geometry?.type!=='Point')continue;const t=f.properties?.tags||{};if(t.highway!=='traffic_signals'&&t.highway!=='crossing')continue;const p=project(f.geometry.coordinates),near=locate(p);if(near.distance>12)continue;
    const userConfirmed=!!f.properties.userConfirmed;
    const item={id:f.id,x:p.x,y:surfaceElevation(near.progress)+.16,z:p.z,progress:near.progress,yaw:near.yaw,width:near.width,sourceId:f.id,sourceUrl:f.properties.sourceUrl,sourceCoordinates:f.geometry.coordinates,provenance:userConfirmed?'User confirmed a signal at the mapped avenue/lakeside road junction; pole appearance and timing are reconstructed':'OSM source junction/crossing node; pole offset, orientation, appearance and signal timing are reconstructed',coordinateEvidence:userConfirmed?'source-junction-user-confirmed':'source-node',signalEvidence:userConfirmed?'user-confirmed':'source-tag',coordinateSourceIds:userConfirmed?['way/1228820956','way/97080595']:undefined,timingEvidence:'scenario-estimate',scenario:false,tags:t};
    if(t.highway==='traffic_signals'){
      const sharedNode=nodes.get(key(f.geometry.coordinates));
      function approachStop(direction){
        const probe=Math.max(0,Math.min(length,near.progress-direction*.01));
        const approach=segments.find(s=>probe>=s.startProgress&&probe<s.endProgress)||segments.at(-1);
        const dx=(approach.to.x-approach.from.x)/approach.length*direction,dz=(approach.to.z-approach.from.z)/approach.length*direction;
        let clearance=2.1;
        for(const branch of sharedNode?.links||[]){
          if(!branch.rideAllowed)continue;
          const other=nodes.get(branch.to),bx=other.x-sharedNode.x,bz=other.z-sharedNode.z,bl=Math.hypot(bx,bz);
          if(bl<.01)continue;
          // Ignore same-axis continuations. For a skew junction, divide the
          // crossing half-width by sin(angle) to clear its actual road ribbon.
          const sine=Math.abs(dx*bz-dz*bx)/bl;if(sine<Math.sin(Math.PI/9))continue;
          clearance=Math.max(clearance,branch.width/(2*sine)+2.1);
        }
        // The mapped footway crosses the cycle bands before the junction
        // centre and again on the lakeside turn. Estimated stop lines must
        // remain outside that whole conflict area, not stop vehicles across
        // the first crossing. Offsets are source-node-relative, so changing
        // dormitories does not move the physical control boundary.
        if(userConfirmed)clearance=Math.max(clearance,direction===1?17.4:15.4);
        const progress=Math.max(0,Math.min(length,near.progress-direction*clearance)),position=sourcePose(progress);
        const segment=segments.find(s=>progress>=s.startProgress&&progress<s.endProgress)||segments.at(-1);
        return{x:position.x,y:surfaceElevation(progress)+.16,z:position.z,yaw:Math.atan2(-(segment.to.x-segment.from.x)*direction,-(segment.to.z-segment.from.z)*direction),progress,width:segment.width,clearance,direction,evidence:userConfirmed?'estimated stop line outside mapped footway/cycle-band crossing area; source junction offset with 17.4 m forward / 15.4 m reverse minimum; not surveyed':'estimated approach stop line beyond connected crossing road half-width plus 2.1 m; skew-angle corrected; not surveyed'};
      }
      item.stopLine=approachStop(1);item.stopLineProgress=item.stopLine.progress;
      item.reverseStopLine=approachStop(-1);item.reverseStopLineProgress=item.reverseStopLine.progress;
      trafficSignals.push(item);
    }else{
      // A nearby commute leg can turn away while this source crossing remains
      // on the avenue. Orient paint across its incident motor road, rather
      // than across whichever leg happens to win the route projection.
      const incident=[];
      for(const road of roads){const profile=getRoadProfile(road);if(!profile.motor)continue;
        const lines=road.geometry.type==='LineString'?[road.geometry.coordinates]:road.geometry.coordinates;
        for(const line of lines){const index=line.findIndex(c=>key(c)===key(f.geometry.coordinates));if(index<0)continue;
          const a=project(line[Math.max(0,index-1)]),b=project(line[Math.min(line.length-1,index+1)]);if(distance(a,b)<.01)continue;
          incident.push({sourceRoadId:road.id,width:profile.width,yaw:Math.atan2(-(b.x-a.x),-(b.z-a.z)),elevation:profile.elevation});
        }
      }
      incident.sort((a,b)=>b.width-a.width||String(a.sourceRoadId).localeCompare(String(b.sourceRoadId)));
      const road=incident[0];
      if(road)Object.assign(item,{sourceRoadId:road.sourceRoadId,width:road.width,yaw:road.yaw,y:road.elevation+.16,orientationEvidence:incident.length>1?'widest motor source way incident at the exact crossing node; source vertex tangent':'motor source way incident at the exact crossing node; source vertex tangent'});
      else item.orientationEvidence='estimated from the nearest commute segment; no incident motor source way found';
      crossings.push(item);
    }
  }
  // A source signal node describes the controlled junction, not a surveyed pole.
  // Older nearby uncontrolled crossings do not independently override its control.
  for(const c of crossings)c.nearSignal=trafficSignals.some(s=>Math.hypot(s.x-c.x,s.z-c.z)<40);
  // Parking is confined to mapped parking areas or a small estimated layout
  // around an explicit parking POI, with clearances from source roads/buildings.
  function inside(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
  const obstacleRings=fc.features.filter(f=>['building','water'].includes(f.properties?.category)&&f.geometry?.type==='Polygon').map(f=>f.geometry.coordinates[0].map(project));
  const roadSegments=roads.flatMap(f=>{const width=getRoadProfile(f).width,lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;return lines.flatMap(line=>line.slice(1).map((c,i)=>({a:project(line[i]),b:project(c),width})));});
  function clear(p){if(obstacleRings.some(r=>inside(p,r)))return false;for(const e of roadSegments){const dx=e.b.x-e.a.x,dz=e.b.z-e.a.z,t=Math.max(0,Math.min(1,((p.x-e.a.x)*dx+(p.z-e.a.z)*dz)/(dx*dx+dz*dz)));if(Math.hypot(p.x-e.a.x-t*dx,p.z-e.a.z-t*dz)<e.width/2+1.2)return false;}return true;}
  const parkingPlaces=[];
  for(const f of fc.features.filter(f=>f.properties?.tags?.amenity==='bicycle_parking')){
    if(EAST_NINE_PARKING_IDS.includes(f.id))continue;
    const ring=f.geometry.type==='Polygon'?f.geometry.coordinates[0].map(project):null;
    const center=ring?{x:ring.reduce((s,p)=>s+p.x,0)/ring.length,z:ring.reduce((s,p)=>s+p.z,0)/ring.length}:f.geometry.type==='Point'?project(f.geometry.coordinates):null;if(!center)continue;
    if(locate(center).distance>110)continue;
    const minX=ring?Math.min(...ring.map(p=>p.x))+1:center.x-6,maxX=ring?Math.max(...ring.map(p=>p.x))-1:center.x+6;
    const minZ=ring?Math.min(...ring.map(p=>p.z))+1:center.z-3,maxZ=ring?Math.max(...ring.map(p=>p.z))-1:center.z+3;
    let count=0;
    for(let z=minZ;z<=maxZ&&count<80;z+=3.3)for(let x=minX;x<=maxX&&count<80;x+=.95){const p={x,z};if(ring&&![p,{x:x-.38,z:z-.9},{x:x+.38,z:z+.9}].every(v=>inside(v,ring))||!clear(p))continue;
      if(![{x:x-.38,z:z-.9},{x:x+.38,z:z+.9}].every(clear))continue;
      parkingPlaces.push({x,y:.16,z,yaw:0,sourceId:f.id,layoutEvidence:ring?'inferred arrangement in source parking polygon':'inferred small layout around source parking POI'});count++;
    }
  }
  parkingPlaces.push(...createEastNineParking(fc,{frame,geoToLocal,roadSurfaces,locate}));
  const roadsideTrees=[];
  const junctions=[...trafficSignals,...crossings,...[...nodes.values()].filter(n=>new Set(n.links.map(e=>e.sourceId)).size>=3&&locate(n).distance<12)];
  function nearObstacle(p){return obstacleRings.some(r=>inside(p,r)||r.some((a,i)=>{const b=r[(i+1)%r.length],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;if(!l2)return false;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l2));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz)<2.1;}));}
  for(let s=12;s<dismountProgress-10;s+=15){const seg=segments.find(g=>s>=g.startProgress&&s<=g.endProgress);if(!seg||seg.bridge||surfaceElevation(s)>.05)continue;const p=sourcePose(s),dx=seg.to.x-seg.from.x,dz=seg.to.z-seg.from.z,l=Math.hypot(dx,dz)||1;
    for(const side of[-1,1]){const offset=(seg.width/2+1.65)*side,candidate={x:p.x-dz/l*offset,z:p.z+dx/l*offset};if(!clear(candidate)||nearObstacle(candidate)||junctions.some(j=>distance(j,candidate)<12)||parkingPlaces.some(v=>distance(v,candidate)<2.5))continue;
      roadsideTrees.push({...candidate,y:.12,height:8+(roadsideTrees.length*1.618)%2,sourceRoadId:seg.sourceId,positionEvidence:'photo-informed inferred roadside planting; not surveyed individual trees'});
    }
  }
  const photoInferredParking=createYunyuanPhotoParking(fc,{roadSurfaces,parkingPlaces,roadsideTrees},{frame,geoToLocal});
  warnings.push(`Start is on the selected ${startAccess} source public road beside ${dormName}; it is not a surveyed dormitory entrance.`);
  if(destination==='a-north')warnings.push('The final source pedestrian crossing, steps and footway are walked after dismounting.');
  else warnings.push('Arrival is on the mapped lakeside carriageway beside the B/C bicycle parking POI; the parking driveway and building doorway have not been surveyed.');
  warnings.push('Route choice, source-road completeness and student route shares are not observed; no candidate is labelled the student main route.');
  if(dormId===DORM)warnings.push('The user identified 27栋 → 十字路口 → 过喻岱桥后左转进东九湖边弯道 and confirmed the last signal at that mapped junction; signal timing and poles remain modelled.');
  const options={dormId,startAccess,travelMode,destination};
  const choice={label:`${dormName}${startAccess==='north'?'北':'南'}侧公共道路 → ${destination==='a-north'?'东九 A 北入口':'东九湖畔 B/C 前场'}`,originEvidence:'source road beside source dormitory footprint; entrance unverified',destinationEvidence:destination==='a-north'?'mapped footway ends at source building exterior':'source way/97080595 vertex near mapped bicycle parking node/11395860770; no doorway inferred',routingEvidence:'mode-specific candidate on captured source graph, not observed student itinerary',userGuidance:dormId===DORM?'27栋 → 十字路口 → 过喻岱桥后，左转红绿灯进东九湖边弯道（用户确认路口）':null,mainRouteVerified:false};
  return{points,segments,length,distanceMeters:length,sourceRouteLength,entryAnchor,options,choice,bidirectional:true,trafficOrigins,roadSurfaces,pedestrianPaths,sourceIds:[...new Set(segments.map(s=>s.sourceId))],start:{...points[0],name:`${dormName}${startAccess==='north'?'北':'南'}侧公共道路`,buildingId:dormId},end:{...points.at(-1),name:destination==='a-north'?'东九 A 区北侧入口步道':'东九湖畔 B/C 前场道路（停车区旁）',buildingId:EAST_NINE},dismountProgress,trafficSignals,crossings,ramps,parkingPlaces,photoInferredParking,roadsideTrees,warnings,coordinateSystem:'LOCAL_ENU',units:'metres',source:'OpenStreetMap captured source geometries',method:'Mode-specific A* on shared WGS84 road vertices; selected start interpolated on source road; no forced canteen waypoint or invented off-road connectors',referenceDistance:dormId===DORM_23&&destination==='a-north'?{metres:929,source:'Earlier official route / Amap walking guidance',use:'23栋 walking reference only; not forced to match source geometry distance'}:null,locate};
}
