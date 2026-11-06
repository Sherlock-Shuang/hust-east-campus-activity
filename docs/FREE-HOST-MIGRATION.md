# 东校区 Online：免费托管迁移准备

本方案用于 Vercel 用量耗尽后、后续访问较少且不新增订阅的情况。准备日期：2026-11-06。代码和配置完成不等于公网恢复；仍需托管账号、服务端环境变量、真实部署和域名切换验收。

## 方案与实际限制

`render.yaml` 只定义一个 Node.js 24 Free Web Service，不创建收费数据库、持久磁盘或其他付费服务。手动部署，避免无关 Git 提交反复消耗构建配额。已有 Turso 数据库、模型服务及其各自用量限制继续保留。

核对的官方规则：

- [Render 免费实例](https://render.com/docs/free)：闲置 15 分钟休眠，再次请求约 1 分钟唤醒；工作区每月 750 免费实例小时；可重启，免费文件系统不持久。官方将它定位为个人项目/体验用途，不承诺生产 SLA。
- [出站流量](https://render.com/docs/outbound-bandwidth)：Hobby 当前每月 5 GB。未绑定付款方式时，耗尽流量会暂停到下月；已绑定付款方式可能产生超量账单。此项目含较大视频、GLB 和 Unity 资源，5 GB 仅适合少量访问，不能据此承诺多人活动容量。
- [Blueprint](https://render.com/docs/blueprint-spec)：`plan: free` 明确选择免费计算实例；`sync: false` 要求在控制台填写凭据，配置中不存储秘密。

遵循当前“不新增订阅”的选择，只选 Hobby 工作区和 Free 实例，不添加付款方式。如果已有账号绑定了付款方式，部署前先核对该账号的计费设置。不要设置定时保活去抵消平台休眠。

## 已准备的运行方式

```sh
npm ci --include=dev
npm run build:host
npm run start:host
```

`build:host` 复用经过校验的 Vite + 作品资源还原流程，资源全部在构建阶段生成到 `dist/`，不在每次冷启动解压。`start:host` 使用 `server/production.mjs`，默认监听 `0.0.0.0` 与平台 `PORT`。不要使用 `npm start` 代替：它是原有本地 JSON 数据版服务器。

生产入口只提供 `dist/` 中的静态资源；活动 API 复用 `serverless/node-handler.mjs` 和原 SQL 实现，留言、五子棋、观众记录、后台认证和 AI 配额仍由 Turso 保存。健康检查 `/healthz` 不会读取数据库。静态大文件支持 Range 与流式传输，不整体读入内存。

HTML 与 games JSON 保持重新验证，哈希资源长期缓存。`/admin`、作品目录、Tasay SPA 与 `/api/games` 特例沿用原路由；不存在的作品文件/API 不回落成校园 HTML。

## 本地验证结果

Node.js 24.22.1 下全部 1,230 项测试通过，完整 `build:host` 成功。新增独立生产服务器测试使用临时 SQLite，覆盖登录/CSRF、留言、五子棋、重启持久化、SSE 清理和 768 MB 文件的尾部 Range。真实 862 MB 构建产物的浏览器验收 11 项通过，189 个构建文件 HEAD 均正常；校园注册、后台暂停/恢复、留言面板和四个作品无页面脚本错误或失败 HTTP 请求。

降耗后，后台默认公告页不读取观众与留言完整列表，只有打开对应标签才刷新；隐藏后台停止周期刷新。校园隐藏时释放 SSE、普通心跳和后台队列重试，恢复时同步最新状态。显式体验事件/返回回执仍会提交，正在进行的五子棋保留独立心跳，避免丢失对局。

上述是本地构建和隔离浏览器验证，尚未完成 Render 公网部署或实际大陆/微信网络验收。

## 首次上线

1. 登录 [Render 控制台](https://dashboard.render.com/)，使用 Hobby 工作区，授权访问现有私有 GitHub 仓库 `Sherlock-Shuang/hust-east-campus-activity`。若尚无账号，需要账号持有人完成注册/登录。
2. 创建 Blueprint，选包含本次准备代码的分支和根目录 `render.yaml`。确认资源列表仅有 `hust-east-campus-online` 一个 **Free** Web Service，地区 Singapore；没有数据库、磁盘或付费实例。
3. 在托管环境中配置下表。凭据从现有 Vercel/Turso 配置转移，不发在聊天或写入 Git。首次使用 Render 自动设置的 `RENDER_EXTERNAL_URL`，先不填写自定义域的 `PUBLIC_ORIGIN`。
4. 构建/启动完成后，先使用平台提供的 `https://…onrender.com` 地址执行下方验收。测试地址和正式域名的浏览器 Cookie 不互通，测试时需重新登录/登记。
5. 验收通过，再在服务设置添加 `www.the-most-interesting.online`，按平台实际给出的记录修改 DNS，等待 HTTPS 证书就绪，同时把 `PUBLIC_ORIGIN` 设为 `https://www.the-most-interesting.online` 并重新部署。原域名下的既有 Cookie 和数据库身份可继续使用；不要清空数据库。

| 环境变量 | 值来源/用途 |
| --- | --- |
| `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN` | 原生产数据库，保留全部活动记录；不要另建空数据库替换 |
| `ADMIN_PASSWORD` | 原主持人密码，至少 12 字符；若无法取回，需由账号持有人设置新密码 |
| `TASAY_LLM_API_KEY`、`TASAY_LLM_BASE_URL`、`TASAY_LLM_MODEL` | 原模型服务配置；缺失会导致 AI 对话不可用 |
| `TASAY_FAST_LLM_API_KEY`、`TASAY_FAST_LLM_BASE_URL`、`TASAY_FAST_LLM_MODEL` | 如果原站配置了快速模型，需在环境设置手动补齐 |
| `PUBLIC_ORIGIN` | 使用自定义域后设为完整 HTTPS origin，不带路径；未设置时使用 `RENDER_EXTERNAL_URL` |
| `PORT` | 平台自动提供，无须手动设置 |

继续使用原数据库无需重新初始化。不要运行清库、重置场次或导入空的本地 JSON。迁移不更换 Turso 数据格式。

## 公网验收与回退

- 首页、校园进入、`/admin` 登录、后台切换标签与留言列表正常；没有 402/503。
- 主持人公告/暂停能够同步到观众；隐藏页面停止定时通信，返回页面先同步最新状态。
- 校园登记、操场留言、两人五子棋、报告厅钢琴 F 分享及返回正常。
- 各作品 HTML/JS/模型/音视频可加载；测试大文件 Range 返回 206，AI 对话正常，返回校园保留体验记录。
- 使用正式域再次验证 Cookie、CSRF、后台控制和 HTTPS；测试域改为非主 origin 后不用于修改操作。
- 在控制台查看实际 CPU、内存和流量。现有本地测试不能替代大陆/微信浏览器网络、Render 冷启动和实际并发验收。

保留原 Vercel 项目与 DNS 记录备份。新站验收不通过时先不改 DNS；已切换后可恢复旧记录，但 Vercel 配额未恢复时旧站仍是暂停状态，不能将 DNS 回退等同于服务恢复。现有 Turso 需要保留，不能删除 Vercel Marketplace 的数据库集成来“清理旧环境”。

## 代理边界

独立服务器不能直接相信浏览器提供的 `Host`、`x-forwarded-proto`、`x-vercel-forwarded-for`。生产适配器使用配置的公开 origin 进行同源/安全 Cookie 判断，并使用 socket 对端地址做保守限流。同一代理后的管理员可能共享失败登录次数；没有确认可信代理规则前不开放任意 forwarded IP 信任。

切换公开 origin 时要同步 HTTPS/DNS 配置。与主 origin 不同的浏览器来源不能借助伪造请求头通过 CSRF 校验。
