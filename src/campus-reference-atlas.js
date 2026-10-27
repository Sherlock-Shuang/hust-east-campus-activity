import {CAMPUS_LANDMARK_EVIDENCE} from './campus-landmarks.js';
import {LOCAL_CAMPUS_REFERENCES} from './local-photo-references.js';
// Source photographs remain on their publishers' servers. Dates below are
// publication/upload information, never an assertion of a current survey.
export const CAMPUS_AERIAL_REFERENCES = [
  {title:'东九 · 湖湾与翼楼全景', category:['东九','道路水岸'], platform:'华中科技大学 · 校园风光', date:'拍摄日期未注明 · 2026-10-24核验',
    image:'https://www.hust.edu.cn/images/22/09/29/1z26t6x3br/12.jpg', source:'https://www.hust.edu.cn/zjhkd/xyfg/qb/5.htm',
    caption:'校方斜向航拍：四条翼楼、临湖弧廊、湖湾、开敞前场与两侧林带。树木沿真实林地和树列线生成，株距与树高仍为估计；不从照片遮挡添加水道。', fresh:true},
  {title:'东九 · 弧廊与前场', category:['东九','道路水岸'], platform:'华中科技大学 · 校园风光', date:'拍摄日期未注明 · 2026-10-24核验',
    image:'https://www.hust.edu.cn/images/22/09/29/1z26t6x3br/11.jpg', source:'https://www.hust.edu.cn/zjhkd/xyfg/qb/5.htm',
    caption:'校方正面航拍：三条玻璃窗带、高柱廊、两侧曲线低绿篱、临湖单列树与密林有清晰分区。图片不提供精确楼高、每株树的位置或背面立面。', fresh:true},
];

export const CAMPUS_BUILDING_REFERENCES=['way/103488139','way/103932379'].flatMap(id=>{
  const e=CAMPUS_LANDMARK_EVIDENCE[id];
  return e.photos.map((image,i)=>({title:`${e.name} · 实拍 ${i+1}`,image,source:e.sourceUrl,
    date:id==='way/103488139'?'校方研究生招生图文 · 2020 年':'校方图文 · 2025 年',
    platform:'华科校方图文转载',category:['韵苑'],caption:`${e.observed} ${e.uncertainty}`,fresh:true}));
});

export const CAMPUS_REFERENCE_VIEWS = [
  {id:'yunyuan-stone',label:'韵苑花田 · 文化石与白棚',landmarkView:'stone',ids:[],photo:LOCAL_CAMPUS_REFERENCES.find(p=>p.id==='campus-stone-lawn'),
    relation:'照片与校方2022年捐赠报道确认是韵苑花田“敢担大任、勇攀高峰”文化石；按灰白竖纹、左低右高轮廓和红色竖排铭文重建。花田沿用地图草地，石头与白棚的位置、尺寸仍为照片估计。'},
  {id:'lake-canopies',label:'东九湖边 · 草坪与白棚',landmarkView:'lake',ids:[],photo:LOCAL_CAMPUS_REFERENCES.find(p=>p.id==='east-nine-lawn-tent'),
    relation:'参考照片分别重建大张拉膜棚和小弧顶棚，保留细支架、锚索、低草地与开敞空间。草地补片避开地图水岸、道路与建筑；棚的位置、大小及是否常设仍待实测。'},
  {id:'yunyuan-market',label:'韵苑食堂 · 教育超市',ids:['way/103814566'],photo:LOCAL_CAMPUS_REFERENCES.find(p=>p.id==='yunyuan-canteen-market'),
    direction:[.42,.10,1.0],padding:0,scale:1,fitAvailable:true,
    relation:'超市位于食堂底层柱廊后方；弧形楼板、连续檐口与柱线共用照片细化轮廓，主门塔与远端小塔分别重建。檐高9.6米及弧度为照片估计，原地图边界保留。'},
  {id:'yunyuan-five',label:'韵苑5栋 · 弧形阳台',ids:['way/103815859'],photo:LOCAL_CAMPUS_REFERENCES.find(p=>p.id==='yunyuan-food-dorm-junction'),
    direction:[.12,.20,1.05],padding:0,scale:1,fitAvailable:true,
    relation:'5栋在食堂东侧，以本地路口镜头与校方5栋照片交叉核对弧阳台、栏杆和窗墙。保留地图五层，照片疑似层数差异待核实，不将此外观套给27栋。'},
  {id:'lake-street',label:'湖边弯道 · 铺砖与路灯',ids:['way/97080595'],photo:LOCAL_CAMPUS_REFERENCES.find(p=>p.id==='east-nine-paver-curve'),
    direction:[.5,.5,.9],padding:0,scale:.85,
    relation:'沿用过喻岱桥后左转的地图弯道，车行面改为灰棕块砖；单曲臂灯朝向道路，树干位于连续草地。道路宽度与灯距尚无测量资料。'},
  {id:'lake',label:'东九与湖湾',ids:['way/1023544717','relation/13705236'],photo:CAMPUS_AERIAL_REFERENCES[0],
    direction:[1.1,.85,-.45],padding:20,scale:.9,
    relation:'东九在湖西北侧；弧廊临湖，四条翼楼之间留出庭院。湖岸与岛屿保留地图内环。'},
  {id:'arcade',label:'东九弧廊',ids:['way/1023544717'],photo:CAMPUS_AERIAL_REFERENCES[1],
    direction:[1.3,.7,.12],padding:0,scale:1.18,
    relation:'广场保持开敞，两端为白墙翼楼；弧廊下方通透。窗带与柱距参考照片，尺寸含估计。'},
  {id:'dorm',label:'韵苑生活区',ids:['way/110398529','way/103814566'],
    photo:{title:'韵苑宿舍 · 窗墙参考',image:'https://5b0988e595225.cdn.sohucs.com/images/20180826/47a7dac3cb3041558d9dba5c0c2f2372.jpeg',source:'https://www.sohu.com/a/250175872_154724',date:'校学生会 · 2018 年 8 月 26 日',caption:'韵苑米白色窗墙、空调外机与路侧绿化。照片楼号不明，仅作为区域外观参考，不能认定是27栋。'},
    direction:[.6,.65,.85],padding:20,scale:1,
    relation:'27栋在东九东北侧，食堂在27栋西南侧。27栋保留地图六层标签；删除没有逐楼证据的统一阳台和楼梯塔。'},
  {id:'library',label:'东图与南部楼群',ids:['way/98867853','way/1228689191'],photo:null,
    direction:[1,.7,.7],padding:20,scale:1,
    relation:'东图在计算机与人工智能大楼东侧、东九湖以南。已补回被兴趣点分类遗漏的体量；图书馆外观与米高仍待实拍核实。'},
  {id:'gym',label:'韵苑体育馆',ids:['way/103488139','way/1484333086'],photo:CAMPUS_BUILDING_REFERENCES[0],
    direction:[.65,.62,1.15],padding:5,scale:1,
    relation:'三层馆体、下部基座和南侧引桥按地图各自的轮廓组成。窄窗与梯形玻璃门洞来自体育馆实拍。'},
  {id:'activity',label:'韵苑学生活动中心',ids:['way/103932379'],photo:CAMPUS_BUILDING_REFERENCES.at(-1),
    direction:[-.9,.55,.9],padding:5,scale:1,
    relation:'保留 L 形双翼体量，按实拍加入低坡屋顶、挑檐、深色窗框与转角弧形玻璃门厅。'},
];

export function mountCampusReferenceAtlas({container,button,onFocus}) {
  const panel=document.createElement('section');panel.className='campus-atlas';panel.hidden=true;
  panel.setAttribute('aria-label','校园实景对照');
  panel.innerHTML='<div class="campus-atlas-heading"><div><small>实景影像 · 空间校核</small><h3>实景与模型对照</h3></div><button aria-label="关闭实景对照">×</button></div><label>查看区域 <select aria-label="实景对照区域"></select></label><figure><a target="_blank" rel="noreferrer"><img referrerpolicy="no-referrer" alt="" /></a><figcaption></figcaption></figure><p class="campus-atlas-relation"></p><p class="campus-atlas-evidence"></p><a class="campus-atlas-source" target="_blank" rel="noreferrer">原图与出处 ↗</a><small class="campus-atlas-note">位置沿用公开地图。高度、立面与树木个体为有依据的建模估计；完整测绘级三维资产尚未取得。</small>';
  container.append(panel);
  const select=panel.querySelector('select'),figure=panel.querySelector('figure'),img=panel.querySelector('img'),source=panel.querySelector('.campus-atlas-source');
  for(const view of CAMPUS_REFERENCE_VIEWS){const option=document.createElement('option');option.value=view.id;option.textContent=view.label;select.append(option);}
  function showView(){
    const view=CAMPUS_REFERENCE_VIEWS.find(v=>v.id===select.value)||CAMPUS_REFERENCE_VIEWS[0];
    panel.querySelector('.campus-atlas-relation').textContent=view.relation;
    figure.hidden=!view.photo;source.hidden=!view.photo;
    panel.querySelector('.campus-atlas-evidence').textContent=view.photo?.caption||'地图已确认此处有图书馆轮廓。当前外观只是占位体量，未把用途推定冒充实拍复原。';
    if(view.photo){img.hidden=false;img.src=view.photo.image;img.alt=view.photo.title;figure.querySelector('a').href=view.photo.image;panel.querySelector('figcaption').textContent=view.photo.date;source.href=view.photo.source;source.textContent='查看原始图文 ↗';}
    onFocus(view);
  }
  img.onerror=()=>{img.hidden=true;panel.querySelector('figcaption').textContent='原站图片暂不可用，可通过下方出处查看。';};
  button.setAttribute('aria-expanded','false');
  function setOpen(open){panel.hidden=!open;button.setAttribute('aria-expanded',String(open));if(open)showView();}
  button.addEventListener('click',()=>setOpen(panel.hidden));
  panel.querySelector('button').addEventListener('click',()=>{setOpen(false);button.focus();});
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);button.focus();}});
  select.addEventListener('change',showView);
  return{setOpen,dispose(){panel.remove();}};
}
