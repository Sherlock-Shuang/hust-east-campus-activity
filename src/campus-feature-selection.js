// Admit only the reviewed east-library amenity polygon; keep its source tags
// intact. Other POI areas are often parking lots, not missing buildings.
export function getReconstructionBuildings(model){
  const buildings=[...(model?.buildings||[])];
  if(!buildings.some(r=>r.id==='way/98867853')){
    const library=model?.records?.find(r=>r.id==='way/98867853'&&r.feature?.properties?.tags?.amenity==='library'&&r.shapes?.length);
    if(library)buildings.push({...library,category:'building',sourceCategory:library.category,
      footprintEvidence:'reviewed amenity=library polygon; building extent unverified',derivedBuilding:true});
  }
  return buildings;
}
