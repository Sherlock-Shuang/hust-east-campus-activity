import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame, geoToLocal} from '../src/geospatial.js';
import {pointInLandcover} from '../src/campus-landcover.js';
import {planEinsteinSquare} from '../src/einstein-square.js';
import {activityPortals, SHE_LOVE_POINT_ID} from '../src/activity-catalog.js';

function segmentDistance(point, a, b) {
  const dx=b.x-a.x, dz=b.z-a.z, lengthSquared=dx*dx+dz*dz;
  const t=lengthSquared ? Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.z-a.z)*dz)/lengthSquared)) : 0;
  return Math.hypot(point.x-a.x-t*dx,point.z-a.z-t*dz);
}
const edgeDistance=(point,ring)=>Math.min(...ring.map((a,i)=>segmentDistance(point,a,ring[(i+1)%ring.length])));

test('independent she-love entry stays on the Einstein court, clear of barriers and reachable from its tour arrival', () => {
  const data=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
  try {
    const plan=planEinsteinSquare(model,{frame,geoToLocal}), portals=activityPortals();
    const entry=portals.find(point=>point.id===SHE_LOVE_POINT_ID);
    assert.ok(plan.accepted && entry && plan.arrival);
    assert.equal(entry.radius,6);
    const isClear=point=>pointInLandcover(point.x,point.z,plan.polygons) &&
      plan.barriers.every(barrier=>!pointInLandcover(point.x,point.z,[[barrier.polygon.map(p=>[p.x,p.z])]]));
    assert.ok(isClear(entry),'entry is on the road-excluded paving and outside every barrier');
    // Center containment plus clearance from every outer/hole edge proves the
    // complete trigger disk stays on the paving, beyond the sampled checks below.
    const pavingClearance=Math.min(...plan.polygons.flatMap(polygon=>polygon.map(ring=>edgeDistance(entry,ring.map(([x,z])=>({x,z}))))));
    assert.ok(pavingClearance>entry.radius,'full trigger disk has room before a paving boundary');
    assert.ok(plan.barriers.every(barrier=>edgeDistance(entry,barrier.polygon)>entry.radius),'full trigger disk clears plinth, head, pergola and beds');
    for(let i=0;i<720;i++) {
      const angle=i*Math.PI/360;
      assert.ok(isClear({x:entry.x+entry.radius*Math.cos(angle),z:entry.z+entry.radius*Math.sin(angle)}),`trigger perimeter sample ${i} stays clear`);
    }
    assert.ok(Math.hypot(entry.x-plan.arrival.x,entry.z-plan.arrival.z)<entry.radius,'existing ?place=einstein arrival can find the entry immediately');
    for(let i=0;i<=100;i++) {
      const t=i/100;
      assert.ok(isClear({x:plan.arrival.x+(entry.x-plan.arrival.x)*t,z:plan.arrival.z+(entry.z-plan.arrival.z)*t}),'arrival-to-entry walk stays on unobstructed paving');
    }
    for(const other of portals.filter(point=>point.id!==entry.id)) {
      assert.ok(Math.hypot(entry.x-other.x,entry.z-other.z)>entry.radius+other.radius,`${other.id} trigger must not overlap`);
    }
  } finally { model.dispose(); }
});
