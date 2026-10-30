// CPU/geometry/upload-range benchmark; this does not claim GPU timing or FPS.
import * as THREE from 'three';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {createC118Audience} from '../src/c118-audience.js';
import {createC118FloodEffect} from '../src/c118-flood-effect.js';
import {createC118Performance} from '../src/c118-performance.js';

const plan=planOptoC118Interior();
const output={conditions:{frames:600,frameRate:60,clock:1793370000,scope:'Node CPU and submitted geometry, not browser FPS'},modes:{}};
for(const mode of['smooth','balanced','clear']){
  const budget=createC118Performance({mode,deviceRatio:1,width:1280,height:720}).budget;
  const audience=createC118Audience(THREE,{plan}),water=createC118FloodEffect(THREE,{plan});
  audience.setPerformanceBudget(budget);water.setPerformanceBudget({level:budget.waterLevel});
  function phase(flood){
    let updates=0;const start=performance.now();
    for(let i=0;i<600;i++)updates+=Number(audience.update({time:1793370000+i/60,elapsed:flood?30+i/60:null}));
    const cpuMs=performance.now()-start;
    const usedUploadBytes=audience.group.children.filter(mesh=>mesh.name.startsWith('c118-audience-moving-')).reduce((sum,mesh)=>sum+mesh.instanceMatrix.updateRanges.reduce((total,range)=>total+range.count*4,0),0);
    return {updates,cpuMs,usedUploadBytes};
  }
  phase(true);const measures=Array.from({length:3},()=>({dry:phase(false),flood:phase(true)}));
  const meshes=water.group.children.filter(o=>o.isMesh),spray=water.group.getObjectByName('c118-door-spray');
  output.modes[mode]={audienceHz:budget.audienceHz,measures,waterTriangles:meshes.reduce((sum,o)=>sum+o.geometry.index.count/3,0),sprayCount:Math.min(spray.geometry.drawRange.count,spray.geometry.attributes.position.count)};
  audience.dispose();water.dispose();
}
console.log(JSON.stringify(output,null,2));
