/** CPU-only replay. PERF_SOURCE points to the unchanged baseline checkout.
 * This checks complete motion states before timing; it does not measure FPS. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {createPlayerMotion} from '../src/player-motion.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {getBuildingProfile} from '../src/building-profiles.js';

if(!process.env.PERF_SOURCE)throw new Error('Set PERF_SOURCE to the unmodified baseline checkout.');
const baselineFile=name=>pathToFileURL(resolve(process.env.PERF_SOURCE,'src',name));
const {createPlayerMotion:baselineMotion}=await import(baselineFile('player-motion.js'));
const {createCommuteRoute:baselineRoute}=await import(baselineFile('commute-route.js'));
const data=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),routeOptions={frame,geoToLocal};
const route=createCommuteRoute(data,routeOptions),oldRoute=baselineRoute(data,routeOptions);
const project=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
const records=category=>data.features.filter(f=>f.properties?.category===category&&['Polygon','MultiPolygon'].includes(f.geometry?.type)).flatMap(f=>(f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates).map(rings=>({id:f.id,rings:rings.map(r=>r.map(project)),height:category==='building'?getBuildingProfile(f).height+.065:0})));
const campusWorld={buildings:records('building'),water:records('water')};
const polygon=(x0,z0,x1,z1)=>[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
const flat={length:300,points:[{x:0,y:.16,z:0,progress:0},{x:0,y:.16,z:-300,progress:300}],segments:[{startProgress:0,endProgress:300,width:7.2}]};
const collisionWorld={buildings:[{height:12,rings:[polygon(-5,-36,5,-30)]},{height:9,minHeight:6,rings:[polygon(12,-18,28,18)]}],barriers:[{polygon:polygon(-8,-15,8,-14.8),height:1.2,minHeight:0,label:'rail'}],walkSurfaces:[{polygon:polygon(-8,-14.8,8,-13),surfaceY:.3}],water:[{rings:[polygon(-40,-80,40,-50)]}]};
const start=route.points[Math.floor(route.points.length*.14)];
const scenarios=[
  ...['walk','scooter','hoverboard','roadster','helicopter','spider'].map(mode=>({id:`campus-${mode}`,mode,world:campusWorld,route,oldRoute,start:{x:start.x+12,z:start.z+12,y:mode==='walk'||mode==='scooter'?.14:30,yaw:0}})),
  ...['walk','scooter','hoverboard','roadster','helicopter','spider'].map(mode=>({id:`colliders-${mode}`,mode,world:collisionWorld,route:flat,oldRoute:flat,start:{x:0,z:0,y:.14,yaw:0}})),
  {id:'boat-shore',mode:'boat',world:{water:[{rings:[polygon(-12,-90,12,15)]}]},route:flat,oldRoute:flat,start:{x:0,z:0,y:.022,yaw:0}},
];
const traffic=Array.from({length:80},(_,i)=>({id:i,type:i%3?'scooter':'walk',active:true,x:(i%10-5)*6,y:.14,z:-Math.floor(i/10)*8-20,yaw:i*.1}));
function make(factory,spec,baseline=false){
  const motion=factory({route:baseline?spec.oldRoute:spec.route,world:spec.world,traffic:()=>traffic});
  motion.setMode(spec.mode);Object.assign(motion.state,spec.start,{mode:spec.mode,speed:0,vx:0,vz:0,rotorPower:1,grounded:spec.start.y<1});
  if(spec.mode==='roadster')motion.setFlightEnabled(true);
  return motion;
}
function frameInput(i,mode){
  const phase=Math.floor(i/90)%6;
  return {forward:phase===5?-.35:phase===4?0:1,turn:phase===1?.42:phase===3?-.6:0,vertical:phase===0?1:phase===3?-1:0,fast:true,brake:phase===4,jump:mode==='spider'&&i%180===0,swing:mode==='spider'&&phase===1,zip:mode==='spider'&&i%210===0,point:mode==='spider'&&i%330===0};
}
const inputs=Object.fromEntries([...new Set(scenarios.map(s=>s.mode))].map(mode=>[mode,Array.from({length:600},(_,i)=>frameInput(i,mode))]));
const cadence=i=>i%73===15?.1:i%73===51?.25:[1/60,1/30,1/20][Math.floor(i/200)];
const checksums={};let comparedFrames=0;
for(const scenario of scenarios){
  const a=make(baselineMotion,scenario,true),b=make(createPlayerMotion,scenario),hash=createHash('sha256');
  assert.deepEqual(b.state,a.state,`${scenario.id}: initial`);
  for(let i=0;i<600;i++){
    a.step(cadence(i),inputs[scenario.mode][i]);b.step(cadence(i),inputs[scenario.mode][i]);
    assert.deepEqual(b.state,a.state,`${scenario.id}: frame ${i}`);hash.update(JSON.stringify(b.state));comparedFrames++;
  }
  checksums[scenario.id]=hash.digest('hex');
}
const median=values=>values.sort((a,b)=>a-b)[values.length>>1];
const measure=(factory,spec,baseline)=>{
  const player=make(factory,spec,baseline),list=inputs[spec.mode],begin=performance.now();
  for(let i=0;i<600;i++)player.step(1/60,list[i]);
  return performance.now()-begin;
};
const results=[];
if(!process.argv.includes('--verify-only'))for(const scenario of scenarios.filter(s=>s.id.startsWith('campus-'))){
  measure(baselineMotion,scenario,true);measure(createPlayerMotion,scenario,false);
  const before=[],after=[];
  for(let run=0;run<7;run++){
    if(run%2){after.push(measure(createPlayerMotion,scenario,false));before.push(measure(baselineMotion,scenario,true));}
    else{before.push(measure(baselineMotion,scenario,true));after.push(measure(createPlayerMotion,scenario,false));}
  }
  const baselineMs=median(before),optimizedMs=median(after);
  results.push({scenario:scenario.id,frames:600,physicsHz:120,baselineMs,optimizedMs,reductionPercent:(1-optimizedMs/baselineMs)*100,baselineRunsMs:before,optimizedRunsMs:after});
}
const report={scope:'Node CPU only, exact full-state comparison on captured source campus buildings/water plus synthetic rails, overhang, steps, shore and traffic; no rendered FPS or complete architectural collision-world claim.',node:process.version,physicsHz:120,routeSegments:route.segments.length,buildings:campusWorld.buildings.length,comparedFrames,checksums,results};
const output=JSON.stringify(report,null,2);console.log(output);
const outputArg=process.argv.find(arg=>arg.startsWith('--output='));if(outputArg)writeFileSync(outputArg.slice(9),output+'\n');
