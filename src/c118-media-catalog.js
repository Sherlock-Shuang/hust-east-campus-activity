// Trusted C118 playlist. Live state carries an ID, never an arbitrary media URL.
export const C118_DEFAULT_MEDIA_ID='vibe-coding';
export const C118_MEDIA_CATALOG=Object.freeze([
  Object.freeze({
    id:'vibe-coding',title:'Vibe Coding 成果展示',
    src:'./media/c118-vibe-coding-720p-v1.mp4',
    poster:'./media/c118-vibe-coding-poster-v1.jpg',duration:112,
  }),
  Object.freeze({
    id:'club-promo',title:'AI 俱乐部宣传片',
    src:'./media/c118-club-promo-720p-v1.mp4',
    poster:'./media/c118-club-promo-poster-v1.jpg',duration:97.533333,
  }),
]);

export function getC118Media(id){return C118_MEDIA_CATALOG.find(item=>item.id===id)||null;}
