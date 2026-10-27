# 过拟合恋人 · 校园接入适配

正式作品使用现有 `ta-say` 的 `index.html → src/main.tsx → src/App.tsx`。活动构建放到 `work-assets/tasay/`，服务地址为 `/works/tasay/`。`/works/tasay/chat` 等子路由必须回退到该作品的 `index.html`，不能回退校园首页。

## 构建

```sh
node integration/tasay/build.mjs --source /absolute/path/to/ta-say
```

`--source` 只用于构建，不编入观众端运行时。脚本在本目录忽略的 `.staging/` 中制作副本，复用原项目已经安装的依赖；不会改原目录。必要时先在原项目安装其锁定依赖。`--output` 可指定输出目录。跨域嵌入时可用 `--campus-origins https://campus.example.com` 声明可信宿主；默认只接受同源宿主。

复制白名单为正式 `src`、`public` 运行资源、入口 HTML、构建类型配置和两张被源模块引用的剧情 PNG。不会复制 `.env`、竞品数据、制作资料或旧 `dist`。

副本只进行接入层变换：

- `BrowserRouter` 添加 `/works/tasay/` basename；所有既有剧情路由保持原逻辑。
- 模型请求改为同源服务端代理，移除浏览器 Authorization；`.env` 不参与 Vite 构建。构建后再次比对私有值，防止密钥混入产物。
- 将 `report={activeReport}` 的既有 nullable 类型错误规范为 `report={activeReport ?? undefined}`，不改报告内容。
- 主入口先载入活动适配脚本，暂停故事定时器、动画帧、媒体和交互；恢复保留剩余时长。未改剧情条件、结束条件、原有存档键或叙事文本。

## 模型代理

`proxy.mjs` 采用 Web 标准 Request/Response，Node 与 Worker 均可调用：

```js
const handle = createTasayProxy({env});
const response = await handle(request, {audienceId: verifiedAudience.id});
```

宿主必须先验证观众 cookie，绝不能从观众 JSON 任取 `audienceId`。代理自身检查同源 Origin、消息大小、请求次数、并发数、输出 token 上限；不接受客户端自选模型地址或真实模型名。默认每位观众每分钟 6 次、每进程生命周期 40 次，总并发 8。多实例部署应传入共享的 `rateLimit(audienceId)`。

服务端环境变量为 `TASAY_LLM_API_KEY`、`TASAY_LLM_BASE_URL`、`TASAY_LLM_MODEL`，以及可选 `TASAY_FAST_LLM_*`。Node 可用 `loadTasayServerEnv({envFile})` 在私有服务端读取原 `.env` 的配置。生产使用托管平台的 runtime secrets；不要把它们放入 Vite 变量、源码或日志。

接口为 `/api/works/tasay/default/chat/completions` 和 `/api/works/tasay/fast/chat/completions`。原项目 Vite 中的开发假 API 不用于活动生产服务。原故事聊天本身采用现有规则和预写叙事，不需要模型请求；翻译和关系蒸馏则通过真实模型代理。模型未配置或调用失败会返回明确错误，不制造分析结果。

## 加载与暂停契约

父页面在 iframe URL 附加 `campusParentOrigin`、`campusAttempt`。脚本只接受同源或构建声明来源，并校验 `event.source === parent`。

React 正式 `main` 出现后发送 `campus:ready {workId:'tasay', level:'page_opened', attemptId}`，含义仅为“作品页面已打开”，不等于通关或所有外部装饰图片加载完成。可信父页面的 `campus:activity {paused}` 暂停／恢复，`campus:dispose` 停止待执行工作。返回校园由父层清晰按钮提供；适配脚本不抢占 Esc 或故事按键。

## 本轮验证

- 原版工作区 tracked 文件未改；源 commit 为 `9d9d37df8bbb0a7fd67e95600688d99b94c7e052`。
- 原版基线测试：70 项中 60 通过、10 失败，主要为已有剧情断言和旧翻译器接口不一致。原版类型检查已有 7 个错误（正式页面 nullable 1 个、旧测试 6 个），未把它们冒充本轮通过。
- 隔离副本正式源码类型检查、Vite 构建通过；发布资源约 4.1 MB，包含两张真实剧情 PNG。
- `node --test integration/tasay/*.test.mjs`：13/13 通过，覆盖来源校验、暂停剩余时长、interval/RAF、销毁、服务端鉴权前置、限速、并发释放、模型重写与敏感诊断不外泄。
- 使用本机既有模型配置，向真实服务发送一次不含私人信息的连接检查，返回 HTTP 200 且有模型响应；没有输出或复制密钥。
- 实际浏览器故事交互、校园返回与最终部署地址由整合验收继续核对，不能用以上构建／接口结果替代。

## 同轮主持人控制台增量

现有 `admin.html` 增加“观众记录”页签；没有新增第二套控制服务。管理员登录后可以按昵称或观众 ID 查找，查看到访、打开、加载失败、返回和当前体验。多个窗口归并为同一匿名观众；“页面已打开”“运行画面已就绪”和通关不混淆。记录仅通过管理端带 cookie 的 `/api/admin/audience` 与个人明细接口读取。

全场控制中的阶段下拉及引导文字仅修改 `phase`，不会自动恢复／暂停活动或重置位置。入口编辑增加作品关联，“载入三个作品点位”只补齐缺少的稳定 ID；已有点位的位置、开放状态和文案保持原值。自定义作品可以填写稳定 ID 和真实 URL。

`admin-ui.test.mjs` 使用构建副本已安装的 JSDOM 运行真实管理端 HTML/JS；也可用 `TASAY_SOURCE=/absolute/path/to/ta-say node --test integration/tasay/admin-ui.test.mjs`。3 项行为测试覆盖去重统计、私有接口、昵称转义、失败／返回状态、阶段独立性、并发阶段冲突、作品合并及正式 URL。连同作品适配与代理共 16 项通过。本轮相关观众领域测试与上述测试合计 24 项通过，校园正式 Vite 构建通过；浏览器视觉和最终部署仍由整体验收单独验证。
