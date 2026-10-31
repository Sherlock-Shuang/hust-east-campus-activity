import {FontLoader} from 'three/addons/loaders/FontLoader.js';
import {TextGeometry} from 'three/addons/geometries/TextGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import fontData from './campus-lettering-font.js';

const font=new FontLoader().parse(fontData);

/** Real extruded letters with a roof-mounted rail, one mesh and one material.
 * The font subset contains only the two complete, case-sensitive inscriptions.
 * This is temporary activity artwork, independent of the source architecture.
 */
export function createCampusRooftopLettering(THREE,item){
  const letters=new TextGeometry(item.text,{font,size:1,depth:.12,curveSegments:3,
    bevelEnabled:true,bevelThickness:.012,bevelSize:.008,bevelSegments:1,steps:1});
  letters.computeBoundingBox();
  const bounds=letters.boundingBox,size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const scale=Math.min(item.width/size.x,item.height/size.y),width=size.x*scale,height=size.y*scale;
  letters.translate(-center.x,-center.y,-center.z);letters.scale(scale,scale,.7/size.z);
  const pieces=[letters],railY=-height/2-.18,footY=item.roofY-item.y+.08;
  function box(w,h,d,x,y,z){const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);pieces.push(g);}
  box(width+.8,.22,1,0,railY,-.45);
  for(const x of [-width*.36,0,width*.36]){
    const length=railY-footY;
    box(.16,length,.18,x,(railY+footY)/2,-.7);
    box(.65,.12,.65,x,footY,-.7);
  }
  const geometry=mergeGeometries(pieces,false);pieces.forEach(g=>g.dispose());
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const material=new THREE.MeshStandardMaterial({color:'#ead9b1',roughness:.58,metalness:.24,
    emissive:'#bca575',emissiveIntensity:.08,transparent:true,opacity:item.opacity,depthWrite:true});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.userData={component:'campus-rooftop-lettering',text:item.text,roofY:item.roofY,
    letterWidth:width,letterHeight:height,depth:.7,artwork:true};
  return mesh;
}
