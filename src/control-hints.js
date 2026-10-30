const TOKENS=/WASD|Shift|Esc|空格|中键|左键|\b[WASDQEFGXLVTR]\b/g;
export function controlHintParts(text){
  return String(text).split('\n').map(line=>{
    const parts=[];let at=0;
    for(const match of line.matchAll(TOKENS)){
      if(match.index>at)parts.push({text:line.slice(at,match.index)});
      const keys=match[0]==='WASD'?['W','A','S','D']:[match[0]];
      for(const key of keys)parts.push({key});at=match.index+match[0].length;
    }
    if(at<line.length)parts.push({text:line.slice(at)});
    return parts;
  });
}
export function renderControlHints(element,text,{document=globalThis.document,keycaps=true}={}){
  if(!element)return;
  const signature=JSON.stringify([text,keycaps]);if(element.dataset.controlHints===signature)return;
  element.dataset.controlHints=signature;element.classList.toggle('has-keycaps',keycaps);
  if(!keycaps){element.textContent=text;return;}
  element.replaceChildren();
  for(const parts of controlHintParts(text)){
    const row=document.createElement('span');row.className='control-hint-row';
    for(const part of parts){const el=document.createElement(part.key?'kbd':'span');el.textContent=part.key??part.text;row.append(el);}
    element.append(row);
  }
}
