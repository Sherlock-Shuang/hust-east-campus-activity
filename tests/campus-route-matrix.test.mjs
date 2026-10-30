import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampusRouteFixture,replayCampusSegment,ROUTE_FRAME_PROFILES} from './helpers/campus-route-replay.mjs';

test('complete campus collider world keeps 17 authored walking segments traversable under six input/frame profiles',()=>{
  const fixture=createCampusRouteFixture();
  try{
    assert.equal(fixture.cases.length,17,'keep all named districts and three C118 entrances covered');
    assert.ok(fixture.world.buildings.length>300,'use the reconstructed full collision world, not isolated boxes');
    for(const segment of fixture.cases)for(const profile of ROUTE_FRAME_PROFILES){
      const result=replayCampusSegment(fixture,segment,profile);
      assert.equal(result.passed,true,JSON.stringify(result));
      if(profile.id.includes('+'))assert.ok(result.longFrames>0,`${segment.id}: exercised actual stalls`);
      if(segment.entry){assert.equal(result.crossedDoor,segment.entry.id);assert.equal(result.returnClear,true);}
      else assert.ok(result.endDistanceMetres<.14,`${segment.id}: reaches final authored waypoint`);
    }
  }finally{fixture.dispose();}
});
