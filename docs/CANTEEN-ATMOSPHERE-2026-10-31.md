# 食堂林荫街道与三种光照（2026-10-31）

依据用户提供的 `4e2948926e9e705d9346beda566ad0ed.jpg`，调整学生一、二食堂前的林荫街道。照片用于树形、密度、停车形态和光影参考；具体树位、树高、车位及灯杆是游戏中的估算，不是实测复原。没有修改源 GeoJSON、道路坐标、楼体、台阶或现有移动系统，也没有发布用户原图。

## 使用

在游戏右上角、画质选择旁切换「林间日光」「夕阳晚霞」「月下校园」。切换仅影响自己的画面，记忆在当前浏览器中，不改变主持人阶段、观众记录、角色位置、朝向或载具。夜景仍保留道路可见度；树影关闭、灯罩和暖色地面光斑开启。普通刷新会保留选中的时段。

食堂前新增错落停车继续走现有电动车交互：靠近后按 F 骑行／下车。停车布局保留源人行道、台阶入口以及已有行人路径，不通过堵路制造拥挤。

## 实现边界与性能

- `src/canteen-street-life.js`：依据真实道路和食堂入口生成成熟树木、停车位、灯杆；共享实例化树木及原有电动车模型。树冠相互交叠，树干保留通行碰撞。停车身份稳定，车体不重复创建。
- `src/campus-atmosphere.js` / `.css`：复用现有半球光、方向光及环境贴图。天空增加一个绘制对象、960 个三角形；切换不创建额外动态灯、不重新生成环境贴图，没有全屏体积光效果。
- 日间斑驳采用固定世界坐标的轻量地面着色，不随镜头滑动；流畅画质关闭动态阴影时也可见。夜间灯光用发光材质和地面光斑表现，不给每盏灯增加实时点光源。
- 保留植被与车辆的距离裁剪、已有 NPC 数量及全部旧交通工具。远处细节不会持续执行额外的逐帧定位逻辑。
- 接入点为 `src/campus-3d.js`、`src/commute-experience.js`、`src/survey.js`。新点位属于表现层，不污染源地图。作品覆盖层打开时沿用原有暂停与资源管理。

## 启动和验证

安装项目现有依赖后按 README 启动（`npm start`，已有 `prestart` 恢复运行资源）。开发、生产沿用现有服务、构建和 GitHub → Vercel 流程，不新增服务或依赖。

新增测试：`tests/campus-atmosphere.test.mjs`、`tests/canteen-street-life.test.mjs`、`tests/canteen-street-integration.test.mjs`。浏览器验收：

```sh
node scripts/verify-canteen-atmosphere-browser.mjs --root . --output artifacts/canteen-atmosphere-20261031/desktop
node scripts/verify-canteen-atmosphere-browser.mjs --root . --output artifacts/canteen-atmosphere-20261031/mobile --profile mobile
```

脚本在临时生产构建中注入只用于验收的探针，不写入发布源码；检查真实 WebGL 着色器、同机位三种光照、刷新记忆、重复切换资源数量、原有 NPC 和载具、三辆新电动车的实际按键取还，输出 JSON 和实机图片。手机测试是桌面 Chrome 的触屏／横屏视口模拟，车辆操作使用键盘；不代表实体低配手机帧率。短时帧率采样仅记录本机测试条件，不作为所有设备性能承诺。

最终数量、测试结果、部署提交和公网验证记录见同目录下任务 artifacts 的报告及 `release-verification.json`。
