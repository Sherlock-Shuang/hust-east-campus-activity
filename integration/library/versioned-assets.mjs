/** Immutable only when the full content hash is embedded in this exact URL. */
export function isVersionedWorkAsset(url,sha256){
 return /^[a-f0-9]{64}$/.test(sha256||'')&&/^\/works\/(?:library|wanyan)\/assets\//.test(url)&&url.includes('/assets/'+sha256+'/');
}
