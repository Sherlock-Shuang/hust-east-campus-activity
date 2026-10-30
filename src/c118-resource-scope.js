/** Own partially initialized runtimes as soon as each factory returns. Failure
 * in one disposer must not strand the other renderer/media/subscription owners. */
export function createC118ResourceScope(){
  let disposed=false;const owned=[];
  function release(entry,errors){try{entry.value?.dispose?.();}catch(error){errors.push({kind:entry.kind,message:String(error?.message||error)});}}
  return {
    own(value,kind='resource'){
      if(!value)return value;
      if(disposed)release({value,kind},[]);else owned.push({value,kind});
      return value;
    },
    snapshot(){return {disposed,owners:owned.map(entry=>entry.kind)};},
    dispose(){if(disposed)return [];disposed=true;const errors=[];for(let i=owned.length-1;i>=0;i--)release(owned[i],errors);owned.length=0;return errors;},
  };
}
