# 校园 AI 墙面文案

活动装饰层在 `src/campus-ai-murals.js` 中配置，由正式校园入口的 `createCampus3D` 加载。它不修改源 GeoJSON、建筑轮廓、碰撞、出生点或活动控制状态。

2026-10-30 修正：此前该模块仅存在本地，线上主场没有导入，导致线上完全不显示。

## 显示位置

- 韵苑食堂出生点正前方：“AI 不止会聊天”。使用入口门玻璃上方、楼层檐线下方的实体墙面，避开雕塑。
- 食堂旁边现有黑色展示框：“让 Agent / 操作电脑 / 搜索 · 文件 · 浏览器”。文字平面位于框前，不埋进墙体。
- 保留食堂背墙、韵苑体育馆和东九 A 翼端墙上的主题文案。
- 其他楼栋使用距离道路 24 米以内、正面无遮挡的窗间墙带；缩短句子，不覆盖门窗。当前合并地图共生成 14 块文案。

主入口两块采用深绿底、浅色粗体；其余为墙面绘字。使用少量静态纹理平面，没有新模型下载或逐帧纹理生成。材质不受阴影压暗，保留深度测试，不能隔墙看字；不使用细小立面构件的距离裁剪。

## 修改与验证

编辑 `AI_WALL_MESSAGES` 可改路边短句；`planCampusAIMurals` 中的命名点位控制主要墙面。修改时需核对实际渲染的墙面偏移，而不是直接贴在 GIS 原始边上。

运行 `node --test tests/campus-ai-murals.test.mjs`：验证正式场景接入、源数据保持不变、出生点朝向与视线、展示框/实墙承托、路边可见性。浏览器还需查看默认出生视角和阴影中的文字效果；几何测试不能替代实际文字渲染检查。

Activity labels use `activity-label-layout.js` to avoid nearby visible text rectangles. Only their screen labels move; host-configured map coordinates, beams and entry admission remain unchanged. Label sizes are cached, and projection shares the existing 66 ms activity-update interval.
