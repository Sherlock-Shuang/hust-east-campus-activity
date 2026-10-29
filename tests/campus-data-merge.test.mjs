import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
const base=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url)));
const extra=JSON.parse(readFileSync(new URL('../public/data/opto-southeast.geojson',import.meta.url)));
const line=(id,coordinates)=>({type:'Feature',id,properties:{category:'road'},geometry:{type:'LineString',coordinates}});
const fc=features=>({type:'FeatureCollection',features});
test('southeast extension adds the real opto outline and three courtyard holes without mutating original data',()=>{
  const before=JSON.stringify(base),ext=JSON.stringify(extra),merged=mergeCampusExtension(base,extra);
  assert.equal(JSON.stringify(base),before);assert.equal(JSON.stringify(extra),ext);
  assert.equal(new Set(merged.features.map(f=>f.id)).size,merged.features.length);
  assert.ok(!base.features.some(f=>f.id==='relation/13705821'));
  const opto=merged.features.find(f=>f.id==='relation/13705821');
  assert.equal(opto.geometry.type,'Polygon');assert.equal(opto.geometry.coordinates.length,4);
  assert.ok(merged.bbox[1]<30.508);
  assert.deepEqual(merged.viewBbox,[114.417,30.508,114.44,30.532]);
  for(const f of base.features.filter(f=>!f.geometry.type.includes('LineString')))assert.equal(merged.features.find(g=>g.id===f.id),f);
});
test('same road across capture seam joins without duplicate overlap or invented bridges',()=>{
  const merged=mergeCampusExtension(fc([line('road',[[1,4],[1,2]])]),fc([line('road',[[1,3],[1,2],[1,0]])]),{seamLatitude:2});
  assert.deepEqual(merged.features[0].geometry,{type:'LineString',coordinates:[[1,4],[1,2],[1,0]]});
  const gap=mergeCampusExtension(fc([line('road',[[1,4],[1,2]])]),fc([line('road',[[2,1],[2,0]])]),{seamLatitude:2});
  assert.equal(gap.features[0].geometry.type,'MultiLineString');
});
test('reversed line endpoints join in source order and crossing segments are clipped exactly',()=>{
  const merged=mergeCampusExtension(fc([line('road',[[2,2],[3,3]])]),fc([line('road',[[3,3],[1,1]])]),{seamLatitude:2});
  assert.deepEqual(merged.features[0].geometry.coordinates,[[3,3],[2,2],[1,1]]);
});
