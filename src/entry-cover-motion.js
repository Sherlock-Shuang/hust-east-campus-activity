// One small 2D canvas keeps the title alive while the real WebGL campus loads.
// No additional renderer, large video, texture decoding or network dependency.
export function mountEntryCoverMotion({cover,canvas,window=globalThis.window,document=globalThis.document}={}){
  if(!cover||!canvas)return()=>{};
  const ctx=canvas.getContext?.('2d',{alpha:true});if(!ctx)return()=>{};
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let width=1,height=1,raf=0,last=0,time=0,disposed=false,panX=0,panY=0,targetX=0,targetY=0;
  const random=(a,b)=>a+Math.random()*(b-a);
  const leaves=Array.from({length:12},(_,i)=>({
    x:random(-.18,1.1),y:i/12,depth:random(.35,1),phase:random(0,Math.PI*2),
    speed:random(.018,.034),sway:random(.025,.075),rotation:random(-2,2),spin:random(-.5,.5),
  }));
  const motes=Array.from({length:16},()=>({x:Math.random(),y:random(.35,1),phase:random(0,7),speed:random(.003,.009)}));
  // Fan outline and sparse veins, deliberately quiet at this scale.
  const leaf=new Path2D('M0 9 Q-3 3 -9 -1 Q-15 -4 -17 -11 Q-15 -16 -12 -18 Q-8 -20 -4 -20 Q-2 -20 0 -17 Q2 -20 4 -20 Q8 -20 12 -18 Q15 -16 17 -11 Q15 -4 9 -1 Q3 3 0 9 Z M0 9 L1 15');
  function resize(){
    const rect=cover.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    const dpr=Math.min(window.devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function drawLeaf(p){
    const near=p.depth>.83,size=(width<600?11:15)*(.5+p.depth*.85);
    const x=(p.x+Math.sin(time*.48+p.phase)*p.sway)*width,y=p.y*height;
    ctx.save();ctx.translate(x,y);ctx.rotate(p.rotation+Math.sin(time*.4+p.phase)*.3+time*p.spin);
    ctx.scale(size/17,Math.max(.25,Math.abs(Math.cos(time*.65+p.phase)))*size/17);
    ctx.globalAlpha=near?.52:.66;ctx.filter=near?'blur(1px)':'none';
    const g=ctx.createLinearGradient(-12,-15,12,10);g.addColorStop(0,'#ffe6a3');g.addColorStop(.45,'#eeb951');g.addColorStop(1,'#ad682f');ctx.fillStyle=g;ctx.fill(leaf);
    ctx.strokeStyle='#fff1bd75';ctx.lineWidth=.5;ctx.stroke(leaf);ctx.beginPath();
    for(const vx of [-9,0,9]){ctx.moveTo(0,8);ctx.quadraticCurveTo(vx*.35,-2,vx,-13);}ctx.stroke();ctx.restore();
  }
  function paint(now){
    raf=0;if(disposed||document.hidden||reduced?.matches||cover.hidden)return;
    if(last&&now-last<32){raf=window.requestAnimationFrame(paint);return;}
    const dt=last?Math.min((now-last)/1000,.06):0;last=now;time+=dt;
    ctx.clearRect(0,0,width,height);
    panX+=(targetX-panX)*.045;panY+=(targetY-panY)*.045;
    cover.style.setProperty('--entry-pan-x',`${panX.toFixed(2)}px`);cover.style.setProperty('--entry-pan-y',`${panY.toFixed(2)}px`);
    // Sparse warm atmosphere in the sunlit half, not glitter over the title.
    ctx.save();ctx.globalCompositeOperation='screen';
    for(const p of motes){const alpha=(.13+Math.sin(time*.6+p.phase)*.09)*Math.max(0,1-p.x);ctx.globalAlpha=alpha;ctx.fillStyle='#ffe4ad';ctx.beginPath();ctx.arc((p.x+Math.sin(time*.13+p.phase)*.015)*width,((p.y-time*p.speed)%1+1)%1*height,1.1,0,Math.PI*2);ctx.fill();}
    // Only the lowest reflections shimmer, preserving building/leaf detail.
    for(let i=0;i<7;i++){const x=(.20+Math.sin(time*.18+i*2.3)*.065)*width,y=(.86+i*.017)*height;ctx.globalAlpha=.025+.018*Math.sin(time*.8+i);ctx.fillStyle='#ffd392';ctx.fillRect(x,y,width*(.025+Math.sin(i+2)*.012),.7);}
    ctx.restore();
    for(const p of leaves){p.y+=p.speed*dt;p.x+=.011*dt;if(p.y>1.12){p.y=-.12;p.x=random(-.1,.95);}drawLeaf(p);}
    raf=window.requestAnimationFrame(paint);
  }
  function restart(){if(raf)window.cancelAnimationFrame(raf);raf=0;last=0;if(!disposed&&!document.hidden&&!reduced?.matches&&!cover.hidden)raf=window.requestAnimationFrame(paint);}
  const pointer=e=>{if(e.pointerType==='touch'||reduced?.matches)return;targetX=(e.clientX/width-.5)*-10;targetY=(e.clientY/height-.5)*-6;};
  const leave=()=>{targetX=0;targetY=0;};
  const visibility=()=>{for(const el of cover.querySelectorAll('.entry-cover-art,.entry-cover-light'))el.style.animationPlayState=document.hidden?'paused':'';restart();};
  const change=()=>{ctx.clearRect(0,0,width,height);restart();};
  window.addEventListener('resize',resize);cover.addEventListener('pointermove',pointer);cover.addEventListener('pointerleave',leave);document.addEventListener('visibilitychange',visibility);
  reduced?.addEventListener?.('change',change);resize();restart();
  return function dispose(){if(disposed)return;disposed=true;if(raf)window.cancelAnimationFrame(raf);window.removeEventListener('resize',resize);cover.removeEventListener('pointermove',pointer);cover.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',visibility);reduced?.removeEventListener?.('change',change);ctx.clearRect(0,0,width,height);};
}
