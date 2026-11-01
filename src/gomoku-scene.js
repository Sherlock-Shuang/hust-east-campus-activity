import {GOMOKU_POINT} from './gomoku-rules.js';
export function createGomokuScene(THREE){
  const group=new THREE.Group();group.name='东操场五子棋';group.position.set(GOMOKU_POINT.x,GOMOKU_POINT.y,GOMOKU_POINT.z);
  const geometries=new Set(),materials=new Set(),textures=new Set();
  const boxGeo=new THREE.BoxGeometry(1,1,1);geometries.add(boxGeo);
  const material=color=>{const m=new THREE.MeshStandardMaterial({color,roughness:.85});materials.add(m);return m;};
  const wood=material('#d7b27a'),edge=material('#614c30'),green=material('#204c40');
  function box(mat,x,y,z,w,h,d){const mesh=new THREE.Mesh(boxGeo,mat);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);group.add(mesh);return mesh;}
  for(const cx of [-3.7,3.7]){
    box(edge,cx,1.04,0,2.9,.2,2.9);box(wood,cx,1.16,0,2.7,.04,2.7);
    for(const dx of [-1.05,1.05])for(const dz of [-1.05,1.05])box(green,cx+dx,.5,dz,.18,1,.18);
    for(const side of [-1,1]){box(green,cx,.58,side*2.05,2.7,.16,.65);for(const dx of [-1,1])box(edge,cx+dx,.25,side*2.05,.16,.5,.5);}
    const points=[];for(let i=0;i<15;i++){const p=-1.2+i*2.4/14;points.push(cx-1.2,1.185,p,cx+1.2,1.185,p,cx+p,1.185,-1.2,cx+p,1.185,1.2);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometries.add(geometry);
    const lineMat=new THREE.LineBasicMaterial({color:'#614c30'});materials.add(lineMat);group.add(new THREE.LineSegments(geometry,lineMat));
  }
  box(green,0,1.8,-3,.15,3.6,.15);box(green,0,3.6,-3,4.8,1.45,.16);
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=320;const ctx=canvas.getContext('2d');
    if(ctx){ctx.fillStyle='#204c40';ctx.fillRect(0,0,1024,320);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fffaf0';ctx.font='600 116px "PingFang SC",sans-serif';ctx.fillText('操场五子棋',512,125);ctx.font='42px "PingFang SC",sans-serif';ctx.fillText('两人一局 · 走近加入',512,249);
      const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;textures.add(tex);const faceMat=new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide});materials.add(faceMat);
      const geo=new THREE.PlaneGeometry(4.65,1.4);geometries.add(geo);for(const sign of [-1,1]){const face=new THREE.Mesh(geo,faceMat);face.position.set(0,3.6,-3+sign*.09);face.rotation.y=sign===1?0:Math.PI;group.add(face);}}
  }
  group.updateMatrixWorld(true);
  return {group,dispose(){group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear();}};
}
