// Wall-clock streaming acceptance. Does not authenticate or mutate activity state.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const REPORT=path.join(ROOT,'artifacts/performance-phase2/public-sse-rotation.json');
let url;try{url=new URL(process.argv[2]);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();}catch{console.error('Usage: node scripts/verify-vercel-public-sse.mjs https://verified-public-host');process.exit(2);}
const report={kind:'real-public-SSE-wall-clock-acceptance',origin:url.origin,startedAt:new Date().toISOString(),passed:false,expectedLifetimeMs:240000,segments:[],globalActivityMutations:false,modelRequests:0};
const ensure=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{safeMessage:message});};
async function stream({untilEnd}){
  const started=performance.now(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),untilEnd?280000:25000);
  let reader,progress,buffer='',snapshotCount=0,clockCount=0,firstRevision=null,lastRevision=null,lastFrameAt=null,maxFrameGapMs=0,initialSnapshotMs=null;
  const decoder=new TextDecoder();
  try{
    const response=await fetch(url.origin+'/api/live/events',{headers:{Origin:url.origin},redirect:'error',signal:controller.signal});
    ensure(response.status===200&&/text\/event-stream/i.test(response.headers.get('content-type')||''),'SSE endpoint did not return HTTP 200 streaming content');
    reader=response.body.getReader();
    if(untilEnd)progress=setInterval(()=>{
      const segment={elapsedMs:Math.round(performance.now()-started),snapshotCount,clockCount};report.segments.push(segment);console.log(JSON.stringify({phase:'streaming',...segment}));
    },30000);
    while(true){
      const chunk=await reader.read();if(chunk.done){ensure(untilEnd,'Reconnect ended before a snapshot');break;}
      buffer+=decoder.decode(chunk.value,{stream:true});ensure(buffer.length<262144,'Unbounded SSE frame');
      const frames=buffer.split('\n\n');buffer=frames.pop();
      for(const frame of frames){
        const event=frame.split('\n').find(s=>s.startsWith('event: '))?.slice(7),data=frame.split('\n').find(s=>s.startsWith('data: '))?.slice(6);
        if(!data)continue;const payload=JSON.parse(data),received=performance.now();
        if(lastFrameAt!=null)maxFrameGapMs=Math.max(maxFrameGapMs,received-lastFrameAt);lastFrameAt=received;
        if(event==='snapshot'){
          ensure(Number.isInteger(payload.state?.revision),'SSE snapshot revision was invalid');snapshotCount++;firstRevision??=payload.state.revision;lastRevision=payload.state.revision;initialSnapshotMs??=Math.round(received-started);
          if(!untilEnd)return {httpStatus:response.status,initialSnapshotMs,firstRevision,lastRevision,snapshotCount,clockCount};
        }else if(event==='clock'){ensure(Number.isFinite(payload.serverTime),'Heartbeat had no server time');clockCount++;}
      }
    }
    const elapsedMs=Math.round(performance.now()-started);
    ensure(snapshotCount>=1&&clockCount>=10,'Stream did not provide continuous snapshots and heartbeats');
    ensure(elapsedMs>=230000&&elapsedMs<=270000,'SSE did not rotate near the configured 240-second lifetime');
    return {httpStatus:response.status,elapsedMs,initialSnapshotMs,firstRevision,lastRevision,snapshotCount,clockCount,maxFrameGapMs:Math.round(maxFrameGapMs),endedNaturally:true};
  }finally{clearTimeout(timeout);clearInterval(progress);await reader?.cancel().catch(()=>{});controller.abort();}
}
try{
  report.first=await stream({untilEnd:true});console.log(JSON.stringify({phase:'rotated',...report.first}));
  report.reconnected=await stream({untilEnd:false});ensure(report.reconnected.firstRevision>=report.first.lastRevision,'Reconnected state regressed');
  report.passed=true;
}catch(error){report.error=error.safeMessage||'Network stream failed; response data withheld';process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await mkdir(path.dirname(REPORT),{recursive:true});await writeFile(REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({phase:'complete',passed:report.passed,report:REPORT,reconnected:report.reconnected}));}
