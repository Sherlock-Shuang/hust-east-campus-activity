import polygonClipping from 'polygon-clipping';
import {applyWorldUV} from './surface-materials.js';

export const CAMPUS_RIVER_TERRAIN=Object.freeze({sourceId:'way/944515200',waterLevel:-1.5,groundLevel:-.08,bankInset:1.6,
  evidence:'Photo-informed relative bank/water separation. No surveyed DEM, bathymetry, or water gauge.',
  sourceUrl:'https://www.thepaper.cn/newsDetail_forward_22920015'});
const open=ring=>{const a=ring.map(p=>[p.x,p.y]);if(a.length>1&&a[0][0]===a.at(-1)[0]&&a[0][1]===a.at(-1)[1])a.pop();return a;};
const asPolygons=shapes=>shapes.map(s=>[open(s.getPoints()),...s.holes.map(h=>open(h.getPoints()))]);
function toShapes(THREE,polygons){return polygons.filter(p=>p[0]?.length>=3).map(p=>{const shape=new THREE.Shape(p[0].map(v=>new THREE.Vector2(...v)));for(const h of p.slice(1))shape.holes.push(new THREE.Path(h.map(v=>new THREE.Vector2(...v))));return shape;});}
function area(polys){let sum=0;for(const poly of polys)for(let j=0;j<poly.length;j++){const r=poly[j];let a=0;for(let i=0,k=r.length-1;i<r.length;k=i++)a+=r[k][0]*r[i][1]-r[i][0]*r[k][1];sum+=Math.abs(a)/2*(j? -1:1);}return sum;}
const riverRecord=model=>model?.water?.find(r=>r.id===CAMPUS_RIVER_TERRAIN.sourceId&&r.mesh?.isMesh&&r.shapes?.length);

/** A source-shaped hole in a display plane. Caller owns the returned geometry.
 * Coordinates remain x=east,y=north; rotate mesh -PI/2 like the original datum. */
export function createGroundGeometry(THREE,{model,size=12000}={}){
  const r=riverRecord(model),half=size/2,base=[[[-half,-half],[half,-half],[half,half],[-half,half],[-half,-half]]];
  const polygons=r?polygonClipping.difference(base,asPolygons(r.shapes)):[base];
  return applyWorldUV(new THREE.ShapeGeometry(toShapes(THREE,polygons),1),1,'xy');
}

/** Reversible display-only river incision. Source shapes/GeoJSON, all original
 * geometries and all non-river water levels stay intact. Call before making
 * water-details so its shoreline contact meshes use the lowered level. */
export function applyRiverTerrain(THREE,{model,datum,surfaces}={}){
  const group=new THREE.Group();group.name='湖溪河 · 河槽与岸坡（相对高差估计）';
  group.userData={...CAMPUS_RIVER_TERRAIN,coordinateSystem:'LOCAL_ENU',units:'metres',measured:false,
    sourceFootprint:'Water mesh and source rings unchanged; upper ground cut by exact river polygon',
    bankTreatment:'Display slope extends up to 1.6 m inward over the source water mesh; not a newly surveyed shoreline'};
  const record=riverRecord(model),ownedGeometries=new Set(),ownedMaterials=new Set(),edits=[];
  const statistics={waterBodies:record?1:0,cutSurfaceIds:[],cutArea:0,bankTriangles:0};
  let enabled=false,disposed=false;
  const originalWaterY=record?.mesh.position.y,originalOutlineY=record?.outline?.position.y;
  if(record){
    const river=asPolygons(record.shapes);
    if(datum?.isMesh){const cut=createGroundGeometry(THREE,{model,size:datum.geometry.parameters?.width??12000});ownedGeometries.add(cut);edits.push({mesh:datum,original:datum.geometry,cut});}
    // Partially intersecting green/land polygons require a real difference;
    // adding an out-of-bounds Shape.hole would corrupt triangulation.
    for(const r of model.records||[]){
      if(!r.mesh?.isMesh||!r.shapes?.length||!['green','other','sports'].includes(r.category))continue;
      const polygon=asPolygons(r.shapes),overlap=polygonClipping.intersection(polygon,river),overlapArea=area(overlap);
      if(overlapArea<.0001)continue;
      const difference=polygonClipping.difference(polygon,river),cut=applyWorldUV(new THREE.ShapeGeometry(toShapes(THREE,difference),1),1,'xy');
      ownedGeometries.add(cut);edits.push({mesh:r.mesh,original:r.mesh.geometry,cut});statistics.cutSurfaceIds.push(r.id);statistics.cutArea+=overlapArea;
    }
    const own=m=>{ownedMaterials.add(m);return m;};
    const grass=own(surfaces?.grass?.clone()??new THREE.MeshStandardMaterial({color:'#778768',roughness:.97}));
    const stone=own(surfaces?.concrete?.clone()??new THREE.MeshStandardMaterial({color:'#858b7a',roughness:.94}));
    stone.color.set('#858b7a');stone.side=THREE.DoubleSide;
    const wet=own(new THREE.MeshStandardMaterial({color:'#4c5946',roughness:.95}));
    const positions=[[],[],[]],ground=CAMPUS_RIVER_TERRAIN.groundLevel,level=CAMPUS_RIVER_TERRAIN.waterLevel;
    function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
    function tri(out,a,b,c){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),cv=new THREE.Vector3(...c),n=bv.sub(av).cross(cv.sub(av));if(n.lengthSq()<1e-12)return;if(n.y<0)[b,c]=[c,b];out.push(...a,...b,...c);}
    const point=(p,y)=>[p[0],y,-p[1]];
    for(const poly of river)for(const ring of poly){
      let signed=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++)signed+=ring[j][0]*ring[i][1]-ring[i][0]*ring[j][1];const sign=Math.sign(signed)||1;
      const inset=ring.map((p,i)=>{
        const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length],dx1=p[0]-a[0],dy1=p[1]-a[1],dx2=b[0]-p[0],dy2=b[1]-p[1],l1=Math.hypot(dx1,dy1)||1,l2=Math.hypot(dx2,dy2)||1;
        let nx=sign*(-dy1/l1-dy2/l2),ny=sign*(dx1/l1+dx2/l2),nl=Math.hypot(nx,ny)||1;nx/=nl;ny/=nl;
        let distance=CAMPUS_RIVER_TERRAIN.bankInset,trial=[p[0]+nx*distance,p[1]+ny*distance];
        for(let k=0;k<6&&!inside(trial,ring);k++){distance*=.5;trial=[p[0]+nx*distance,p[1]+ny*distance];}
        return trial;
      });
      for(let i=0;i<ring.length;i++){
        const j=(i+1)%ring.length,a=ring[i],b=ring[j],u=inset[i],v=inset[j];if(Math.hypot(a[0]-b[0],a[1]-b[1])<.01)continue;
        // Upper planted slope, lower rough stone face and a damp waterline band.
        tri(positions[0],point(a,ground+.025),point(b,ground+.025),point(u,level+.48));
        tri(positions[0],point(b,ground+.025),point(v,level+.48),point(u,level+.48));
        tri(positions[1],point(u,level+.48),point(v,level+.48),point(u,level-.08));
        tri(positions[1],point(v,level+.48),point(v,level-.08),point(u,level-.08));
        const un=[u[0]+(u[0]-a[0])*.025,u[1]+(u[1]-a[1])*.025],vn=[v[0]+(v[0]-b[0])*.025,v[1]+(v[1]-b[1])*.025];
        tri(positions[2],point(u,level+.012),point(v,level+.012),point(un,level+.013));
        tri(positions[2],point(v,level+.012),point(vn,level+.013),point(un,level+.013));
      }
    }
    for(let i=0;i<3;i++)if(positions[i].length){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions[i],3));g.computeVertexNormals();applyWorldUV(g);ownedGeometries.add(g);
      const m=new THREE.Mesh(g,[grass,stone,wet][i]);m.name=['river-grass-slope','river-lower-stone-bank','river-wet-waterline'][i];m.receiveShadow=true;m.castShadow=true;m.renderOrder=203;m.userData={...group.userData};group.add(m);statistics.bankTriangles+=positions[i].length/9;
    }
  }
  function setEnabled(value){if(disposed)return false;enabled=!!value&&!!record;group.visible=enabled;for(const e of edits)e.mesh.geometry=enabled?e.cut:e.original;if(record){record.mesh.position.y=enabled?CAMPUS_RIVER_TERRAIN.waterLevel:originalWaterY;if(record.outline)record.outline.position.y=enabled?CAMPUS_RIVER_TERRAIN.waterLevel+(originalOutlineY-originalWaterY):originalOutlineY;}return enabled;}
  setEnabled(true);
  return{group,statistics,recordId:record?.id??null,get enabled(){return enabled;},setEnabled,
    dispose(){if(disposed)return;setEnabled(false);disposed=true;group.removeFromParent();ownedGeometries.forEach(g=>g.dispose());ownedMaterials.forEach(m=>m.dispose());group.clear();}};
}
