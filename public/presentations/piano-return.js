// Navigation around the supplied deck; its slides and presentation code stay intact.
export function pianoReturnURL({href,referrer='',frameSrc=''}={}){
  const deck=new URL(href),fallback=new URL('../c118.html',deck);
  const candidates=[deck.searchParams.get('returnTo'),referrer,frameSrc];
  let hall;
  for(const value of candidates){
    if(!value)continue;
    try{const url=new URL(value,deck);if(url.origin===deck.origin&&url.pathname===fallback.pathname&&!url.username&&!url.password){hall=url;break;}}catch{}
  }
  hall??=fallback;
  hall.searchParams.set('pianoReturn','1');
  return hall.href;
}

if(typeof document!=='undefined'){
  let frameSrc='';try{frameSrc=window.frameElement?.src||'';}catch{}
  const destination=pianoReturnURL({href:location.href,referrer:document.referrer,frameSrc});
  const button=document.createElement('button');
  button.type='button';button.id='piano-return';button.textContent='← 返回报告厅';
  button.style.cssText='position:fixed;top:max(12px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 18px;border:1px solid #cbd5dd;border-radius:999px;background:#ffffffed;color:#263b41;font:500 14px/1.4 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 12px #00000010;';
  button.addEventListener('click',()=>{button.disabled=true;location.replace(destination);});
  document.body.append(button);
}
