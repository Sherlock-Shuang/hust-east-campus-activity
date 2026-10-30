/** Conservative immutable bounds for planning-time exclusions. Querying a disc
 * returns the same source-ordered candidates; callers retain exact polygon or
 * segment-distance tests. Large footprints occupy every crossed grid cell. */
export function createPlanExclusionIndex(items,boundsAt,{cellSize=32}={}){
  const cells=new Map(),marks=new Uint32Array(items.length);let epoch=0;
  items.forEach((item,index)=>{const b=boundsAt(item);for(let x=Math.floor(b.minX/cellSize);x<=Math.floor(b.maxX/cellSize);x++)for(let z=Math.floor(b.minZ/cellSize);z<=Math.floor(b.maxZ/cellSize);z++){const key=`${x}/${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(index);}});
  return{query(x,z,radius=0,out=[]){
    out.length=0;epoch=(epoch+1)>>>0;if(!epoch){marks.fill(0);epoch=1;}
    for(let ix=Math.floor((x-radius)/cellSize);ix<=Math.floor((x+radius)/cellSize);ix++)for(let iz=Math.floor((z-radius)/cellSize);iz<=Math.floor((z+radius)/cellSize);iz++)for(const index of cells.get(`${ix}/${iz}`)||[])marks[index]=epoch;
    for(let i=0;i<items.length;i++)if(marks[i]===epoch)out.push(items[i]);return out;
  }};
}
