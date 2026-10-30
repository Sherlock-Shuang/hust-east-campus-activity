/** Static sphere clusters. Bounds include each full sphere (not only its
 * centre), so a branch crossing a cell/frustum edge cannot disappear. Exact
 * per-instance tests and stable source order remain the caller's job. */
export function createStaticFrustumIndex(THREE,items,getSphere,{cellSize=96}={}){
  const cells=new Map(),sphere=new THREE.Sphere(),scratch=new THREE.Box3();
  items.forEach((item,index)=>{
    getSphere(item,sphere);const key=`${Math.floor(sphere.center.x/cellSize)}/${Math.floor(sphere.center.z/cellSize)}`;
    let cell=cells.get(key);if(!cell)cells.set(key,cell={bounds:new THREE.Box3(),indices:[]});
    sphere.getBoundingBox(scratch);cell.bounds.union(scratch);cell.indices.push(index);
  });
  const marks=new Uint32Array(items.length);let epoch=0;
  const stats={cells:cells.size,candidates:items.length,testedCells:0};
  return{stats,query(frustum,out=[]){
    out.length=0;stats.testedCells=0;
    if(!frustum){for(let i=0;i<items.length;i++)out.push(i);}
    else{
      epoch=(epoch+1)>>>0;if(!epoch){marks.fill(0);epoch=1;}
      for(const cell of cells.values()){stats.testedCells++;if(frustum.intersectsBox(cell.bounds))for(const index of cell.indices)marks[index]=epoch;}
      // Linear integer scan keeps stable source order without sorting thousands
      // of candidates at each camera motion. No sphere/distance work here.
      for(let i=0;i<marks.length;i++)if(marks[i]===epoch)out.push(i);
    }
    stats.candidates=out.length;return out;
  }};
}
