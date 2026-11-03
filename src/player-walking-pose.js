// Keep the authored foot contacts and cadence, but solve each knee between its
// hip and ankle. The generic commuter's independent sine curves stretched the
// calf by over 40% and let the knee bend backwards during a forward stride.
// A small, symmetric reach allowance accommodates those existing foot targets
// without moving the feet, bobbing the camera, or changing water/vehicle poses.
export function refineWalkingLegPose(pose,speed=0){
  const thigh=.415,calf=.435;
  const activity=Math.min(1,Math.max(0,speed)/.8);
  for(const side of ['L','R']){
    const hip=pose.points[`hip${side}`],ankle=pose.points[`ankle${side}`];
    const dy=ankle[1]-hip[1],dz=ankle[2]-hip[2],distance=Math.hypot(dy,dz);
    if(distance<1e-6)continue;
    // Stand with relaxed, almost straight knees. As actual speed settles, the
    // resting pose follows continuously instead of holding a crouched stride.
    const restingLength=distance+.003,activeLength=Math.max(thigh+calf,distance+.008);
    const reach=(restingLength+(activeLength-restingLength)*activity)/(thigh+calf);
    const upper=thigh*reach,lower=calf*reach;
    const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
    const bend=Math.sqrt(Math.max(0,upper*upper-along*along));
    // Forward is local -Z. Choose this same bend side throughout the stride,
    // including release to idle, instead of flipping at each sine zero.
    pose.points[`knee${side}`]=[hip[0],hip[1]+(dy*along-dz*bend)/distance,hip[2]+(dz*along+dy*bend)/distance];
  }
  return pose;
}

export function refineWalkingUpperBodyPose(pose,{speed=0,progress=0}={}){
  const activity=Math.min(1,Math.max(0,speed)/1.2),run=Math.min(1,Math.max(0,(speed-2.2)/1.6));
  // The shared commuter torso is sculpted leaning toward handlebars. Rotate
  // that authored shape back over the pelvis for walking, retaining only a
  // slight forward athletic lean at speed. The same offset realigns its fixed
  // pelvis mesh with the walking hip/foot anchors.
  pose.pitch=.27-.035*activity-.04*run;pose.bodyOffsetZ=-.11;
  pose.handRotation={};
  const c=Math.cos(pose.pitch),s=Math.sin(pose.pitch),phase=progress*5.2;
  for(const side of [-1,1]){
    const key=side<0?'L':'R';
    const shoulder=[side*.164,.87+.445*c+.122*s,.20+.445*s-.122*c+pose.bodyOffsetZ];
    const swing=Math.sin(phase)*side*(.32*activity+.18*run);
    const upperAngle=swing-.025,forearmAngle=upperAngle+.10+.14*activity+.42*run;
    const upperLength=Math.sqrt(.265**2-.045**2),lowerLength=Math.sqrt(.245**2-.014**2);
    const elbow=[side*.209,shoulder[1]-Math.cos(upperAngle)*upperLength,shoulder[2]-Math.sin(upperAngle)*upperLength];
    const hand=[side*.223,elbow[1]-Math.cos(forearmAngle)*lowerLength,elbow[2]-Math.sin(forearmAngle)*lowerLength];
    pose.points[`shoulder${key}`]=shoulder;pose.points[`elbow${key}`]=elbow;pose.points[`hand${key}`]=hand;
    // The shared hand mesh's long axis is horizontal. Align it with the
    // forearm so idle palms hang naturally instead of holding invisible grips.
    pose.handRotation[`hand${key}`]=Math.PI/2+forearmAngle;
  }
  return pose;
}
