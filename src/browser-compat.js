// Small API gaps in embedded mobile browsers must not abort scene startup.
// Keep the built-ins non-enumerable and install only missing implementations.
export function installBrowserCompatibility({ArrayType=Array,ObjectType=Object}={}){
  if(typeof ArrayType.prototype.at!=='function')Object.defineProperty(ArrayType.prototype,'at',{configurable:true,writable:true,value:function(index){
    if(this==null)throw new TypeError('Array.at requires an array-like receiver');
    const length=Math.min(Math.max(Math.trunc(Number(this.length))||0,0),Number.MAX_SAFE_INTEGER);
    const n=Math.trunc(Number(index))||0,at=n<0?length+n:n;
    return at<0||at>=length?undefined:this[at];
  }});
  if(typeof ObjectType.hasOwn!=='function')Object.defineProperty(ObjectType,'hasOwn',{configurable:true,writable:true,value:(object,key)=>{
    if(object==null)throw new TypeError('Object.hasOwn requires an object');
    return Object.prototype.hasOwnProperty.call(object,key);
  }});
}

export function createClientId(crypto=globalThis.crypto){
  if(typeof crypto?.randomUUID==='function')return crypto.randomUUID();
  // randomUUID is newer than getRandomValues, which is available in older
  // HTTPS WebViews. These IDs identify deliveries; authentication uses cookies.
  if(typeof crypto?.getRandomValues!=='function')throw new Error('当前浏览器无法建立活动连接，请在系统浏览器中打开此 HTTPS 链接');
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
