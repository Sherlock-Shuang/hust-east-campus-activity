// Explicit shared tour links only. The normal URL still starts at 韵苑食堂.
export function campusLandmarkArrival(campus,place){
  if(place==='opto'&&campus?.optoEntry)return {...campus.optoEntry,pitch:-.15};
  if(place==='opto-exterior'&&campus?.optoViewpoints?.exterior)return {...campus.optoViewpoints.exterior,y:.14};
  if(place==='einstein'&&campus?.einsteinSquarePlan?.accepted){
    const statue=campus.einsteinSquarePlan.statue;
    return {x:statue.x+3,z:statue.z+18,y:.16,yaw:Math.atan2(3,18),pitch:-.12};
  }
  return null;
}
