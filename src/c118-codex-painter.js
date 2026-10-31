// Canvas counterpart of codex-ui-replica/dist/index.html + fidelity.css.
// Render into the hall's existing video mesh; no second screen or DOM app.
export const CODEX_VIEW = Object.freeze({width:1280,height:720,ratio:2});
export function paintC118Codex(ctx,{messages=[],draft='',icon=()=>{}}={}){
  const C={chrome:'#f7f7f7',sidebar:'#fcfcfc',ink:'#373530',secondary:'#54534e',muted:'#9d9c99',line:'#eeeeec'};
  function roundedRect(x,y,w,h,r){ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  function box(x,y,w,h,r,color,stroke){ctx.beginPath();roundedRect(x,y,w,h,r);if(color){ctx.fillStyle=color;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
  function text(value,x,y,size=14,color=C.ink,weight=400){ctx.font=`${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;ctx.fillStyle=color;ctx.fillText(value,x,y);}
  function glyph(name,x,y,size=18,color=C.muted){icon(name,x,y,size,color);}
  function wrap(value,width,size=17){text('',0,0,size);const out=[];for(const p of value.split('\n')){let line='';for(const c of p){if(line&&ctx.measureText(line+c).width>width){out.push(line);line='';}line+=c;}out.push(line);}return out;}
  ctx.save();ctx.scale(CODEX_VIEW.ratio,CODEX_VIEW.ratio);ctx.fillStyle=C.chrome;ctx.fillRect(0,0,1280,720);
  // Original desktop shell: 44 px title bar, 52 px app rail, 238 px sidebar.
  ['#ff5f57','#febc2e','#28c840'].forEach((c,i)=>box(12+i*15,18,9,9,5,c));
  glyph('arrowLeft',80,14,17);glyph('arrowRight',114,14,17);glyph('panel',148,14,17);
  box(290,14,1,17,0,'#e7e7e5');glyph('folder',306,14,16,C.ink);text('C118 报告厅',339,29,15,C.ink,500);
  glyph('more',1162,14,17);glyph('list',1200,14,17);glyph('panelRight',1244,14,17);
  box(8,52,36,36,10,'#ececeb');glyph('home',16,60,20,C.ink);
  ['layers','clock','activity','more','gitPull','grid'].forEach((name,i)=>glyph(name,17,105+i*44,19));
  box(14,276,24,1,0,'#e4e4e2');box(14,677,24,24,12,'#8c9999');text('AI',20,693,9,'#fff');
  box(52,44,1224,672,16,'#fff',C.line);
  ctx.save();ctx.beginPath();roundedRect(52,44,1224,672,16);ctx.clip();ctx.fillStyle=C.sidebar;ctx.fillRect(52,44,238,672);box(289,44,1,672,0,C.line);ctx.restore();
  text('Codex',68,78,18,C.ink,600);glyph('chevronDown',128,66,11);glyph('bell',228,64,16);glyph('search',261,64,16);
  glyph('edit',69,107,16,C.secondary);text('新聊天',95,121,14,C.secondary);
  box(72,145,13,13,7,'#bcc2d3');box(76,149,5,5,3,C.sidebar);text('你的 dot',95,157,14,C.secondary);box(60,168,222,1,0,C.line);
  text('已置顶',69,194,11,C.muted);text('项目',69,228,11,C.muted);
  glyph('folder',69,245,17,C.secondary);text('AI 俱乐部',96,260,14,C.secondary);
  box(60,271,222,31,10,'#f1f1f1');text('C118 报告厅',92,292,14,C.secondary);
  text('最近聊天',69,335,11,C.muted);
  // Use the same white rounded composer, shield, blue effort label and send icon.
  const left=310,right=1258,composerY=600;
  box(left,composerY,right-left,101,22,'#fff','#ededeb');
  const prompt=wrap(draft||'和 Codex 一起工作',right-left-34,14).slice(-2);
  prompt.forEach((s,i)=>text(s,left+14,composerY+28+i*21,14,draft?C.ink:'#cecdcc'));
  glyph('plus',left+12,composerY+67,18,C.secondary);glyph('shield',left+49,composerY+69,15,C.secondary);text('默认权限',left+71,composerY+82,13,C.secondary);
  text('GPT-6.1 Sol',right-177,composerY+82,13);text('高',right-91,composerY+82,13,'#3021f0');glyph('chevronDown',right-70,composerY+72,10);
  box(right-42,composerY+64,28,28,14,draft.trim()?C.ink:'#ededeb');glyph('arrowUp',right-37,composerY+69,18,draft.trim()?'#fff':'#b3b3b0');
  if(!messages.length){
    glyph('codex',764,191,40,C.muted);text('我们来构建点什么？',665,269,26,C.ink,500);
    const prompts=[['book','探索并理解','项目代码','#3d82c4'],['sparkles','构建新功能、','应用或工具','#9c6acf'],['gitPull','审查代码','并提供建议','#558c62'],['bolt','排查问题','并修复错误','#c47b4a']];
    prompts.forEach(([name,a,b,color],i)=>{const x=459+i*165;box(x,310,155,92,12,'#fff',C.line);glyph(name,x+12,322,16,color);text(a,x+12,368,12,C.secondary);text(b,x+12,386,12,C.secondary);});
  }else{
    // Latest turns stay above the composer; long content is clipped to the
    // conversation viewport, never over the title bar or input controls.
    let bottom=578;const blocks=[];
    for(const item of [...messages].reverse()){
      const user=item.role==='user',rows=wrap(item.text,user?690:908).slice(-17),h=rows.length*27+(user?24:0),top=bottom-h;
      blocks.unshift({user,rows,top,h});bottom=top-(user?35:28);if(bottom<44)break;
    }
    ctx.save();ctx.beginPath();ctx.rect(left,65,right-left,520);ctx.clip();
    const offset=Math.min(0,85-blocks[0].top);
    for(const {user,rows,top:blockTop,h}of blocks){
      const top=blockTop+offset;
      const width=user?Math.min(726,Math.max(...rows.map(s=>ctx.measureText(s).width))+32):right-left,x=user?right-width:left+4;
      if(user)box(x,top,width,h,18,'#f5f5f4');
      rows.forEach((s,i)=>text(s,x+(user?16:0),top+(user?31:20)+i*27,17));
    }ctx.restore();
  }
  ctx.restore();
}
