// Bounded, allocation-free hot-path samples. These are frame intervals and
// CPU timings, not GPU durations or a claim about physical GPU memory.
export function createFrameMetrics({capacity=1800}={}) {
  const size=Math.max(30,Math.min(18000,Math.floor(capacity)||1800));
  const intervals=new Float64Array(size),cpu=new Float64Array(size);
  let cursor=0,count=0,lastCalls=0,lastTriangles=0;
  return {
    sample({frameMs,cpuMs=0,drawCalls=0,triangles=0,active=true}={}) {
      if(!active||!Number.isFinite(frameMs)||frameMs<=0||frameMs>10000)return false;
      intervals[cursor]=frameMs;cpu[cursor]=Number.isFinite(cpuMs)?Math.max(0,cpuMs):0;
      cursor=(cursor+1)%size;count=Math.min(size,count+1);
      lastCalls=drawCalls;lastTriangles=triangles;return true;
    },
    reset(){cursor=count=lastCalls=lastTriangles=0;},
    snapshot(){
      const sorted=Array.from(intervals.subarray(0,count)).sort((a,b)=>a-b);
      let elapsed=0,cpuTotal=0,longFrames50=0,longFrames100=0;
      for(let i=0;i<count;i++){elapsed+=intervals[i];cpuTotal+=cpu[i];if(intervals[i]>50)longFrames50++;if(intervals[i]>100)longFrames100++;}
      const percentile=q=>count?sorted[Math.min(count-1,Math.ceil(count*q)-1)]:0;
      return {sampleCount:count,windowMs:elapsed,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),
        longFrames50,longFrames100,longFrames100PerMinute:elapsed?longFrames100*60000/elapsed:0,
        averageCpuMs:count?cpuTotal/count:0,averageFps:elapsed?count*1000/elapsed:0,drawCalls:lastCalls,triangles:lastTriangles};
    },
  };
}
