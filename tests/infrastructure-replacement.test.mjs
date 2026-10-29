import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerMotion} from '../src/player-motion.js';
import {createPlayerWorld} from '../src/player-experience.js';

const rectangle=(x0,z0,x1,z1)=>[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
const deck={sourceId:'canteen-walkway',polygon:rectangle(-2,-20,2,-10),surfaceY:4.14,bridge:true,deckDepth:.75};
const route={length:50,points:[{x:0,z:0,y:.16},{x:0,z:-50,y:.16}],roadSurfaces:[deck]};

test('photo-model replacement suppresses the old flat deck without deleting the actual upper walkway',()=>{
  const replacement={...deck,surfaceY:3.54,deckDepth:.25};
  const player=createPlayerMotion({route,world:{replacedRoadIds:['canteen-walkway'],walkSurfaces:[replacement]}});
  assert.equal(player.groundAt(0,-15).height,3.54,'only the replacement roof contact remains');
  assert.equal(player.groundAt(0,-15,0,.14).height,.14,'ground level passage stays below the deck');
  assert.equal(player.placeWalker({x:0,y:.14,z:-8,yaw:0}).ok,true);
  for(let i=0;i<150;i++)player.step(1/60,{moveX:0,moveZ:-1});
  assert.ok(player.state.z<-12,'a person can walk beneath the elevated arcade');
  assert.equal(player.state.y,.14,'entering the footprint does not launch a walker onto the old 4m bridge');
  const original=createPlayerMotion({route});
  assert.equal(original.groundAt(0,-15).height,4.14,'unreplaced source bridges retain their original surface');
});

test('source road replacement IDs pass through the shared world without mutating map infrastructure',()=>{
  const architecture={replacedRoadIds:['canteen-walkway','shared']},sports={replacedRoadIds:['stadium-stairs','shared']};
  const model={records:[],buildings:[],water:[],bounds:{},architectureInfrastructure:architecture,sportsInfrastructure:sports};
  const before=JSON.stringify(model),world=createPlayerWorld(model);
  assert.deepEqual(new Set(world.replacedRoadIds),new Set(['canteen-walkway','stadium-stairs','shared']));
  assert.equal(world.replacedRoadIds.length,3);
  assert.equal(JSON.stringify(model),before);
});

test('a bridge and solid landing sharing only an edge allow a whole foot to cross while unguarded drops stay blocked',()=>{
  const bridge={sourceId:'arcade',polygon:rectangle(-2,-10,2,0),surfaceY:3.54,bridge:true,deckDepth:.25};
  const flatRoute={...route,roadSurfaces:[bridge]};
  const make=walkSurfaces=>createPlayerMotion({route:flatRoute,world:{walkSurfaces}});
  const landing={polygon:rectangle(-2,0,2,5),surfaceY:3.54};
  const player=make([landing]);
  assert.equal(player.placeWalker({x:0,z:-3,y:3.54,yaw:Math.PI}).ok,true);
  for(let i=0;i<180;i++)player.step(1/120,{moveX:0,moveZ:1});
  assert.ok(player.state.z>1,'no invisible wall at the shared boundary');
  assert.equal(player.state.y,3.54);
  const edge=make([]);assert.equal(edge.placeWalker({x:0,z:-3,y:3.54,yaw:Math.PI}).ok,true);
  for(let i=0;i<180;i++)edge.step(1/120,{moveX:0,moveZ:1});
  assert.ok(edge.state.z<=-.25,'unsupported bridge edge is still rejected');
  assert.equal(edge.state.y,3.54);
  const holed=make([{...landing,holes:[rectangle(-1,0,1,4)]}]);assert.equal(holed.placeWalker({x:0,z:-3,y:3.54,yaw:Math.PI}).ok,true);
  for(let i=0;i<180;i++)holed.step(1/120,{moveX:0,moveZ:1});
  assert.ok(holed.state.z<=-.25,'a hole in the landing is not support');
});
