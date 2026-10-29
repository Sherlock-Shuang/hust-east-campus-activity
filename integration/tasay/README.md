# 过拟合恋人 · 校园接入适配

正式作品使用现有 `ta-say` 的 `index.html → src/main.tsx → src/App.tsx`。活动构建放到 `work-assets/tasay/`，服务地址为 `/works/tasay/`。`/works/tasay/chat` 等子路由必须回退到该作品的 `index.html`，不能回退校园首页。

## 构建

```sh
node integration/tasay/build.mjs --source /absolute/path/to/ta-say
```

`--source` 只用于构建，不编入观众端运行时。脚本在本目录忽略的 `.staging/` 中制作副本，复用原项目已经安装的依赖；不会改原目录。必要时先在原项目安装其锁定依赖。`--output` 可指定输出目录。跨域嵌入时可用 `--campus-origins https://campus.example.com` 声明可信宿主；默认只接受同源宿主。

复制白名单为正式 `src`、`public` 运行资源、入口 HTML、构建类型配置和两张被源模块引用的剧情 PNG。不会复制 `.env`、竞品数据、制作资料或旧 `dist`。

副本进行以下接入层与校园界面变换：

- `BrowserRouter` 添加 `/works/tasay/` basename；所有既有剧情路由保持原逻辑。
- 模型请求改为同源服务端代理，移除浏览器 Authorization；`.env` 不参与 Vite 构建。构建后再次比对私有值，防止密钥混入产物。
- 将 `report={activeReport}` 的既有 nullable 类型错误规范为 `report={activeReport ?? undefined}`，不改报告内容。
- 主入口先载入活动适配脚本，暂停故事定时器、动画帧、媒体和交互；恢复保留剩余时长。

## 原版剧情恢复（2026-10-29）

按用户要求撤回“回声项目—多窗口调查—身份替代”改写。`ui-overrides/src/config/hardcodedCopy.ts` 与 `src/features/reply/replyFallbacks.ts` 精确取自原项目提交 `9d9d37df8bbb0a7fd67e95600688d99b94c7e052`，作为持久化叙事基准；不从当前未提交的改写文案构建。朋友圈恢复该提交的原动态。聊天页移除新增调查任务、核对提示、预填疑问入口。

原主线保持：甜蜜开场 → 第三次发送开始的连续消息改写 → 第 15 条对话出现监控图和“我会一直盯着你” → 第 28 条对话触发定位 → “回头／骗你的／我无处不在” → 原真相与梦醒文案。删稿、读档和朋友圈异常保持原行为。计数包含双方非系统消息，不是玩家发送次数。真相按钮恢复“梦醒”；保留直接进入聊天以及聊天内呈现尾声的现有容器。独立的开源项目入口见下节，不参与主线流程。

保留手机微信布局、防拉伸、输入法、草稿、滚动、存储容错及异步取消修复。恢复版使用 `ta-say:original-story:*` 独立存档，旧版 `ta-say:session`、`ta-say:persisted` 和 `ta-say:investigation-ui:v1` 不删除或覆盖；首次打开恢复版从原开场开始，之后正常续玩。

## 独立项目入口（2026-10-30）

按用户最新要求，“她不一样 · 恋情分析室”已从过拟合恋人的结局、聊天菜单和发现页移至爱因斯坦广场独立入口，地址 `/works/she-love-me/`，不再要求通关。过拟合恋人的原剧情、手机布局和存档保持原行为；既有完成标记没有清除，但不再用于此项目的访问资格。

独立页面源码在 `public/works/she-love-me/`，提供开源仓库、MIT 许可链接、可复制使用指令及手动复制降级；沿用公共 activity bridge 的暂停和返回校园功能。项目在电脑的 AI 编程助手中运行，页面不上传或分析聊天记录。

新地图点 `point-she-love-me` 位于爱因斯坦雕像东南侧铺装（x=848.45、z=-61.39，触发半径6米），开放和定时设置始终跟随过拟合恋人。旧活动配置读取时补齐，不修改现有活动坐标、修订号或主持人设置，下一次正常保存时持久化。没有过拟合恋人主入口时，这个关联入口保持关闭。

验证：`TASAY_SOURCE=/absolute/path/to/ta-say node --test integration/tasay/she-love-project.test.mjs`；构建后运行 `QA_OUTPUT_DIR=/absolute/path/to/evidence node scripts/verify-she-love-entry.mjs` 验证旧配置补齐、广场进入、外链、手机布局、暂停返回及同步关闭。

## 手机微信布局（2026-10-28）

`ui-overrides/` 是校园版的持久化界面源，构建时覆盖到 `.staging/`，不会回写原 `ta-say`。入口最后加载 `src/campus-mobile.css`，其手机规则适用宽度 ≤860px 或 ≤1024px 的短横屏；桌面继续三栏布局。

- 聊天列表与聊天页分屏；列表包含搜索、通讯录、发现和我，所有入口连接现有联系人、收藏及朋友圈。
- 聊天页采用 48px 顶栏、40px 方形头像、灰底、白/绿色气泡、居中分组时间与底部输入栏。读档和虚构退出移入右上角菜单，正常返回列表不触发退出剧情。
- 表情插入、更多面板、多行输入、中文输入法保护、发送保持焦点；本作品继续使用文字交流。
- 草稿写入防抖并在页面隐藏/失焦时保存；会话切换记住本次浏览中的滚动位置。读历史时新回复不抢滚动，底部阅读时跟随文本、图片与视口高度变化。
- 朋友圈使用封面、右下头像、连续白底动态。原收藏/群聊内容、朋友圈访问次数和故事转场保持。
- `useChatViewport` 处理本窗口与同源 iframe 的可见区域，保留双指缩放、横竖屏与安全区；提供减弱动态效果支持。跨源宿主和不改变视口的浮动键盘需由宿主/设备另行处理。

验证命令：

```sh
node --test integration/tasay/adapter.test.mjs integration/tasay/proxy.test.mjs integration/tasay/chat-viewport.test.mjs
node scripts/verify-tasay-mobile.mjs
```

浏览器回归使用隔离上下文并拦截模型接口；设备仿真不等同于真实 iOS/Android 软键盘验证。可交互手机预览在 `/artifacts/tasay-mobile-2026-10-28/preview.html`。

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
