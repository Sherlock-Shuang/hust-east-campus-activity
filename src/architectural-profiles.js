/** A six-sided stone section with two small upper chamfers. Its outer bounds
 * exactly match a box, so visual refinements cannot steal walking clearance. */
export function createChamferedStone(THREE,width,height,depth,bevel=.022){
  const b=Math.min(bevel,height*.3,depth*.22),half=depth/2,top=height/2,bottom=-top;
  const section=[[-half,bottom],[half,bottom],[half,top-b],[half-b,top],[-half+b,top],[-half,top-b]];
  const vertices=[],normals=[],uvs=[];
  function triangle(a,b,c,n){for(const p of[a,b,c]){vertices.push(...p);normals.push(...n);uvs.push(p[0],p[2]);}}
  const left=section.map(([z,y])=>[-width/2,y,z]),right=section.map(([z,y])=>[width/2,y,z]);
  for(let i=0;i<section.length;i++){
    const j=(i+1)%section.length,dz=section[j][0]-section[i][0],dy=section[j][1]-section[i][1],length=Math.hypot(dz,dy),n=[0,-dz/length,dy/length];
    triangle(left[i],right[i],right[j],n);triangle(left[i],right[j],left[j],n);
  }
  for(let i=1;i<section.length-1;i++){triangle(left[0],left[i],left[i+1],[-1,0,0]);triangle(right[0],right[i+1],right[i],[1,0,0]);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.userData={profile:'upper-edge-chamfer',bevel:b,preservesBoxBounds:true};return geometry;
}

/** Narrow bevels along the vertical arrises catch daylight on tall piers,
 * without rounding away the photographed rectangular column profile. */
export function createChamferedColumn(THREE,width,height,depth,bevel=.018){
  const x=width/2,z=depth/2,b=Math.min(bevel,width*.2,depth*.2);
  const points=[[-x+b,-z],[x-b,-z],[x,-z+b],[x,z-b],[x-b,z],[-x+b,z],[-x,z-b],[-x,-z+b]];
  const shape=new THREE.Shape(points.map(([px,pz])=>new THREE.Vector2(px,-pz)));
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1,curveSegments:1});geometry.rotateX(-Math.PI/2);geometry.translate(0,-height/2,0);
  geometry.userData={profile:'vertical-arrises-chamfer',bevel:b,preservesBoxBounds:true};return geometry;
}
