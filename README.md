# 东校区互动活动

现有华科东校区 3D 校园、主持人控制台及三个真实作品的活动运行版本。观众填写昵称，在校园点位进入作品并返回；主持人控制公告、暂停、光柱、入口和活动阶段，查看个人记录与全场统计。默认出生位置是韵苑食堂。没有积分、钥匙、排行榜或玩家互相可见的多人同步。

已发布试用站点：[观众入口](https://hust-east-campus-activity.vercel.app/) · [主持人控制端](https://hust-east-campus-activity.vercel.app/admin)。本机直连 Vercel 存在超时；开启现有代理后，公网接口、真实作品进入／返回、双浏览器观众和主持人联动已验证，现场网络与物理手柄仍未验收，具体边界见 [部署验收记录](docs/VERCEL-ACCEPTANCE.md)。

## 本地运行

使用 Node.js 24 与 npm：

```sh
npm ci
npm run build
npm start
```

访问 `http://127.0.0.1:5178/`，控制端为 `/admin`。首次启动会从 `asset-source/` 自动恢复作品到忽略提交的 `work-assets/`（约 370 MB）；以后启动校验缓存。源码已包含全部必需网页运行资源，无须原制作工程。开发模式使用 `npm run dev`。

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

部署应通过 Git 集成：运行资源压缩源约 218 MB，超过 Hobby 的 CLI 源文件上传限制；仓库文件以小于 16 MB 的压缩片段保存，构建时校验 SHA-256 并还原真实资源，不经 API 传输大模型。`.env*`、`.vercel/`、`server-data/`、`dist/` 均不提交。

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

蜘蛛侠模式按下并保持 E 或鼠标左键，按镜头方向选择一个真实锚点并保持；松手保留惯性，再次按下才选择下一锚点。不会因上摆、时间或墙边停滞自动换点，碰撞断丝后也须松手重按。Q 收丝，空格起跳／弹射，WASD 控向，G 定点和 F 前冲仍是主动动作。R／旧自动穿行按钮不再接丝。

《过拟合恋人》对话需要上述服务端模型配置。本地可用 `TASAY_ENV_FILE` 指向私有配置文件；在线只使用 Vercel 服务端变量。未配置时场景可打开，但模型对话无法完成。代理限制请求频率与场次用量，不把上游凭据交给浏览器。

校园入口为 `index.html → src/survey.js`；作品与默认点位配置在 `src/activity-catalog.js`，采用原校园坐标系。新增作品需配置稳定 ID、真实 URL、说明和就绪方式，并在 `activityPortals()` 中设定位置及触发范围。主持人可调整入口、光柱和阶段，阶段与个人进度独立。外部作品必须按 `public/experiences/activity-bridge.js` 的来源校验接入返回，不可用页面关闭伪造胜利。

## 验证与维护

```sh
npm test
npm run build:vercel
```

`tests/` 验证 Node HTTP、认证、同人去重、记录一致性、100 观众连接与事件以及 SSE 轮换；使用临时本地 SQLite，不是 100 台设备同时渲染 3D 的性能测试。实际部署验收记录以 `docs/VERCEL-ACCEPTANCE.md` 为准。`docs/ACTIVITY-RUNBOOK.md` 与 `docs/ACTIVITY-ACCEPTANCE.md` 保留原整合阶段说明，涉及完整工程的重新制作命令仅适用于持有原素材者。

保留了校园地图、碰撞、镜头、步行、电动车、跑车、直升机、滑板及蜘蛛侠玩法。作品按进入时加载，退出销毁 iframe。这里只发布运行所需源码及资源，不包含建模参考图库、原制作目录、私人资料、密钥或观众数据。
