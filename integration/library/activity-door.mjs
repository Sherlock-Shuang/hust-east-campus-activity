// Apply only to the activity copy. Game victories and StoryClock stay unchanged.
export const ACTIVITY_DOOR_HINT='图书馆大门已开放，可自由出入';
const marker='// Activity entrance stays open independently of story completion.';

function replaceOnce(source,from,to,label){
  const index=source.indexOf(from);
  if(index<0||source.indexOf(from,index+from.length)>=0)throw new Error(`Library door source changed: ${label}`);
  return source.slice(0,index)+to+source.slice(index+from.length);
}

export function openActivityLibraryDoor(source){
  if(source.includes(marker))return source;
  const changes=[
    ["setExitLocked(!exitUnlocked(journey));",`${marker}\nconst ACTIVITY_GATE_ANGLE=Math.PI/2;\nsetExitLocked(false);`,'initial collision'],
    ['ROUTE_PRESENTATION_ROTATION,beforeExitDoor,nearExitDoor,outsideExitDoor','ROUTE_PRESENTATION_ROTATION,outsideExitDoor','route imports'],
    ['// A legacy indoor pose can land on the new plaza after the route moves. Keep\n// story progress, but do not let that stale location count as a real exit.','// Restore any valid activity location, including outdoors. StoryClock still\n// requires both real victories and the final conversation before celebration.','saved position comment'],
    ['&&(exitUnlocked(journey)||beforeExitDoor(s.x,s.z))&&(journey.exited||!outsideExitDoor(s.x,s.z))','','saved outdoor position'],
    ["exitDoor.name='双书通关出口'","exitDoor.name='图书馆开放大门'",'door name'],
    ['let gateAngle=exitUnlocked(journey)?Math.PI/2:0;','let gateAngle=ACTIVITY_GATE_ANGLE;','initial leaf angle'],
    ['const unlocked=exitUnlocked(journey);setExitLocked(!unlocked);','const unlocked=exitUnlocked(journey);setExitLocked(false);','journey collision update'],
    ["$('#journey-status').textContent=journeyText(journey);","$('#journey-status').textContent=journeyText(journey).replace('读完新的消息并收起手机后，出口会打开。','读完新的消息，再沿馆外的小路走一会儿。');",'open door journey guidance'],
    ['document.documentElement.dataset.exitUnlocked=String(unlocked);',"document.documentElement.dataset.exitUnlocked='true';\n document.documentElement.dataset.storyExitUnlocked=String(unlocked);",'gate and story status'],
    ['gateAngle=0;gateLeaf.rotation.y=0;','gateAngle=ACTIVITY_GATE_ANGLE;gateLeaf.rotation.y=gateAngle;','reset leaf angle'],
    ['let lastSave=0,lastGateNotice=0;','let lastSave=0;','locked notice timer'],
    [" if(!phone.active&&!exitUnlocked(journey)&&nearExitDoor(player.x,player.z)&&now-lastGateNotice>7000){lastGateNotice=now;notice(journey.completed.isaac&&journey.completed.wanyan?'手机里还有一条消息。':'出口尚未打开，两段旅程还没有完成。');}\n",'','locked notice'],
    ['const target=exitUnlocked(journey)?Math.PI/2:0;','const target=ACTIVITY_GATE_ANGLE;','animated leaf angle'],
  ];
  for(const [from,to,label] of changes)source=replaceOnce(source,from,to,label);
  return source.replaceAll('唯一的密钥是一个日期',ACTIVITY_DOOR_HINT);
}

export function openActivityLibraryDocument(source){
  // A later activity pass may have advanced the runtime version. Once the
  // entrance hint is converted, preserve its cache token rather than downgrade
  // the document back to an older script generation.
  if(source.includes(ACTIVITY_DOOR_HINT)&&/src="\/works\/library\/hub\/main\.mjs\?v=[^"\s]+"/.test(source))return source;
  return source.replaceAll('唯一的密钥是一个日期',ACTIVITY_DOOR_HINT)
    .replace(/(src="\/works\/library\/hub\/main\.mjs)(?:\?[^"\s]*)?"/,'$1?v=open-door-20261030"');
}
