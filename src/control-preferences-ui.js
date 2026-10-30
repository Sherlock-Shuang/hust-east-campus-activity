/** A small optional settings dialog beside the existing translucent HUD. No
 * permanent settings panel and no changes to the world's interaction keys. */
export function createControlPreferencesUI({document,host,preferences,canOpen=()=>true,onBoundary=()=>{},onClose=()=>{}}={}){
  if(!host||!document?.createElement)return {close(){},refresh(){},dispose(){}};
  const listeners=[],fields={};let disposed=false,opening=false,opened=false;
  const element=(tag,text,attributes={})=>{const e=document.createElement(tag);if(text)e.textContent=text;for(const [key,value]of Object.entries(attributes))e.setAttribute(key,value);return e;};
  const listen=(el,type,handler)=>{el.addEventListener(type,handler);listeners.push(()=>el.removeEventListener(type,handler));};
  const button=element('button','操作',{type:'button',class:'control-preferences-button','aria-haspopup':'dialog','aria-label':'调整操作偏好'});
  const dialog=element('dialog','',{class:'control-preferences-dialog','aria-label':'操作偏好'});
  const heading=element('strong','操作偏好'),hint=element('p','设置仅保存在这台设备。'),form=element('div','',{class:'control-preferences-fields'});
  function field(key,label,{type,min,max,step}={}){
    const row=element('label',label),input=element('input','',{'aria-label':label,type});input.type=type;
    for(const [attr,value]of Object.entries({min,max,step}))if(value!==undefined){input.setAttribute(attr,String(value));input[attr]=String(value);}
    const output=type==='range'?element('output'):null;
    row.append(input);if(output)row.append(output);form.append(row);fields[key]={input,output};
    listen(input,type==='range'?'input':'change',()=>{preferences.set({[key]:type==='checkbox'?!!input.checked:Number(input.value)});refresh();});
  }
  field('sensitivity','视角灵敏度',{type:'range',min:.45,max:1.8,step:.05});
  field('joystickScale','摇杆大小',{type:'range',min:.8,max:1.35,step:.05});
  field('invertY','反转上下视角',{type:'checkbox'});
  field('comfortableCamera','减少镜头晃动',{type:'checkbox'});
  const footer=element('div','',{class:'control-preferences-footer'}),reset=element('button','恢复默认',{type:'button'}),done=element('button','继续探索',{type:'button'});
  footer.append(reset);footer.append(done);dialog.append(heading);dialog.append(hint);dialog.append(form);dialog.append(footer);
  host.append(button);document.body.append(dialog);
  function refresh(){const value=preferences.value;for(const [key,{input,output}]of Object.entries(fields)){if(input.type==='checkbox')input.checked=value[key];else input.value=String(value[key]);if(output)output.textContent=`${value[key].toFixed(2)}×`;}}
  function finishClose(){if(!opened)return;opened=false;onBoundary();onClose();}
  function close(){if(!dialog.open&&!opened)return;dialog.close?.();dialog.open=false;finishClose();}
  listen(button,'click',()=>{if(disposed||!canOpen()||opening||opened)return;opening=true;onBoundary();refresh();if(dialog.showModal)dialog.showModal();else{dialog.open=true;dialog.setAttribute('open','');}opened=true;opening=false;});
  listen(done,'click',close);listen(reset,'click',()=>{preferences.reset();refresh();});
  listen(dialog,'close',finishClose);
  listen(dialog,'cancel',()=>onBoundary());
  refresh();
  return {close,refresh,dispose(){if(disposed)return;close();disposed=true;listeners.forEach(remove=>remove());button.remove();dialog.remove();}};
}
