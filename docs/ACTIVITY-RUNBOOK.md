# 东校区互动活动运行手册

更新：2026-10-27。交付以本地完整源码与可运行包为准，主场入口为 `index.html → src/survey.js`。按用户最新要求，停止继续尝试 GPT 平台部署与平台验收，后续由用户选择 Vercel 或其他服务接管部署。已有平台发布记录不作为经过验收的可用地址；实际验证和限制见 [ACTIVITY-ACCEPTANCE.md](ACTIVITY-ACCEPTANCE.md)。

## 系统与真实入口

校园、管理界面、活动 API 和作品使用同一来源。校园继续使用原有建筑、碰撞、视角、交通工具和蜘蛛侠移动；本轮增加活动层，不重建地图，也不新增多人角色同步。

默认出生点为韵苑食堂南侧入口前的铺地区域，面向食堂。初次选择交通工具和重生使用该位置；切换交通工具与从作品返回保留当前位置。通勤 NPC 仍沿原韵苑 27 栋至东九路线运行，三个活动点位不随出生点移动。

| 内容 | 访问路径 | 实际来源／运行方式 |
|---|---|---|
| 观众主场 | `/` | 原生 JavaScript、Three.js、Vite 校园构建 |
| 主持人控制台 | `/admin` 或 `/admin.html` | 现有管理端，密码登录后使用管理 API |
| 书境图书馆 | `/works/library/` | 原 `apps/library/viewer/serve.py` 等价资源映射的活动运行副本 |
| 黑神话.晚言 | `/works/wanyan/` | 原 `apps/library/games/wanyan/` 的真实 Unity 网页构建 |
| 过拟合恋人 | `/works/tasay/` | 原 `index.html → src/main.tsx → src/App.tsx` 的隔离 Vite 构建 |
| 图书馆内以撒 | `/works/library/games/isaac/` | 保留原 HTML、Ruffle、游戏与剧情桥 |
| 图书馆游戏清单 | `/works/library/api/games` | 保留两款书中游戏状态；兼容 `/api/games` |
| 实时状态／推送 | `/api/live/state`、`/api/live/events` | HTTP 快照与 SSE；无每帧位置上传 |
| 私有观众列表／明细 | `/api/admin/audience`、`/api/admin/audience/:id` | 需要管理员 cookie，普通观众不可读 |

`/works/tasay/chat` 等正式 React 路由回退到作品自己的 HTML。缺失的 `.js`、模型、Unity 资源返回失败，不回退成“成功页面”。进入作品才下载其资源；校园首屏不等待三个作品全部下载。

## 交付包直接启动

交付文件为 `output/east-campus-activity-source.zip`，约 226 MB。干净启动验收跑次为 248 个文件；文档更新后重新打包的准确体积和哈希以包外 `output/east-campus-activity-source-verification.json` 为准。包含校园源码、管理端、Node 服务和三个真实作品运行包，已有 `dist/` 与 `work-assets/`，无需寻找原作品或重新构建作品。

解压后进入 `east-campus-activity/`，使用 Node.js 22.13 或以上：

```sh
npm ci
npm start
```

打开 `http://127.0.0.1:5178/`，管理端为 `http://127.0.0.1:5178/admin`。干净解压后的校园构建、真实 HTML／资源、69 条图书馆／晚言路由和匿名观众 API 流程已验证；测试复用本机依赖仅用于验收，ZIP 不含 `node_modules`，接收方仍需 `npm ci`。模型凭据和 `server-data/` 不在包内。

## 从原项目重新构建

修改校园源码后运行 `npm run build` 即可。只有重新生成作品运行包才需要原 `ta-say` 锁文件对应的依赖与原图书馆完整资源；常规启动不需要以下两个源路径。只复制 viewer HTML 不能代替图书馆运行资源。

在校园工程根目录执行，下列两个路径只用于构建，含中文与空格时保留引号：

```sh
npm ci
export BOOKREALM_SOURCE='/持有完整资源的/生日礼物工程目录'
export TASAY_SOURCE='/持有源码的/ta-say目录'
npm run build:activity
npm start
```

`build:activity` 依次构建作品与校园；默认输出为 `work-assets/library/`、`work-assets/wanyan/`、`work-assets/tasay/`、`dist/`。缺少原资源时应修复构建输入，不用占位网页代替。构建后的 Node 运行不依赖原工程绝对路径。

Node 开发模式也提供完整活动 API 和作品路由：

```sh
npm run dev -- --host 127.0.0.1 --port 5178
```

默认本机观众入口为 `http://127.0.0.1:5178/`，管理入口为 `http://127.0.0.1:5178/admin`。`npm run preview` 仅是 Vite 静态预览，不是完整活动启动方式。不要使用 `file://` 直接打开主场。

正式 Node 服务可设置 `HOST`、`PORT`、`PUBLIC_ORIGIN`。同一现场局域网运行可用 `HOST=0.0.0.0` 并使用现场设备可到达的主机地址；那仍需按验收清单用另一设备验证。正式域名经反向代理终止 HTTPS 时，将 `PUBLIC_ORIGIN` 设置为完整来源，例如 `https://campus.example.com`，不带路径或末尾斜杠，并让代理转发 `/api/`、`/works/` 和静态请求。SSE 路由应关闭响应缓冲、允许长连接。

`ADMIN_PASSWORD` 可通过服务端环境提供，至少 12 个字符。Node 未配置时生成随机密码，写入 `server-data/admin-password.txt`，文件权限为 0600；终端只显示文件位置，不打印密码。只向主持人安全交付密码。管理员会话有效期为 8 小时。

## 主持人现场使用

1. 登录 `/admin`，确认“控制服务已连接”、独立参与人数与在线观众数。新场次默认提供三个真实作品点位；历史状态未包含时，在“体验入口”点击“载入三个作品点位”。它仅补齐缺少的稳定 ID，保留已有位置、文案和开放状态。
2. 在阶段下拉中选择“自由探索／集合／短片／分享”，编辑引导文字并保存。阶段完全由主持人决定，切换不会清空探索记录、移动玩家或隐式解除暂停。
3. “暂停全体玩家／恢复全体玩家”独立操作。暂停会冻结校园控制并通知当前作品，保留姿态和进度。先改阶段、再发公告、是否暂停可按现场需要分别决定。
4. 公告可立即发布或设置开始、结束时间，提供普通、庆祝、紧急样式。光柱和入口也有启用及时间范围；开始时刻包含在内，结束时刻不包含在内。时间由服务端校准，断线后补取当前状态。
5. 在地图上点选位置或输入米制 X/Z 坐标，设置光柱和入口。入口的“对应作品”选择真实作品会填入名称、介绍和 URL；保存前可以调整。
6. “观众记录”支持昵称或 ID 搜索、独立到访／作品统计、当前体验及个人时间线。点击昵称查看加载失败、页面已打开、运行就绪、返回等记录。旧记录可继续展开。两位主持人同时保存冲突时，界面会提示重新核对，避免悄悄覆盖。

“短片”阶段只表达主持人当前环节与引导，不会凭空播放尚未提供的影片，也不会把统一观看计成游戏通关。没有星星、积分、兑换、排行榜或个人任务解锁阶段。

## 身份、到访与统计口径

- 观众填写昵称后由服务端生成匿名 ID，身份凭据保存在同源 HttpOnly cookie；同名观众仍有不同 ID。同一浏览器的多个标签页共享身份，刷新和重连保留服务端记录。
- 这是浏览器匿名身份，不是实名账号。同一人更换浏览器、设备或清除身份 cookie 后可能成为新观众；不会通过昵称强行合并。
- 浏览器每 15 秒心跳，服务端以最近 65 秒的活动判断在线。关闭窗口不会立即变为离线；连接数是诊断信息，不能当独立观众数。
- 到访只在实际进入开放入口的触发范围时发起，服务端复核点位、水平距离和高度范围。重复事件、重复靠近、多窗口不会增加独立到访人数。没有逐帧位置同步；这不是防作弊的权威物理服务器。
- `opening` 是一次加载尝试，不等于已体验。图书馆须两个 GLB 解析完成、晚言须 Unity 实例创建成功，才满足 `runtime_ready`；过拟合恋人使用正式 React 主界面出现的 `page_opened`，准确标为“页面已打开”。
- 加载失败和加载前返回不计为成功打开。`returned` 表示打开后返回校园，`cancelled` 表示加载前退出。重复消息按 `eventId` 去重，作品按稳定 `workId` 汇总。
- 独立参与人数包含已离线观众；各点位人数按观众去重；作品打开人数不等于打开次数。当前体验人数仅计在线且已打开的体验，同一人多个窗口也去重。全场当前体验人数不简单相加各作品人数。
- 本轮没有强行接入三部作品的通关系统。原作品内部真实胜利条件仍归原剧情使用，进入、刷新、返回、阶段切换都不会伪造胜利。

数据存储在服务端。`localStorage` 仅缓冲断线事件，`sessionStorage` 保存返回姿态，不作为主持人的全场数据库。

## 进入、暂停和返回

观众靠近开放点位后点击入口或按 Enter。只有完成服务端到访、创建体验尝试后才打开 iframe。父层保存校园身份、位置、移动模式和相机状态，释放输入焦点并暂停校园活动；作品在自己的运行时加载。返回按钮一直在父层顶部，不抢占原作品 Esc 键。

父子消息严格匹配窗口、来源和 `attemptId`。作品加载成功、运行就绪和失败分别处理，未收到匹配就绪信号不会仅凭 iframe `load` 记为已打开。关闭入口会让正在该入口的观众返回。返回时移除 iframe，发送销毁通知；晚言尝试退出 Unity，图书馆与故事适配器停止或暂停自己的输入、音频和计时工作。鼠标锁定遵守浏览器要求，返回后可再次主动锁定。

## 增加点位与作品

活动目录是 `src/activity-catalog.js`，不修改校园 GeoJSON。当前点位共用原 ENU 坐标：1 单位为 1 米，X 向东、Y 向上、Z 向南。

| 稳定点位 ID | 作品 ID | X / Z | 默认触发半径 |
|---|---|---|---|
| `point-library` | `library` | 584.66 / 332.64（东图东门外） | 8 米 |
| `point-wanyan` | `wanyan` | 449.91 / -119.96 | 16 米 |
| `point-tasay` | `tasay` | 58.19 / 17.55 | 16 米 |

已有作品可从管理端新增入口，选择作品，填写真实 URL、说明和位置。新作品填稳定 `workId`，不同入口指向同一作品时复用它；入口 `id` 自身必须唯一。当前最多 12 个光柱、12 个入口。`workId`、点位 ID 用字母、数字、短横线或下划线，发布后尽量不改，避免割裂历史记录。

需要固定默认项时在 `ACTIVITY_WORKS` 和 `activityPortals()` 中添加，发布前接好真实路由／资源并验证可达；已有持久化状态不会被新默认值覆盖，应在管理端补齐。新子作品使用同源服务最简单；外域需允许 iframe，并在构建时声明可信校园来源，不能无条件信任 URL 参数。

子作品接收可信父窗口的 `campus:activity`（`paused`、公告、服务时间）和 `campus:dispose`；完成真实加载阶段后发送 `campus:ready`，带 `workId`、`attemptId`、`level: 'page_opened' | 'runtime_ready'`。返回发送 `campus:exit`。来源来自父层附加的 `campusParentOrigin` 和 `campusAttempt`，但只接受同源或预先声明的来源，并核对 `event.source`。详见两个 `integration/*/README.md` 和 `public/experiences/activity-bridge.js`。外部普通网页没提供桥时不能宣称已经成功体验。

本轮只定位了图书馆、晚言和过拟合恋人三个正式作品。短片、额外 HTML 分享、其他翻译工具的真实素材或运行项目尚未由本轮清单确认，不创建虚构入口。

## Node 持久化与备份

Node 单进程通过 `server/index.mjs` 同时提供所有路由。`server-data/live-state.json` 保存全场状态，`server-data/audiences.json` 保存观众、到访、尝试和事件。写入经队列、临时文件和原子重命名，保存失败不应用新状态。

部署时将 `server-data/` 放在持久磁盘，停服备份该目录并妥善保管；迁移时连同已构建 `dist/`、`work-assets/` 和运行源码部署。不能把它作为静态目录公开。管理员内存会话在 Node 重启后失效，需重新登录；观众记录、身份散列和活动状态会恢复。此文件存储方案用于单实例，不能让多台 Node 实例同时写同一份 JSON。

## 用户接管部署

本次不再继续 GPT 平台部署。当前没有通过独立设备／网络验收、可以据此保证现场可用的公网地址。后续选用 Vercel 或其他托管时，必须同时处理静态校园资源、三个作品资源、服务端 API、实时推送、持久数据和 runtime secrets；仅上传 `dist/` 不能提供控制台与观众统计。

现成 Node 路径最直接：将解压包部署到支持长期 Node 进程和持久磁盘的运行环境，`npm ci` 后 `npm start`，配置 `HOST`、`PORT`、`PUBLIC_ORIGIN`、管理员密码及可选模型配置，代理 SSE 长连接并持久化 `server-data/`。若选择无状态／临时文件系统的运行环境，应先适配该平台的持久数据库和实时推送方式，不能直接把本地 JSON 存储当成可靠云数据库。

原工程也保留了 Worker 适配分支 `deployment/site/`，供后续自行托管参考；它不在精简 Node ZIP 内。该分支包含：

- `worker/index.ts`：活动 API、模型代理、运行资产路由。
- `worker/activity-api.js`：D1 保存全场状态、匿名观众、管理员会话、限额和连接租约；并发写采用版本比较，SSE 约 1.5 秒检查版本、15 秒心跳。
- `db/schema.ts` 与 `drizzle/`：持久化数据库与迁移。本地预览库和生产库独立。
- `worker/generated-assets.json` schema v2、`public/_activity_assets/`：运行资源白名单；每 16 MiB 原始数据分别 gzip，无损存储约 217.8 MB，对应原始 374.5 MB。Worker 逐块流式解压，保持原 URL、MIME、SHA 对应内容、HEAD、Range 和 ETag。动态流可使用合法的 chunked 传输，没有 Content-Length 时以实际字节数与哈希验证。
- `runtime/`：与校园共享的状态 schema、目录、观众领域和模型代理。`deployment/prepare-source.mjs` 负责同步，不要只更新 `dist`。

重新生成此分支的运行资源时，在完整校园工程内执行：

```sh
npm run build:activity
node deployment/prepare-assets.mjs --verify
node deployment/prepare-source.mjs
```

再到 `deployment/site/` 安装其锁定依赖并构建：

```sh
npm ci
npm run build
```

Worker 使用 `DB` 和 `ASSETS` 绑定。使用本地 Wrangler 预览时，首次按 `deployment/site/README.md` 应用尚未执行的迁移，`npm start` 只启动本地预览。自行部署到其他项目时，应核对目标项目标识、数据库迁移、资源绑定与 runtime secrets；不要带入本地观众测试数据。生产备份针对实际数据库，不能以 `.wrangler/` 的本地库替代。

既有历史记录：原项目 `appgprj_6adb1308ace0819195294e83e0ecc3af` 的 public version 1 已由平台确认发布，源码 commit 为 `34d28c382ebb8b6a5e0a7505d623e5523de2d8bf`。当前网络终端访问返回 Cloudflare 403，浏览器公网全流程未确认；因此不将该发布记录列为本轮可用观众入口。没有把“平台发布成功”写成“公网验收通过”。

## 模型与凭据

过拟合恋人的原主线聊天使用规则与预写叙事；翻译／关系蒸馏功能需要真实模型。浏览器只调用 `/api/works/tasay/default/chat/completions` 或 `/api/works/tasay/fast/chat/completions`。服务端要求已验证的观众身份、同源请求，固定上游地址与模型；不接受观众自选 URL，也不将上游密钥或敏感报错返回浏览器。

配置 `TASAY_LLM_API_KEY`、`TASAY_LLM_BASE_URL`、`TASAY_LLM_MODEL`；可选 `TASAY_FAST_LLM_*`。Node 可用 `TASAY_ENV_FILE` 在服务端读取现有私有环境文件，生产 Worker 使用托管平台 runtime secrets，不上传本地 `.env`。活动 Vite 构建清除 `VITE_*` 环境输入，并扫描产物防止私有值混入。

代理默认每身份每分钟 6 次、每进程或 isolate 生命周期 40 次、同一代理并发 8、请求超时 60 秒、最大输出 2048 tokens。Worker 额外用 D1 原子扣减每身份每分钟 6 次、每天 40 次和全场每天 500 次的共享上限，防止多实例绕过；“每日”按 UTC 日桶计算。模型额度耗尽显示真实错误，不生成假结果。模型费用与校园三维渲染是不同资源；没有给出未经核实的服务报价。

## 保护范围与交付边界

原生日礼物、ta-say 及校园原地图均保留。只发布运行白名单，不发布制作工程、原私有剧情配置／头像、参考图库合集、旧构建、密钥或观众数据文件。

图书馆活动副本使用中性的访客引导和独立活动存档键，保留原节点、回复数、延时、开门与真实胜利条件；Unity/SWF 编译资源原样保留。过拟合恋人仅在隔离副本改 basename、模型代理和暂停桥，以及一处既有 nullable 类型绑定，不改原叙事与存档。源码基线和已知失败见验收文档。

当前不包含仿 Codex 舞台界面、语音监听、演员控制、人物捏脸、照片上传或多人角色同步。约 100 人的服务连接压测不等于 100 个三维玩家同屏测试，也不说明任何手机都能流畅运行重型模型。现场应按最终验收设备与网络测试首屏和作品首次加载。
