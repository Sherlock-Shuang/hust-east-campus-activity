import {mkdirSync,writeFileSync} from 'node:fs';
import {createCampusRouteFixture,replayCampusSegment,ROUTE_FRAME_PROFILES} from '../tests/helpers/campus-route-replay.mjs';
const directory=new URL('../artifacts/optimization-2026-10-30/',import.meta.url),fixture=createCampusRouteFixture();
try{
  const results=fixture.cases.flatMap(segment=>ROUTE_FRAME_PROFILES.map(profile=>replayCampusSegment(fixture,segment,profile)));
  const report={scope:'Complete collider world, segmented walking route replay. No straight-line travel between districts, rendered-browser traversal, multiplayer, FPS or human input claims.',physicsHz:120,inputProfiles:ROUTE_FRAME_PROFILES.map(p=>p.id),longFrameSeconds:[.1,.25],node:process.version,buildings:fixture.world.buildings.length,segments:fixture.cases.length,total:results.length,passed:results.filter(r=>r.passed).length,results};
  mkdirSync(directory,{recursive:true});writeFileSync(new URL('spatial-route-regression.json',directory),JSON.stringify(report,null,2)+'\n');
  const rows=fixture.cases.map(segment=>{const runs=results.filter(r=>r.segment===segment.id);return `| ${segment.id} | ${runs.filter(r=>r.passed).length}/${runs.length} | ${segment.length.toFixed(1)} | ${Math.min(...runs.map(r=>r.minY)).toFixed(3)}–${Math.max(...runs.map(r=>r.maxY)).toFixed(3)} | ${[...new Set(runs.filter(r=>!r.passed).map(r=>r.failure))].join('; ')||'通过'} |`;});
  const markdown=`# 校园分段路线回归\n\n${report.passed}/${report.total} 项通过。完整当前建筑、桥面、栏杆、门廊碰撞世界；固定 120 Hz 物理，以 20/30/60 Hz 取样步行输入，另分别混入 100 ms、250 ms 长帧。\n\n这是按源道路和已有入口路径逐段回放；每段独立出生，不声称各区域之间任意直线可走。未运行三维绘制、NPC 车流、真实浏览器或多人玩家。C118 路径验内门触发和安全返回，不把进入事件当成室内加载成功。\n\n| 路段 | 通过 | 路长 m | 脚底高度 m | 结果 |\n|---|---:|---:|---|---|\n${rows.join('\n')}\n\n输入控制为低速确定性方向跟随，在既有路径转角松开控制；不修改游戏行走速度、120 Hz 物理或锚点规则。每帧高度变化受帧长影响，JSON 同时记录最大帧上升、阻挡帧数、终点坐标与门标识。\n`;
  writeFileSync(new URL('spatial-route-regression.md',directory),markdown);console.log(markdown);
  if(report.passed!==report.total)process.exitCode=1;
}finally{fixture.dispose();}
