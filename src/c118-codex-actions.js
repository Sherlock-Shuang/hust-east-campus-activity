import {CODEX_VIEW} from './c118-codex-painter.js';

// Coordinates in the painted desktop, reached through the stage mesh's UVs.
export function c118CodexActionAt(uv){
  if(!uv||!Number.isFinite(uv.x)||!Number.isFinite(uv.y)||uv.x<0||uv.x>1||uv.y<0||uv.y>1)return null;
  const x=uv.x*CODEX_VIEW.width,y=(1-uv.y)*CODEX_VIEW.height;
  const inside=(a,b,w,h)=>x>=a&&x<=a+w&&y>=b&&y<=b+h;
  if(inside(60,99,222,34)||inside(8,52,36,36))return {type:'new-chat'};
  if(inside(1216,664,28,28))return {type:'send'};
  if(inside(310,600,948,101)||inside(60,271,222,31))return {type:'compose'};
  const prompts=['介绍一下这个项目的结构，帮我找到可以开始的地方。','帮我实现一个新功能，先和我一起梳理需求。','检查项目代码，找到值得改进的部分，并给出建议。','帮我排查项目中的问题，并给出修复方案。'];
  for(let i=0;i<4;i++)if(inside(459+i*165,310,155,92))return {type:'suggest',text:prompts[i]};
  return null;
}
