/** Same-process read coalescing for public activity rows only. This is never an
 * authority for admission, administrator CAS, authentication or persistence.
 * A successful local write publishes its newer revision; a late old SELECT
 * cannot overwrite it. Other processes are observed after the short TTL. */
export function createPublicStateCache({ttlMs=500,now=()=>performance.now()}={}){
  let value=null,expiresAt=-Infinity,pending=null,generation=0;
  const lifetime=Math.max(0,Math.min(1000,Number.isFinite(ttlMs)?ttlMs:500));
  function publish(row){
    if(!row||!Number.isSafeInteger(row.revision)||row.revision<0)throw new Error('Invalid activity revision');
    if(value&&row.revision<value.revision)return value;
    value=Object.freeze({...row});expiresAt=now()+lifetime;generation++;
    return value;
  }
  return {
    publish,
    read(load){
      if(value&&now()<expiresAt)return Promise.resolve(value);
      if(pending)return pending;
      const requestedAt=generation;
      const request=Promise.resolve().then(load).then(row=>{
        // A committed write while this SELECT was in flight wins immediately.
        if(generation!==requestedAt&&value&&value.revision>=row.revision)return value;
        return publish(row);
      }).finally(()=>{if(pending===request)pending=null;});
      pending=request;return request;
    },
  };
}
