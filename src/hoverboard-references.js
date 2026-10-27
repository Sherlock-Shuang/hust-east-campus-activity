// Public reportage photos stay on their original host; the 3D asset is original.
export function installHoverboardReferences(){
  const button=document.getElementById('hoverboard-references');
  if(!button)return()=>{};
  const dialog=document.createElement('dialog');dialog.id='hoverboard-source-dialog';
  dialog.setAttribute('aria-labelledby','hoverboard-source-title');
  dialog.innerHTML=`
    <button class="roadster-source-close" aria-label="关闭飞行滑板资料">×</button>
    <span class="eyebrow">神奇阿宇 · 电动飞行滑板 · 2026.10</span>
    <h2 id="hoverboard-source-title">站上滑板，飞过校园。</h2>
    <p>参考湖北创作者宋兴宇的电动载人飞行滑板。极目新闻记者在 10 月 22 日现场见证短距离试飞；模型依据实拍重建白色镂空板体、蓝色边灯、外露旋翼和站立操控姿态。</p>
    <div class="roadster-photo-grid">
      <figure><img loading="lazy" referrerpolicy="no-referrer" src="https://ctdsb.clouddiffuse.xyz/b242f2614f374744a12302ed2b36dda2.png" alt="宋兴宇站在白色飞行滑板上，板体有蓝色边灯，底部露出电机与浅色桨叶"><figcaption>板体、旋翼、脚踏与手持控制器</figcaption></figure>
      <figure><img loading="lazy" referrerpolicy="no-referrer" src="https://ctdsb.clouddiffuse.xyz/a52d7e0645424588a6e02406ddb60125.png" alt="厂房内悬停实拍，骑手双脚分开站立，双臂微张，支腿悬垂在板下"><figcaption>悬停姿态、屈膝与落地支腿</figcaption></figure>
    </div>
    <p class="small">图片来源：极目新闻现场报道。<a href="https://www.ctdsb.net/c1476_202610/2886116.html" target="_blank" rel="noreferrer">查看原文与更多实拍 ↗</a></p>
    <div class="roadster-video-links" aria-label="飞行滑板实拍视频">
      <a href="https://www.bilibili.com/video/BV1jjnt6ZEQx/" target="_blank" rel="noreferrer"><b>01 / 记者采访</b><span>湖视频 · 10 月 23 日 ↗</span></a>
      <a href="https://www.bilibili.com/video/BV1HYnM6LEh6/" target="_blank" rel="noreferrer"><b>02 / 飞行短片</b><span>新华网 · 10 月 18 日 ↗</span></a>
      <a href="https://space.bilibili.com/431956189/" target="_blank" rel="noreferrer"><b>03 / 神奇阿宇Ayu</b><span>创作者 B 站主页 ↗</span></a>
    </div>
    <p>10 电机来自作者受访陈述；板体比例、旋翼布局和人物尺寸按照片估计。前进、悬停、60 米高度上限与升降速度为游戏设定，未使用真实飞控或测绘数据。</p>
    <p class="small">操作：Q / E 升降，W / S 前后，A / D 转向，空格悬停，V 切换视角。起飞先等待旋翼加速，落地后才能切换其他载具。</p>
  `;
  document.body.append(dialog);
  const open=()=>dialog.showModal(),close=()=>dialog.close();
  const backdrop=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}};
  button.addEventListener('click',open);dialog.querySelector('button').addEventListener('click',close);dialog.addEventListener('click',backdrop);
  dialog.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.closest('figure').classList.add('photo-unavailable');img.nextElementSibling.textContent+=' · 原图暂不可用，请访问原始报道';},{once:true}));
  return()=>{button.removeEventListener('click',open);dialog.remove();};
}
