import {campusMapGeometry,campusMapFocus,campusNavigationPlaces,navigationReading,formatCampusDistance,nearbyCampusName} from './campus-navigation-data.js';
import './campus-navigation.css';

export function createCampusNavigation({document,window,host,canvas,getPlayer,getHeading=()=>0,notify=()=>{}}){
  const svgNS='http://www.w3.org/2000/svg',listeners=[],rows=new Map(),markers=new Map();
  let places=[],map=null,selected=null,preview=null,available=false,disposed=false,fullMap=false,lastTick=-Infinity,arrived=false;
  let storage;try{storage=window.sessionStorage;}catch{}
  const listen=(element,name,fn,options)=>{element?.addEventListener(name,fn,options);listeners.push(()=>element?.removeEventListener(name,fn,options));};
  const dialog=document.createElement('dialog');dialog.className='campus-map-dialog';dialog.setAttribute('aria-labelledby','campus-map-title');
  dialog.innerHTML=`<div class="campus-map-heading"><div><h2 id="campus-map-title">校园地图</h2><p>选一个地方，沿校园道路慢慢走过去。</p></div><button type="button" class="campus-map-close" aria-label="关闭校园地图">关闭 <kbd>Esc</kbd></button></div>
    <div class="campus-map-layout"><div class="campus-map-drawing"><button type="button" class="campus-map-extent">查看全图</button><svg role="group" aria-label="东校区道路、建筑与当前所在位置"></svg><span class="campus-map-north" aria-hidden="true">↑ 北</span><span class="campus-map-legend">蓝色箭头是你的位置</span></div>
    <div class="campus-map-index"><label for="campus-map-search">想去哪里</label><input id="campus-map-search" type="search" placeholder="搜索地标" autocomplete="off"><div class="campus-map-places" role="group" aria-label="校园地标"></div><p class="campus-map-empty" hidden>没有找到这个地点，试试“食堂”或“操场”。</p>
    <div class="campus-map-destination"><strong></strong><p>选择地点后，校园里会显示方向和直线距离。</p><button class="campus-map-start" type="button" disabled>开始指引</button></div></div></div>`;
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector),svg=$('svg'),list=$('.campus-map-places'),search=$('input'),start=$('.campus-map-start'),destination=$('.campus-map-destination');
  const location=document.createElement('button');location.type='button';location.className='campus-location';location.hidden=true;location.setAttribute('aria-label','查看当前位置，打开校园地图');location.innerHTML='<span class="campus-location-icon" aria-hidden="true">⌖</span><span></span><kbd>M</kbd>';host.append(location);
  const bearing=document.createElement('div');bearing.className='campus-bearing';bearing.hidden=true;bearing.innerHTML='<button type="button" class="campus-bearing-go"><span class="campus-bearing-arrow" aria-hidden="true">↑</span><span><strong></strong><small></small></span></button><button type="button" class="campus-bearing-clear" aria-label="结束目的地指引">×</button>';host.append(bearing);
  const toggle=document.getElementById('campus-map-toggle');
  const svgElement=(tag,attributes)=>{const node=document.createElementNS(svgNS,tag);for(const [name,value]of Object.entries(attributes||{}))node.setAttribute(name,String(value));return node;};
  const extent=$('.campus-map-extent');
  const playerMarker=svgElement('g',{'aria-hidden':'true',class:'campus-map-player'});
  playerMarker.append(svgElement('circle',{r:11}),svgElement('path',{d:'M0 -8L6 7L0 4L-6 7Z'}));
  function storeSelection(){try{selected?storage?.setItem('campus-navigation-v1',selected.id):storage?.removeItem('campus-navigation-v1');}catch{}}
  function choose(place){
    preview=place;
    for(const [id,row]of rows)row.setAttribute('aria-pressed',String(id===place?.id));
    for(const [id,marker]of markers)marker.classList.toggle('is-selected',id===place?.id);
    destination.querySelector('strong').textContent=place?.label||'选一个校园地标';
    destination.querySelector('p').textContent=place?place.description+'。指引显示方向和直线距离，请沿道路前往。':'选择地点后，校园里会显示方向和直线距离。';
    start.disabled=!place;
  }
  function close({restoreFocus=true}={}){
    if(!dialog.open)return;
    dialog.close();document.body.classList.remove('campus-map-open');
    getPlayer()?.releaseInput?.();
    if(restoreFocus&&available&&getPlayer()?.active&&!getPlayer()?.suspended)canvas.focus({preventScroll:true});
  }
  function open(){
    if(disposed||!available||!getPlayer()?.active||getPlayer().suspended||document.hidden||!map||dialog.open||document.querySelector('dialog[open]'))return;
    getPlayer()?.releaseInput?.();search.value='';filter();choose(selected||places[0]);
    dialog.showModal();document.body.classList.add('campus-map-open');
    search.focus({preventScroll:true});paintPlayer();
  }
  function filter(){const q=search.value.trim().toLocaleLowerCase();let found=0;for(const place of places){const visible=(place.label+place.description).toLocaleLowerCase().includes(q);rows.get(place.id).hidden=!visible;if(visible)found++;}$('.campus-map-empty').hidden=found>0;if(q&&(!preview||rows.get(preview.id)?.hidden))choose(places.find(place=>!rows.get(place.id).hidden)||null);}
  function paintPlayer(){
    const pose=getPlayer()?.state;if(!map||!pose)return;
    playerMarker.setAttribute('transform',`translate(${pose.x} ${pose.z}) scale(${map.markerScale}) rotate(${-getHeading()*180/Math.PI})`);
  }
  function clear(){selected=null;arrived=false;storeSelection();bearing.hidden=true;}
  listen(toggle,'click',open);listen(location,'click',open);listen(bearing.querySelector('.campus-bearing-go'),'click',open);listen(bearing.querySelector('.campus-bearing-clear'),'click',clear);
  listen($('.campus-map-close'),'click',()=>close());listen(search,'input',filter);
  listen(start,'click',()=>{if(!preview)return;selected=preview;arrived=false;storeSelection();close();lastTick=-Infinity;notify(`已开始前往${selected.label}的方向指引`);});
  listen(dialog,'cancel',event=>{event.preventDefault();close();});
  listen(dialog,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'||event.code==='KeyM'&&!event.target.closest('input')){event.preventDefault();close();}});
  listen(dialog,'close',()=>document.body.classList.remove('campus-map-open'));
  listen(window,'keydown',event=>{
    if(event.code!=='KeyM'||event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.target?.closest?.('input,textarea,select,[contenteditable=true],dialog[open]'))return;
    if(!available)return;event.preventDefault();open();
  });
  function setExtent(){
    if(!map)return;
    const box=fullMap?map.viewBox:campusMapFocus(places,map.viewBox);map.markerScale=Math.max(box[2],box[3])/640;svg.setAttribute('viewBox',box.join(' '));extent.textContent=fullMap?'聚焦校园':'查看全图';
    for(const place of places)markers.get(place.id)?.setAttribute('transform',`translate(${place.x} ${place.z}) scale(${map.markerScale})`);paintPlayer();
  }
  listen(extent,'click',()=>{fullMap=!fullMap;setExtent();});
  function setData(campus,model){
    close({restoreFocus:false});places=campusNavigationPlaces(campus,model);map=campusMapGeometry(model);rows.clear();markers.clear();list.replaceChildren();svg.replaceChildren();
    svg.setAttribute('viewBox',map.viewBox.join(' '));
    for(const [category,d]of Object.entries(map.paths))svg.append(svgElement('path',{d,class:'campus-map-'+category,'fill-rule':'evenodd'}));
    for(const place of places){
      const row=document.createElement('button');row.type='button';row.innerHTML='<strong></strong><span></span>';row.querySelector('strong').textContent=place.label;row.querySelector('span').textContent=place.description;row.setAttribute('aria-pressed','false');row.onclick=()=>choose(place);rows.set(place.id,row);list.append(row);
      const marker=svgElement('g',{class:'campus-map-point',transform:`translate(${place.x} ${place.z}) scale(${map.markerScale})`,tabindex:0,role:'button','aria-label':place.label});
      const title=svgElement('title');title.textContent=place.label;
      const label=svgElement('text',{class:'campus-map-point-label',y:-17,'text-anchor':'middle','aria-hidden':'true'});label.textContent=place.label;
      marker.append(svgElement('circle',{r:9}),svgElement('circle',{r:3}),title,label);
      marker.onclick=()=>{search.value='';filter();choose(place);rows.get(place.id).scrollIntoView({block:'nearest'});};
      marker.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();search.value='';filter();choose(place);rows.get(place.id).scrollIntoView({block:'nearest'});}};
      markers.set(place.id,marker);svg.append(marker);
    }
    svg.append(playerMarker);setExtent();
    let id;try{id=storage?.getItem('campus-navigation-v1');}catch{}
    selected=places.find(place=>place.id===(selected?.id||id))||null;choose(selected||places[0]);lastTick=-Infinity;
  }
  function tick(now,{enabled=true}={}){
    if(disposed)return;
    const player=getPlayer();available=enabled&&!!player?.active&&!player.suspended&&!document.hidden;
    if(toggle)toggle.disabled=!available||!map;
    if(!available){close({restoreFocus:false});location.hidden=true;bearing.hidden=true;return;}
    if(now-lastTick<100)return;lastTick=now;
    const anotherDialog=!!document.querySelector('dialog[open]');location.hidden=anotherDialog;
    const name=nearbyCampusName(player.state,places),nameNode=location.querySelector('span:not(.campus-location-icon)');
    if(nameNode.textContent!==name)nameNode.textContent=name;
    if(dialog.open)paintPlayer();
    const reading=selected&&navigationReading(player.state,selected,getHeading());
    bearing.hidden=!reading||anotherDialog;
    if(reading){
      bearing.querySelector('strong').textContent=selected.label;
      bearing.querySelector('small').textContent=reading.arrived?'已到达附近':`${formatCampusDistance(reading.distance)} · 直线距离`;
      bearing.querySelector('.campus-bearing-arrow').style.transform=`rotate(${reading.angle}rad)`;
      bearing.dataset.arrived=String(reading.arrived);
      if(reading.arrived&&!arrived){arrived=true;notify(`已到达${selected.label}附近`);}else if(reading.distance>20)arrived=false;
    }
  }
  return {setData,tick,open,close,get isOpen(){return dialog.open;},dispose(){if(disposed)return;close({restoreFocus:false});disposed=true;listeners.forEach(fn=>fn());dialog.remove();location.remove();bearing.remove();rows.clear();markers.clear();}};
}
