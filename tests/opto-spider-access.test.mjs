import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {crossedInteriorDoor,nearbyInterior,interiorReturnSnapshot} from '../src/building-interiors.js';

// Reproduce the actual merged campus and its replacement infrastructure, not
// just an empty rectangular test doorway. Use the real commute road surfaces.
const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
const campus=createCampus3D(THREE,model,{frame,geoToLocal});
const world=createPlayerWorld(model),route=createCommuteRoute(data,{frame,geoToLocal});
after(()=>{campus.dispose();model.dispose();});
const motion=()=>createPlayerMotion({world,route});
const doorPose=(entry,depth)=>({x:entry.doorGate.center.x+entry.doorGate.normal.x*depth,
  z:entry.doorGate.center.z+entry.doorGate.normal.z*depth,y:entry.y,
  yaw:Math.atan2(entry.doorGate.normal.x,entry.doorGate.normal.z)});
const where=state=>JSON.stringify({x:state.x,y:state.y,z:state.z,grounded:state.grounded,blockedReason:state.blockedReason});

function detector(player,phase=0){
  let tick=phase,previous={...player.state},crossed=null,nearSeen=false;
  return {
    update(input={}){
      player.step(1/120,input);
      if(++tick%24===0){
        // live-experience refreshes at 200 ms; checking every physics step
        // would miss a detection regression at normal or sprint spider speed.
        crossed??=crossedInteriorDoor(campus.optoEntries,previous,player.state);
        nearSeen||=!!nearbyInterior(campus.optoEntries,player.state);
        previous={...player.state};
      }
      return crossed;
    },
    get crossed(){return crossed;},get nearSeen(){return nearSeen;},
  };
}

for(const mode of ['walk','spider'])for(const fast of [false,true]){
  test(`${mode}${fast?' sprint':''}: complete exterior-to-C118 paths stay grounded and enter at 200 ms polling`,()=>{
    for(const entry of campus.optoEntries){
      const path=entry.exteriorAccessPath||entry.accessPath;
      const p=motion();assert.equal(p.placeMode(path[0],mode).ok,true,`${entry.id} approach permits ${mode}`);
      const poll=detector(p);
      for(const [index,target]of path.slice(1).entries()){
        let reached=false;
        for(let i=0;i<2400&&!poll.crossed;i++){
          const dx=target.x-p.state.x,dz=target.z-p.state.z,d=Math.hypot(dx,dz);
          if(d<.07){reached=true;p.suspend();break;}
          const gain=Math.min(1,d*1.8);poll.update({moveX:dx/d*gain,moveZ:dz/d*gain,fast});
          assert.equal(p.state.blockedReason,'',`${entry.id} segment ${index}: ${where(p.state)}`);
          assert.equal(p.state.grounded,true,`${entry.id}: walking must not turn airborne`);
          assert.ok(Math.abs(p.state.y-.14)<.03,`${entry.id}: no stair or roof snap`);
        }
        assert.ok(reached||poll.crossed,`${entry.id}: target not reached, ${where(p.state)}`);
        if(poll.crossed)break;
      }
      for(let i=0;i<24&&!poll.crossed;i++)poll.update();
      assert.equal(poll.crossed?.id,entry.id,`${entry.id} does not open at realistic polling`);
      assert.equal(poll.crossed.url,entry.url);
      assert.ok(poll.nearSeen,'an accessible doorway also offers Enter/click admission');
    }
  });
}

test('spider sprint crosses all three real doors at every 120 Hz / 200 ms polling phase',()=>{
  for(const entry of campus.optoEntries)for(let phase=0;phase<24;phase++){
    const p=motion();assert.equal(p.placeMode(doorPose(entry,2.8),'spider').ok,true);
    const poll=detector(p,phase),normal=entry.doorGate.normal;
    for(let i=0;i<240&&!poll.crossed;i++)poll.update({moveX:-normal.x,moveZ:-normal.z,fast:true});
    assert.equal(poll.crossed?.id,entry.id,`${entry.id}, phase ${phase}, ${where(p.state)}`);
    assert.equal(p.state.grounded,true);assert.ok(Math.abs(p.state.y-entry.y)<.04);
  }
});

test('grounded spider supports manual admission and exact same-path return; airborne admission is rejected',()=>{
  for(const entry of campus.optoEntries)for(const mode of ['walk','spider']){
    const p=motion();assert.equal(p.placeMode(doorPose(entry,.65),mode).ok,true);
    assert.equal(nearbyInterior(campus.optoEntries,p.state)?.id,entry.id);
    assert.equal(nearbyInterior(campus.optoEntries,{...p.state,grounded:false}),null,'landing is required');
    assert.equal(nearbyInterior(campus.optoEntries,{...p.state,y:p.state.y+1}),null,'no admission from a different storey');
    const saved={mode,state:{...p.state},lookHeading:1.2,view:'third'};
    const returned=interiorReturnSnapshot(saved,entry),restored=p.restorePose(returned.state,returned.mode);
    assert.equal(restored.ok,true,`${entry.id}/${mode}: ${restored.reason}`);
    assert.equal(p.state.mode,mode);assert.equal(p.state.grounded,true);
    assert.ok(Math.hypot(p.state.x-entry.returnPose.x,p.state.z-entry.returnPose.z)<1e-8);
    assert.equal(nearbyInterior(campus.optoEntries,p.state),null,'return is clear of admission zone');
    assert.equal(crossedInteriorDoor(campus.optoEntries,null,p.state),null,'return does not reopen the hall');
  }
});
