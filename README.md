# 东校区互动活动

## 性能与低配置设备

默认自动调整画质，右上角可选择「流畅优先／均衡／清晰」。已优化远景树木、实例缓冲、停车与骑手更新、阴影、倒影及角色加载，保持地图、碰撞与玩法。[优化说明和验证](docs/PERFORMANCE-OPTIMIZATION.md)。

第二阶段已接入出生区先可玩、装饰实例按需驻留、30/60 Hz 绘制、图书馆轻量资源与角色延迟加载、作品退出清理和活动查询减量。实测收益、运行命令与未完成的真机验收见 [本轮实施报告](docs/PERFORMANCE-PHASE2-IMPLEMENTATION-2026-10-30.md)。普通界面不显示诊断；需要导出报告时添加 `?diagnostics=1`。

200 人活动优化已加入同实例 SSE 共享调度、批量租约续期、连接错峰和后台恢复修正，并修复模型并发穿透、增加有界排队。新旧 200 人测试及保留的 AI 预算限制见 [200 人优化与验收](docs/PERFORMANCE-200-IMPLEMENTATION-2026-10-30.md)。

现有华科东校区 3D 校园、主持人控制台及三个真实作品的活动运行版本。观众填写昵称，在校园点位进入作品并返回；主持人控制公告、暂停、光柱、入口和活动阶段，查看个人记录与全场统计。默认在韵苑食堂步行出发。出行方式已改为场景交互：靠近现有电动车、路边跑车、草坪直升机、飞行器或地面战衣，按 F 使用；停稳落地后 F 退出。右上角显示透明操作提示。没有积分、钥匙、排行榜或玩家互相可见的多人同步。

已发布试用站点：[观众入口](https://www.the-most-interesting.online/) · [主持人控制端](https://www.the-most-interesting.online/admin)。本轮已核对最新校园、三个真实作品、版本化资源缓存与公网实时连接轮换；结果与设备边界见 [当前实施报告](docs/PERFORMANCE-PHASE2-IMPLEMENTATION-2026-10-30.md)。最初整合阶段的双浏览器与主持人联动记录保留在 [部署验收记录](docs/VERCEL-ACCEPTANCE.md)，现场网络与物理手柄不以桌面测试替代。

## 手机横屏

手机横放后自动显示摇杆、触屏视角与载具动作；蜘蛛侠保留按住挂丝、松开再按换点。支持刘海安全区、可选全屏和手机渲染预算。[操作与验证范围](docs/MOBILE-CONTROLS.md)。

步行采用与蜘蛛侠一致的镜头方向输入，W/S 前后、A/D 两侧，人物平滑转向，镜头保持朝向；C 主动回正。键盘和摇杆共用此逻辑。步行上限 3.2 m/s，Shift / 触屏加速为 5.2 m/s；玩家电动车前进上限 7.5 m/s，并加强松油门减速和空格刹车。[本轮操控说明](docs/CAMERA-RELATIVE-WALKING.md)。

## 本地运行

使用 Node.js 24 与 npm：

```sh
npm ci
npm run build
npm start
```

访问 `http://127.0.0.1:5178/`，控制端为 `/admin`。首次启动会从 `asset-source/` 自动恢复作品到忽略提交的 `work-assets/`（本轮约 692 MB，含保留的原模型与显式移动候选）；以后启动校验缓存。源码已包含全部必需网页运行资源，无须原制作工程。开发模式使用 `npm run dev`。

本地 Node 将活动数据保存在 `server-data/`。管理员密码由 `ADMIN_PASSWORD` 提供（至少 12 字符），未配置则首次随机生成并保存到 `server-data/admin-password.txt`。局域网使用 `HOST=0.0.0.0 npm start`，分享这台电脑的局域网 IP；不要分享 localhost。模型服务设置见下文。

## Vercel 部署

这是 Vercel + Turso 生产部署源码，`vercel.json` 已配置静态作品、Node API、路由和 300 秒函数时限。校园与大型模型、Unity 文件由静态 CDN 提供；活动数据、管理认证和模型代理进入 `api/activity.mjs`，不依赖临时文件系统。实时连接会在 240 秒主动轮换并自动重连。

1. 把此目录推送到自己的 GitHub 仓库，在 Vercel 导入。框架选择 Other，Node.js 24，构建命令 `npm run build:vercel`，输出目录 `dist`，开启 Fluid compute。配置文件已包含构建命令。
2. 在 Vercel Marketplace 连接 Turso 数据库到 **Production**，获得 `TURSO_DATABASE_URL` 和 `TURSO_AUTH_TOKEN`。Preview 如需使用，配置另一套数据库，不与正式活动混用。
3. 设置 Production 服务端环境变量 `ADMIN_PASSWORD`、`TASAY_LLM_API_KEY`、`TASAY_LLM_BASE_URL`、`TASAY_LLM_MODEL`。可选 `TASAY_FAST_LLM_API_KEY`／`BASE_URL`／`MODEL`。不要使用 `VITE_` 前缀、写入 Git 或发送给观众。
4. 在已授权的终端执行以下数据库初始化，然后部署 main 分支。迁移只创建表和索引，不清空记录。

```sh
npx vercel link
npx vercel env pull .env.production.local --environment production
node --env-file=.env.production.local serverless/migrate.mjs
```

部署应通过 Git 集成：本轮运行资源压缩源约 361 MB；仓库按块保存，构建时校验 SHA-256 并还原真实资源，不经 API 传输大模型。新增哈希资源与原资源共存，观众只在进入对应作品时请求所选版本，不会下载全部资源包。`.env*`、`.vercel/`、`server-data/`、`dist/` 均不提交。

更新 `asset-source/manifest.json` 后执行 `npm run sync:routes`，把更新后的 `vercel.json` 一起提交。Vercel 在构建前读取路由，不能只生成 `routes.generated.json`；构建会检查两者一致，新的 Vite 哈希 JS/CSS 也有独立缓存规则。

## 作品、控制台与配置

| 入口 | 内容 |
| --- | --- |
| `/` | 校园与昵称加入 |
| `/admin` | 密码认证的主持人控制端 |
| `/works/library/` | 书境图书馆，保留内部以撒入口与原旅程 |
| `/works/wanyan/` | 黑神话.晚言完整 Unity 网页游戏 |
| `/works/tasay/` | 过拟合恋人正式 React 游戏 |

请从校园点位进入作品，才能关联当前观众、记录体验和恢复校园位置。图书馆采用匿名化活动副本，原生日礼物工程未修改。活动数据区分到访、已打开、正在体验、已返回和有真实事件时的已完成；不会把关闭页面记为通关。

主持人登录 `/admin` 后，在“活动开启”中勾选本轮作品，点击“开启所选活动”。选中的作品同时出现召集光柱并允许靠近进入，未选中的作品关闭；支持同时开启多个。“全部关闭”撤下所有作品入口及其光柱，已进入作品的观众仍可继续体验并返回。独立集合光柱、暂停和活动阶段各自控制。新建场次默认没有开放作品；已有场次的设置保存在数据库中，不会因重新部署而重置。

蜘蛛侠模式按下并保持 E 或鼠标左键，按镜头方向选择一个真实锚点并保持；松手保留惯性，再次按下才选择下一锚点。不会因上摆、时间或墙边停滞自动换点，碰撞断丝后也须松手重按。Q 收丝，空格起跳／弹射，WASD 控向，G 定点与空中 F 前冲仍是主动动作；地面停稳 F 脱下战衣。R／旧自动穿行按钮不再接丝。

《过拟合恋人》对话需要上述服务端模型配置。本地可用 `TASAY_ENV_FILE` 指向私有配置文件；在线只使用 Vercel 服务端变量。未配置时场景可打开，但模型对话无法完成。代理限制请求频率与场次用量，不把上游凭据交给浏览器。

校园入口为 `index.html → src/campus-entry.js → src/survey.js`，启动层提供移动浏览器兼容与失败重试；作品与默认点位配置在 `src/activity-catalog.js`，采用原校园坐标系。新增作品需配置稳定 ID、真实 URL、说明和就绪方式，并在 `activityPortals()` 中设定位置及触发范围。主持人可调整入口、光柱和阶段，阶段与个人进度独立。外部作品必须按 `public/experiences/activity-bridge.js` 的来源校验接入返回，不可用页面关闭伪造胜利。

地图共放置 1 架韵苑草坪直升机、10 件战衣、3 辆特斯拉、5 架电动飞行器与 2 艘东九湖游艇。所有当前显示的电动车均支持骑行／下车，下车留下原车；游艇只在水域航行、靠岸上下船。步行速度 2.2 m/s，Shift 3.8 m/s。摆放与维护见 [场景载具说明](docs/WORLD-TRANSPORT.md)。

## 验证与维护

```sh
npm test
npm run build:vercel
```

`tests/` 验证 Node HTTP、认证、同人去重、记录一致性、100 观众连接与事件以及 SSE 轮换；使用临时本地 SQLite，不是 100 台设备同时渲染 3D 的性能测试。实际部署验收记录以 `docs/VERCEL-ACCEPTANCE.md` 为准。`docs/ACTIVITY-RUNBOOK.md` 与 `docs/ACTIVITY-ACCEPTANCE.md` 保留原整合阶段说明，涉及完整工程的重新制作命令仅适用于持有原素材者。

保留了校园地图、碰撞、镜头、步行、电动车、跑车、直升机、滑板及蜘蛛侠玩法。作品按进入时加载，退出销毁 iframe。这里只发布运行所需源码及资源，不包含建模参考图库、原制作目录、私人资料、密钥或观众数据。

本轮行走与高速飞行的帧率、CPU、模型合批及等价性验收见 [移动性能优化记录](docs/MOVEMENT-PERFORMANCE-2026-10-31.md)。
