// Explicit shared tour links only. The normal URL still starts at 韵苑食堂.
export function campusLandmarkArrival(campus,place){
  if(place==='opto'&&campus?.optoEntry)return {...campus.optoEntry,pitch:-.15};
  if(place==='opto-main'&&campus?.optoEntries?.length){
    const main=campus.optoEntries.find(entry=>entry.id==='opto-c118-main');
    if(main?.approach)return {...main.approach,pitch:-.08};
  }
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
