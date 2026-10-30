// One scheduler per database adapter, not one polling/lease loop per viewer.
// It owns only ephemeral subscriptions. Database rows remain authoritative.
export function createSharedActivityStream({clock,readState,readCounts,renewLeases,onIdle,pollMs=1500,heartbeatMs=15000}){
  const clients=new Map();let timer=null,running=null,repeat=false,disposed=false;
  const active=client=>clients.get(client.id)===client;
  function idle(){
    if(clients.size||disposed)return;
    disposed=true;clock.clearTimeout(timer);timer=null;onIdle?.();
  }
  function remove(client){if(active(client)){clients.delete(client.id);idle();}}
  function fail(client,cause,phase){
    if(!active(client))return;
    remove(client);
    try{client.error(cause,phase);}catch{}
  }
  function send(client,name,payload){
    if(!active(client))return false;
    try{client.send(name,payload);return true;}
    catch(cause){fail(client,cause,name==='clock'?'lease':'snapshot');return false;}
  }
  function pump(){
    if(disposed||!clients.size)return Promise.resolve();
    if(running){repeat=true;return running;}
    clock.clearTimeout(timer);timer=null;
    const request=(async()=>{
      let phase='state-read';
      try{
        const row=await readState();
        if(disposed)return;
        const changed=[...clients.values()].filter(client=>row.revision>client.revision);
        if(changed.length){
          phase='snapshot';
          const counts=await readCounts();
          const payload={state:JSON.parse(row.payload),serverTime:clock.now(),...counts};
          for(const client of changed)if(send(client,'snapshot',payload))client.revision=row.revision;
        }
        const now=clock.now();
        // The INSERT has already granted a new stream its first 45 seconds.
        // Only established streams need SQL renewal; new streams still receive
        // an immediate clock after their initial snapshot.
        const due=[...clients.values()].filter(client=>client.revision>=0&&now-client.heartbeatAt>=heartbeatMs);
        // A slow initial database read can consume part of the initial lease;
        // renew that lease too rather than allowing a new clock to outlive it.
        const renewing=due.filter(client=>now-client.leaseAt>=heartbeatMs);
        phase='lease';
        if(renewing.length){await renewLeases(renewing.map(client=>client.id),now);for(const client of renewing)client.leaseAt=now;}
        for(const client of due)if(send(client,'clock',{serverTime:now}))client.heartbeatAt=now;
      }catch(cause){for(const client of [...clients.values()])fail(client,cause,phase);}
    })().finally(()=>{
      if(running===request)running=null;
      if(disposed||!clients.size)return;
      // A subscriber arriving during an awaited lease/count query must receive
      // its initial snapshot immediately after that query, not a poll later.
      if(repeat){repeat=false;void pump();}
      else timer=clock.setTimeout(pump,pollMs);
    });
    running=request;return request;
  }
  return {
    subscribe({id,send,error,leaseAt=clock.now()}){
      if(disposed)throw new Error('Activity stream scheduler is closed');
      if(clients.has(id))throw new Error('Duplicate activity subscription');
      const client={id,send,error,revision:-1,heartbeatAt:-Infinity,leaseAt};
      clients.set(id,client);void pump();
      return ()=>remove(client);
    },
  };
}
