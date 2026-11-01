export const GOMOKU_SIZE=15;
export const GOMOKU_POINT=Object.freeze({x:446.44619,y:.066,z:78.80678,radius:8});
export const GOMOKU_GRACE_MS=90_000;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function nearGomoku(p){return !!p&&[p.x,p.y,p.z].every(Number.isFinite)&&p.y>=-1&&p.y<=5&&Math.hypot(p.x-GOMOKU_POINT.x,p.z-GOMOKU_POINT.z)<=GOMOKU_POINT.radius;}
export function newGomoku(){return{board:'0'.repeat(225),turn:1,status:'playing',winner:null,line:[],moves:[]};}
export function placeGomokuStone(game,{color,cell,moveId,revision,expectedRevision}){
  if(![1,2].includes(color))fail(403,'你不是这局的玩家');
  if(typeof moveId!=='string'||!/^[\w-]{16,80}$/.test(moveId))fail(400,'落子标识无效');
  const previous=game.moves.find(m=>m.id===moveId);
  if(previous){if(previous.color!==color||previous.cell!==cell)fail(409,'这次落子请求已用于其他位置');return game;}
  if(game.status!=='playing')fail(409,'本局已结束');
  if(expectedRevision!==revision)fail(409,'棋局已更新，请在最新棋盘上落子');
  if(game.turn!==color)fail(409,'请等待对手落子');
  if(!Number.isInteger(cell)||cell<0||cell>=225)fail(400,'请选择棋盘上的交叉点');
  if(game.board[cell]!=='0')fail(409,'这里已经有棋子了');
  const board=game.board.slice(0,cell)+color+game.board.slice(cell+1),x=cell%15,y=Math.floor(cell/15);
  let line=[];
  for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]){
    const run=[cell];
    for(const sign of [-1,1])for(let n=1;n<15;n++){
      const xx=x+dx*n*sign,yy=y+dy*n*sign;
      if(xx<0||xx>=15||yy<0||yy>=15||board[yy*15+xx]!==String(color))break;
      run.push(yy*15+xx);
    }
    if(run.length>=5){line=run;break;}
  }
  const moves=[...game.moves,{id:moveId,cell,color}];
  return {...game,board,moves,line,turn:3-color,status:line.length?'won':moves.length===225?'draw':'playing',winner:line.length?color:null};
}
