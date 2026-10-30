import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getBuildingSpatialIndex,invalidateBuildingSpatialIndex} from '../src/building-spatial-index.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {calculatePlayerCamera,constrainPlayerCamera} from '../src/player-camera.js';
import {spatialWorld,rectangle,motionReplay,cameraReplay} from './helpers/spatial-query-scenarios.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('bounded grid candidates equal an ordered full bounds scan, including negative cells and long sweeps',()=>{
  const world=spatialWorld(),index=getBuildingSpatialIndex(world.buildings);let random=1234567;
  const next=()=>((random=Math.imul(random,1664525)+1013904223>>>0)/2**32);
  for(let n=0;n<3000;n++){
    const minX=-200+next()*1200,minZ=-500+next()*1500,maxX=minX+next()*(n%20===0?1800:80),maxZ=minZ+next()*(n%20===0?1800:80);
    const expected=index.records.filter(b=>!(maxX<b.minX||minX>b.maxX||maxZ<b.minZ||minZ>b.maxZ));
    assert.deepEqual(index.queryBounds(minX,minZ,maxX,maxZ),expected);
  }
  const thin=index.records.find(b=>b.id==='thin');
  assert.ok(index.querySegment({x:-200,z:-44.98},{x:500,z:-44.98},.37).includes(thin),'full swept path sees thin wall despite empty endpoint cells');
  assert.ok(index.queryPoint(32,-30).some(b=>b.id==='court'),'courtyard remains a candidate; exact holes stay a narrow-phase responsibility');
});

test('shared raw/normalized arrays reuse index; replacement, append and explicit edits rebuild safely',()=>{
  const records=spatialWorld().buildings,index=getBuildingSpatialIndex(records);
  assert.equal(getBuildingSpatialIndex(records),index);
  assert.equal(getBuildingSpatialIndex(index.records),index);
  assert.notEqual(getBuildingSpatialIndex([...records]),index);
  records.push({id:'new',rings:[rectangle(-150,-150,-145,-145)],height:10});
  const rebuilt=getBuildingSpatialIndex(records);assert.notEqual(rebuilt,index);
  assert.equal(rebuilt.queryPoint(-148,-148)[0].id,'new');
  records.at(-1).rings=[rectangle(-180,-180,-175,-175)];invalidateBuildingSpatialIndex(records);
  const edited=getBuildingSpatialIndex(records);assert.equal(edited.queryPoint(-178,-178)[0].id,'new');
  invalidateBuildingSpatialIndex(edited.records);assert.notEqual(getBuildingSpatialIndex(records),edited,'invalidating a normalized alias also invalidates the original source');
});

test('large footprints and edge touching are retained without unbounded cell construction',()=>{
  const records=[{id:'huge',rings:[rectangle(-100000,-100000,100000,100000)],height:8},
    {id:'edge',rings:[rectangle(32,32,33,33)],height:2}];
  const index=getBuildingSpatialIndex(records);
  assert.ok(index.cellCount<10);
  assert.deepEqual(index.queryPoint(32,32).map(b=>b.id),['huge','edge']);
  assert.deepEqual(index.queryBounds(-Infinity,0,Infinity,1),index.records,'invalid broad phase conservatively leaves exact checks intact');
  const mapped=index.records.map((b,i)=>({id:b.id,index:i}));
  assert.deepEqual(index.querySegment({x:-2,z:-2},{x:32,z:32},0,mapped),mapped);
});

test('six modes and camera traces retain pre-index behavior, including long frames and held casts',()=>{
  const baseline=JSON.parse(readFileSync(new URL('./fixtures/building-spatial-baseline.json',import.meta.url),'utf8'));
  const world=spatialWorld(),motion=motionReplay(createPlayerMotion,world);
  for(const mode of Object.keys(motion))assert.equal(digest(motion[mode]),baseline.motion[mode],`${mode} deterministic fixed-step behavior unchanged`);
  assert.equal(digest(cameraReplay(calculatePlayerCamera,constrainPlayerCamera,world)),baseline.camera,'camera clipping including inner courts/overhead structures unchanged');
});
