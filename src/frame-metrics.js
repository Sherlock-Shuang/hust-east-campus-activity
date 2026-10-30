// Bounded, allocation-free hot-path samples. These are frame intervals and
// CPU timings, not GPU durations or a claim about physical GPU memory.
export function createFrameMetrics({capacity=1800,maxMinutes=120}={}) {
  const size=Math.max(30,Math.min(18000,Math.floor(capacity)||1800));
  const intervals=new Float64Array(size),cpu=new Float64Array(size);
  let cursor=0,count=0,lastCalls=0,lastTriangles=0;
  // Histogram has 1 ms bins through 250 ms and explicit slow-frame buckets.
  // Session totals never roll over with the short diagnostic sample window.
  const limits=[...Array.from({length:251},(_,i)=>i),500,1000,2000,10000];
  const makeBucket=()=>({hist:new Float64Array(limits.length),count:0,ms:0,cpu:0,long50:0,long100:0,maxMs:0});
  let total=makeBucket(),minute=makeBucket(),minuteIndex=0;
  const minutes=[],marks=[],minuteLimit=Math.max(1,Math.min(1440,Math.floor(maxMinutes)||120));
  function add(bucket,ms,cost){const bin=ms<=250?Math.ceil(ms):ms<=500?251:ms<=1000?252:ms<=2000?253:254;bucket.hist[bin]++;bucket.count++;bucket.ms+=ms;bucket.cpu+=cost;bucket.long50+=ms>50?1:0;bucket.long100+=ms>100?1:0;bucket.maxMs=Math.max(bucket.maxMs,ms);}
  function report(bucket){
    const percentile=q=>{if(!bucket.count)return 0;let n=0;for(let i=0;i<limits.length;i++){n+=bucket.hist[i];if(n>=Math.ceil(bucket.count*q))return limits[i];}return 10000;};
    return {sampleCount:bucket.count,activeMs:bucket.ms,p50UpperMs:percentile(.5),p95UpperMs:percentile(.95),p99UpperMs:percentile(.99),maxMs:bucket.maxMs,
      longFrames50:bucket.long50,longFrames100:bucket.long100,longFrames100PerMinute:bucket.ms?bucket.long100*60000/bucket.ms:0,
      averageCpuMs:bucket.count?bucket.cpu/bucket.count:0,averageFps:bucket.ms?bucket.count*1000/bucket.ms:0};
  }
  return {
    sample({frameMs,cpuMs=0,drawCalls=0,triangles=0,active=true}={}) {
      if(!active||!Number.isFinite(frameMs)||frameMs<=0||frameMs>10000)return false;
      intervals[cursor]=frameMs;cpu[cursor]=Number.isFinite(cpuMs)?Math.max(0,cpuMs):0;
      add(total,frameMs,cpu[cursor]);add(minute,frameMs,cpu[cursor]);
      if(minute.ms>=60000){minutes.push({index:minuteIndex++,...report(minute)});if(minutes.length>minuteLimit)minutes.shift();minute=makeBucket();}
      cursor=(cursor+1)%size;count=Math.min(size,count+1);
      lastCalls=drawCalls;lastTriangles=triangles;return true;
    },
    reset(){cursor=count=lastCalls=lastTriangles=0;},
    resetSession(){total=makeBucket();minute=makeBucket();minuteIndex=0;minutes.length=marks.length=0;},
    mark(type,detail){marks.push({activeMs:total.ms,type:String(type).slice(0,64),detail});if(marks.length>128)marks.shift();},
    session(){return {...report(total),quantiles:'Histogram upper bounds: 1 ms through 250 ms, then 500/1000/2000/10000 ms.',completedMinutes:minuteIndex,minutes:minutes.map(m=>({...m})),currentMinute:report(minute),marks:marks.map(m=>({...m}))};},
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
