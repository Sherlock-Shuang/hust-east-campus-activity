/** Gameplay model: metres, seconds and radians. Speeds/crowd timings are tunable,
 * not measurements of HUST students or traffic. No renderer or DOM dependency. */
export const TUNING = Object.freeze({
  clockScale: 1, walkSpeed: 1.65, runSpeed: 3.4, bikeSpeed: 5.4,
  bikeSprintSpeed: 7.1, scooterSpeed: 5.4, scooterFastSpeed: 6.2, scooterRadius: 0.57, rainSpeedFactor: 0.86, sprintDrain: 8,
  staminaRecovery: 11, playerRadius: 0.36, bikeRadius: 0.55,
  fixedStep: 1 / 60, classroomTime: 8 * 3600, arrivalRadius: 5,
});
const EPS = 1e-7;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export function seededRandom(seed = 943108) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** Strict overlap: a circle touching an AABB remains a valid position. */
export function circleIntersectsAABB(x, z, radius, box) {
  const dx = x - clamp(x, box.minX, box.maxX);
  const dz = z - clamp(z, box.minZ, box.maxZ);
  return dx * dx + dz * dz < radius * radius - EPS;
}
/** Exact circle/ellipse distance outside the lake (rather than an inflated ellipse). */
export function circleIntersectsEllipse(x, z, radius, ellipse) {
  if (!ellipse) return false;
  const px = Math.abs(x - ellipse.x), pz = Math.abs(z - ellipse.z);
  const a = ellipse.rx, b = ellipse.rz;
  if (px > a + radius || pz > b + radius) return false;
  if (px * px / (a * a) + pz * pz / (b * b) <= 1) return true;
  const aa = a * a, bb = b * b;
  const equation = t => aa * px * px / ((t + aa) ** 2) + bb * pz * pz / ((t + bb) ** 2);
  let lo = 0, hi = Math.max(a * px, b * pz, 1);
  while (equation(hi) > 1) hi *= 2;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (equation(mid) > 1) lo = mid; else hi = mid; }
  const t = (lo + hi) / 2;
  const qx = aa * px / (t + aa), qz = bb * pz / (t + bb);
  return Math.hypot(px - qx, pz - qz) < radius - EPS;
}
export function isWalkable(world, x, z, radius = TUNING.playerRadius) {
  const b = world.bounds;
  if (b && (x - radius < b.minX - EPS || x + radius > b.maxX + EPS || z - radius < b.minZ - EPS || z + radius > b.maxZ + EPS)) return false;
  if ((world.colliders || []).some(box => circleIntersectsAABB(x, z, radius, box))) return false;
  return !circleIntersectsEllipse(x, z, radius, world.lake);
}
/** Substepped circle motion prevents tunnelling; axis fallback slides along walls. */
export function moveCircle(world, position, dx, dz, radius = TUNING.playerRadius) {
  let x = position.x, z = position.z;
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.max(0.08, radius * 0.5)));
  const sx = dx / count, sz = dz / count;
  for (let i = 0; i < count; i++) {
    if (isWalkable(world, x + sx, z + sz, radius)) { x += sx; z += sz; }
    else {
      if (isWalkable(world, x + sx, z, radius)) x += sx;
      if (isWalkable(world, x, z + sz, radius)) z += sz;
    }
  }
  return { x, z };
}
function segmentClear(world, from, to, radius = TUNING.playerRadius) {
  const steps = Math.max(1, Math.ceil(distance(from, to) / 0.6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable(world, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t, radius)) return false;
  }
  return true;
}

/** A* on a weighted road graph; an unreachable destination returns an empty route. */
export function findPath(nodes, startId, goalId) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (!byId.has(startId) || !byId.has(goalId)) return [];
  const open = new Set([startId]), cameFrom = new Map(), g = new Map([[startId, 0]]);
  const goal = byId.get(goalId);
  const f = new Map([[startId, distance(byId.get(startId), goal)]]);
  while (open.size) {
    let current; let best = Infinity;
    for (const id of open) if ((f.get(id) ?? Infinity) < best) { current = id; best = f.get(id); }
    if (current === goalId) {
      const ids = [current];
      while (cameFrom.has(current)) { current = cameFrom.get(current); ids.unshift(current); }
      return ids.map(id => { const n = byId.get(id); return { id, x: n.x, z: n.z }; });
    }
    open.delete(current);
    const node = byId.get(current);
    for (const neighborId of node.links || []) {
      const neighbor = byId.get(neighborId);
      if (!neighbor) continue;
      const next = g.get(current) + distance(node, neighbor);
      if (next < (g.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, current); g.set(neighborId, next);
        f.set(neighborId, next + distance(neighbor, goal)); open.add(neighborId);
      }
    }
  }
  return [];
}
export function planRoute(world, from, to = world.goal, radius = TUNING.playerRadius) {
  const nodes = world.pathNodes || [];
  if (!nodes.length) return segmentClear(world, from, to, radius) ? [{ x: to.x, z: to.z }] : [];
  const nearest = point => [...nodes].sort((a, b) => distance(point, a) - distance(point, b)).find(n => segmentClear(world, point, n, radius));
  const start = nearest(from), goal = nearest(to);
  if (!start || !goal) return [];
  // Edges are checked against collision geometry so bad graph links cannot lead through buildings.
  const traversableNodes = nodes.map(n => ({ ...n, links: (n.links || []).filter(id => {
    const other = nodes.find(candidate => candidate.id === id);
    return other && segmentClear(world, n, other, radius);
  }) }));
  const route = findPath(traversableNodes, start.id, goal.id);
  if (!route.length) return [];
  if (distance(route[route.length - 1], to) > 0.05) route.push({ x: to.x, z: to.z });
  // If the player is already partway along the first road edge, join it ahead
  // instead of walking back to the nearest node behind them.
  if (route.length > 1) {
    const a = route[0], b = route[1], dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? ((from.x - a.x) * dx + (from.z - a.z) * dz) / lengthSquared : 0;
    const perpendicularDistance = distance(from, { x: a.x + dx * t, z: a.z + dz * t });
    if (t > 0 && t <= 1 && perpendicularDistance < 5 && segmentClear(world, from, b, radius)) route.shift();
  }
  while (route.length > 1 && distance(from, route[0]) < 0.5) route.shift();
  return route;
}
function routeDistance(position, route) {
  if (!route.length) return 0;
  let total = distance(position, route[0]);
  for (let i = 1; i < route.length; i++) total += distance(route[i - 1], route[i]);
  return total;
}

// Estimated morning demand profile, not a measured count or a campus traffic survey.
export const DEMAND_PROFILE = Object.freeze([[450,.08],[455,.16],[460,.30],[465,.55],[470,.82],[475,1],[480,.75],[485,.32],[495,.06]]);
export function morningProfile(seconds) {
  const minute = seconds / 60;
  if (minute <= DEMAND_PROFILE[0][0]) return DEMAND_PROFILE[0][1];
  for (let i = 1; i < DEMAND_PROFILE.length; i++) {
    const [end, b] = DEMAND_PROFILE[i], [start, a] = DEMAND_PROFILE[i - 1];
    if (minute <= end) return a + (b - a) * (minute - start) / (end - start);
  }
  return .04;
}
export function estimatedInflow(seconds, population = 280, flowScale = 1) {
  return 1.4 * population / 280 * flowScale * morningProfile(seconds);
}
export function followingAcceleration(speed, desiredSpeed, gap = Infinity, leaderSpeed = speed, kind = 'scooter') {
  const a = kind === 'walk' ? 1.1 : 1.55, b = kind === 'walk' ? 2 : 3.5;
  const standstill = kind === 'walk' ? .2 : .45, headway = kind === 'walk' ? .5 : .65;
  const wanted = standstill + Math.max(0, speed * headway + speed * (speed - leaderSpeed) / (2 * Math.sqrt(a * b)));
  return clamp(a * (1 - (speed / Math.max(.1, desiredSpeed)) ** 4 - (Number.isFinite(gap) ? (wanted / Math.max(.05, gap)) ** 2 : 0)), -b, a);
}
function makePolyline(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances.at(-1) + distance(points[i - 1], points[i]));
  return { points, distances, length: distances.at(-1) || 0 };
}
function samplePolyline(path, progress, offset = 0) {
  const s = clamp(progress, 0, path.length);
  let i = 1;
  while (i < path.distances.length - 1 && path.distances[i] < s) i++;
  const a = path.points[i - 1] || path.points[0], b = path.points[i] || a;
  const length = distance(a, b) || 1, dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
  const t = clamp((s - (path.distances[i - 1] || 0)) / length, 0, 1);
  // Smooth the lane normal near turns, preventing a sideways teleport at a vertex.
  let nx = -dz, nz = dx;
  const blendDistance = Math.min(7, length * .3);
  if (i < path.points.length - 1 && length * (1 - t) < blendDistance) {
    const c = path.points[i + 1], nextLength = distance(b, c) || 1;
    const weight = .5 * (1 - length * (1 - t) / blendDistance);
    nx = nx * (1 - weight) - (c.z - b.z) / nextLength * weight;
    nz = nz * (1 - weight) + (c.x - b.x) / nextLength * weight;
  } else if (i > 1 && length * t < blendDistance) {
    const before = path.points[i - 2], previousLength = distance(before, a) || 1;
    const weight = .5 * (1 - length * t / blendDistance);
    nx = nx * (1 - weight) - (a.z - before.z) / previousLength * weight;
    nz = nz * (1 - weight) + (a.x - before.x) / previousLength * weight;
  }
  const normalLength = Math.hypot(nx, nz) || 1;
  return { x: a.x + (b.x - a.x) * t + nx / normalLength * offset,
    z: a.z + (b.z - a.z) * t + nz / normalLength * offset, dx, dz, index: i };
}
function projectPolyline(path, point) {
  let best = { distance: Infinity, progress: 0 };
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i], dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz), t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length || 1), 0, 1);
    const d = distance(point, { x: a.x + dx * t, z: a.z + dz * t });
    if (d < best.distance) best = { distance: d, progress: path.distances[i - 1] + t * length };
  }
  return best;
}

export function createSimulation(world, options = {}) {
  let random, routeTimer = 0, exhausted = false, crowdAccumulator = 0, spawnAccumulator = 0;
  let trafficGrid = new Map(), gates = [], arrivalHistory = [];
  const state = {}, CELL = 5;
  const palette = [0xe7c789,0x71909c,0xb56856,0x6d7c69,0xb9b0a0,0x485369,0x85805a];
  const maxAgents = clamp(options.maxAgents ?? 600, 0, 600);
  const defaults = { population: clamp(options.population ?? options.npcCount ?? 280, 0, maxAgents), flowScale: 1, scooterShare: .82 };
  const startTimes = { early: 7*3600+35*60, normal: 7*3600+45*60, rush: 7*3600+55*60, explore: 7*3600+55*60, ...options.startTimes };
  const clockScale = options.clockScale ?? TUNING.clockScale;
  const primaryPoints = [{ x: world.spawn.x, z: world.spawn.z }, ...planRoute(world, world.spawn)];
  const deduplicated = primaryPoints.filter((p, i, all) => !i || distance(p, all[i - 1]) > .01);
  if (deduplicated.length < 2) deduplicated.push({ ...world.goal });
  const inboundPath = makePolyline(deduplicated), outboundPath = makePolyline([...deduplicated].reverse());
  const sourcePaths=(world.commuteSources||[{node:world.pathNodes?.[0]?.id,weight:1}]).map(source=>{
    const node=world.pathNodes?.find(n=>n.id===source.node)||world.spawn;
    const route=planRoute(world,node);
    const points=[{x:node.x,z:node.z},...route].filter((p,i,all)=>!i||distance(p,all[i-1])>.01);
    return {...source,path:points.length>1?makePolyline(points):inboundPath};
  });
  function chooseSource(){let choice=random()*sourcePaths.reduce((sum,s)=>sum+s.weight,0);for(const source of sourcePaths){choice-=source.weight;if(choice<=0)return source;}return sourcePaths[0];}
  const keyOf = (x,z) => `${Math.floor(x/CELL)},${Math.floor(z/CELL)}`;
  function rebuildGrid() {
    trafficGrid = new Map();
    for (const n of state.npcs) if (n.phase !== 'arrived') {
      const key = keyOf(n.x,n.z); if (!trafficGrid.has(key)) trafficGrid.set(key,[]); trafficGrid.get(key).push(n);
    }
  }
  function neighbors(x,z,radius=3) {
    const result=[], gx=Math.floor(x/CELL),gz=Math.floor(z/CELL), span=Math.max(1,Math.ceil(radius/CELL));
    for(let ix=-span;ix<=span;ix++)for(let iz=-span;iz<=span;iz++)result.push(...(trafficGrid.get(`${gx+ix},${gz+iz}`)||[]));
    return result;
  }
  function updateGridPosition(n, oldKey) {
    const newKey=keyOf(n.x,n.z); if(newKey===oldKey)return;
    const old=trafficGrid.get(oldKey);if(old){const i=old.indexOf(n);if(i>=0)old.splice(i,1);}
    if(!trafficGrid.has(newKey))trafficGrid.set(newKey,[]);trafficGrid.get(newKey).push(n);
  }
  function hasCrowdOverlap(x,z,radius,ignore=null) {
    for(const other of neighbors(x,z,radius+1.5)) {
      if(other===ignore||other.phase==='arrived')continue;
      if(Math.hypot(x-other.x,z-other.z)<radius+other.radius+.035-EPS)return true;
    }
    return false;
  }
  function lanePosition(n, progress) {
    // Two inbound scooter lanes and a pavement stream merge into the entrance.
    const remaining=n.path.length-progress;
    const taper=n.direction===1?clamp((remaining-1.5)/25,.08,1):1;
    let offset=n.laneOffset*taper;
    let p=samplePolyline(n.path,progress,offset);
    // Local architectural geometry takes precedence over the nominal lane offset.
    for(let i=0;i<6&&!isWalkable(world,p.x,p.z,n.radius);i++){offset*=.55;p=samplePolyline(n.path,progress,offset);}
    return p;
  }
  function initGates() {
    gates=(world.bottlenecks||[]).map((b,i)=>({id:b.id||`junction-${i}`,name:b.name||'汇流口',...b,
      progress:projectPolyline(inboundPath,b).progress,capacity:Math.max(.2,b.capacity||1.8),nextRelease:0}));
    // Finite doorway/parking-to-walking service, with no invented traffic signal.
    if(!gates.some(g=>Math.abs(g.progress-inboundPath.length)<12)) {
      const p=samplePolyline(inboundPath,Math.max(0,inboundPath.length-5));
      gates.push({id:'entrance',name:'教学楼入口',x:p.x,z:p.z,radius:12,progress:Math.max(0,inboundPath.length-5),capacity:1.4,nextRelease:0});
    }
  }
  function createNPC(id, initial=false) {
    const direction=random()<.08?-1:1,source=chooseSource(),path=direction===1?source.path:outboundPath;
    const kind=random()<state.traffic.scooterShare?'scooter':'walk';
    const lane=kind==='walk'?2:(random()<.5?0:1);
    const n={id,x:0,z:0,yaw:0,speed:0,phase:kind==='walk'?'walking':'riding',kind,originalKind:kind,
      color:palette[Math.floor(random()*palette.length)],stride:random()*Math.PI*2,
      radius:kind==='scooter'?.57:.3,desiredSpeed:kind==='scooter'?4+random()*2:1.1+random()*.55,
      route:path.points,path,source:direction===1?source.node:'opposing',routeIndex:1,direction,lane,laneOffset:[.85,2.35,4.05][lane],
      progress:0,passedGates:{},gateProgress:{},queueTime:0,blocked:false,wait:0};
    for(const g of gates){const projected=projectPolyline(path,g);n.gateProgress[g.id]=projected.progress;if(projected.distance>(g.radius||15))n.passedGates[g.id]=true;}
    for(let attempt=0;attempt<80;attempt++) {
      n.progress=initial?2+random()*Math.max(1,path.length-10):random()*2;
      const p=lanePosition(n,n.progress);n.x=p.x;n.z=p.z;n.yaw=Math.atan2(-p.dx,-p.dz);n.routeIndex=p.index;
      const playerRadius=state.transport==='scooter'?TUNING.scooterRadius:TUNING.playerRadius;
      if(isWalkable(world,n.x,n.z,n.radius)&&!hasCrowdOverlap(n.x,n.z,n.radius)&&distance(n,state.player)>n.radius+playerRadius+.15) {
        n.speed=initial?n.desiredSpeed*(.5+random()*.35):0;
        for(const g of gates){if(n.progress>n.gateProgress[g.id])n.passedGates[g.id]=true;}
        return n;
      }
    }
    return null;
  }
  function addNPC(initial=false) {
    let index=state.npcs.findIndex(n=>n.phase==='arrived');
    if(index<0){if(state.npcs.length>=maxAgents)return false;index=state.npcs.length;}
    const n=createNPC(index,initial);if(!n)return false;
    state.npcs[index]=n;const key=keyOf(n.x,n.z);if(!trafficGrid.has(key))trafficGrid.set(key,[]);trafficGrid.get(key).push(n);return true;
  }
  function updateStats() {
    const active=state.npcs.filter(n=>n.phase!=='arrived');
    const trafficTime=state.elapsed*(state.mode==='explore'?1:clockScale);
    arrivalHistory=arrivalHistory.filter(t=>trafficTime-t<=60);
    const bottleneckStats=gates.map(g=>{const near=active.filter(n=>distance(n,g)<(g.radius||16));return {
      id:g.id,name:g.name,active:near.length,queued:near.filter(n=>n.speed<.65).length,
      meanSpeed:near.length?near.reduce((sum,n)=>sum+n.speed,0)/near.length:0,capacity:g.capacity,
    };});
    const queued=active.filter(n=>n.speed<.65&&n.progress>3).length;
    state.stats={activeCount:active.length,walkingCount:active.filter(n=>n.kind==='walk').length,
      scooterCount:active.filter(n=>n.kind==='scooter').length,queuedCount:queued,
      meanSpeed:active.length?active.reduce((sum,n)=>sum+n.speed,0)/active.length:0,
      congestion:active.length?queued/active.length:0,throughputPerMinute:arrivalHistory.length,
      inflowPerMinute:estimatedInflow(state.clock,state.traffic.population,state.traffic.flowScale)*60,
      demandFactor:morningProfile(state.clock),targetActiveCount:state.traffic.population,
      arrivedTotal:state.arrivedTotal,bottlenecks:bottleneckStats,
      sources:Object.fromEntries(sourcePaths.map(source=>[source.node,active.filter(n=>n.source===source.node).length])),
      estimated:true};
    state.crowdNearby=neighbors(state.player.x,state.player.z,10).filter(n=>distance(n,state.player)<10&&n.phase!=='arrived').length;
  }
  function populate() {
    state.npcs=[];trafficGrid=new Map();initGates();
    const desired=Math.round(state.traffic.population*morningProfile(state.clock));
    for(let i=0;i<desired;i++)if(!addNPC(true))break;
    updateStats();
  }
  function reset() {
    random=seededRandom(options.seed??943108);routeTimer=0;exhausted=false;crowdAccumulator=0;spawnAccumulator=0;arrivalHistory=[];
    Object.assign(state,{status:'intro',mode:'normal',player:{...world.spawn,stamina:100,speed:0},npcs:[],
      clock:startTimes.normal,elapsed:0,distance:0,transport:options.defaultTransport||'scooter',weather:'sunny',auto:false,
      route:[],goalDistance:distance(world.spawn,world.goal),remainingDistance:0,
      message:'从韵苑出发，随通勤车流前往东九。B 下车，WASD 移动。',event:null,
      lateSeconds:0,lateness:0,onTime:false,arrivalTime:null,crowdNearby:0,queueDelay:0,trafficWait:0,
      arrivedTotal:0,traffic:{...defaults},stats:{}});
    state.route=planRoute(world,state.player);state.remainingDistance=routeDistance(state.player,state.route);populate();return state;
  }
  function start(mode='normal') {
    const weather=state.weather,transport=state.transport,traffic={...state.traffic};
    reset();state.weather=weather;state.transport=transport;state.traffic=traffic;
    state.mode=Object.hasOwn(startTimes,mode)?mode:'normal';state.clock=startTimes[state.mode];state.status='playing';
    random=seededRandom(options.seed??943108);populate();
    state.message=state.mode==='explore'?'自由漫游：以 07:55 高峰流量持续模拟，时钟冻结。':'沿韵苑—喻园大道前往东九；前车制动时请留出间距。';return state;
  }
  function preview(mode='normal') { start(mode); state.status='intro'; return state; }
  function setTraffic(settings={}) {
    if(Number.isFinite(settings.population))state.traffic.population=Math.round(clamp(settings.population,0,maxAgents));
    if(Number.isFinite(settings.flowScale))state.traffic.flowScale=clamp(settings.flowScale,.1,3);
    if(Number.isFinite(settings.scooterShare))state.traffic.scooterShare=clamp(settings.scooterShare,0,1);
    // Sliders affect incoming demand; existing road users complete their trips.
    if(state.status==='intro'){random=seededRandom(options.seed??943108);populate();}else updateStats();
    return state.traffic;
  }
  function setPaused(paused=true){if(paused&&state.status==='playing'){state.status='paused';state.player.speed=0;}else if(!paused&&state.status==='paused')state.status='playing';return state.status;}
  function setWeather(weather){if(!['sunny','rain'].includes(weather))return false;state.weather=weather;state.message=weather==='rain'?'雨天减速，电动车制动和跟车更保守。':'天气转晴，保持跟车距离。';return true;}
  function setTransport(transport){if(transport==='bike')transport='scooter';if(!['walk','scooter'].includes(transport))return false;
    if(transport==='scooter'&&(!isWalkable(world,state.player.x,state.player.z,TUNING.scooterRadius)||hasCrowdOverlap(state.player.x,state.player.z,TUNING.scooterRadius))){state.message='周围太挤，请到开阔处再上车。';return false;}
    state.transport=transport;state.message=transport==='scooter'?'骑上电动车。跟随车流，到入口按 B 下车。':'已下车，可步行进入教学楼。';return true;}
  function toggleAuto(){state.auto=!state.auto;if(state.auto){state.route=planRoute(world,state.player,world.goal,state.transport==='scooter'?TUNING.scooterRadius:TUNING.playerRadius);if(!state.route.length){state.auto=false;state.message='请先回到可通行道路。';}else state.message='自动沿路前往东九；拥堵时会排队，WASD 可接管。';}else state.message='已切换手动移动。';return state.auto;}
  function interact(){if(state.status!=='playing')return false;if(distance(state.player,world.goal)>=TUNING.arrivalRadius){state.message='请先到教学楼入口。';return false;}if(state.transport!=='walk'){state.message='先按 B 停车下车，再按 E 进入教室。';return false;}
    state.status='arrived';state.auto=false;state.player.speed=0;state.arrivalTime=state.clock;state.lateSeconds=state.mode==='explore'?0:Math.max(0,state.clock-TUNING.classroomTime);state.lateness=state.lateSeconds;state.onTime=state.lateSeconds===0;
    state.message=state.mode==='explore'?'到达东九。':state.onTime?'赶上了，准备上课。':'已经开课，轻轻推门进入。';state.event={type:'arrival',time:state.clock,lateSeconds:state.lateSeconds};return true;}
  function updateCrowd(dt) {
    rebuildGrid();
    const active=state.npcs.filter(n=>n.phase!=='arrived');
    // Front-to-back integration means a follower sees its leader's newly occupied position.
    // Remaining distance is comparable after different residence branches merge.
    const ordered=active.sort((a,b)=>(a.path.length-a.progress)-(b.path.length-b.progress));
    for(const n of ordered){
      const oldKey=keyOf(n.x,n.z),oldSpeed=n.speed;
      if(n.direction===1&&n.path.length-n.progress<20&&n.kind==='scooter'){n.kind='walk';n.radius=.3;n.desiredSpeed=1.4;}
      let gap=Infinity,leadSpeed=n.speed;
      let desired=n.desiredSpeed*(state.weather==='rain'?.80:1);
      const here=samplePolyline(n.path,n.progress),px=state.player.x-n.x,pz=state.player.z-n.z;
      for(const other of neighbors(n.x,n.z,13)){
        if(other===n||other.phase==='arrived')continue;
        const ox=other.x-n.x,oz=other.z-n.z,ahead=ox*here.dx+oz*here.dz,lateral=Math.abs(ox*here.dz-oz*here.dx);
        if(ahead>0&&ahead<13&&lateral<n.radius+other.radius+.12){const candidate=ahead-n.radius-other.radius;if(candidate<gap){gap=candidate;leadSpeed=other.speed;}}
      }
      const ahead=px*here.dx+pz*here.dz,lateral=Math.abs(px*here.dz-pz*here.dx);
      const playerRadius=state.transport==='scooter'?TUNING.scooterRadius:TUNING.playerRadius;
      if(ahead>0&&lateral<n.radius+playerRadius+.2&&ahead-n.radius-playerRadius<gap){gap=ahead-n.radius-playerRadius;leadSpeed=state.player.speed;}
      const approaching=[];
      for(const g of gates){if(n.passedGates[g.id])continue;const s=n.gateProgress[g.id];const remaining=s-n.progress;
        if(remaining<-.1){n.passedGates[g.id]=true;continue;}
        if(remaining<25){approaching.push({g,s});if(state.elapsed<g.nextRelease&&remaining-.45<gap){gap=remaining-.45;leadSpeed=0;}}
      }
      n.speed=clamp(n.speed+followingAcceleration(n.speed,desired,gap,leadSpeed,n.kind)*dt,0,desired);
      let progress=Math.min(n.path.length,n.progress+n.speed*dt);
      if(Number.isFinite(gap))progress=Math.min(progress,n.progress+Math.max(0,gap-.12));
      for(const {g,s} of approaching)if(progress>=s&&!n.passedGates[g.id]){
        if(state.elapsed+EPS<g.nextRelease)progress=Math.min(progress,Math.max(n.progress,s-.06));
      }
      progress=Math.max(n.progress,progress);
      let next=lanePosition(n,progress);
      const overlapsPlayer=distance(next,state.player)<n.radius+playerRadius+.035;
      if(!isWalkable(world,next.x,next.z,n.radius)||hasCrowdOverlap(next.x,next.z,n.radius,n)||overlapsPlayer){progress=n.progress;next={x:n.x,z:n.z};n.speed=0;n.blocked=true;}else n.blocked=false;
      const moved=distance(n,next);n.speed=Math.min(n.speed,moved/dt);n.progress=progress;
      for(const {g,s} of approaching)if(n.progress>=s&&!n.passedGates[g.id]){g.nextRelease=state.elapsed+1/g.capacity;n.passedGates[g.id]=true;}
      if(n.speed<.65&&n.progress>3)n.queueTime+=dt;
      if(moved>.001)n.yaw+=angleDelta(n.yaw,Math.atan2(-(next.x-n.x),-(next.z-n.z)))*Math.min(1,dt*9);
      n.x=next.x;n.z=next.z;n.stride+=n.speed*dt*4.5;n.routeIndex=samplePolyline(n.path,n.progress).index;
      n.phase=n.kind==='scooter'?'riding':n.speed<.15?'waiting':'walking';
      updateGridPosition(n,oldKey);
      if(n.path.length-n.progress<.6){n.phase='arrived';n.speed=0;state.arrivedTotal++;arrivalHistory.push(state.elapsed*(state.mode==='explore'?1:clockScale));}
    }
    let count=state.npcs.filter(n=>n.phase!=='arrived').length;
    spawnAccumulator+=estimatedInflow(state.clock,state.traffic.population,state.traffic.flowScale)*dt*(state.mode==='explore'?1:clockScale);
    while(spawnAccumulator>=1&&count<state.traffic.population&&count<maxAgents){if(!addNPC(false))break;spawnAccumulator--;count++;}
    spawnAccumulator=Math.min(spawnAccumulator,5);updateStats();
  }
  function step(dt,input){
    state.elapsed+=dt;if(state.mode!=='explore')state.clock+=dt*clockScale;
    const p=state.player;let forward=clamp(Number(input.forward)||0,-1,1),right=clamp(Number(input.right)||0,-1,1);
    if((forward||right)&&state.auto){state.auto=false;state.message='已接管移动。';}if(Number.isFinite(input.yaw)&&!state.auto)p.yaw=input.yaw;
    let dx=0,dz=0;while(state.route.length>1&&distance(p,state.route[0])<.65)state.route.shift();
    if(state.auto){if(distance(p,world.goal)<1.8){state.auto=false;state.message=state.transport==='scooter'?'已到入口，B 下车后按 E 进入。':'已到入口，按 E 进入。';}else if(state.route.length){const target=state.route[0],len=distance(p,target);dx=(target.x-p.x)/Math.max(len,.01);dz=(target.z-p.z)/Math.max(len,.01);p.yaw+=angleDelta(p.yaw,Math.atan2(-dx,-dz))*Math.min(1,dt*8);}}
    else{const len=Math.hypot(forward,right);if(len>0){forward/=Math.max(1,len);right/=Math.max(1,len);dx=-Math.sin(p.yaw)*forward+Math.cos(p.yaw)*right;dz=-Math.cos(p.yaw)*forward-Math.sin(p.yaw)*right;}}
    const moving=Math.hypot(dx,dz)>.01;if(p.stamina<=0)exhausted=true;if(p.stamina>20||!input.sprint)exhausted=false;
    const sprint=!!input.sprint&&moving&&!exhausted&&p.stamina>0;
    let targetSpeed=state.transport==='scooter'?(sprint?TUNING.scooterFastSpeed:TUNING.scooterSpeed):(sprint?TUNING.runSpeed:TUNING.walkSpeed);
    if(state.weather==='rain')targetSpeed*=TUNING.rainSpeedFactor;
    let blockedByCrowd=false;
    if(moving)for(const n of neighbors(p.x,p.z,12)){if(n.phase==='arrived')continue;const ox=n.x-p.x,oz=n.z-p.z,ahead=ox*dx+oz*dz,lateral=Math.abs(ox*dz-oz*dx),radius=state.transport==='scooter'?TUNING.scooterRadius:TUNING.playerRadius;
      if(ahead>0&&ahead<12&&lateral<radius+n.radius+.1){const gap=ahead-radius-n.radius-.12;const safe=Math.max(0,(gap-.3)/.8);if(safe<targetSpeed){targetSpeed=safe;blockedByCrowd=true;}}
    }
    // Scooters accelerate and brake; pedestrians respond directly to walking input.
    const current=p.speed;let speed=state.transport==='scooter'?Math.max(0,current+clamp((moving?targetSpeed:0)-current,-(state.weather==='rain'?2.6:3.8)*dt,1.8*dt)):(moving?targetSpeed:0);
    if(!moving&&state.transport==='scooter'){dx=-Math.sin(p.yaw);dz=-Math.cos(p.yaw);}
    const radius=state.transport==='scooter'?TUNING.scooterRadius:TUNING.playerRadius;
    let next=moveCircle(world,p,dx*speed*dt,dz*speed*dt,radius);
    if(hasCrowdOverlap(next.x,next.z,radius)){next={x:p.x,z:p.z};blockedByCrowd=true;speed=0;}
    const moved=distance(p,next);p.x=next.x;p.z=next.z;p.speed=moved/dt;state.distance+=moved;
    if(moving&&blockedByCrowd&&p.speed<.6){state.queueDelay+=dt*(state.mode==='explore'?1:clockScale);state.trafficWait=state.queueDelay;}
    // Electric acceleration does not consume the rider's running stamina.
    p.stamina=clamp(p.stamina+(sprint&&state.transport==='walk'&&moved>.001?-TUNING.sprintDrain:TUNING.staminaRecovery*(moving?.48:1))*dt,0,100);
    state.goalDistance=distance(p,world.goal);routeTimer+=dt;if(!state.auto&&routeTimer>=1.5){routeTimer=0;state.route=planRoute(world,p);}
    state.remainingDistance=state.goalDistance<1.8?state.goalDistance:routeDistance(p,state.route);
    crowdAccumulator+=dt;while(crowdAccumulator>=.05-EPS){updateCrowd(.05);crowdAccumulator-=.05;}
  }
  function update(dt,input={}){if(state.status!=='playing'||!Number.isFinite(dt)||dt<=0)return state;let remaining=dt;while(remaining>EPS){const h=Math.min(TUNING.fixedStep,remaining);step(h,input);remaining-=h;}return state;}
  reset();return{state,start,preview,reset,update,setPaused,resume:()=>setPaused(false),setWeather,setTransport,setTraffic,toggleAuto,interact};
}
