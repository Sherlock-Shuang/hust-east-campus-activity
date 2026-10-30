/** Shared conservative X/Z broad phase for the static campus collision world.
 * It never decides a collision, floor or anchor: callers retain their exact
 * polygon/height checks. Results remain in source order for deterministic ties.
 * Replace the building array (normal world rebuild), or explicitly invalidate
 * it after editing footprints in place. No renderer/DOM dependencies.
 */
const cache = new WeakMap();
const EMPTY = Object.freeze([]);
const CELL = 32;
const MAX_CELLS_PER_BUILDING = 256;

function createIndex(source) {
  const records = source.filter(record => record?.rings?.[0]?.length >= 3).map(record => {
    let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
    for(const p of record.rings[0]){minX=Math.min(minX,p.x);minZ=Math.min(minZ,p.z);maxX=Math.max(maxX,p.x);maxZ=Math.max(maxZ,p.z);}
    return {...record,minX,minZ,maxX,maxZ};
  });
  const cells = new Map(), global = [], marks = new Uint32Array(records.length);
  let stamp=0;
  for(let i=0;i<records.length;i++){
    const b=records[i],x0=Math.floor(b.minX/CELL),x1=Math.floor(b.maxX/CELL),z0=Math.floor(b.minZ/CELL),z1=Math.floor(b.maxZ/CELL);
    if(![x0,x1,z0,z1].every(Number.isFinite)||(x1-x0+1)*(z1-z0+1)>MAX_CELLS_PER_BUILDING){global.push(i);continue;}
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
      const key=`${x}/${z}`;let bucket=cells.get(key);if(!bucket)cells.set(key,bucket=[]);bucket.push(i);
    }
  }
  function queryBounds(minX,minZ,maxX,maxZ,mapped=records){
    // Unexpected non-finite input must not erase collisions. Let the existing
    // narrow phase apply its prior semantics instead of entering an endless grid.
    if(![minX,minZ,maxX,maxZ].every(Number.isFinite))return mapped;
    if(minX>maxX)[minX,maxX]=[maxX,minX];if(minZ>maxZ)[minZ,maxZ]=[maxZ,minZ];
    const x0=Math.floor(minX/CELL),x1=Math.floor(maxX/CELL),z0=Math.floor(minZ/CELL),z1=Math.floor(maxZ/CELL);
    const touches=i=>{const b=records[i];return !(maxX<b.minX||minX>b.maxX||maxZ<b.minZ||minZ>b.maxZ);};
    // Rare long rays/campus-wide queries are cheaper as one bounds scan. This
    // also bounds work for teleports and malformedly large query distances.
    if((x1-x0+1)*(z1-z0+1)>Math.max(16,cells.size/2)){
      const out=[];for(let i=0;i<records.length;i++)if(touches(i))out.push(mapped[i]);return out;
    }
    if(x0===x1&&z0===z1&&!global.length){
      const bucket=cells.get(`${x0}/${z0}`);if(!bucket)return EMPTY;
      const out=[];for(const i of bucket)if(touches(i))out.push(mapped[i]);return out;
    }
    if(++stamp===0xffffffff){marks.fill(0);stamp=1;}
    const ids=[];
    const add=i=>{if(marks[i]!==stamp){marks[i]=stamp;if(touches(i))ids.push(i);}};
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)for(const i of cells.get(`${x}/${z}`)||EMPTY)add(i);
    for(const i of global)add(i);
    ids.sort((a,b)=>a-b);return ids.map(i=>mapped[i]);
  }
  const index={records,sourceLength:source.length,cellSize:CELL,cellCount:cells.size,
    invalidate:()=>{cache.delete(source);cache.delete(records);},
    queryBounds,
    queryPoint:(x,z,radius=0,mapped)=>queryBounds(x-radius,z-radius,x+radius,z+radius,mapped),
    querySegment:(a,b,radius=0,mapped)=>queryBounds(Math.min(a.x,b.x)-radius,Math.min(a.z,b.z)-radius,Math.max(a.x,b.x)+radius,Math.max(a.z,b.z)+radius,mapped),
  };
  cache.set(source,index);cache.set(records,index);return index;
}

/** Original and normalized arrays share one index across movement, camera,
 * and swinging. A distinct/rebuilt world gets a distinct weakly-held index. */
export function getBuildingSpatialIndex(records=EMPTY){
  const source=Array.isArray(records)?records:EMPTY,existing=cache.get(source);
  if(existing&&(source===existing.records||existing.sourceLength===source.length))return existing;
  return createIndex(source);
}

export function invalidateBuildingSpatialIndex(records){
  cache.get(records)?.invalidate();
}
