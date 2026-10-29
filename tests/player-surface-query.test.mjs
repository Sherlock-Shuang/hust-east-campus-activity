import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlayerMotion } from '../src/player-motion.js';
import { createVehicleCameraRig } from '../src/player-camera.js';
import { createCommuteRoute } from '../src/commute-route.js';
import { createLocalFrame, geoToLocal } from '../src/geospatial.js';

const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const route=createCommuteRoute(source,{frame,geoToLocal});

test('height-only queries match full contact at source route, bridge decks and cell boundaries',()=>{
  const player=createPlayerMotion({route});
  const points=route.points.flatMap(p=>[-4,0,4].flatMap(dx=>[-4,0,4].map(dz=>({x:p.x+dx,z:p.z+dz}))));
  for(const surface of route.roadSurfaces.filter(s=>s.bridge)) {
    points.push(...surface.polygon);
    points.push({x:surface.polygon.reduce((n,p)=>n+p.x,0)/surface.polygon.length,z:surface.polygon.reduce((n,p)=>n+p.z,0)/surface.polygon.length});
    const b=surface.bounds;
    for(let x=Math.floor(b.minX/24)*24;x<=b.maxX+24;x+=24)for(let z=Math.floor(b.minZ/24)*24;z<=b.maxZ+24;z+=24)points.push({x,z});
  }
  for(const p of points) {
    const full=player.groundAt(p.x,p.z).height,fast=player.groundAt.heightAt(p.x,p.z);
    assert.ok(Math.abs(fast-full)<1e-10,`height mismatch at ${p.x}, ${p.z}`);
    assert.ok(fast<=player.groundAt.maxHeightInBounds(p.x-.3,p.z-.3,p.x+.3,p.z+.3)+1e-10);
  }
});

test('custom ramps keep the full interpolated contact semantics and a conservative ceiling',()=>{
  const ramp={points:[{x:0,z:0,y:.16},{x:0,z:-10,y:.16},{x:0,z:-30,y:3.16},{x:0,z:-60,y:3.16}],segments:[{startProgress:0,endProgress:60,width:8}]};
  const player=createPlayerMotion({route:ramp});
  for(let z=0;z>=-60;z-=.5)for(const x of[-5,0,3]) {
    assert.equal(player.groundAt.heightAt(x,z),player.groundAt(x,z).height);
    assert.ok(player.groundAt.heightAt(x,z)<=player.groundAt.maxHeightInBounds(x,z,x,z));
  }
});

test('a clear chase camera no longer queries route progress hundreds of times per frame',()=>{
  const player=createPlayerMotion({route});player.setMode('hoverboard');
  let fullCalls=0,heightCalls=0;
  const groundAt=(...args)=>{fullCalls++;return player.groundAt(...args);};
  groundAt.heightAt=(...args)=>{heightCalls++;return player.groundAt.heightAt(...args);};
  groundAt.maxHeightInBounds=player.groundAt.maxHeightInBounds;
  const rig=createVehicleCameraRig();rig.reset(player.state);
  for(let i=0;i<60;i++)rig.update(player.state,1/60,{groundAt});
  assert.equal(fullCalls,0);
  assert.ok(heightCalls<=180,`expected at most three local height checks per frame, got ${heightCalls/60}`);
});

test('local terrain bound cannot hide a raised deck or skip a camera below that deck',()=>{
  const bridge={bridge:true,surfaceY:3,polygon:[{x:-2,z:2},{x:2,z:2},{x:2,z:5},{x:-2,z:5}]};
  const flat={points:[{x:0,z:0,y:.16},{x:0,z:-100,y:.16}],segments:[{startProgress:0,endProgress:100,width:8}],roadSurfaces:[bridge]};
  const player=createPlayerMotion({route:flat});player.setMode('hoverboard');
  assert.equal(player.groundAt.heightAt(0,3),3);
  assert.ok(player.groundAt.maxHeightInBounds(-.3,-1,.3,8)>=3);
  const direct=createVehicleCameraRig(),optimized=createVehicleCameraRig();direct.reset(player.state);optimized.reset(player.state);
  const raw=(...args)=>player.groundAt(...args);
  raw.solidsInBounds=player.groundAt.solidsInBounds;
  for(let i=0;i<30;i++) {
    const a=direct.update(player.state,1/60,{groundAt:raw}),b=optimized.update(player.state,1/60,{groundAt:player.groundAt});
    for(const part of ['position','target'])for(const axis of ['x','y','z'])assert.ok(Math.abs(a[part][axis]-b[part][axis])<1e-9);
  }
});
