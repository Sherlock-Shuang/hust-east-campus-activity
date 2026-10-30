// Explicit shared tour links only. The normal URL still starts at 韵苑食堂.
export function campusLandmarkArrival(campus,place){
  if(['cbd','cbd-zhou','cbd-oxygen','canteen-shops'].includes(place)&&campus?.commercialStreetViewpoints?.[place])return {...campus.commercialStreetViewpoints[place]};
  if(place?.startsWith('poem-')){
    const fromApproach=place.endsWith('-approach'),id=fromApproach?place.slice(0,-9):place;
    const poem=campus?.aiMuralPlan?.find(item=>item.id===id&&item.poetryId);
    if(fromApproach)return poem?.approach?{...poem.approach}:null;
    if(poem?.inspection)return {...poem.inspection};
  }
  if(place==='opto-passage'&&campus?.optoViewpoints?.northPassage)return {...campus.optoViewpoints.northPassage};
  if(place==='opto-rear'&&campus?.optoViewpoints?.rearEntrance)return {...campus.optoViewpoints.rearEntrance};
  if(place==='opto-left'&&campus?.optoViewpoints?.leftCourtyard)return {...campus.optoViewpoints.leftCourtyard};
  if(place==='opto'&&campus?.optoEntry)return {...campus.optoEntry,pitch:-.15};
  if(place==='opto-main'&&campus?.optoEntry)return {...campus.optoEntry,pitch:-.08};
  if(place==='opto-east'&&campus?.optoEntries?.length){
    const east=campus.optoEntries.find(entry=>entry.url==='./c118.html?view=eastEntry');
    if(east?.approach)return {...east.approach,pitch:-.08};
  }
  const gate=campus?.gateViewpoints?.[place];
  if(gate&&['east-gate','yunyuan-gate'].includes(place))return {...gate.arrival};
  if(place==='opto-exterior'&&campus?.optoViewpoints?.exterior)return {...campus.optoViewpoints.exterior,y:.14};
  if(place==='yunyuan-south'&&campus?.yunyuanSouthViewpoints?.southCanteen)return {...campus.yunyuanSouthViewpoints.southCanteen,pitch:-.12};
  if(place==='xueer'&&campus?.yunyuanSouthViewpoints?.southCanteenNorth)return {...campus.yunyuanSouthViewpoints.southCanteenNorth,pitch:-.12};
  if(place==='einstein'&&campus?.einsteinSquarePlan?.accepted){
    if(campus.einsteinSquarePlan.arrival)return {...campus.einsteinSquarePlan.arrival};
    const statue=campus.einsteinSquarePlan.statue;
    return {x:statue.x+3,z:statue.z+18,y:.16,yaw:Math.atan2(3,18),pitch:-.12};
  }
  return null;
}
