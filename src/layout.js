// Metre-scale reconstruction: verified East9 identity and official navigation topology.
// 23栋→东九: official 929 m, segments 17/40/148/160/509/50/5 m.
// GPS endpoints anchor the displacement. Intermediate turns and footprints are approximated.
const arcX = z => -9 + 0.0042*z*z;
const wings=[-75,-25,25,75].map((z,i)=>({x:i===0||i===3?-22:-43,z,w:i===0||i===3?134:94,d:16,label:`东九 ${'ABCD'[i]} 区`}));
const surroundings=[
 {x:707,z:-278,w:54,d:17,label:'韵苑 23 栋',kind:'dorm',floors:6},
 {x:637,z:-287,w:58,d:17,label:'韵苑公寓',kind:'dorm',floors:6},
 {x:706,z:-345,w:56,d:17,label:'韵苑公寓',kind:'dorm',floors:6},
 {x:634,z:-354,w:58,d:17,label:'韵苑公寓',kind:'dorm',floors:6},
 {x:623,z:-179,w:66,d:17,label:'韵苑公寓',kind:'dorm',floors:6},
 {x:704,z:-170,w:58,d:17,label:'韵苑公寓',kind:'dorm',floors:6},
 {x:494,z:-163,w:59,d:65,label:'韵苑学生食堂',kind:'canteen',floors:3},
];
const pts=[
 ['start',705,-250],['exit',688.126,-252.067],['laneEast',707.694,-217.18],
 ['dormWest',560.791,-235.172],['canteenMerge',541.34,-76.358],
 ['aTurn',36.116,-138.237],['aDoor',30.037,-88.608],['entrance',35,-88],
];
const pathNodes=pts.map(([id,x,z],i)=>({id,x,z,links:[i?pts[i-1][0]:null,i<pts.length-1?pts[i+1][0]:null].filter(Boolean)}));
// Other residence exits feed the same commute; their footprints are not surveyed.
pathNodes.push({id:'dormNorth',x:570,z:-315,links:['dormWest']},{id:'dormEast',x:662,z:-215,links:['laneEast']},{id:'eastStream',x:735,z:-53,links:['canteenMerge']});
pathNodes.find(n=>n.id==='dormWest').links.push('dormNorth');pathNodes.find(n=>n.id==='laneEast').links.push('dormEast');pathNodes.find(n=>n.id==='canteenMerge').links.push('eastStream');
const roads=[];
function road(a,b,width,label){const dx=b.x-a.x,dz=b.z-a.z;roads.push({x:(a.x+b.x)/2,z:(a.z+b.z)/2,w:width,d:Math.hypot(dx,dz),rot:Math.atan2(dx,dz),a:{x:a.x,z:a.z},b:{x:b.x,z:b.z},label});}
road(pathNodes[2],pathNodes[3],12,'韵苑内部横路');road(pathNodes[8],pathNodes[4],14,'韵苑西侧道路');road(pathNodes[4],pathNodes[5],14,'喻园大道');road(pathNodes[4],pathNodes[10],14,'喻园大道东段');road(pathNodes[5],pathNodes[6],10,'东九 A 区入口');
// Short folded residence exit is paving, with no invented car street.
const arcColliders=[];for(let z=-68;z<=68;z+=10.5)for(const offset of[1.2,-5])arcColliders.push({minX:arcX(z)+offset-.7,maxX:arcX(z)+offset+.7,minZ:z-.7,maxZ:z+.7});
const buildings=[...wings,...surroundings];
export const WORLD={
 bounds:{minX:-160,maxX:850,minZ:-420,maxZ:210},
 spawn:{x:705,z:-250,yaw:1.449},goal:{x:35,z:-88,name:'东九 A101'},entrance:{x:35,z:-88},
 buildings,surroundings,colliders:[...buildings.map(b=>({minX:b.x-b.w/2,maxX:b.x+b.w/2,minZ:b.z-b.d/2,maxZ:b.z+b.d/2})),...arcColliders],
 roads,pathNodes,
 commuteSources:[{node:'start',weight:.54},{node:'dormNorth',weight:.20},{node:'dormEast',weight:.18},{node:'eastStream',weight:.08}],
 bottlenecks:[{x:541.34,z:-76.358,radius:16,capacity:1.8,name:'食堂口汇流'},{x:36.116,z:-138.237,radius:12,capacity:1.6,name:'东九北侧左转'},{x:30.037,z:-88.608,radius:8,capacity:1.3,name:'A 区入口'}],
 landmarks:[{x:707,z:-278,label:'韵苑 23 栋'},{x:652,z:-340,label:'韵苑公寓'},{x:494,z:-163,label:'韵苑学生食堂'},{x:300,z:-106,label:'喻园大道'},{x:75,z:0,label:'东九湖'},{x:35,z:-88,label:'A 区 · 早八教室'},{x:-126,z:-4,label:'西侧高架'}],
 lake:{x:75,z:0,rx:28,rz:42},
 overview:{position:[205,125,230],target:[5,4,35]},
 commuteOverview:{position:[665,420,270],target:[350,0,-125]},
 classroom:{position:[400,1.65,6],target:[400,1.65,-6],spawn:{x:400,z:6,yaw:0},bounds:{minX:393,maxX:407,minZ:-10,maxZ:9},board:{x:400,z:-9},exit:{x:406,z:7}},
 referenceRouteLength:929,arcX,
};
