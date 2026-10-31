// User-authored copy. Preserve spelling, wording, punctuation and case; line
// breaks below only compose each small artwork for its particular surface.
export const CAMPUS_POETRY=Object.freeze([
  {id:'life-ai',text:'给AI以生命，而不是给生命以AI',lines:['给AI以生命，','而不是给生命以AI'],motif:'breath'},
  {id:'life-art',text:'生活源于艺术而高于艺术',lines:['生活源于艺术','而高于艺术'],motif:'horizon'},
  {id:'responsibility',text:'能力越大，责任越大',lines:['能力越大，责任越大'],motif:'thread'},
  {id:'chocolate',text:"life is always like a box of chocolate, you'll never know what you are gonna get",lines:['life is always','like a box','of chocolate,',"you'll never",'know what you','are gonna get'],motif:'chocolate',latin:true},
  {id:'birds',text:'some birds are never meant to be caged, their feathers are just too bright',lines:['some birds are never meant to be caged,','their feathers are just too bright'],motif:'feather',latin:true},
  {id:'possibility',text:'你能做的，岂止如此！',lines:['你能做的，','岂止如此！'],motif:'open'},
  {id:'heroes',text:'侠骨柔情的英雄气概\n重心然诺的君子风度\n快意恩仇的人生境界\n照亮了我们平庸而琐碎的生活',lines:['侠骨柔情的英雄气概','重心然诺的君子风度','快意恩仇的人生境界','照亮了我们平庸而琐碎的生活'],motif:'mountains'},
  {id:'breeze',text:'他强任他强，清风拂山岗，\n他横由他横，明月照大江。',lines:['他强任他强，','清风拂山岗，','他横由他横，','明月照大江。'],motif:'river',vertical:true},
  {id:'day',text:'seize the day',lines:['seize the day'],motif:'day',latin:true},
  {id:'stay',text:'STAY',lines:['STAY'],motif:'orbit',latin:true},
].map(p=>Object.freeze({...p,lines:Object.freeze(p.lines)})));

const song='"Songti SC", "Noto Serif CJK SC", "SimSun", serif';
const kai='"STKaiti", "KaiTi", "Songti SC", serif';

function motif(ctx,w,h,kind,ink){
  ctx.save();ctx.scale(w,h);ctx.strokeStyle=ink;ctx.fillStyle=ink;ctx.globalAlpha=.36;ctx.lineWidth=.0022;ctx.lineCap='round';ctx.lineJoin='round';
  const line=points=>{ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();};
  if(kind==='breath'){
    ctx.beginPath();ctx.moveTo(.32,.82);ctx.bezierCurveTo(.38,.74,.36,.94,.47,.84);ctx.bezierCurveTo(.57,.74,.55,.88,.68,.82);ctx.stroke();
  }else if(kind==='horizon'){
    ctx.beginPath();ctx.moveTo(.27,.82);ctx.bezierCurveTo(.40,.74,.47,.88,.68,.80);ctx.stroke();line([[.36,.87],[.73,.87]]);
  }else if(kind==='thread'){
    line([[.30,.81],[.50,.91],[.72,.78]]);line([[.39,.82],[.50,.91],[.61,.82]]);line([[.50,.78],[.50,.91]]);
  }else if(kind==='chocolate'){
    for(let r=0;r<2;r++)for(let c=0;c<3;c++)if(r||c!==2)ctx.strokeRect(.415+c*.055,.81+r*.045,.037,.031);
  }else if(kind==='feather'){
    ctx.beginPath();ctx.moveTo(.33,.91);ctx.bezierCurveTo(.44,.78,.56,.89,.68,.78);ctx.stroke();
    for(let i=0;i<6;i++){const x=.40+i*.04,y=.87-i*.009;line([[x-.018,y-.032],[x,y],[x+.036,y+.012]]);}
  }else if(kind==='open'){
    ctx.beginPath();ctx.arc(.5,.83,.075,.22,Math.PI*1.75);ctx.stroke();ctx.beginPath();ctx.arc(.59,.80,.008,0,Math.PI*2);ctx.fill();
  }else if(kind==='mountains'){
    line([[.25,.88],[.39,.81],[.48,.86],[.58,.78],[.75,.88]]);line([[.35,.90],[.59,.85],[.72,.89]]);
  }else if(kind==='river'){
    ctx.beginPath();ctx.moveTo(.18,.90);ctx.bezierCurveTo(.39,.85,.48,.96,.82,.88);ctx.stroke();
    ctx.beginPath();ctx.moveTo(.24,.94);ctx.bezierCurveTo(.43,.89,.64,.97,.79,.93);ctx.stroke();
    ctx.beginPath();ctx.arc(.80,.15,.035,0,Math.PI*2);ctx.stroke();
  }else if(kind==='day'){
    line([[.35,.76],[.65,.76]]);ctx.beginPath();ctx.arc(.5,.76,.073,Math.PI,Math.PI*2);ctx.stroke();
  }else if(kind==='orbit'){
    ctx.beginPath();ctx.ellipse(.5,.78,.14,.025,-.2,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(.5,.78,.045,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
}

export function paintCampusMural(ctx,canvas,item){
  const w=canvas.width,h=canvas.height,poem=item.poetryId;
  const prominent=poem&&poem!=='life-ai'&&poem!=='life-art';
  const shallow=poem&&item.lines.length===1&&item.height/item.width<.35;
  ctx.clearRect(0,0,w,h);ctx.fillStyle=item.color;ctx.textBaseline='middle';ctx.textAlign='center';
  function drawText(value,x,y,size){
    // A thin paint outline keeps the two foyer pieces legible across the
    // existing light stone panels and dark decorative bands.
    if(poem==='heroes'||poem==='breeze'){
      ctx.strokeStyle='#e4e2d3';ctx.lineWidth=size*.06;ctx.lineJoin='round';
      ctx.strokeText(value,x,y);
    }
    ctx.fillText(value,x,y);
  }
  if(poem&&!shallow)motif(ctx,w,h,item.motif,item.color);
  const family=item.latin?'Georgia, "Times New Roman", serif':item.vertical||item.motif==='mountains'?kai:song;
  const weight=prominent?'600':'400';
  if(item.vertical){
    const rows=Math.max(...item.lines.map(line=>[...line].length)),columns=item.lines.length;
    const size=Math.min(h*.82/rows,w*.82/(columns*1.1));
    ctx.font=`${weight} ${size}px ${family}`;
    item.lines.forEach((line,i)=>[...line].forEach((char,j)=>drawText(char,w*(.09+.82*(columns-i-.5)/columns),h*.09+j*size*1.06,size)));
    return;
  }
  const count=item.lines.length;
  const blockHeight=h*(prominent?.72:poem?.46:count>1?.7:.8),step=blockHeight/count;
  const first=shallow?h*.5:poem?(count===1?h*.46:prominent?(count>2?h*.15:h*.25):h*.28):h*.5-step*(count-1)/2;
  item.lines.forEach((line,i)=>{
    let size=shallow?h*(prominent?.80:.60):poem?(count===1?h*(prominent?.76:.23):step*(prominent?.90:.77)):step*.65;
    const font=n=>`${item.latin&&item.motif!=='orbit'?'italic ':''}${weight} ${n}px ${family}`;
    ctx.font=font(size);size*=Math.min(1,w*(prominent?.94:poem?.90:.94)/Math.max(1,ctx.measureText(line).width));ctx.font=font(size);
    if(item.motif==='orbit'){
      const spacedWidth=ctx.measureText(line).width+size*.42*([ ...line].length-1);
      size*=Math.min(1,w*.94/spacedWidth);ctx.font=font(size);
      const gap=size*.42,chars=[...line],widths=chars.map(c=>ctx.measureText(c).width),total=widths.reduce((a,b)=>a+b,0)+gap*(chars.length-1);
      let x=(w-total)/2;ctx.textAlign='left';chars.forEach((c,j)=>{ctx.fillText(c,x,first);x+=widths[j]+gap;});ctx.textAlign='center';
    }else drawText(line,w/2,first+i*step,size);
  });
}
