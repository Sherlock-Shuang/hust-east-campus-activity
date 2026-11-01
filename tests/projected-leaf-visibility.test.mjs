import test from 'node:test';import assert from 'node:assert/strict';
import {createProjectedLeafVisibility} from '../src/projected-leaf-visibility.js';
test('projected threshold inversion matches original leaf decisions across distances, heights and exact cutoffs',()=>{
 const leaves=Array.from({length:12000},(_,i)=>({x:Math.sin(i)*200,z:Math.cos(i*.31)*300,height:i%8*.04,radius:.09+(i%12)*.01})),thresholds=leaves.map((_,i)=>(i*.61803398875)%1),out=new Uint8Array(leaves.length),select=createProjectedLeafVisibility(leaves,thresholds,.13);
 function compare(camera,scale){select(camera,scale,out);for(let i=0;i<leaves.length;i++){const l=leaves[i],d=Math.hypot(camera.x-l.x,camera.y-(.13+l.height),camera.z-l.z),pixels=l.radius*scale/Math.max(.01,d),t=Math.max(0,Math.min(1,(pixels-.9)/1.1)),density=t*t*(3-2*t);assert.equal(out[i],density>=1||density>thresholds[i]?1:0);}}
 for(const scale of[200,390,800,1800])for(const y of[0,1.7,20,80,250])compare({x:80,z:-40,y},scale);
 for(const i of[0,1,502,11000]){const l=leaves[i],t=.5-Math.sin(Math.asin(1-2*thresholds[i])/3),d=l.radius*800/(.9+1.1*t);for(const shift of[-1e-10,0,1e-10])compare({x:l.x+d+shift,y:.13+l.height,z:l.z},800);}
});
