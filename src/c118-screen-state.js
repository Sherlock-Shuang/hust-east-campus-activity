// Only trusted bundled media can be selected by the host. No client URL input.
export const C118_SCREEN_MEDIA_IDS=Object.freeze(['vibe-coding','club-promo']);
export function createDefaultC118Screen(){return {mediaId:'vibe-coding',revision:0};}
export function normalizeC118Screen(value){
  if(value==null)return createDefaultC118Screen();
  if(typeof value!=='object'||Array.isArray(value)||!C118_SCREEN_MEDIA_IDS.includes(value.mediaId))throw new Error('C118影片无效');
  if(!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error('C118播放版本无效');
  return {mediaId:value.mediaId,revision:value.revision};
}
/** Full-state saves do not restart playback. Only a one-step command does.
 * Must run under the same global revision guard/CAS as the activity write.
 * Returns the field; missing legacy writes preserve the current programme.
 */
export function reconcileC118Screen(previousState,nextState){
  const previous=normalizeC118Screen(previousState.c118Screen);
  if(!Object.hasOwn(nextState,'c118Screen'))return previous;
  const requested=normalizeC118Screen(nextState.c118Screen);
  if(requested.revision===previous.revision&&requested.mediaId===previous.mediaId)return previous;
  if(previous.revision===Number.MAX_SAFE_INTEGER||requested.revision!==previous.revision+1)throw new Error('C118播放列表已更新，请刷新后重试');
  return {mediaId:requested.mediaId,revision:previous.revision+1};
}
