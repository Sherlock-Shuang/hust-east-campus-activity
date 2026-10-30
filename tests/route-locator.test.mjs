import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRouteLocator} from '../src/route-locator.js';
import {createCommuteRoute,COMMUTE_DORMS} from '../src/commute-route.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

function originalLocate(segments,p){let best={distance:Infinity};for(const seg of segments){const dx=seg.to.x-seg.from.x,dz=seg.to.z-seg.from.z,l2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((p.x-seg.from.x)*dx+(p.z-seg.from.z)*dz)/l2)),x=seg.from.x+dx*t,z=seg.from.z+dz*t,d=Math.hypot(p.x-x,p.z-z);if(d<best.distance)best={distance:d,x,z,progress:seg.startProgress+t*seg.length,yaw:Math.atan2(-dx,-dz),width:seg.width,sourceId:seg.sourceId};}return best;}
function segment(a,b,index){return {from:a,to:b,startProgress:index*100,length:Math.hypot(a.x-b.x,a.z-b.z),sourceId:`source-${index}`,width:7+index};}

test('route bounds preserve exact source-order ties, endpoint projections and degenerate input',()=>{
  const segments=[segment({x:0,z:-4},{x:0,z:4},0),segment({x:-4,z:0},{x:4,z:0},1),segment({x:0,z:4},{x:0,z:-4},2),...Array.from({length:30},(_,i)=>segment({x:100+i*8,z:100},{x:104+i*8,z:104},i+3)),segment({x:0,z:0},{x:0,z:0},33)];
  const locate=createRouteLocator(segments);
  for(const p of [{x:0,z:0},{x:1,z:1},{x:0,z:4},{x:4,z:4},{x:-1e6,z:1e6},{x:NaN,z:0},{x:Infinity,z:0}])assert.deepEqual(locate(p),originalLocate(segments,p));
  assert.deepEqual(createRouteLocator([])({x:0,z:0}),{distance:Infinity});
});

test('indexed source routes match the original projection at all vertices and across campus',()=>{
  const data=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  let seed=9413;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
  for(const dorm of COMMUTE_DORMS){
    const route=createCommuteRoute(data,{frame,geoToLocal,dormId:dorm.id});
    const queries=route.segments.flatMap(s=>[s.from,s.to,{x:(s.from.x+s.to.x)/2,z:(s.from.z+s.to.z)/2}]);
    for(let i=0;i<1200;i++)queries.push({x:random()*2200-1100,z:random()*2200-1100});
    for(const p of queries)assert.deepEqual(route.locate(p),originalLocate(route.segments,p),`${dorm.id}: ${p.x}, ${p.z}`);
  }
});
