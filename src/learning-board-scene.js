import { LEARNING_BOARD } from './activity-catalog.js';

/** A physical, two-sided campus noticeboard. Interaction is owned by the live
 * experience; this module owns only its geometry, materials and one texture. */
export function createLearningBoardScene(THREE) {
  const group=new THREE.Group();
  group.name='东操场 · 留言板';
  group.position.set(LEARNING_BOARD.x,LEARNING_BOARD.y,LEARNING_BOARD.z);
  group.rotation.y=LEARNING_BOARD.yaw;
  group.userData={component:'learning-board',boardId:LEARNING_BOARD.id,
    label:LEARNING_BOARD.label,title:'给我们留言',instruction:'走近留言 · 主持人会看到',
    artwork:true,sourceFieldId:'way/1023821172',groundContactY:LEARNING_BOARD.y,
    dimensions:{width:LEARNING_BOARD.width,height:LEARNING_BOARD.height,depth:.86}};

  const geometries=new Set(),materials=new Set(),textures=new Set();
  const ownGeometry=geometry=>{geometries.add(geometry);return geometry;};
  const material=(color,roughness=.86,metalness=0)=>{
    const result=new THREE.MeshStandardMaterial({color,roughness,metalness});materials.add(result);return result;
  };
  const pine=material('#31584c'),wood=material('#aa8054'),woodEdge=material('#c3a379'),
    paper=material('#f2eee1'),metal=material('#3f514b',.52,.3),concrete=material('#a5aaa1'),brass=material('#b5a279',.45,.45);
  const unit=ownGeometry(new THREE.BoxGeometry(1,1,1));
  function mesh(name,geometry,mat,parent=group){
    const object=new THREE.Mesh(geometry,mat);object.name=name;
    object.castShadow=true;object.receiveShadow=true;object.renderOrder=207;
    object.userData={component:name,boardId:LEARNING_BOARD.id};parent.add(object);return object;
  }
  function box(name,mat,x,y,z,w,h,d){
    const object=mesh(name,unit,mat);object.position.set(x,y,z);object.scale.set(w,h,d);return object;
  }

  // Compact feet and two solid posts visibly meet the playing surface. Their
  // positions are decorative, not source GIS features or collision barriers.
  for(const side of[-1,1]){
    box('learning-board-foot',concrete,side*2.24,.07,0,.46,.14,.86);
    box('learning-board-post-shoe',metal,side*2.24,.22,0,.24,.30,.28);
    box('learning-board-timber-post',wood,side*2.24,1.91,0,.19,3.54,.22);
    box('learning-board-post-cap',pine,side*2.24,3.72,0,.25,.10,.28);
  }
  box('learning-board-lower-tie',metal,0,.59,0,4.55,.07,.10);
  box('learning-board-solid-back',pine,0,2.18,0,5.18,2.48,.20);
  box('learning-board-top-frame',wood,0,3.47,0,5.32,.13,.29);
  box('learning-board-bottom-frame',wood,0,.89,0,5.32,.13,.29);
  for(const side of[-1,1])box('learning-board-side-frame',wood,side*2.595,2.18,0,.13,2.48,.29);

  // The shallow overhang and ledges make the board read as outdoor furniture.
  box('learning-board-canopy',pine,0,3.74,0,5.4,.12,.64);
  box('learning-board-canopy-edge',woodEdge,0,3.665,.30,5.4,.045,.045);
  box('learning-board-canopy-edge',woodEdge,0,3.665,-.30,5.4,.045,.045);
  for(const side of[-1,1])box('learning-board-pencil-ledge',pine,0,.96,side*.19,5.02,.06,.20);

  // Render Chinese lettering once, then reuse it on the two outward faces.
  // The board remains a valid solid scene object in Node/export test contexts.
  if(typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=760;
    const ctx=canvas.getContext('2d');
    if(ctx){
      ctx.fillStyle='#f2eee1';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='#31584c';ctx.fillRect(0,0,canvas.width,12);
      const font=(size,weight=600)=>`${weight} ${size}px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
      ctx.textBaseline='middle';ctx.textAlign='left';ctx.font=font(34,500);ctx.fillStyle='#637368';
      ctx.fillText('东操场 · AI 俱乐部',90,76);
      ctx.textAlign='right';ctx.fillText('操场留言板',1510,76);
      ctx.textAlign='center';ctx.fillStyle='#244f41';ctx.font=font(151,800);
      ctx.fillText('给我们留言',800,238);
      ctx.font=font(54,600);ctx.fillStyle='#536b60';ctx.fillText('走近留言 · 主持人会看到',800,376);
      ctx.fillStyle='#d8d7c7';ctx.fillRect(90,443,1420,2);
      const cards=[{x:110,color:'#e5d9b8',title:'活动建议'},
        {x:585,color:'#dbe2d5',title:'遇到的问题'},
        {x:1060,color:'#e7d4c8',title:'你的想法'}];
      for(const card of cards){
        ctx.fillStyle='#d9d7c9';ctx.fillRect(card.x+4,495,430,167);
        ctx.fillStyle=card.color;ctx.fillRect(card.x,490,430,167);
        ctx.fillStyle='#a58b61';ctx.beginPath();ctx.arc(card.x+215,504,7,0,Math.PI*2);ctx.fill();
        ctx.font=font(42,600);ctx.fillStyle='#435b4d';ctx.fillText(card.title,card.x+215,558);
        ctx.fillStyle='rgba(67,91,77,.18)';ctx.fillRect(card.x+57,609,316,2);ctx.fillRect(card.x+57,631,236,2);
      }
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
      textures.add(texture);paper.map=texture;paper.color.set('#ffffff');paper.needsUpdate=true;
    }
  }
  const face=ownGeometry(new THREE.PlaneGeometry(5.02,2.38));
  for(const side of[-1,1]){
    const panel=mesh('learning-board-readable-face',face,paper);
    panel.position.set(0,2.18,side*.121);panel.rotation.y=side===1?0:Math.PI;panel.castShadow=false;
  }
  const screw=ownGeometry(new THREE.SphereGeometry(.027,8,6));
  for(const side of[-1,1])for(const x of[-2.595,2.595])for(const y of[1.07,3.28]){
    const bolt=mesh('learning-board-frame-bolt',screw,brass);bolt.position.set(x,y,side*.148);bolt.scale.z=.45;
  }
  let disposed=false;
  return {group,dispose(){
    if(disposed)return;disposed=true;group.removeFromParent();
    for(const geometry of geometries)geometry.dispose();
    for(const mat of materials)mat.dispose();
    for(const texture of textures)texture.dispose();
  }};
}
