# 东校区大门与韵苑生活区入口：来源和模型边界

核验日期：2026-10-29。本模块为现有校园的独立增量。没有修改源 GeoJSON、其他建筑的位置、鸟蛋雕塑或移动系统。相片只在 `artifacts/campus-gates-2026-10-29/` 留作研究，不作为线上贴图。

## 最终确认的两个位置

|入口|来源与定位|模型范围与置信边界|
|---|---|---|
|东校区大门|现有 `opto-southeast.geojson` 的 `way/104350466`，`building=yes, layer=1`；门下通路 `way/478977155` 标记 `tunnel=building_passage`。门下通路中点 WGS84 **114.42739115, 30.5083232**；在湖溪路南端，南接 `way/98831433`，北接 `way/478977154`。|来源轮廓和路网定位可信；卫星图可以识别横梁及两侧门房。模型用源屋顶轮廓推导约18.0m宽的门楼，红色平梁、灰柱、独立侧门、玻璃岗亭、开放道闸。高度、柱宽和岗亭细节均为照片估计，非实测。|
|韵苑生活区入口|现有 `east-campus.geojson` 的 `node/1194858814`，`barrier=gate`，WGS84 **114.4267576, 30.5164782**；`way/97057001` 穿过节点。食堂在西，五栋在东，南接喻家路/启明路路口。|源节点与道路关联可信。本地街景确认开敞的生活区入口和入口旁鸟蛋；没有足够近景确认门杆、门岗的完整当前规格，所以只补较低门柱和沿侧边收起的细栏，明确为示意估计，不造巨型门楼，不新增无依据岗亭。|

两入口使用相同校园 ENU 米制坐标；不把南部真实校门搬到原地图30.512裁剪边界。东大门位于后来已接入的东南补充图范围，湖溪路已贯通，不新增无证据长连接路。

## 实际查看过的照片和地图

1. [华中科技大学研究生招生《新生必备｜华科太大？地图攻略在此别害怕》](https://www.sohu.com/a/337138707_673149)，2019-08-28。原文明列东校区大门可通车、东小门不可通车，东北门另列。已下载并目视：
   - [东校区大门原图](https://5b0988e595225.cdn.sohucs.com/images/20190829/47ac9cda5569483c8ab00e5014591e9f.jpeg)：`official-east-main-2019.jpeg`。四根灰柱、深红梁、灰色板块吊顶、左右小通道、侧面窗房、竖起闸杆、蓝白锥筒；取景北箭头有助核对面向。
   - [东小门原图](https://5b0988e595225.cdn.sohucs.com/images/20190829/51a74798532e448283c4b3cc80b80935.jpeg)：`official-east-small-2019.jpeg`。灰色低门柱、窄小人行口与医院导向牌。它与红梁东大门明显不同，未把它混为生活区内部入口。
   - [校门关系图](https://5b0988e595225.cdn.sohucs.com/images/20190829/3abe5cbb6bdf4a3786c997f1df418a47.jpeg)：`official-gate-map-2019.jpeg`。可看东大门、东小门、东北门的关系，底图为示意，不取图上像素直接当WGS84。
2. [Wikimedia Commons：HUST East Campus](https://commons.wikimedia.org/wiki/File:HUST_East_Campus.JPG)，Georgezhao，2012-11-30，CC BY-SA 3.0；[原图](https://upload.wikimedia.org/wikipedia/commons/0/03/HUST_East_Campus.JPG)已目视，保存 `commons-east-campus-2012.jpg`。与校方2019照片红梁、四灰柱、右侧竖牌和两侧岗亭一致。它不是华科主校区南大门照片。历史图片证明形制，不证明2026所有表面饰材未改。
3. 用户本地 `宣传片/真实参考图片/截屏2026-10-06 20.19.10.png` 原尺寸目视：左为韵苑食堂/教育超市，右为五栋，入口位于二者之间；鸟蛋在左侧前场。沿用现有 `yunyuan-forecourt.js` 的雕塑，不复制。截图日期不是拍摄日期。
4. [华科新闻网《“梦工厂”韵苑崛起》](https://news.hust.edu.cn/info/1004/22620.htm)，2010-05-28，明确把破壳鸟雕塑称为韵苑入口雕塑。[校方《这里是韵苑！》转载](https://news.sina.cn/gn/2020-12-11/detail-iiznctke6018801.d.html)，2020-12-11；27张可下载图实际通过标号联系表 `yunyuan-2020-contact.jpg` 查看，单独查看14、27及路牌图。照片支持生活区环境，不足以补出一座大门楼。
5. Esri World Imagery 公共服务：[服务](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer)，来源署名 `Esri, Vantor, Earthstar Geographics, and the GIS User Community`，影像拍摄日期未知。使用公开瓦片取得东大门与生活区入口正射关系，未作实时材质：
   - `huxi-gate-overhead.jpg` / `huxi-gate-registered.jpg`：源门楼轮廓和穿门道路叠加，北朝上。
   - `yunyuan-gate-overhead.jpg` / `yunyuan-gate-registered.jpg`：源门节点、食堂、五栋与内街关系。
   - 同目录若干 `east-gate`、`south-gate`、`luoyu-gate`、`east-large-gate` 前缀图是辨认候选地点时的上下文，不是最终定位；最终模型以 **huxi-gate-registered** 为准。

## 明确排除的错误定位

- `way/1009118314` 的“东北门”在喻家湖路西侧（约114.42163,30.52077）；它不是此红梁东校区大门。
- 启明路南段与珞喻东路交会处、吹笛路南端都不是这组红梁柱门的源轮廓位置。迎新文写的“珞喻东路佳园路站”是公交下车站，不能直接当成门坐标。
- [2012 Panoramio《华中科技大学东校区》](https://commons.wikimedia.org/wiki/File:华中科技大学东校区_-_panoramio.jpg) 图片和GPS均已查看；它显示林荫内街，GPS是拍摄位置，不能直接认作门的坐标。保存 `commons-panoramio-east-2012.jpg`，未以此注册门位置。
- 搜到2023《理工男》拍摄临时校门的图片及改名报道，属于电影布景，未采入校园永久门形制。
- 没把华科南大门、武汉科技大学门、其他城市小区大门或图片搜索的自动描述当成实景证据。

## 模型与接入

`createCampusGates(THREE, model, {frame,geoToLocal})` 返回：

- `group`：两处独立近景组；`plan.gates` 保存源ID、经纬度、估计尺寸、开口、部件、到达视角。
- `infrastructure`：`buildings:[]`、`barriers`、`walkSurfaces`、`replacedBuildingIds:['way/104350466']`、`extraBounds`。必须排除原门楼盒子渲染和整块碰撞，才能走门下。
- `viewpoints['east-gate']`、`viewpoints['yunyuan-gate']`，分别含 `position/target/arrival`。`arrival` 为脚底坐标，生活区到达点沿现有弯折入口路生成，不是从门朝向硬推到人行道外。
- `forestExclusions` 是 MultiPolygon 形式，排除门区开口、柱脚与岗亭占地里的随机植被；不改变源林地。
- `update(camera)`：每处门独立620m距离裁剪；`dispose()` 幂等释放自产几何、材质及文字纹理。

东大门中央净开口约10.6m，左右人行净开口各1.93m，门梁净空5.35m。两侧道闸始终竖起，门不与活动解锁联动。生活区净开口10m，低栏沿侧边收起。尺寸都是展示估计；不宣称通过地图获得了真实门高。

模型不制造源楼内新房间。岗亭窗有框、低墙、分格和外挑顶，属于外观建筑；没有在玩家视角前贴摄影平面。门牌只生成原图可读的“华中科技大学”字样，不杜撰小牌正文。

本轮同时向主集成代理报告：`tunnel=building_passage` 表示穿门梁的地面道路，旧通用规则会把它降到地下4.5m。共享 `building-profiles.js` 由主代理单独修复；此模块提供门下地面 walkSurfaces，并让顶梁碰撞从净空高度开始。

## 实际验证

`node --test tests/campus-gates.test.mjs`：**5项通过**。验证：

1. 使用两处真实源要素、门路一致、原地图数据未改变；不混淆东北门。
2. 门柱、收起栏杆和机器不封闭车行与两侧行人开口；中心和左右车行轨迹通过；梁仅在5.35m以上阻挡。
3. 生活区导览脚底点位于真实转入路段，距门9m。
4. 几何有限、两门独立距离裁剪、资源一次释放。Node生成 **13次绘制、不到4000三角**；浏览器门牌会多1次绘制和2个三角。
5. 源证据缺失时不凭空产生门楼或错误建筑替换。

实际浏览器站在门下、步行/车行穿越与整体地图接入由主场集成任务负责；上述单元测试不冒充浏览器实测。

## 搜索摘要

- 网页搜索2词：`华中科技大学 东校区 东门 韵苑 生活区 大门 照片`；`华中科技大学 喻家山门 东南门 东门 校门 照片`，随后主要沿已找到的校方文章、Commons原图及源GIS链接核对。
- 图片搜索2词：`华中科技大学 东校区 大门 启明路`；`华中科技大学 韵苑 生活区 门`。第二个范围用于核对生活区入口，不能因相似标题移植别处门图。
- 预检读取OpenCLI实时registry与豆包帮助；豆包/小红书都要求占用浏览器，本次根代理正在主场浏览器验收，分支没有调用它们的搜索，不把AI问答当证据。
- 只读OSM公开map API取得南部上下文，保存XML在research artifacts；最终两处实际源要素已存在当前主图/东南补充图，无需改源GeoJSON。
