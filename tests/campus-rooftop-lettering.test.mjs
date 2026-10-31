import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fontData from '../src/campus-lettering-font.js';
import {createCampusRooftopLettering} from '../src/campus-rooftop-lettering.js';

test('both complete rooftop inscriptions have finite solid letters and mounts that reach the registered roof',()=>{
  for(const item of [
    {text:'S.T.A.Y',width:22,height:5.5,y:30.9,roofY:27.4,opacity:.96},
    {text:'seize the day',width:30,height:3.8,y:22.7,roofY:20,opacity:.96},
  ]){
    for(const character of new Set(item.text))assert.ok(fontData.glyphs[character],`missing glyph ${character} must not turn into a fallback`);
    const mesh=createCampusRooftopLettering(THREE,item),bounds=mesh.geometry.boundingBox;
    assert.ok(mesh.isMesh&&mesh.geometry.getAttribute('position').count<50000,'one bounded mesh per inscription');
    for(const value of mesh.geometry.getAttribute('position').array)assert.ok(Number.isFinite(value));
    assert.ok(mesh.userData.letterHeight>=item.height*.75,'the actual contours, rather than an empty plane, occupy the available height');
    assert.ok(mesh.userData.letterWidth<=item.width+.001&&mesh.userData.letterWidth>item.width*.7);
    assert.ok(Math.abs(bounds.min.y+item.y-(item.roofY+.02))<.001,'mount feet rest just above the existing roof');
    assert.ok(bounds.max.y+item.y<=item.y+item.height/2+.001);
    assert.ok(bounds.min.z>=-1.1&&bounds.max.z>=.34,'real extrusion and shallow roof mounts');
    assert.equal(mesh.material.map,null,'the solid sculptures add no image textures');
    assert.equal(mesh.material.depthWrite,true);
    mesh.geometry.dispose();mesh.material.dispose();
  }
});
