// Links checked against Tesla's page and YouTube's official oEmbed metadata.
// Photos remain on their original host; geometry is independently authored.
export function installRoadsterReferences(){
  const button=document.getElementById('roadster-references');
  if(!button)return()=>{};
  const dialog=document.createElement('dialog');dialog.id='roadster-source-dialog';
  dialog.setAttribute('aria-labelledby','roadster-source-title');
  dialog.innerHTML=`
    <button class="roadster-source-close" aria-label="关闭 Roadster 资料">×</button>
    <span class="eyebrow">TESLA · ROADSTER ROCKET · 2026</span>
    <h2 id="roadster-source-title">从演示车，到校园探索。</h2>
    <p>参考 Tesla 新款 Roadster Rocket 的白色楔形车身、低矮黑色舱罩、封闭轮盘与冷气推进器，独立制作可驾驶模型。</p>
    <div class="roadster-photo-grid">
      <figure><img loading="lazy" referrerpolicy="no-referrer" src="https://techcrunch.com/wp-content/uploads/2026/10/tesla-roadster-starman.jpg?w=680" alt="Tesla Roadster Rocket 侧面实拍：白色楔形车身、黑色封闭轮盘与打开的车门"><figcaption>侧面比例、舱罩与封闭轮盘</figcaption></figure>
      <figure><img loading="lazy" referrerpolicy="no-referrer" src="https://techcrunch.com/wp-content/uploads/2026/10/roadster-tesla-ramp.jpg?w=680" alt="Roadster 坡道演示中的后部：贯穿尾灯与下部喷口"><figcaption>贯穿尾灯、后肩与尾部喷口</figcaption></figure>
    </div>
    <p class="small">照片 © Tesla，经 TechCrunch 报道转引。<a href="https://techcrunch.com/2026/10/15/tesla-reveals-spacex-powered-roadster-that-flies-and-falls-with-style/" target="_blank" rel="noreferrer">查看原图报道 ↗</a></p>
    <div class="roadster-video-links" aria-label="Tesla 官方演示视频">
      <a href="https://www.youtube.com/watch?v=7p5LxFdc-Qg" target="_blank" rel="noreferrer"><b>01 / THE RAMP</b><span>坡道演示 · Tesla 官方 ↗</span></a>
      <a href="https://www.youtube.com/watch?v=r5vsHHPVhJg" target="_blank" rel="noreferrer"><b>02 / THE KICKFLIP</b><span>空中翻转 · Tesla 官方 ↗</span></a>
      <a href="https://www.youtube.com/watch?v=qt5p-_tE8d0" target="_blank" rel="noreferrer"><b>03 / ROADSTER EVENT</b><span>发布会 · Tesla 官方 ↗</span></a>
    </div>
    <p>官方描述 Rocket 为单座、周向冷气推进的演示车型。模型尺寸约 4.5 × 2.0 × 1.25 米，为照片估计；按住喷气获得升力、松开受重力下落。80 米高度上限、推力和操控参数是校园探索玩法，不代表实车性能。</p>
    <a class="roadster-official" href="https://www.tesla.com/roadster" target="_blank" rel="noreferrer">Tesla 车型资料 ↗</a>
  `;
  document.body.append(dialog);
  const open=()=>dialog.showModal(),close=()=>dialog.close();
  const backdrop=e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}};
  button.addEventListener('click',open);dialog.querySelector('button').addEventListener('click',close);dialog.addEventListener('click',backdrop);
  dialog.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.closest('figure').classList.add('photo-unavailable');img.nextElementSibling.textContent+=' · 原图暂不可用，请访问原始报道';},{once:true}));
  return()=>{button.removeEventListener('click',open);dialog.remove();};
}
